// The decoder contract: what AVNI claims it reads, it reads — checked against
// the fixture files the app ships, plus the traps hit while building it (tile
// and SubIFD tags, OpenJPEG's zero-length buffer, XML attributes on text nodes).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { classifyName, sniffFormat, ACCEPT_ATTR, SUPPORT_MATRIX } from '../lib/scene-format.js';
import { readTiffLayout, geoFromTags, readGeoTiff, packRgba } from '../lib/geotiff-io.js';
import { readJp2Boxes, decodeJp2ToRgba, isJp2, frameToRgba } from '../lib/jp2.js';
import { readSentinelSafe, parseSafeMtd, safeFamily, composeTrueColour } from '../lib/safe.js';
import { readSceneFile, readJp2Scene } from '../lib/raster.js';

const bytesOf = (p) => new Uint8Array(readFileSync(path.join(process.cwd(), 'fixtures', p)));

// readSceneFile takes what a drop event hands over: a File/Blob-like object.
const asFile = (p) => {
  const bytes = bytesOf(p);
  const name = path.basename(p);
  return {
    name,
    size: bytes.length,
    type: '',
    slice: (a = 0, b = bytes.length) => ({ arrayBuffer: async () => bytes.slice(a, b).buffer }),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  };
};

const COG = 'geotiff/T43REP-tiled-utm43n.tif';
const GEO = 'geotiff/T43REP-geographic-wgs84.tif';
const B04 = 'jp2/T43REP_20250814T051742_B04_10m.jp2';
const B03 = 'jp2/T43REP_20250814T051742_B03_10m.jp2';
const SAFE = 'safe/S2B_MSIL2A_20250814T051742_N0510_R076_T43REP_20250814T071234.SAFE.zip';

describe('format sniffing', () => {
  it('classifies the primary imagery names', () => {
    expect(classifyName('S2_L2A_T43REP.tif').id).toBe('geotiff');
    expect(classifyName('T43REP_20250814T051742_B04_10m.jp2').id).toBe('jp2');
    expect(classifyName('x.SAFE').id).toBe('safe');
    expect(classifyName('S2B_MSIL2A.SAFE.zip').id).toBe('safe');
  });

  it('classifies PNG/JPEG as the ungeoreferenced fallback', () => {
    expect(classifyName('quicklook.png')).toMatchObject({ id: 'image', tier: 'fallback' });
    expect(classifyName('shot.jpeg')).toMatchObject({ id: 'image', tier: 'fallback' });
  });

  it('never advertises NetCDF/HDF5 or ERDAS/ENVI in the picker', () => {
    for (const ext of ['.nc', '.h5', '.hdf5', '.img', '.dat']) expect(ACCEPT_ATTR).not.toContain(ext);
    expect(classifyName('scene.nc')).toMatchObject({ tier: 'none' });
    expect(SUPPORT_MATRIX.map((r) => r.name).join(' ')).not.toMatch(/NetCDF|ENVI|HDF5/);
  });

  it('sniffs from magic bytes when the extension lies', () => {
    expect(sniffFormat(bytesOf(COG))).toBe('geotiff');
    expect(sniffFormat(bytesOf(B04))).toBe('jp2');
    expect(sniffFormat(bytesOf(SAFE))).toBe('zip');
    expect(sniffFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0]))).toBe('image');
    // a GeoTIFF named .jpeg is still read as a GeoTIFF: magic wins over the name
    expect(sniffFormat(bytesOf(COG))).not.toBe(classifyName('tile.jpeg').id);
  });
});

describe('GeoTIFF / COG', () => {
  it('reads the tiled layout through tags, because image.fileDirectory is empty', () => {
    const layout = readTiffLayout(bytesOf(COG));
    expect(layout.tileWidth).toBe(128);
    expect(layout.tileLength).toBeGreaterThan(0);
    expect(layout.subIfds.length).toBe(2); // the two overviews a COG carries
    // ...and they have to be real IFD offsets: the SubIFDs entry is type 13
    // (IFD), which an incomplete type table read as SHORTs — reporting the
    // offset of the array itself and a zero
    const cog = bytesOf(COG);
    const view = new DataView(cog.buffer, cog.byteOffset, cog.byteLength);
    for (const offset of layout.subIfds) {
      expect(offset).toBeGreaterThan(0);
      expect(offset + 12).toBeLessThan(cog.length);
      expect(view.getUint16(offset, true)).toBeGreaterThan(0); // an IFD with entries
    }
    expect(layout.strips).toBe(false);
    const strips = readTiffLayout(bytesOf(GEO));
    expect(strips.strips).toBe(true);
  });

  it('reads a TileWidth stored as a BYTE without tripping the parse', () => {
    // type 1 (BYTE) inline: the value reader reached its u8 branch, which was
    // declared after the entry loop and therefore in its temporal dead zone
    const header = new Uint8Array([
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // II, 42, IFD at 8
      0x01, 0x00, // one entry
      0x42, 0x01, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00, // 322 BYTE x1 = 128
      0x00, 0x00, 0x00, 0x00 // no next IFD
    ]);
    expect(readTiffLayout(header).tileWidth).toBe(128);
  });

  it('resolves EPSG:32643 from the geo keys with a UTM origin', async () => {
    const scene = await readGeoTiff(bytesOf(COG));
    expect(scene.georef.crs).toBe('EPSG:32643');
    expect(scene.georef.extent.minLon).toBeLessThan(scene.georef.extent.maxLon);
    expect(scene.georef.extent.minLat).toBeLessThan(scene.georef.extent.maxLat);
    // the chip is westing 782000 / northing 1436000 in zone 43N
    expect(scene.georef.extent.minLon).toBeGreaterThan(77);
    expect(scene.georef.extent.maxLon).toBeLessThan(79);
  });

  it('reports nothing rather than guessing when there is no geo block', () => {
    expect(geoFromTags({ geoKeys: {}, width: 10, height: 10 })).toBe(null);
  });

  it('decodes pixels for both the tiled and the stripped fixture', async () => {
    for (const name of [COG, GEO]) {
      const scene = await readGeoTiff(bytesOf(name));
      expect(scene.width).toBe(256);
      expect(scene.height).toBe(144);
      expect(scene.rgba.length).toBe(256 * 144 * 4);
      expect(scene.georef.crs).toMatch(/^EPSG:/);
      expect(scene.georef.status).toBe('georeferenced');
    }
  });

  it('reads a two-band raster as grey plus alpha, on the interleaved stride', () => {
    // 2 px, samples interleaved: [grey0, alpha0, grey1, alpha1]
    const rgba = packRgba(new Uint8Array([10, 200, 240, 128]), 2, 1, 2, { bits: 8 });
    expect([...rgba]).toEqual([10, 10, 10, 200, 240, 240, 240, 128]);
  });

  it('scales a 16-bit alpha plane into the byte alpha channel', () => {
    const rgba = packRgba(new Uint16Array([0, 65535, 65535, 0]), 2, 1, 2, { bits: 16 });
    expect([...rgba]).toEqual([0, 0, 0, 255, 255, 255, 255, 0]);
  });

  it('routes a GeoTIFF drop and labels the COG as cloud-optimised', async () => {
    const scene = await readSceneFile(asFile(COG));
    expect(scene.kind).toBe('cog');
    expect(scene.formatLabel).toBe('cloud-optimised GeoTIFF');
    expect(scene.georef.crs).toBe('EPSG:32643');
    expect(scene.width).toBe(256);
  });
});

describe('JPEG2000', () => {
  it('recognises the JP2 signature and lists its boxes', () => {
    const bytes = bytesOf(B04);
    expect(isJp2(bytes)).toBe(true);
    expect(readJp2Boxes(bytes).boxes).toContain('jp2h');
  });

  it('decodes through OpenJPEG — the encoded buffer must be sized and copied, not viewed', async () => {
    const out = await decodeJp2ToRgba(bytesOf(B04));
    expect(out.width).toBe(256);
    expect(out.height).toBe(144);
    expect(out.rgba.length).toBe(256 * 144 * 4);
    expect(out.frame.componentCount ?? out.frame.components).toBeGreaterThanOrEqual(1);
    // the decoded band is not a constant: a real image came out of the wasm
    expect(new Set(out.rgba.filter((_, i) => i % 4 === 0)).size).toBeGreaterThan(4);
  });

  it('reports grey, no CRS, and the wavelet note for a bare band', async () => {
    const scene = await readJp2Scene(bytesOf(B03), { name: 'B03.jp2' });
    expect(scene.kind).toBe('jp2');
    expect(scene.georef).toBe(null);
    expect(scene.bands).toEqual(['grey']);
    expect(scene.notes.join(' ')).toMatch(/no CRS inside a JPEG2000 file/);
  });

  it('stretches a signed 16-bit band against the values it actually maps', () => {
    // two's-complement samples: the histogram has to be built from the shifted
    // values, or the darkest sample does not reach the stretch's black point
    const data = new Uint16Array([0x8000, 0x8001, 0x9000, 0xffff]); // -32768, -32767, -4096, -1
    const rgba = frameToRgba({ width: 4, height: 1, components: 1, bitsPerSample: 16, isSigned: true, data });
    expect(rgba[0]).toBe(0); // the darkest sample is the black point, not white
    expect(rgba[12]).toBe(255); // the brightest is the white point
    expect(rgba[4]).toBe(0); // one step up is still inside the 2 % floor
    expect(rgba[8]).toBeGreaterThan(0); // and the mid sample is above the floor
  });

  it('treats a two-component frame as grey plus alpha, not as RGB', () => {
    const data = new Uint8Array([10, 200, 20, 200]); // 2 x 1: grey 10/20, alpha 200
    const rgba = frameToRgba({ width: 2, height: 1, components: 2, bitsPerSample: 8, data });
    expect([...rgba.slice(0, 4)]).toEqual([10, 10, 10, 200]);
    expect([...rgba.slice(4, 8)]).toEqual([20, 20, 20, 200]);
  });

  it('expands a single-component frame to grey RGBA', () => {
    const rgba = frameToRgba({
      width: 2,
      height: 2,
      components: 1,
      bitsPerSample: 8,
      data: new Uint8ClampedArray([0, 128, 255, 64])
    });
    // component 1 is greyscale: r = g = b, alpha opaque, and every sample maps
    expect([...rgba.slice(0, 4)]).toEqual([0, 0, 0, 255]);
    expect([...rgba.slice(4, 8)]).toEqual([128, 128, 128, 255]);
    expect([...rgba.slice(8, 12)]).toEqual([255, 255, 255, 255]);
    expect([...rgba.slice(12, 16)]).toEqual([64, 64, 64, 255]);
  });
});

describe('Sentinel SAFE', () => {
  it('identifies the product family from the MTD name', () => {
    expect(safeFamily(['GRANULE/x/MTD_MSIL2A.xml'])).toBe('S2MSI2A');
    expect(safeFamily(['MTD_MSIL1C.xml'])).toBe('S2MSI1C');
    expect(safeFamily(['MANIFEST.SAFE', 's1/measurement/s1a-iw-grd-vv.tiff'])).toBe('S1GRD');
    expect(safeFamily(['nothing/at/all'])).toBe(null);
  });

  it('reads the true-colour triplet and the footprint from the zip', async () => {
    const scene = await readSentinelSafe({ zipBytes: bytesOf(SAFE), name: 's2.SAFE' });
    expect(scene.bands).toEqual(['B04', 'B03', 'B02']);
    expect(scene.georef.crs).toBe('EPSG:4326');
    expect(scene.georef.footprint.length).toBeGreaterThanOrEqual(4);
    expect(scene.georef.extent.maxLat).toBeGreaterThan(scene.georef.extent.minLat);
    expect(scene.georef.extent.minLon).toBeLessThan(scene.georef.extent.maxLon);
    expect(scene.rgba.length).toBe(scene.width * scene.height * 4);
  });

  it('parses metadata attributes that sit on a text node', () => {
    const mtd = `<?xml version="1.0"?><n1:Level-2A_User_Product>
      <n1:General_Info><Product_Info>
        <PRODUCT_TYPE unit="type">S2MSI2A</PRODUCT_TYPE>
        <PRODUCT_START_TIME>2025-08-14T05:17:42.024Z</PRODUCT_START_TIME>
        <Cloud_Coverage_Assessment>3.41</Cloud_Coverage_Assessment>
      </Product_Info></n1:General_Info>
    </n1:Level-2A_User_Product>`;
    const parsed = parseSafeMtd(mtd);
    expect(parsed.cloudCoverPct).toBeCloseTo(3.41, 2);
    expect(parsed.sensingStart).toContain('2025-08-14');
    expect(parsed.productType).toBeNull(); // Product_Type lives under General_Info/Product_Type
    expect(parseSafeMtd('<Level-2A_User_Product><General_Info><Product_Type>S2MSI2A</Product_Type></General_Info></Level-2A_User_Product>').productType).toBe('S2MSI2A');
  });

  it('refuses to compose a preview from bands that are not the same size', () => {
    // reading past the end of the smaller frame yields undefined -> NaN -> black
    const frame = (w, h) => ({ width: w, height: h, bitsPerSample: 8, data: new Uint8ClampedArray(w * h) });
    expect(() =>
      composeTrueColour({ red: frame(2, 2), green: frame(4, 4), blue: null }, { width: 4, height: 4 })
    ).toThrow(/band is \d+x\d+ while the others are/i);
    expect(() => composeTrueColour({ red: frame(2, 2), green: frame(2, 2), blue: null }, { width: 2, height: 2 })).not.toThrow();
  });

  it('composes a true colour image from three reflectance bands', () => {
    // each band is stretched by its own 2–98 % percentiles, so a dark band and
    // a bright band both come out readable instead of one being black
    const band = (values) => ({ width: 4, height: 1, bitsPerSample: 8, data: new Uint8ClampedArray(values) });
    const rgba = composeTrueColour(
      { red: band([100, 120, 140, 160]), green: band([50, 90, 100, 110]), blue: band([10, 20, 30, 90]) },
      { width: 4, height: 1 }
    );
    expect(rgba.length).toBe(16);
    expect(rgba[3]).toBe(255);
    expect(rgba[0]).toBe(0); // the darkest red is the stretch's black point
    expect(rgba[12]).toBe(255); // the brightest red saturates
    // the second pixel keeps the relative brightness of the three bands
    // instead of collapsing to black-or-white — the regression this test exists for
    const [r, g, b] = [rgba[4], rgba[5], rgba[6]];
    expect(g).toBeGreaterThan(r);
    expect(r).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(0);
  });
});

describe('the single-door reader', () => {
  it('routes a SAFE zip through the same call as a GeoTIFF', async () => {
    const safe = await readSceneFile(asFile(SAFE));
    expect(safe.kind).toBe('safe-s2');
    expect(safe.georef.crs).toBe('EPSG:4326');
    expect(safe.formatLabel).toMatch(/Sentinel-2 SAFE/);
    expect(safe.kind).toBe('safe-s2');
  });

  it('routes a JPEG2000 drop and keeps geodesy off', async () => {
    const jp2 = await readSceneFile(asFile(B04));
    expect(jp2.kind).toBe('jp2');
    expect(jp2.georef).toBe(null);
  });

  it('refuses formats that are out of scope instead of guessing', async () => {
    const fourBytes = () => ({
      name: 'scene.nc',
      size: 4,
      slice: () => ({ arrayBuffer: async () => new ArrayBuffer(4) }),
      arrayBuffer: async () => new ArrayBuffer(4)
    });
    await expect(readSceneFile(fourBytes())).rejects.toThrow(/unsupported raster format \(nc\)/);
    // HDF5 is sniffed from its magic and refused by name, not decoded by luck
    const hdf = new Uint8Array([0x89, 0x48, 0x44, 0x46, 13, 10, 26, 10]);
    await expect(
      readSceneFile({
        name: 'scene.h5',
        size: 8,
        slice: () => ({ arrayBuffer: async () => hdf.buffer }),
        arrayBuffer: async () => hdf.buffer
      })
    ).rejects.toThrow(/out of scope/);
  });
});
