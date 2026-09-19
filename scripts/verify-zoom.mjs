// Verifies the zoom/pan inverse transform: the scene point under the pointer
// must not move when you zoom or drag, and the overlays must stay registered.
//   npm run verify:zoom
import { launch, watchPage, APP_URL, SHOTS_DIR, prepareDirs } from './browser.mjs';
import path from 'node:path';

prepareDirs();
const browser = await launch({ width: 1680, height: 950 });
const page = watchPage(await browser.newPage(), 'zoom');
await page.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForNetworkIdle({ idleTime: 600 });
await new Promise((r) => setTimeout(r, 900));

const pills = () =>
  page.evaluate(() => {
    const spans = [...document.querySelectorAll('span.pill.data-mono')];
    const lat = spans.find((s) => s.textContent.includes('°N'))?.textContent.trim();
    const lon = spans.find((s) => s.textContent.includes('°E'))?.textContent.trim();
    const zoom = document.querySelector('button[title="fit scene to view (0)"]')?.textContent.trim();
    const gsd = spans.find((s) => /m\/px/.test(s.textContent))?.textContent.trim();
    return { lat, lon, zoom, gsd };
  });

const box = await page.evaluate(() => {
  const el = document.querySelector('.scanlines');
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});

const P = { x: box.x + box.w * 0.34, y: box.y + box.h * 0.45 };
const results = [];

// 1. zoom anchored off-center: the point under the cursor must hold still
await page.mouse.move(P.x, P.y);
await new Promise((r) => setTimeout(r, 150));
const before = await pills();

await page.mouse.wheel({ deltaY: -420 });
await new Promise((r) => setTimeout(r, 250));
// sub-pixel nudge: the readout only updates on pointermove, and a full pixel
// at this zoom is worth one unit in the last displayed decimal
await page.mouse.move(P.x + 0.3, P.y + 0.3);
await new Promise((r) => setTimeout(r, 200));
const after = await pills();
results.push(['zoom anchor holds', before.lat === after.lat && before.lon === after.lon, `${before.lat},${before.lon} → ${after.lat},${after.lon}`, `zoom ${before.zoom} → ${after.zoom}`]);

// 2. drag to pan: the point under the cursor must travel with the sheet
const D = { x: 180, y: 90 };
await page.mouse.move(P.x, P.y);
await page.mouse.down();
await page.mouse.move(P.x + D.x, P.y + D.y, { steps: 12 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 200));
await page.mouse.move(P.x + D.x + 0.3, P.y + D.y + 0.3);
await new Promise((r) => setTimeout(r, 200));
const panned = await pills();
results.push(['pan follows sheet', panned.lat === after.lat && panned.lon === after.lon, `${after.lat},${after.lon} → ${panned.lat},${panned.lon}`]);

await page.screenshot({ path: path.join(SHOTS_DIR, '08-zoom.jpg'), type: 'jpeg', quality: 84 });

// 3. fit restores
await page.click('button[title="fit scene to view (0)"]');
await new Promise((r) => setTimeout(r, 250));
const fitted = await pills();
results.push(['fit restores 100%', fitted.zoom === '100%', `zoom ${fitted.zoom}`]);

// 4. the on-screen scale bar must describe the ground it covers
const bar = await page.evaluate(() => {
  const host = document.querySelector('span[title^="scale bar"]');
  const el = host?.querySelector('span');
  return { label: host?.textContent.trim(), px: el ? parseFloat(el.style.width) : null };
});
const widthKm = 22.0305;
const sheetW = await page.evaluate(() => {
  const el = document.querySelector('.scanlines').firstElementChild;
  return el.getBoundingClientRect().width;
});
const realKm = (bar.px / sheetW) * widthKm;
const claimed = bar.label?.includes('km') ? parseFloat(bar.label) : parseFloat(bar.label) / 1000;
results.push([
  'scale bar matches the ground',
  Math.abs(realKm - claimed) / claimed < 0.06,
  `${bar.px}px = ${realKm.toFixed(3)} km labelled ${bar.label}`
]);

// 5. imagery and overlays stay registered under zoom
await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.5);
await page.mouse.wheel({ deltaY: -300 });
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: path.join(SHOTS_DIR, '09-zoom-masks.jpg'), type: 'jpeg', quality: 84 });
console.log('captured 08-zoom + 09-zoom-masks');

// ---- small screens: drawers
const small = watchPage(await browser.newPage(), 'small');
await small.setViewport({ width: 390, height: 844 });
await small.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 60000 });
await small.waitForNetworkIdle({ idleTime: 600 });
await new Promise((r) => setTimeout(r, 800));
await small.screenshot({ path: path.join(SHOTS_DIR, 'responsive', 'phone-390x844-empty.jpg') });

const drawerOpen = () =>
  small.evaluate(() => {
    const a = document.querySelector('aside');
    const r = a.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) };
  });
console.log('phone imagery drawer (closed):', JSON.stringify(await drawerOpen()));

await small.click('button[title="imagery panel"]');
await new Promise((r) => setTimeout(r, 450));
await small.screenshot({ path: path.join(SHOTS_DIR, 'responsive', 'phone-imagery-drawer.jpg') });
const drawn = await drawerOpen();
results.push(['imagery drawer opens on-screen', drawn.left >= -1 && drawn.right <= 391, JSON.stringify(drawn)]);

await small.click('button[title="query panel"]');
await new Promise((r) => setTimeout(r, 450));
await small.type('#composer-input', 'Where is flooding most severe?', { delay: 3 });
await small.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 4300));
await small.screenshot({ path: path.join(SHOTS_DIR, 'responsive', 'phone-query-drawer.jpg') });
const measures = await small.evaluate(() => ({
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth
}));
results.push(['phone has no horizontal overflow', measures.scrollW === measures.clientW, JSON.stringify(measures)]);

await browser.close();

for (const [name, ok, detail, extra] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}  ${extra || ''}`);
}
const failed = results.filter((r) => !r[1]).length;
console.log(failed ? `${failed} check(s) failed` : 'ALL PASS');
process.exit(failed ? 1 : 0);
