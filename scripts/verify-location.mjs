// Verifies the location-honesty pass:
//  1. the bundled scene resolves a REAL place name (not a hardcoded string)
//  2. that name tracks the AOI, recomputing when the AOI moves
//  3. an upload with no CRS flips the console to "unlocated" everywhere
//     (header, viewer readout, geodetic row, layer export) instead of
//     reusing the previous scene's coordinates
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'fs';

mkdirSync('shots', { recursive: true });
writeFileSync('/tmp/unknown_scene.tif', 'II*\0 not-really-a-geotiff');

const browser = await puppeteer.launch({
  args: [...chromium.args, '--force-color-profile=srgb', '--hide-scrollbars'],
  executablePath: await chromium.executablePath(),
  headless: true,
  defaultViewport: { width: 1680, height: 950 }
});

const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text().slice(0, 160));
});
await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForNetworkIdle({ idleTime: 600 });
await new Promise((r) => setTimeout(r, 900));

const header = () =>
  page.evaluate(() => {
    const h = document.querySelector('header');
    const block = [...h.querySelectorAll('span')].find((s) => s.textContent.includes('AOI'))?.parentElement;
    return block ? block.textContent.replace(/\s+/g, ' ').trim() : null;
  });
const readout = () =>
  page.evaluate(() => {
    const pills = [...document.querySelectorAll('span.pill')].map((s) => s.textContent.replace(/\s+/g, ' ').trim());
    return pills.filter((t) => /°[NSEW]|unlocated|elev/.test(t)).join(' | ');
  });

const results = [];
const check = (name, ok, detail) => results.push([name, ok, detail]);

// --- 1. bundled scene resolves a real place ---
const h1 = await header();
console.log('header:', h1);
check('bundled scene names a real place', /Bengaluru|MG Road|Cubbon/.test(h1 || ''), h1);
check('hardcoded corridor string is gone', !/Hosur corridor/.test(h1 || ''), h1);
check('name carries a distance+bearing', /\d(\.\d)? km [NSEW]{1,2}|at /.test(h1 || ''), h1);
check('scene reports a CRS', /gazetteer/.test(h1 || ''), h1);
const r1 = await readout();
check('viewer reports coordinates', /°N/.test(r1) && /°E/.test(r1), r1);

// --- 2. place name recomputes when the AOI moves ---
// draw a new AOI in the top-left of the scene (head of the extent)
const box = await page.evaluate(() => {
  const r = document.querySelector('.scanlines').getBoundingClientRect();
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
await page.screenshot({ path: 'shots/10-location.png' });

// --- 3. an upload with no CRS must not inherit the old coordinates ---
const input = await page.$('input[type=file]');
await input.uploadFile('/tmp/unknown_scene.tif');
await new Promise((r) => setTimeout(r, 700));

const h3 = await header();
const r3 = await readout();
console.log('header after upload:', h3);
console.log('viewer after upload:', r3);
check('upload flags the scene unlocated', /unlocated/i.test(h3 || ''), h3);
check('viewer withholds coordinates', !/°N/.test(r3) && /unlocated/i.test(r3), r3);

// sidebar extent readout
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
await page.screenshot({ path: 'shots/11-unlocated.png' });

for (const [name, ok, detail] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${String(detail).slice(0, 96)}`);
}
console.log(results.every((r) => r[1]) ? 'ALL PASS' : 'SOME FAILED');

await browser.close();
