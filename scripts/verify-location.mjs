// Verifies the location-honesty pass end to end:
//  1. the bundled scene resolves a REAL place name (not a hardcoded string)
//  2. that name tracks the AOI, recomputing when the AOI moves
//  3. an upload with no CRS flips the console to "unlocated" everywhere
//     (header, viewer readout, geodetic row, every export path) instead of
//     reusing the previous scene's coordinates
//   npm run verify:location
import { launch, watchPage, APP_URL, SHOTS_DIR, prepareDirs } from './browser.mjs';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

prepareDirs();
const unknown = path.join(tmpdir(), 'unknown_scene.tif');
writeFileSync(unknown, 'II*\0 not-really-a-geotiff');

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
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Draw AOI'));
  b && b.click();
});
for (const [u, v] of [[0.12, 0.1], [0.3, 0.12], [0.32, 0.3], [0.14, 0.28]]) {
  await page.mouse.click(box.x + box.w * u, box.y + box.h * v);
  await new Promise((r) => setTimeout(r, 120));
}
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 500));
const h2 = await header();
console.log('header after AOI move:', h2);
check('place recomputes with the AOI', h1 !== h2 && /km|at /.test(h2 || ''), `${h1} → ${h2}`);
await page.screenshot({ path: path.join(SHOTS_DIR, '10-location.jpg'), type: 'jpeg', quality: 84 });

// --- 3. an upload with no CRS must not inherit the old coordinates
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Restore bundled scene'))?.click());
await new Promise((r) => setTimeout(r, 400));
const input = await page.$('input[type=file][accept*=".tif"]');
await input.uploadFile(unknown);
await new Promise((r) => setTimeout(r, 900));

const h3 = await header();
const r3 = await readout();
console.log('header after upload:', h3);
console.log('viewer after upload:', r3);
check('upload flags the scene unlocated', /unlocated/i.test(h3 || ''), h3);
check('viewer withholds coordinates', !/°N/.test(r3) && /unlocated/i.test(r3), r3);
check('no fake preview is shown for an undecodable file', await page.evaluate(() => document.body.innerText.includes('no renderable preview')));

const side = await page.evaluate(() => {
  const a = [...document.querySelectorAll('aside')][0];
  const idx = a.textContent.indexOf('unverified');
  return idx >= 0 ? a.textContent.slice(idx - 40, idx + 40).replace(/\s+/g, ' ').trim() : 'not found';
});
check('sidebar extent marked unverified', /unverified/.test(side), side);

// ask a question: the geodetic row must withhold coordinates
await page.click('#composer-input');
await page.type('#composer-input', 'Where is flooding most severe?', { delay: 3 });
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 4500));
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

await browser.close();
const failed = results.filter((r) => !r[1]).length;
console.log(failed ? `${failed} check(s) FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
