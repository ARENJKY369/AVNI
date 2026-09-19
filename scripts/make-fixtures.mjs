// Builds the binary fixtures the format tests and the browser passes read.
//
//   node scripts/make-fixtures.mjs
//
// Everything is synthetic and tiny on purpose (fixtures/ stays under a few
// hundred kB): a georeferenced tiled GeoTIFF in EPSG:32643 (the tile this
// console's demo scene lives in), a geographic GeoTIFF, three single-band
// JPEG2000 files standing in for Sentinel-2 B04/B03/B02, and a Sentinel SAFE
// product (zip) containing a real MTD_MSIL2A.xml footprint plus those bands.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { writeArrayBuffer } from 'geotiff';
import { zipSync } from 'fflate';

const OUT = path.resolve('fixtures');
const TMP = path.join(OUT, '.tmp');
const SCENE = path.resolve('src/assets/scene-optical.jpg');

// demo footprint: tile 43REP, 256 x 144 px at 60 m — a 15.36 x 8.64 km chip
const W = 256;
const H = 144;
const PIXEL_M = 60;
const E0 = 782000; // westing of the chip inside zone 43N
const N0 = 1436000;
const SENSING = '2025-08-14T05:17:42.000Z';
const TILE = '43REP';

const clean = () => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  for (const dir of ['geotiff', 'jp2', 'safe']) {
    mkdirSync(path.join(OUT, dir), { recursive: true });
  }
  mkdirSync(TMP, { recursive: true });
};

const magick = (args) => execFileSync('convert', args, { stdio: ['ignore', 'ignore', 'pipe'] });

// --- a greyscale band, as the Sentinel-2 IMG_DATA jp2 files are -------------
// ImageMagick writes the JP2 container through OpenJPEG 2.5.0; the app decodes
// it with the same OpenJPEG compiled to wasm, so this is a real round trip.
function band(tag, resize) {
  const out = path.join(OUT, 'jp2', `T${TILE}_20250814T051742_${tag}.jp2`);
  magick([SCENE, '-resize', resize, '-colorspace', 'Gray', '-depth', '8', '-quality', '30', out]);
  return out;
}

// --- georeferenced GeoTIFF --------------------------------------------------
// Written with tifffile (Python) rather than geotiff.js: the JS writer only
// emits stripped, uncompressed, tag-less TIFFs, and the whole point of this
// fixture is a *tiled* file with overviews and a real GeoKeyDirectory block —
// i.e. the COG layout plus the CRS tags GDAL/PROJ read.
const PY_TIFF = String.raw`
import sys, numpy as np, tifffile
out, mode = sys.argv[1], sys.argv[2]
W, H, PX = 256, 144, 60.0
E0, N0 = 782000.0, 1436000.0
ramp = (np.add.outer(np.arange(H) * 5, np.arange(W) * 3) % 251).astype('uint8')
if mode == 'utm':
    scale = (PX, PX, 0.0)
    tie = (0.0, 0.0, 0.0, E0, N0, 0.0)
    keys = (1, 1, 0, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 32643)
    citation = 'WGS 84 / UTM zone 43N|'
else:
    dlon = PX / (111320.0 * np.cos(np.radians(13.0)))
    dlat = PX / 110574.0
    scale = (dlon, dlat, 0.0)
    tie = (0.0, 0.0, 0.0, 77.501156, 13.031374, 0.0)
    keys = (1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326)
    citation = 'WGS 84|'
extratags = [
    (33550, 'd', 3, scale, False),
    (33922, 'd', 6, tie, False),
    (34735, 'H', len(keys), keys, False),
    (34737, 's', 0, citation, False),
]
tiled = mode == 'utm'
with tifffile.TiffWriter(out) as tw:
    if tiled:
        tw.write(ramp, tile=(128, 128), photometric='minisblack', extratags=extratags, subifds=2)
        for lvl in (ramp[::2, ::2], ramp[::4, ::4]):
            tw.write(lvl, tile=(128, 128), photometric='minisblack', subfiletype=1)
    else:
        tw.write(ramp, photometric='minisblack', extratags=extratags)
`;

async function geoTiff(name, mode) {
  const file = path.join(OUT, 'geotiff', name);
  execFileSync('python3', ['-c', PY_TIFF, file, mode], { stdio: ['ignore', 'pipe', 'pipe'] });
  return file;
}

// --- Sentinel SAFE ----------------------------------------------------------
const MTD = ({ footprintOnly = false } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<n1:Level-2A_User_Product xmlns:n1="https://psd-14.sentinel2.eo.esa.int/PSD/User_Product_Level-2A.xsd">
  <n1:General_Info>
    <Product_Type>S2MSI2A</Product_Type>
    <Product_Info>
      <PRODUCT_START_TIME>${SENSING}</PRODUCT_START_TIME>
      <PRODUCT_STOP_TIME>2025-08-14T05:17:52.000Z</PRODUCT_STOP_TIME>
      <PRODUCT_URI>S2B_MSIL2A_20250814T051742_N0510_R076_T${TILE}_20250814T071234.SAFE</PRODUCT_URI>
      <Datatake>S2B-2</Datatake>
      <Cloud_Coverage_Assessment>3.41</Cloud_Coverage_Assessment>
      <Degraded_MSI_Ancillary_Quality_Flag>A</Degraded_MSI_Ancillary_Quality_Flag>
    </Product_Info>
  </n1:General_Info>
  <n1:Product_Image_Characteristics>
    <QUANTIFICATION_VALUE unit="none">10000</QUANTIFICATION_VALUE>
    <Special_Values>
      <SPECIAL_VALUE_TEXT>NODATA</SPECIAL_VALUE_TEXT>
      <SPECIAL_VALUE_INDEX>0</SPECIAL_VALUE_INDEX>
    </Special_Values>
  </n1:Product_Image_Characteristics>
  ${footprintOnly ? '' : `<n1:Product_Footprint>
    <n1:Global_Footprint>
      <EXT_POS_LIST>
        13.031374 77.501156 13.031374 77.704244 12.920226 77.704244 12.920226 77.501156 13.031374 77.501156
      </EXT_POS_LIST>
    </n1:Global_Footprint>
  </n1:Product_Footprint>`}
</n1:Level-2A_User_Product>
`;

function safeProduct(bandFiles) {
  const root = `S2B_MSIL2A_20250814T051742_N0510_R076_T${TILE}_20250814T071234.SAFE`;
  const granule = `GRANULE/L2A_T${TILE}_A012345_20250814T051742`;
  const tree = {
    [`${root}/MTD_MSIL2A.xml`]: Buffer.from(MTD()),
    [`${root}/manifest.safe`]: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>\n<xfd:XFDU xmlns:xfd="urn:ccsds:schema:xfdu:1"><informationPackageMap><contentUnit textInfo="S2B_MSIL2A_20250814T051742_N0510_R076_T${TILE}"/></informationPackageMap></xfd:XFDU>\n`
    ),
    [`${root}/${granule}/MTD_TL.xml`]: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>\n<n1:Level-2A_Tile_ID xmlns:n1="https://psd-14.sentinel2.eo.esa.int/PSD/User_Product_Level-2A.xsd"><n1:Geometric_Info><Tile_Geocoding><HORIZONTAL_CS_NAME>WGS84 / UTM zone 43N</HORIZONTAL_CS_NAME><HORIZONTAL_CS_CODE>EPSG:32643</HORIZONTAL_CS_CODE></Tile_Geocoding></n1:Geometric_Info></n1:Level-2A_Tile_ID>\n`
    ),
    [`${root}/${granule}/IMG_DATA/R10m/T${TILE}_20250814T051742_B02_10m.jp2`]: bandFiles.B02,
    [`${root}/${granule}/IMG_DATA/R10m/T${TILE}_20250814T051742_B03_10m.jp2`]: bandFiles.B03,
    [`${root}/${granule}/IMG_DATA/R10m/T${TILE}_20250814T051742_B04_10m.jp2`]: bandFiles.B04
  };
  const zipped = zipSync(tree, { level: 6 });
  const file = path.join(OUT, 'safe', `${root}.zip`);
  writeFileSync(file, Buffer.from(zipped));
  return { file, root, tree };
}

clean();
const tiled = await geoTiff(`T${TILE}-tiled-utm43n.tif`, 'utm');
const geographic = await geoTiff(`T${TILE}-geographic-wgs84.tif`, 'geographic');
const B02 = readFileSync(band('B02_10m', '256x144!'));
const B03 = readFileSync(band('B03_10m', '256x144!'));
const B04 = readFileSync(band('B04_10m', '256x144!'));
const safe = safeProduct({ B02, B03, B04 });
rmSync(TMP, { recursive: true, force: true });

const list = [tiled, geographic, safe.file, ...['B02_10m', 'B03_10m', 'B04_10m'].map((t) => path.join(OUT, 'jp2', `T${TILE}_20250814T051742_${t}.jp2`))];
let total = 0;
for (const f of list) {
  const kb = statSync(f).size / 1024;
  total += kb;
  console.log(`${(kb).toFixed(1).padStart(8)} kB  ${path.relative(process.cwd(), f)}`);
}
console.log(`${total.toFixed(1)} kB total`);
