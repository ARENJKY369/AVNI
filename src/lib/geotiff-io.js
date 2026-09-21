// GeoTIFF and cloud-optimised GeoTIFF reading.
//
// The pixels come from geotiff.js (which handles both stripped and tiled
// layouts, and reads a COG over HTTP with range requests). The georeference
// comes from the file's own tag block: ModelPixelScale + ModelTiepoint for the
// footprint, GeoKeyDirectory for the CRS. Anything we cannot resolve to WGS84
// is reported as unresolved rather than guessed — an upload that says
// "EPSG:32643" but whose corner we cannot project gets no coordinates.

import { utmToLatLon, utmZoneFromEpsg } from './geodesy.js';

const isNode = () => typeof process !== 'undefined' && !!process.versions?.node && typeof window === 'undefined';

const loadGeotiff = () => import('geotiff');

/**
 * Minimal first-IFD reader for the three tags that describe a COG's layout
 * (TileWidth/TileLength/SubIFDs). geotiff.js lazily parses only the fields it
 * needs, so the layout summary is read straight off the header instead of
 * being guessed from the decode path.
 */
export function readTiffLayout(bytes) {
  if (!bytes || bytes.length < 8) return null;
  const little = bytes[0] === 0x49 && bytes[1] === 0x49;
  const big = bytes[0] === 0x4d && bytes[1] === 0x4d;
  if (!little && !big) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o) => view.getUint16(o, little);
  const u32 = (o) => view.getUint32(o, little);
  // declared before the entry loop: the value reader below can reach the BYTE
  // path, and a `const` declared after the loop was in its temporal dead zone
  const u8 = (o) => bytes[o];
  if (u16(2) !== 42) return null;
  const ifdOffset = u32(4);
  if (ifdOffset + 2 > bytes.length) return null;
  const entries = u16(ifdOffset);
  const out = { tileWidth: 0, tileLength: 0, subIfds: [], strips: false };
  for (let i = 0; i < entries; i += 1) {
    const at = ifdOffset + 2 + i * 12;
    if (at + 12 > bytes.length) break;
    const tag = u16(at);
    const type = u16(at + 2);
    const count = u32(at + 4);
    // 13 is IFD and 16/17/18 are the BigTIFF 64-bit types. Leaving 13 out made
    // the SubIFDs entry (tag 330, type 13) read as SHORTs, so a COG's overview
    // offsets came back as the offset of their own array and a zero.
    const size =
      { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4, 16: 8, 17: 8, 18: 8 }[type] || 0;
    if (size === 0) continue; // unknown field type: skip rather than read garbage
    const inline = size * count <= 4;
    const valueAt = inline ? at + 8 : u32(at + 8);
    const first = () => {
      if (inline) return size === 2 ? u16(at + 8) : size === 4 ? u32(at + 8) : u8(at + 8);
      if (size === 2) return u16(valueAt);
      if (size === 4) return u32(valueAt);
      return u8(valueAt);
    };
    if (tag === 322) out.tileWidth = first();
    if (tag === 323) out.tileLength = first();
    if (tag === 273) out.strips = true;
    if (tag === 330) {
      // offsets are LONG (4) or LONG8/IFD8 (8); a SHORT-typed entry would be
      // malformed, so read the wide form whenever the type declares it
      const step = size >= 4 ? size : 2;
      for (let k = 0; k < count; k += 1) {
        const at2 = valueAt + k * step;
        if (at2 + 4 > bytes.length) break;
        out.subIfds.push(size >= 8 ? u32(at2) + u32(at2 + 4) * 4294967296 : u32(at2));
      }
    }
  }
  return out;
}

/**
 * Read the geo tags into the shape the console reports to the user.
 * Returns null when the file carries no usable georeference.
 */
export function geoFromTags({ geoKeys = {}, bbox, origin, resolution, width, height }) {
  const projected = geoKeys.ProjectedCSTypeGeoKey ?? geoKeys.ProjectedCSType;
  const geographic = geoKeys.GeographicTypeGeoKey ?? geoKeys.GeographicType;
  const modelType = geoKeys.GTModelTypeGeoKey;
  if (!bbox || bbox.length !== 4) return null;

  const [minX, minY, maxX, maxY] = bbox;
  const corners = [
    [minX, maxY],
    [maxX, maxY],
    [minX, minY],
    [maxX, minY]
  ];

  // 4326 (or 2 = geographic model type): the file is already lat/lon
  const isGeographic = projected === undefined && (geographic === 4326 || modelType === 2);
  if (isGeographic) {
    const lats = corners.map((c) => c[1]);
    const lons = corners.map((c) => c[0]);
    return {
      status: 'georeferenced',
      crs: `EPSG:${geographic === 4326 || !geographic ? 4326 : geographic}`,
      source: 'GeoTIFF tags (GTModelType/GeoKeyDirectory)',
      mapping: 'linear over the file footprint (lat/lon raster, no warping needed)',
      extent: {
        minLat: Math.min(...lats),
        maxLat: Math.max(...lats),
        minLon: Math.min(...lons),
        maxLon: Math.max(...lons)
      },
      projected: { minX, minY, maxX, maxY },
      pixelScale: resolution ? [Math.abs(resolution[0]), Math.abs(resolution[1])] : null,
      raster: { width, height }
    };
  }

  const utm = projected !== undefined ? utmZoneFromEpsg(projected) : null;
  if (utm) {
    // project every corner (not just two) so a rotated footprint still
    // produces a correct bounding box
    const projectedCorners = corners.map(([e, n]) => utmToLatLon(e, n, utm.zone, utm.hemisphere));
    const lats = projectedCorners.map((c) => c.lat);
    const lons = projectedCorners.map((c) => c.lon);
    return {
      status: 'georeferenced',
      crs: `EPSG:${projected}`,
      source: `GeoTIFF tags (GeoKeyDirectory → EPSG:${projected})`,
      mapping: `WGS84 inverse transverse Mercator (UTM zone ${utm.zone}${utm.hemisphere}), footprint bbox`,
      extent: {
        minLat: Math.min(...lats),
        maxLat: Math.max(...lats),
        minLon: Math.min(...lons),
        maxLon: Math.max(...lons)
      },
      projected: { minX, minY, maxX, maxY },
      utm,
      pixelScale: resolution ? [Math.abs(resolution[0]), Math.abs(resolution[1])] : null,
      raster: { width, height }
    };
  }

  if (projected !== undefined || geographic !== undefined) {
    return {
      status: 'unknown',
      crs: `EPSG:${projected ?? geographic}`,
      source: `GeoTIFF tags name EPSG:${projected ?? geographic} — latitude/longitude conversion not supported`,
      reason: `projection EPSG:${projected ?? geographic} is outside the projections this console converts (WGS84 geographic and UTM)`
    };
  }

  return null;
}

export const packRgba = (values, width, height, samples, { bits = 8, isSigned = false } = {}) => {
  const px = width * height;
  const out = new Uint8ClampedArray(px * 4);

  if (samples === 1 || samples === 2) {
    // interleaved samples, so the grey plane is at stride `samples`. Reading it
    // at stride 1 mixed neighbouring pixels together and dropped the alpha
    // plane of a grey+alpha raster entirely.
    const stride = samples;
    const band = new Float64Array(px);
    for (let i = 0; i < px; i += 1) band[i] = values[i * stride];
    const scale = stretchFor(band, bits, isSigned);
    const alpha = bits > 8 ? (v) => Math.min(255, Math.round(v / 257)) : (v) => Math.min(255, Math.round(v));
    for (let i = 0; i < px; i += 1) {
      const v = scale(band[i]);
      out[i * 4] = v;
      out[i * 4 + 1] = v;
      out[i * 4 + 2] = v;
      out[i * 4 + 3] = samples === 2 ? alpha(values[i * stride + 1]) : 255;
    }
    return out;
  }

  const scale = [];
  for (let c = 0; c < Math.min(3, samples); c += 1) {
    const band = new Float64Array(px);
    for (let i = 0; i < px; i += 1) band[i] = values[i * samples + c];
    scale.push(stretchFor(band, bits, isSigned));
  }
  for (let i = 0; i < px; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      out[i * 4 + c] = scale[c] ? scale[c](values[i * samples + c]) : values[i * samples + c];
    }
    out[i * 4 + 3] = samples > 3 ? Math.min(255, values[i * samples + 3]) : 255;
  }
  return out;
};

/**
 * A 2-98 % percentile stretch for floating/high-bit-depth bands, and an
 * identity map for ordinary 8-bit imagery (so an 8-bit GeoTIFF previews
 * exactly as stored rather than being re-contrasted).
 */
export function stretchFor(band, bits, isSigned = false) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < band.length; i += 1) {
    const v = band[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return (v) => 0;
  if (!isSigned && bits <= 8 && min >= 0 && max <= 255) return (v) => v;
  const hist = new Uint32Array(1024);
  const span = max - min || 1;
  for (let i = 0; i < band.length; i += 1) {
    const v = band[i];
    if (!Number.isFinite(v)) continue;
    hist[Math.min(1023, Math.max(0, Math.round(((v - min) / span) * 1023)))] += 1;
  }
  const target = band.length * 0.02;
  let lo = 0;
  let hi = 1023;
  let acc = 0;
  for (let i = 0; i < 1024; i += 1) {
    acc += hist[i];
    if (acc >= target) {
      lo = i;
      break;
    }
  }
  acc = 0;
  for (let i = 0; i < 1024; i += 1) {
    acc += hist[i];
    if (acc >= band.length - target) {
      hi = i;
      break;
    }
  }
  if (hi <= lo) hi = lo + 1;
  const loV = min + (lo / 1023) * span;
  const hiV = min + (hi / 1023) * span;
  return (v) => Math.round(((v - loV) / (hiV - loV || 1)) * 255);
}

/**
 * Read a GeoTIFF/COG from a File/Blob or an HTTP(S) URL.
 *
 * `maxPixels` caps the preview raster: a 10980 x 10980 Sentinel-2 granule is
 * read with geotiff's own decimation instead of being pulled into memory at
 * full resolution.
 */
export async function readGeoTiff(input, { maxPixels = 4_000_000, blockSize = 65536, onProgress } = {}) {
  const { fromArrayBuffer, fromUrl } = await loadGeotiff();
  let tiff;
  let buffer = null;
  if (input?.url) {
    // COG over HTTP: geotiff.js issues range requests per tile, so a huge COG
    // never has to be downloaded to read one window
    tiff = await fromUrl(input.url, { blockSize, allowFullFile: false });
  } else {
    const rawInput = input?.file ?? input;
    buffer =
      rawInput instanceof ArrayBuffer
        ? rawInput
        : rawInput.buffer && rawInput.byteLength !== undefined && !rawInput.arrayBuffer
          ? rawInput.buffer
          : await rawInput.arrayBuffer();
    tiff = await fromArrayBuffer(buffer);
  }

  const count = await tiff.getImageCount();
  const image = await tiff.getImage(0);
  const width = image.getWidth();
  const height = image.getHeight();
  const samples = image.getSamplesPerPixel();
  const bits = image.getBitsPerSample?.() ?? 8;
  const isSigned = image.getSampleFormat?.() === 2;

  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
  const rw = Math.max(1, Math.round(width * scale));
  const rh = Math.max(1, Math.round(height * scale));

  onProgress?.({ stage: 'reading raster', width: rw, height: rh });
  const values = await image.readRasters({
    width: rw,
    height: rh,
    interleave: true,
    resampleMethod: 'bilinear'
  });

  const rgba = packRgba(values, rw, rh, samples, { bits, isSigned });
  const geoKeys = image.getGeoKeys?.() ?? {};
  const bbox = image.getBoundingBox?.() ?? null;
  const origin = image.getOrigin?.() ?? null;
  const resolution = image.getResolution?.() ?? null;

  // geotiff.js lazily parses only what it needs, so the layout summary is read
  // off the IFD itself: tiled? how many overview levels (SubIFDs)?
  const localLayout = buffer ? readTiffLayout(new Uint8Array(buffer)) : null;
  const tiled = image.isTiled === true || (localLayout?.tileWidth ?? 0) > 0;
  const overviews = localLayout?.subIfds?.length ?? Math.max(0, count - 1);

  const gcps = (() => {
    try {
      return image.getGCPs?.() ?? null;
    } catch {
      return null;
    }
  })();

  return {
    kind: tiled && overviews > 0 ? 'cog' : 'geotiff',
    width: rw,
    height: rh,
    sourceWidth: width,
    sourceHeight: height,
    samples,
    bits,
    rgba,
    georef:
      geoFromTags({ geoKeys, bbox, origin, resolution, width, height }) ??
      geoFromGcps(gcps, { width, height }),
    layout: {
      tiled,
      overviews,
      tileWidth: localLayout?.tileWidth || null,
      decimated: scale < 1 ? Math.round(1 / scale) : 1,
      remote: Boolean(input?.url)
    },
    notes: [
      tiled ? `tiled layout${localLayout?.tileWidth ? ` (${localLayout.tileWidth} px blocks)` : ''}` : 'stripped layout',
      (geoKeys.GTCitationGeoKey || '').trim() ? `citation: ${String(geoKeys.GTCitationGeoKey).trim()}` : null,
      overviews ? `${overviews} overview level${overviews > 1 ? 's' : ''}` : null,
      scale < 1 ? `read at 1/${Math.round(1 / scale)} resolution` : null,
      input?.url ? 'read over HTTP with range requests' : null
    ].filter(Boolean)
  };
}

/** GCP-based footprint — the georeference Sentinel-1 GRD measurement TIFFs carry. */
export function geoFromGcps(gcps, { width, height } = {}) {
  if (!gcps || gcps.length < 4) return null;
  const geo = gcps.filter((g) => Number.isFinite(g.latitude ?? g.y) && Number.isFinite(g.longitude ?? g.x));
  if (geo.length < 4) return null;
  const lats = geo.map((g) => g.latitude ?? g.y);
  const lons = geo.map((g) => g.longitude ?? g.x);
  return {
    status: 'georeferenced',
    crs: 'EPSG:4326',
    source: `GeoTIFF ground control points (${geo.length} GCPs, bilinear fit)`,
    mapping: 'bilinear fit through the GCP mesh — approximate between control points',
    approximate: true,
    extent: {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLon: Math.min(...lons),
      maxLon: Math.max(...lons)
    },
    raster: { width, height }
  };
}

export { isNode };
