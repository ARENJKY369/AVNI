// Sentinel SAFE reading.
//
// A SAFE product is a directory tree (sometimes shipped as a .zip). AVNI reads
// the product metadata for the things that are actually in it — sensing time,
// cloud cover, the footprint polygon and the UTM tile — then builds the
// true-colour preview the way the ground segment does: B04→red, B03→green,
// B02→blue, each band stretched on its own percentiles.
//
// Nothing here invents a georeference. The footprint comes from the product's
// own MTD footprint block; if a product does not carry one, the scene is
// reported as unlocated and the geodesy features stay off.

import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { decodeJp2Raw, frameToRgba } from './jp2.js';

const MAX_UNCOMPRESSED = 320 * 1024 * 1024; // refuse to inflate a monster archive

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: true,
  trimValues: true
});

export const SAFE_MTD_RE = /(^|\/)MTD_(MSIL[12][AC]|L2A_User_Product|L1C_User_Product)\.xml$/i;
const BAND_RE = /IMG_DATA\/(?:R(\d+)m\/)?[^/]*_(B0[2-8]|B8A?|B1[12])_?(?:(\d+)m)?\.jp2$/i;

/** Which Sentinel family is this product? */
export function safeFamily(paths) {
  const joined = paths.join('\n');
  if (/MTD_MSIL2A\.xml/.test(joined)) return 'S2MSI2A';
  if (/MTD_MSIL1C\.xml/.test(joined)) return 'S2MSI1C';
  if (/MANIFEST\.SAFE/.test(joined) && /\/measurement\/.*\.tiff$/im.test(joined)) return 'S1GRD';
  if (/MTD_MSIL2A|MTD_MSIL1C/.test(joined)) return 'S2';
  if (/\/measurement\//.test(joined)) return 'S1GRD';
  return null;
}

export const isSafePath = (name) => /\.SAFE(\/|$)/i.test(String(name)) || /MTD_MSIL[12][AC]\.xml$/i.test(String(name));

/** Depth-first read of the few entries a SAFE reader needs. */
function pick(entries) {
  const wanted = { mtd: null, manifest: null, tileMtd: null, measurements: [], bands: [] };
  for (const e of entries) {
    const path = e.path;
    if (!wanted.mtd && SAFE_MTD_RE.test(path)) wanted.mtd = e;
    else if (!wanted.manifest && /MANIFEST\.SAFE$/i.test(path)) wanted.manifest = e;
    else if (!wanted.tileMtd && /MTD_TL\.xml$/i.test(path)) wanted.tileMtd = e;
    const band = path.match(BAND_RE);
    if (band) wanted.bands.push({ path, entry: e, band: band[2].toUpperCase(), res: Number(band[1] || band[3] || 0) || null });
    if (/\/measurement\/[^/]+\.tiff?$/i.test(path)) wanted.measurements.push({ path, entry: e });
  }
  return wanted;
}

/** Unzip just the members we read (fflate filters before inflating). */
export function safeEntriesFromZip(bytes, { maxUncompressed = MAX_UNCOMPRESSED } = {}) {
  const keep = (file) =>
    SAFE_MTD_RE.test(file.name) ||
    /MANIFEST\.SAFE$/i.test(file.name) ||
    /MTD_TL\.xml$/i.test(file.name) ||
    /IMG_DATA\/.*\.jp2$/i.test(file.name) ||
    /\/measurement\/[^/]+\.tiff?$/i.test(file.name);
  const files = unzipSync(bytes, { filter: (file) => keep(file) && file.originalSize < maxUncompressed });
  return Object.entries(files).map(([path, data]) => ({ path, bytes: data }));
}

/** Normalise a FileList (folder drop or webkitdirectory) into {path, file} entries. */
export function safeEntriesFromFiles(files) {
  return Array.from(files).map((f) => ({
    path: f.webkitRelativePath || f.name,
    file: f
  }));
}

/** XML leaves become objects when they carry attributes: read either shape. */
const numberish = (node) => {
  const raw = node && typeof node === 'object' ? node['#text'] : node;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

const text = async (entry) => {
  if (entry.bytes) return new TextDecoder().decode(entry.bytes);
  return entry.file.text();
};
const bytesOf = async (entry) => {
  if (entry.bytes) return entry.bytes;
  return new Uint8Array(await entry.file.arrayBuffer());
};

/** The MTD_MSIL2A/1C product metadata: sensing time, cloud, footprint, tile. */
export function parseSafeMtd(xml) {
  const doc = parser.parse(xml);
  const root = doc['Level-2A_User_Product'] || doc['Level-1C_User_Product'] || doc.User_Product || doc;
  const info = root?.General_Info || {};
  const product = info.Product_Info || {};
  const footprintNode = root?.Product_Footprint?.Global_Footprint;
  const posList = footprintNode?.EXT_POS_LIST;

  // EXT_POS_LIST is a flat "lat lon lat lon …" run (whitespace or newline separated)
  const numbers = String(posList ?? '')
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  const footprint = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    footprint.push([numbers[i], numbers[i + 1]]);
  }

  const uri = String(product.PRODUCT_URI || '');
  const tileMatch = uri.match(/_T(\d{2}[A-Z]{3})_/) || String(root?.Product_Image_Characteristics?.PRODUCT_URI || '').match(/_T(\d{2}[A-Z]{3})_/);

  return {
    productType: info.Product_Type || null,
    datatake: product.Datatake || null,
    sensingStart: product.PRODUCT_START_TIME || null,
    sensingStop: product.PRODUCT_STOP_TIME || null,
    cloudCoverPct: Number.isFinite(product.Cloud_Coverage_Assessment) ? product.Cloud_Coverage_Assessment : null,
    degraded: product.Degraded_MSI_Ancillary_Quality_Flag || null,
    uri: uri || null,
    tileId: tileMatch ? tileMatch[1] : null,
    quantification: numberish(root?.Product_Image_Characteristics?.QUANTIFICATION_VALUE),
    footprint
  };
}

/** HORIZONTAL_CS_CODE from the tile metadata: the EPSG the SAFE is laid out in. */
export function parseGranuleGeocoding(xml) {
  if (!xml) return null;
  const doc = parser.parse(xml);
  const walk = (node) => {
    if (!node || typeof node !== 'object') return null;
    if (node.HORIZONTAL_CS_CODE) return String(node.HORIZONTAL_CS_CODE);
    for (const value of Object.values(node)) {
      const found = walk(value);
      if (found) return found;
    }
    return null;
  };
  const code = walk(doc);
  const epsg = code ? Number(String(code).replace(/^EPSG:/i, '')) : NaN;
  return Number.isFinite(epsg) ? { code, epsg } : code ? { code, epsg: null } : null;
}

/** Sentinel-1 annotation header: product type, polarisation, start time. */
export function parseS1Annotation(xml) {
  if (!xml) return null;
  const doc = parser.parse(xml);
  const header = doc?.product?.adsHeader || doc?.adsHeader || {};
  return {
    productType: header.productType || null,
    polarisation: header.polarisation || null,
    mode: header.mode || null,
    sensingStart: header.startTime || null,
    absoluteOrbit: header.absoluteOrbitNumber || null
  };
}

/** sceneGeo-shaped footprint from a lat/lon ring. */
export function footprintToGeo(footprint, { crs = 'EPSG:4326', source, mapping, approximate = false } = {}) {
  if (!footprint || footprint.length < 3) return null;
  const lats = footprint.map((p) => p[0]);
  const lons = footprint.map((p) => p[1]);
  return {
    status: 'georeferenced',
    crs,
    source,
    mapping,
    approximate,
    extent: {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLon: Math.min(...lons),
      maxLon: Math.max(...lons)
    },
    footprint
  };
}

/**
 * Compose RGB from the reflectance bands. Each band is stretched on its own
 * 2-98 % percentiles (Sentinel-2 L2A is 16-bit reflectance, so raw values are
 * unusable as screen colours without it).
 */
export function composeTrueColour({ red, green, blue }, { width, height }) {
  const out = new Uint8ClampedArray(width * height * 4);
  const stretchBand = (frame) => {
    const px = frame.width * frame.height;
    const data = frame.bitsPerSample > 8 ? new Uint16Array(frame.data.buffer, frame.data.byteOffset, px) : frame.data;
    const max = frame.bitsPerSample > 8 ? 65535 : 255;
    const hist = new Uint32Array(256);
    for (let i = 0; i < px; i += 1) hist[Math.min(255, Math.round((data[i] / max) * 255))] += 1;
    const target = px * 0.02;
    let lo = 0;
    let hi = 255;
    let acc = 0;
    for (let i = 0; i < 256; i += 1) {
      acc += hist[i];
      if (acc >= target) {
        lo = i;
        break;
      }
    }
    acc = 0;
    for (let i = 0; i < 256; i += 1) {
      acc += hist[i];
      if (acc >= px - target) {
        hi = i;
        break;
      }
    }
    if (hi <= lo) hi = lo + 1;
    // scale *then* round: rounding inside the scale quantises every band to
    // 0 or 255, which turns a true-colour preview into eight flat colours
    return (v) => Math.max(0, Math.min(255, Math.round((((v / max) * 255 - lo) / (hi - lo)) * 255)));
  };

  const bands = [red, green, blue].filter(Boolean);
  const maps = bands.map(stretchBand);
  for (let i = 0; i < width * height; i += 1) {
    for (let c = 0; c < bands.length; c += 1) {
      const frame = bands[c];
      const px = frame.width * frame.height;
      const data = frame.bitsPerSample > 8 ? new Uint16Array(frame.data.buffer, frame.data.byteOffset, px) : frame.data;
      out[i * 4 + c] = maps[c](data[i]);
    }
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Read a Sentinel SAFE product — dropped as a folder or as a .zip.
 * Returns the same shape as every other reader in raster.js.
 */
export async function readSentinelSafe({ zipBytes, files, name = 'scene.SAFE' } = {}, { onProgress } = {}) {
  const entries = zipBytes
    ? safeEntriesFromZip(zipBytes)
    : safeEntriesFromFiles(files || []);
  if (!entries.length) throw new Error('no readable files in this SAFE product');

  const family = safeFamily(entries.map((e) => e.path));
  const { mtd, tileMtd, measurements, bands } = pick(entries);
  const notes = [];
  let meta = null;
  let georef = null;
  let sensor = 'Sentinel (SAFE)';
  let acquired = null;

  if (family === 'S1GRD') {
    // Sentinel-1: read the annotation for the pass details and the measurement
    // GeoTIFF (or its GCPs) for the footprint.
    const annotation = entries.find((e) => /annotation\/s1[^/]*\.xml$/i.test(e.path));
    if (annotation) {
      const parsed = parseS1Annotation(await text(annotation));
      if (parsed) {
        sensor = `Sentinel-1 GRD${parsed.polarisation ? ` · ${parsed.polarisation}` : ''}`;
        acquired = parsed.sensingStart || null;
        meta = parsed;
        notes.push(`annotation: ${parsed.productType || 'GRD'}${parsed.mode ? ` ${parsed.mode}` : ''}`);
      }
    }
    if (!measurements.length) throw new Error('Sentinel-1 product has no measurement raster');
    const { readGeoTiff } = await import('./geotiff-io.js');
    onProgress?.({ stage: 'reading measurement', path: measurements[0].path });
    const tif = await readGeoTiff({ file: await bytesOf(measurements[0]) });
    if (tif.georef) {
      georef = tif.georef;
      notes.push('footprint from the measurement GCPs');
    }
    return {
      ok: true,
      kind: 'safe-s1',
      formatLabel: 'Sentinel-1 GRD (SAFE)',
      sensor,
      fileName: name,
      width: tif.width,
      height: tif.height,
      rgba: tif.rgba,
      georef,
      bands: [meta?.polarisation || 'measurement'],
      notes: [...notes, ...tif.notes],
      acquired,
      meta
    };
  }

  if (!mtd) throw new Error('no MTD_MSIL2A.xml / MTD_MSIL1C.xml in this product');
  const parsed = parseSafeMtd(await text(mtd));
  meta = parsed;
  acquired = parsed.sensingStart || null;
  sensor = parsed.productType
    ? `Sentinel-2 ${parsed.productType === 'S2MSI2A' ? 'L2A' : 'L1C'}`
    : 'Sentinel-2';

  const granule = tileMtd ? parseGranuleGeocoding(await text(tileMtd)) : null;
  if (granule?.epsg) notes.push(`granule geocoding: ${granule.code}`);
  if (parsed.cloudCoverPct !== null) notes.push(`cloud cover ${parsed.cloudCoverPct} %`);
  if (parsed.tileId) notes.push(`tile T${parsed.tileId}`);

  if (parsed.footprint.length >= 3) {
    georef = footprintToGeo(parsed.footprint, {
      crs: 'EPSG:4326',
      source: `SAFE product metadata (${'MTD_MSIL2A.xml'}) Product_Footprint`,
      mapping: 'linear over the product footprint bbox (UTM raster, not resampled)',
      approximate: true
    });
    notes.push(`footprint: ${parsed.footprint.length} vertices from the product metadata`);
  } else {
    notes.push('no Product_Footprint in the metadata — coordinates withheld');
  }

  // choose the finest resolution that has all three visible bands
  const byRes = new Map();
  for (const b of bands) {
    const res = b.res || 0;
    if (!byRes.has(res)) byRes.set(res, {});
    byRes.get(res)[b.band] = b;
  }
  const usable = [...byRes.entries()]
    .filter(([, set]) => set.B04 && set.B03 && set.B02)
    .sort((a, b) => (a[0] || 999) - (b[0] || 999));
  const chosen = usable[0] || [...byRes.entries()].sort((a, b) => (a[0] || 999) - (b[0] || 999))[0];

  if (!chosen) throw new Error('no IMG_DATA JP2 bands found in this product');
  const set = chosen[1];
  const wanted = ['B04', 'B03', 'B02'].map((id) => set[id]).filter(Boolean);
  if (!wanted.length) throw new Error('no visible bands (B02/B03/B04) in this product');

  onProgress?.({ stage: 'decoding bands', bands: wanted.map((b) => b.band) });
  const decoded = [];
  for (const b of wanted) {
    decoded.push(await decodeJp2Raw(await bytesOf(b.entry)));
  }

  const width = decoded[0].width;
  const height = decoded[0].height;
  const rgba =
    decoded.length >= 3
      ? composeTrueColour({ red: decoded[0], green: decoded[1], blue: decoded[2] }, { width, height })
      : frameToRgba(decoded[0]);

  return {
    ok: true,
    kind: 'safe-s2',
    formatLabel: `Sentinel-2 SAFE${chosen[0] ? ` · ${chosen[0]} m bands` : ''}`,
    sensor,
    fileName: name,
    width,
    height,
    rgba,
    georef,
    bands: wanted.map((b) => b.band),
    notes,
    acquired,
    meta
  };
}
