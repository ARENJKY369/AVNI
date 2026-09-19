// What AVNI will open as imagery, and what it means when it does.
//
// The rule this file encodes: the *primary* formats are the ones an EO analyst
// actually gets from the ground segment — GeoTIFF, cloud-optimised GeoTIFF,
// JPEG2000 and Sentinel SAFE — and they are read for pixels *and* for
// georeference. PNG/JPEG stay accepted, but only as a fallback: pixels with no
// CRS, so every geodesy feature is switched off rather than guessed.
//
// Deliberately not supported: NetCDF/HDF5 (`.nc`, `.h5`) and legacy ERDAS
// IMAGINE / ENVI (`.img`, `.dat`, `.hdr`, `.bil`, `.ers`). They are named here
// so the UI can say "not supported" out loud instead of failing on decode.

export const PRIMARY_EXTS = ['.tif', '.tiff', '.jp2', '.j2k', '.j2c', '.safe', '.zip'];
export const FALLBACK_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.avif', '.bmp'];
export const UNSUPPORTED_EXTS = [
  '.nc',
  '.nc4',
  '.h5',
  '.hdf',
  '.hdf5',
  '.img',
  '.dat',
  '.bil',
  '.hdr',
  '.ers',
  '.grd',
  '.envi'
];

export const ACCEPT_ATTR = [...PRIMARY_EXTS, ...FALLBACK_EXTS].join(',');

const ext = (name) => {
  const s = String(name || '').toLowerCase();
  const base = s.split(/[\\/]/).pop() || s;
  const i = base.lastIndexOf('.');
  return i === -1 ? '' : base.slice(i);
};

/**
 * Name-level classification. This is a *hint* — `sniffFormat` reads magic
 * bytes and wins, because `scene.jpeg` that is really a GeoTIFF must be read
 * as a GeoTIFF.
 */
export function classifyName(name) {
  const e = ext(name);
  const s = String(name || '').toLowerCase();
  if (e === '.zip' && s.includes('.safe')) return { id: 'safe', tier: 'primary', label: 'Sentinel SAFE (zip)' };
  if (e === '.safe') return { id: 'safe', tier: 'primary', label: 'Sentinel SAFE' };
  if (e === '.zip') return { id: 'zip', tier: 'primary', label: 'archive' };
  if (e === '.tif' || e === '.tiff') return { id: 'geotiff', tier: 'primary', label: 'GeoTIFF' };
  if (e === '.jp2' || e === '.j2k' || e === '.j2c') return { id: 'jp2', tier: 'primary', label: 'JPEG2000' };
  if (FALLBACK_EXTS.includes(e)) return { id: 'image', tier: 'fallback', label: 'image (no CRS)' };
  if (UNSUPPORTED_EXTS.includes(e)) return { id: 'unsupported', tier: 'none', label: 'unsupported raster format' };
  return { id: 'unknown', tier: 'none', label: 'unrecognised' };
}

const ascii = (bytes, at, len) => String.fromCharCode(...bytes.slice(at, at + len));

/** Magic-byte format detection: extensions lie, headers do not. */
export function sniffFormat(bytes) {
  if (!bytes || bytes.length < 4) return null;
  // TIFF: little (II*\0) or big (MM\0*) endian
  if (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) return 'geotiff';
  if (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a) return 'geotiff';
  // JPEG2000 family
  if (ascii(bytes, 4, 4) === 'jP  ') return 'jp2';
  if (bytes[0] === 0xff && bytes[1] === 0x4f && bytes[2] === 0xff && bytes[3] === 0x51) return 'j2k';
  // PNG
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') return 'image';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image';
  if (ascii(bytes, 0, 3) === 'GIF') return 'image';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image';
  if (ascii(bytes, 0, 2) === 'PK') return 'zip';
  // HDF5 signature - named so we can refuse it politely
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'HDF') return 'hdf5';
  return null;
}

export const isPrimary = (id) => id === 'geotiff' || id === 'jp2' || id === 'j2k' || id === 'safe';

/**
 * One line of UI copy per outcome, so the rail never claims more than the
 * decoder actually delivered.
 */
export function describeResult({ kind, georef, bands = [], notes = [] }) {
  const located = georef && georef.status === 'georeferenced';
  const suffix = located
    ? `${georef.crs} footprint read from the file`
    : 'no CRS in the file — geodesy features off';
  const extra = notes.length ? ` · ${notes[0]}` : '';
  return `${kind} · ${bands.length ? `${bands.join('/')} ` : ''}${suffix}${extra}`;
}

export const SUPPORT_MATRIX = [
  { id: 'geotiff', name: 'GeoTIFF (.tif/.tiff)', read: 'pixels + CRS + footprint', tier: 'primary' },
  { id: 'cog', name: 'Cloud-optimised GeoTIFF', read: 'tiled reads + overviews + CRS', tier: 'primary' },
  { id: 'jp2', name: 'JPEG2000 (.jp2/.j2k)', read: 'pixels (OpenJPEG/WASM)', tier: 'primary' },
  { id: 'safe', name: 'Sentinel SAFE (.SAFE/.zip)', read: 'bands + MTD footprint', tier: 'primary' },
  { id: 'png', name: 'PNG / JPEG', read: 'pixels only — no CRS, geodesy off', tier: 'fallback' }
];

export const UNSUPPORTED_NOTE = 'NetCDF/HDF5 and ERDAS IMAGINE / ENVI rasters are out of scope';
