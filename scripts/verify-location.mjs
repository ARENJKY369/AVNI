// Verifies the location-honesty pass end to end:
//  1. the bundled scene resolves a REAL place name (not a hardcoded string)
//  2. that name tracks the AOI, recomputing when the AOI moves
//  3. an upload with no CRS flips the console to "unlocated" everywhere
//     (header, viewer readout, geodetic row, every export path) instead of
//     reusing the previous scene's coordinates
//   npm run verify:location
import { launch, watchPage, APP_URL, SHOTS_DIR, prepareDirs } from './browser.mjs';
import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { writeArrayBuffer } from 'geotiff';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';

prepareDirs();
const execFileAsync = promisify(execFile);

const browser = await launch({ width: 1680, height: 950 });
const page = watchPage(await browser.newPage(), 'location');
// capture the exact bytes each export hands to the browser: the download
// plumbing itself is not something a headless CI box should depend on
await page.evaluateOnNewDocument(() => {
  window.__avniBlobs = [];
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    window.__avniBlobs.push(blob);
    return orig(blob);
  };
});
await page.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForNetworkIdle({ idleTime: 600 });
await new Promise((r) => setTimeout(r, 900));

const results = [];
const check = (name, ok, detail) => {
  results.push([name, ok, detail]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${String(detail).slice(0, 100)}`);
};

const header = () =>
  page.evaluate(() => {
    const h = document.querySelector('header');
    const block = [...h.querySelectorAll('span')].find((s) => s.textContent.includes('AOI'))?.parentElement;
    return block ? block.textContent.replace(/\s+/g, ' ').trim() : null;
  });
const readout = () =>
  page.evaluate(() => {
    const pills = [...document.querySelectorAll('span.pill')].map((s) => s.textContent.replace(/\s+/g, ' ').trim());
    return pills.filter((t) => /°[NSEW]|unlocated|m\/px/.test(t)).join(' | ');
  });

// --- 1. bundled scene resolves a real place
const h1 = await header();
console.log('header:', h1);
check('bundled scene names a real place', /Bengaluru|MG Road|Cubbon/.test(h1 || ''), h1);
check('name carries a distance+bearing', /\d(\.\d)? km [NSEW]{1,2}|at /.test(h1 || ''), h1);
check('scene reports a CRS', /gazetteer/.test(h1 || ''), h1);
const r1 = await readout();
check('viewer reports coordinates and a derived GSD', /°N/.test(r1) && /°E/.test(r1) && /m\/px/.test(r1), r1);

// --- 2. place name recomputes when the AOI moves
const box = await page.evaluate(() => {
  // the scene sheet (the footprint) is the transform target inside the viewer
  const r = document.querySelector('.scanlines').firstElementChild.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /^Draw (polygon|AOI)\b/.test(x.textContent.trim()));
  if (!b) throw new Error('no AOI-draw control on the rail');
  b.click();
});
for (const [u, v] of [[0.12, 0.1], [0.3, 0.12], [0.32, 0.3], [0.14, 0.28]]) {
  await page.mouse.click(box.x + box.w * u, box.y + box.h * v);
  await new Promise((r) => setTimeout(r, 120));
}
await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.5);
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 600));
const h2 = await header();
console.log('header after AOI move:', h2);
check('place recomputes with the AOI', h1 !== h2 && /km|at /.test(h2 || ''), `${h1} → ${h2}`);
await page.screenshot({ path: path.join(SHOTS_DIR, '10-location.jpg'), type: 'jpeg', quality: 84 });

// --- 3. a raster with no CRS must not inherit the old coordinates
// (an *undecodable* file is a different case: it is refused outright, which
// verify-console covers. Here the file decodes to real pixels — a PNG has no
// georeferencing at all — so the scene registers unlocated and every
// coordinate, area and export has to be withheld.)
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Restore bundled scene'))?.click());
await new Promise((r) => setTimeout(r, 400));
const png = path.join(tmpdir(), 'avni-location-unlocated.png');
await execFileAsync('convert', ['-size', '240x160', 'gradient:navy-orange', png]);
const input = await page.$('input[aria-label="register a scene file"]');
await input.uploadFile(png);
await new Promise((r) => setTimeout(r, 1600));

const h3 = await header();
const r3 = await readout();
console.log('header after upload:', h3);
console.log('viewer after upload:', r3);
check('upload of a CRS-less raster flags the scene unlocated', /unlocated/i.test(h3 || ''), h3);
check('viewer withholds coordinates', !/°N/.test(r3) && /unlocated/i.test(r3), r3);
check(
  'no fake preview is shown for an unreadable file',
  await page.evaluate(() => !document.body.innerText.includes('no renderable preview')),
  'the PNG decodes, so its own pixels are on screen'
);

const side = await page.evaluate(() => {
  const a = [...document.querySelectorAll('aside')][0];
  const idx = a.textContent.indexOf('unverified');
  return idx >= 0 ? a.textContent.slice(idx - 40, idx + 40).replace(/\s+/g, ' ').trim() : 'not found';
});
check('sidebar extent marked unverified', /unverified/.test(side), side);

// the same picture: a file that will not decode is refused, not half-registered
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Restore bundled scene'))?.click());
await new Promise((r) => setTimeout(r, 400));
const unknown = path.join(tmpdir(), 'unknown_scene.tif');
writeFileSync(unknown, 'II*\0 not-really-a-geotiff');
await (await page.$('input[type=file]')).uploadFile(unknown);
await new Promise((r) => setTimeout(r, 1400));
const refused = await page.evaluate(() => ({
  toast: /not registered/.test(document.body.innerText),
  stale: !/no renderable preview for unknown_scene\.tif/.test(document.body.innerText),
  name: /unknown_scene\.tif/.test(document.querySelector('aside').innerText)
}));
check('an undecodable file is refused rather than registered blank', refused.toast && refused.stale && !refused.name, JSON.stringify(refused));

// put the unlocated raster back for the export checks below
await (await page.$('input[type=file]')).uploadFile(png);
await new Promise((r) => setTimeout(r, 1600));
check('the CRS-less raster is back on screen', /unlocated/i.test((await header()) || ''), await header());

// ask a question: the geodetic row must withhold coordinates
await page.click('#composer-input');
await page.type('#composer-input', 'Where is flooding most severe?', { delay: 3 });
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 5000));
const geodetic = await page.evaluate(() => {
  const t = document.body.innerText;
  const i = t.indexOf('coordinates withheld');
  return i < 0 ? 'not found' : t.slice(i, i + 90).replace(/\s+/g, ' ').trim();
});
check('answer withholds coordinates', /coordinates withheld/.test(geodetic), geodetic);

// export menu: the geometry export must be disabled
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Export result'));
  b && b.click();
});
await new Promise((r) => setTimeout(r, 400));
const geoItem = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('withheld · no georeference'));
  return b ? { disabled: b.disabled, text: b.textContent.replace(/\s+/g, ' ').trim() } : null;
});
check('GeoJSON export disabled when unlocated', !!geoItem && geoItem.disabled, JSON.stringify(geoItem));
await page.screenshot({ path: path.join(SHOTS_DIR, '11-unlocated.jpg'), type: 'jpeg', quality: 84 });

// the JSON bundle is downloadable but must not contain coordinates
const readLastBlob = () =>
  page.evaluate(async () => {
    const b = window.__avniBlobs[window.__avniBlobs.length - 1];
    return b ? await b.text() : null;
  });
// the menu is still open from the check above — clicking "Export result"
// again would toggle it shut
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('evidence bundle'));
  b && b.click();
});
await new Promise((r) => setTimeout(r, 900));
const bundle = await readLastBlob();
check(
  'evidence bundle carries no coordinates',
  !!bundle && !/12\.9\d|77\.5\d/.test(bundle) && /withheld/.test(bundle),
  bundle ? `${bundle.length} bytes written` : 'no blob captured'
);

// and the scene can be restored
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Restore bundled scene'))?.click());
await new Promise((r) => setTimeout(r, 600));
check('restore brings the declared footprint back', /gazetteer/.test((await header()) || ''), await header());

// a georeferenced scene 14 km away: the AOI place name has to follow the new
// footprint instead of naming the old scene (the header is memoised)
const whitefield = path.join(tmpdir(), 'avni-verify-whitefield.tif');
const W = 32;
const H = 24;
const PIXEL_M2 = 16;
const LON0 = 77.73;
const LAT0 = 12.99;
const values = new Uint8Array(W * H);
for (let i = 0; i < values.length; i += 1) values[i] = (i * 7) % 255;
const tags = {
  width: W,
  height: H,
  GeographicTypeGeoKey: 4326,
  ModelTypeGeoKey: 2,
  RasterTypeGeoKey: 1,
  ModelPixelScale: [PIXEL_M2 / (111320 * Math.cos((LAT0 * Math.PI) / 180)), PIXEL_M2 / 110574, 0],
  ModelTiepoint: [0, 0, 0, LON0, LAT0 + (H * PIXEL_M2) / 110574, 0]
};
writeFileSync(whitefield, Buffer.from(await writeArrayBuffer(values, tags)));
await (await page.$('input[type=file]')).uploadFile(whitefield);
await new Promise((r) => setTimeout(r, 2000));
const moved = await page.evaluate(async () => {
  const block = document.querySelector('header').innerText.replace(/\n+/g, ' · ');
  const place = (block.match(/AOI · ([^·]*)·/) || [])[1]?.trim() || null;
  const at = document.querySelector('aside').innerText.match(/(\d+\.\d+)°N\s+(\d+\.\d+)°E/);
  const geo = await import('/src/lib/geo.js');
  const expected = at ? geo.placeSummary(parseFloat(at[1]), parseFloat(at[2])).name : null;
  return { place, expected };
});
check(
  'the AOI place name follows a scene swap',
  !!moved.place && moved.place === moved.expected && moved.place !== 'MG Road',
  `header "${moved.place}" vs the rail's own coordinates -> ${moved.expected}`
);

// the sheet and the scale bar belong to the scene on screen too: the sheet used
// to keep the bundled aspect (stretching the upload) and the bar kept the
// bundled extent, so a 0.5 km scene still showed "1 km"
const drawn = await page.evaluate(() => {
  const host = document.querySelector('.scanlines');
  const sheetEl = [...host.children].find((el) => getComputedStyle(el).transform !== 'none' && el.tagName === 'DIV');
  const sheet = sheetEl?.getBoundingClientRect();
  const labelEl = [...host.querySelectorAll('*')].find((n) => n.children.length === 0 && /^\d+(\.\d+)? (km|m)$/.test(n.textContent.trim()));
  const barEl = labelEl?.parentElement?.querySelector('span');
  const title = labelEl?.parentElement?.getAttribute('title') || '';
  return {
    aspect: sheet ? sheet.width / sheet.height : null,
    label: labelEl?.textContent.trim() || '(none)',
    px: barEl ? barEl.getBoundingClientRect().width : null,
    metresPerPx: title.match(/1 px = ([\d.]+) m/)?.[1] ? Number(title.match(/1 px = ([\d.]+) m/)[1]) : null
  };
});
const labelMetres = drawn.label.endsWith('km') ? parseFloat(drawn.label) * 1000 : parseFloat(drawn.label);
check(
  'the sheet takes the aspect of the uploaded raster',
  drawn.aspect !== null && Math.abs(drawn.aspect - 32 / 24) < 0.02,
  `sheet aspect ${drawn.aspect?.toFixed(3)} (the upload is 32x24 = 1.333, the bundled sheet 1.792)`
);
check(
  'the scale bar is drawn from this scene\'s own extent',
  drawn.metresPerPx !== null &&
    Math.abs(drawn.px * drawn.metresPerPx - labelMetres) / labelMetres < 0.03 &&
    labelMetres < 490,
  `${drawn.px?.toFixed(0)} px x ${drawn.metresPerPx} m/px = ${(drawn.px * drawn.metresPerPx).toFixed(0)} m, labelled ${drawn.label} (the whole scene is ~490 m wide)`
);

// the evidence bundle has to measure the GSD on *this* scene's raster
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /export result/i.test(b.textContent))?.click());
await new Promise((r) => setTimeout(r, 250));
await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((x) => /evidence bundle/i.test(x.textContent))?.click());
await new Promise((r) => setTimeout(r, 700));
const gsd = await page.evaluate(async () => {
  const bundle = JSON.parse(await window.__avniBlobs[window.__avniBlobs.length - 1].text());
  const rail = [...document.querySelectorAll('span.pill')].map((x) => x.textContent).find((t) => /m\/px/.test(t)) || '';
  return { bundle: bundle.scene.ground_sample_distance, raster: bundle.scene.raster, rail };
});
check(
  'the evidence bundle measures GSD on the exported scene\'s own raster',
  !!gsd.bundle && gsd.rail.includes(gsd.bundle) && gsd.raster?.width === 32 && gsd.raster?.height === 24,
  `bundle ${gsd.bundle} (${JSON.stringify(gsd.raster)}) vs the rail's ${gsd.rail}`
);

// and the layer export has to describe *this* scene: the geometry used to be
// mapped through the bundled footprint whatever the header said
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /download map layer/i.test(b.textContent))?.click());
await new Promise((r) => setTimeout(r, 800));
const exported = await page.evaluate(async () => {
  const text = await window.__avniBlobs[window.__avniBlobs.length - 1].text();
  const fc = JSON.parse(text);
  const lons = [];
  const lats = [];
  const walk = (c) => (typeof c[0] === 'number' ? (lons.push(c[0]), lats.push(c[1])) : c.forEach(walk));
  for (const f of fc.features) walk(f.geometry.coordinates);
  const aoi = fc.features.find((f) => f.properties.layer === 'aoi');
  return { count: fc.features.length, minLon: Math.min(...lons), maxLon: Math.max(...lons), minLat: Math.min(...lats), maxLat: Math.max(...lats), name: aoi?.properties?.name || null, crs: fc.georeference?.crs || null };
});
check(
  'the exported layer is drawn on the scene that is on screen',
  exported.crs === 'EPSG:4326' &&
    /Whitefield/.test(exported.name || '') &&
    exported.minLon > 77.6 &&
    exported.minLon < 77.75 &&
    exported.maxLat < 13.05,
  `${exported.count} features · lon ${exported.minLon.toFixed(4)}–${exported.maxLon.toFixed(4)} · AOI ${exported.name}`
);

await browser.close();
const failed = results.filter((r) => !r[1]).length;
console.log(failed ? `${failed} check(s) FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
