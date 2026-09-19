// One door for imagery, whichever container it arrives in.
//
// readSceneFile() looks at the bytes (not the extension), routes to the right
// reader, and returns a single descriptor the rest of the console understands:
//
//   { kind, formatLabel, sensor, width, height, rgba, bitmap, georef, bands,
//     notes, acquired, meta }
//
// `georef` is either null (nothing usable in the file) or a sceneGeo-shaped
// object with status 'georeferenced' | 'unknown'. A scene that cannot be
// located is *not* silently treated as located: the caller switches the
// geodesy features off.

import { classifyName, sniffFormat } from './scene-format.js';
import { decodeJp2Raw, frameToRgba, isJp2, readJp2Boxes, readJp2GmlBounds } from './jp2.js';
import { footprintToGeo, isSafePath, safeEntriesFromZip, safeFamily, readSentinelSafe } from './safe.js';

export const SNIFF_BYTES = 128;

const error = (message, detail = {}) => Object.assign(new Error(message), { sceneError: true, ...detail });

async function headBytes(file, n = SNIFF_BYTES) {
  return new Uint8Array(await file.slice(0, n).arrayBuffer());
}

/** RGBA preview of a browser-decodable image (PNG/JPEG/WebP). No georeference. */
async function readImagePreview(file, { maxPixels = 4_000_000 } = {}) {
  if (typeof createImageBitmap !== 'function') {
    throw error('this environment cannot decode browser images', { fallback: true });
  }
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw error('the browser could not decode this image');
  const scale = Math.min(1, Math.sqrt(maxPixels / (bitmap.width * bitmap.height)));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas =
    typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  return { width, height, rgba: data, bitmap, sourceWidth: bitmap.width, sourceHeight: bitmap.height };
}

/** JPEG2000 (with an optional GML envelope inside the container). */
export async function readJp2Scene(bytes, { maxPixels = 4_000_000, name = 'scene.jp2' } = {}) {
  const frame = await decodeJp2Raw(bytes);
  const rgba = frameToRgba(frame);
  const boxes = isJp2(bytes) ? readJp2Boxes(bytes) : { boxes: [], header: null };
  const gml = isJp2(bytes) ? readJp2GmlBounds(bytes) : null;
  const georef = gml
    ? footprintToGeo(gml, {
        crs: 'EPSG:4326',
        source: 'GML envelope inside the JPEG2000 container',
        mapping: 'linear over the GML envelope',
        approximate: true
      })
    : null;

  return {
    ok: true,
    kind: 'jp2',
    formatLabel: `JPEG2000 (${boxes.boxes.includes('jp2c') ? 'JP2 container' : 'raw codestream'})`,
    sensor: 'JPEG2000 raster',
    fileName: name,
    width: frame.width,
    height: frame.height,
    rgba,
    georef,
    bands: frame.components === 1 ? ['grey'] : frame.components === 3 ? ['R', 'G', 'B'] : ['R', 'G', 'B', 'A'],
    notes: [
      `${frame.components} component${frame.components === 1 ? '' : 's'} · ${frame.bitsPerSample} bit`,
      frame.isReversible ? 'reversible 5/3 wavelet' : 'irreversible 9/7 wavelet',
      gml ? 'GML envelope found in the container' : 'no CRS inside a JPEG2000 file — Sentinel-2 JP2 georeference lives in the SAFE metadata'
    ],
    meta: { boxes: boxes.boxes, header: boxes.header }
  };
}

/**
 * Route a dropped file to its reader.
 * `onProgress` receives { stage, ... } so the rail can say what is happening.
 */
export async function readSceneFile(file, { maxPixels = 4_000_000, onProgress } = {}) {
  if (!file) throw error('no file');
  const name = file.name || 'scene';
  const hint = classifyName(name);
  const head = await headBytes(file);
  const sniffed = sniffFormat(head);
  const kind = sniffed === 'j2k' ? 'jp2' : sniffed || hint.id;

  onProgress?.({ stage: 'identified', kind, name });

  if (kind === 'zip' || kind === 'safe') {
    onProgress?.({ stage: 'reading archive', name });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const entries = safeEntriesFromZip(bytes);
    const family = safeFamily(entries.map((e) => e.path));
    if (!family && !entries.length) {
      throw error('this archive does not look like a Sentinel SAFE product', { kind: 'zip' });
    }
    const scene = await readSentinelSafe({ zipBytes: bytes, name }, { onProgress });
    return { ...scene, bytesRead: bytes.length, entryCount: entries.length };
  }

  if (kind === 'geotiff') {
    const { readGeoTiff } = await import('./geotiff-io.js');
    onProgress?.({ stage: 'reading GeoTIFF tags', name });
    const tif = await readGeoTiff({ file }, { maxPixels, onProgress });
    return {
      ok: true,
      kind: tif.kind,
      formatLabel: tif.kind === 'cog' ? 'cloud-optimised GeoTIFF' : 'GeoTIFF',
      sensor: 'GeoTIFF raster',
      fileName: name,
      width: tif.width,
      height: tif.height,
      sourceWidth: tif.sourceWidth,
      sourceHeight: tif.sourceHeight,
      rgba: tif.rgba,
      georef: tif.georef,
      bands: tif.samples === 1 ? ['grey'] : tif.samples === 3 ? ['R', 'G', 'B'] : [`${tif.samples} bands`],
      notes: tif.notes,
      meta: { layout: tif.layout, bits: tif.bits }
    };
  }

  if (kind === 'jp2') {
    onProgress?.({ stage: 'decoding JPEG2000', name });
    return readJp2Scene(new Uint8Array(await file.arrayBuffer()), { maxPixels, name });
  }

  if (kind === 'image' || hint.tier === 'fallback') {
    onProgress?.({ stage: 'decoding image', name });
    const preview = await readImagePreview(file, { maxPixels });
    return {
      ok: true,
      kind: 'image',
      formatLabel: 'PNG/JPEG (fallback)',
      sensor: 'undocumented raster',
      fileName: name,
      width: preview.width,
      height: preview.height,
      sourceWidth: preview.sourceWidth,
      sourceHeight: preview.sourceHeight,
      rgba: preview.rgba,
      bitmap: preview.bitmap,
      georef: null,
      bands: ['R', 'G', 'B', 'A'],
      notes: ['no CRS in a PNG/JPEG — geodesy features are off for this scene'],
      meta: {}
    };
  }

  if (kind === 'hdf5') {
    throw error('NetCDF/HDF5 rasters are out of scope for AVNI', { kind: 'hdf5' });
  }

  throw error(`unsupported raster format (${name.split('.').pop() || 'unknown'})`, { kind: hint.id });
}

/** A dropped folder: what a .SAFE directory looks like in the browser. */
export async function readSceneDirectory(files, { onProgress } = {}) {
  const list = Array.from(files || []);
  if (!list.length) throw error('empty folder');
  const paths = list.map((f) => f.webkitRelativePath || f.name);
  const family = safeFamily(paths);
  if (!family && !paths.some(isSafePath)) {
    throw error('this folder is not a Sentinel SAFE product');
  }
  onProgress?.({ stage: 'reading SAFE folder', files: list.length });
  return readSentinelSafe({ files: list, name: paths[0]?.split('/')[0] || 'scene.SAFE' }, { onProgress });
}

/**
 * Remote scenes: a COG on a web server is read with HTTP range requests
 * (geotiff.js), a plain image is fetched whole. This is the path that makes
 * "cloud-optimised" mean something — the console reads a window, not the file.
 */
export async function readSceneUrl(url, { maxPixels = 4_000_000, onProgress, fetchImpl = fetch } = {}) {
  const parsed = new URL(url, globalThis.location?.href || 'http://localhost');
  const hint = classifyName(parsed.pathname);
  onProgress?.({ stage: 'probing remote scene', url: parsed.href });

  // probe the first bytes so remote routing uses magic too
  const probe = await fetchImpl(parsed.href, { headers: { Range: 'bytes=0-127' } });
  if (!probe.ok && probe.status !== 206) throw error(`remote scene returned ${probe.status}`);
  const head = new Uint8Array(await probe.arrayBuffer());
  const sniffed = sniffFormat(head);
  const acceptRanges = probe.headers?.get?.('accept-ranges') || (probe.status === 206 ? 'bytes' : null);
  const kind = sniffed === 'j2k' ? 'jp2' : sniffed || hint.id;

  if (kind === 'geotiff') {
    const { readGeoTiff } = await import('./geotiff-io.js');
    const tif = await readGeoTiff({ url: parsed.href }, { maxPixels, onProgress });
    return {
      ok: true,
      kind: tif.kind,
      formatLabel: tif.kind === 'cog' ? 'cloud-optimised GeoTIFF (remote)' : 'GeoTIFF (remote)',
      sensor: 'GeoTIFF raster',
      fileName: parsed.pathname.split('/').pop(),
      width: tif.width,
      height: tif.height,
      rgba: tif.rgba,
      georef: tif.georef,
      bands: tif.samples === 1 ? ['grey'] : ['R', 'G', 'B'],
      notes: [...tif.notes, acceptRanges ? 'server advertises range requests' : 'no range support advertised'],
      meta: { layout: tif.layout, url: parsed.href }
    };
  }

  const full = await fetchImpl(parsed.href);
  if (!full.ok) throw error(`remote scene returned ${full.status}`);
  const bytes = new Uint8Array(await full.arrayBuffer());
  if (kind === 'jp2') return readJp2Scene(bytes, { maxPixels, name: parsed.pathname.split('/').pop() });
  if (kind === 'image') {
    const blob = new Blob([bytes], { type: full.headers?.get?.('content-type') || 'image/png' });
    const preview = await readImagePreview(blob, { maxPixels });
    return {
      ok: true,
      kind: 'image',
      formatLabel: 'PNG/JPEG (fallback, remote)',
      sensor: 'undocumented raster',
      fileName: parsed.pathname.split('/').pop(),
      width: preview.width,
      height: preview.height,
      rgba: preview.rgba,
      bitmap: preview.bitmap,
      georef: null,
      bands: ['R', 'G', 'B'],
      notes: ['no CRS — geodesy features are off for this scene'],
      meta: { url: parsed.href }
    };
  }
  throw error(`unsupported remote raster (${kind})`);
}

/** What the rail shows after a successful register. */
export function describeScene(scene) {
  const located = scene.georef && scene.georef.status === 'georeferenced';
  return [
    scene.formatLabel,
    scene.bands?.length ? scene.bands.join('+') : null,
    located ? scene.georef.crs : 'no CRS',
    scene.notes?.[0] || null
  ]
    .filter(Boolean)
    .join(' · ');
}

/** A canvas holding the decoded preview: the drawable the viewer samples. */
export function makeCanvas(width, height) {
  const canvas =
    typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });
  return canvas;
}

/**
 * Turn a decoded scene into something the renderer and the segmenter can both
 * use: a drawable (canvas) and the pixel window that produced it.
 */
export function sourceFromScene(scene) {
  if (!scene?.ok) return null;
  const width = scene.width;
  const height = scene.height;
  let canvas = null;
  let pixels = null;
  const canDraw = typeof document !== 'undefined' || typeof OffscreenCanvas === 'function';
  if (canDraw && scene.rgba) {
    canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.putImageData(new ImageData(new Uint8ClampedArray(scene.rgba), width, height), 0, 0);
      pixels = { data: new Uint8ClampedArray(scene.rgba), width, height };
    }
  }
  return { ...scene, canvas, bitmap: canvas, pixels };
}

/** Bundled demo scenes are URLs; the renderer needs pixels, so rasterise them. */
export async function loadSceneSource(url, { name = 'scene', label = null, crossOrigin = null } = {}) {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    throw error('no DOM image decoding in this environment');
  }
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = crossOrigin;
    img.onload = () => resolve(img);
    img.onerror = () => reject(error(`could not load ${url}`));
    img.src = url;
  });
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0);
  let pixels = null;
  try {
    pixels = ctx.getImageData(0, 0, width, height);
  } catch {
    pixels = null; // tainted canvas: segmentation falls back to the bitmap
  }
  return { url, name, label, width, height, canvas, bitmap: canvas, pixels, kind: 'fixture' };
}
