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

// 3b. the raster is one canvas painted at device resolution. It has to reach
// every edge of the *visible scene*: an unpainted strip along the border is
// what a zoomed raster looks like when it is torn apart. Measured by sampling a
// 1 px band just inside each side of the visible sheet rect on every rung, and
// after panning into each corner.
const edgeBands = () =>
  page.evaluate(() => {
    const canvas = document.querySelector('.scanlines canvas');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    // the scene sheet is the child carrying the pan/zoom transform — the
    // canvas sits before it and is always the size of the viewport
    const sheetEl = [...document.querySelector('.scanlines').children].find(
      (el) => getComputedStyle(el).transform !== 'none'
    );
    const sheet = (sheetEl || canvas).getBoundingClientRect();
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const toDevice = (v) => Math.round(v * dpr);

    // The region that *should* be painted: the visible part of the sheet, in
    // canvas device pixels. Sampling the full canvas edge would count the
    // letterbox as a tear.
    const left = Math.max(sheet.left, rect.left);
    const top = Math.max(sheet.top, rect.top);
    const right = Math.min(sheet.right, rect.right);
    const bottom = Math.min(sheet.bottom, rect.bottom);
    const x0 = Math.max(0, toDevice(left - rect.left));
    const y0 = Math.max(0, toDevice(top - rect.top));
    const x1 = Math.min(canvas.width, toDevice(right - rect.left));
    const y1 = Math.min(canvas.height, toDevice(bottom - rect.top));
    const w = x1 - x0;
    const h = y1 - y0;
    if (w < 4 || h < 4) return { empty: true };

    const inset = 1;
    const bands = {
      top: [x0, y0, w, inset],
      bottom: [x0, y1 - inset, w, inset],
      left: [x0, y0, inset, h],
      right: [x1 - inset, y0, inset, h]
    };
    const blank = {};
    for (const [name, [bx, by, bw, bh]] of Object.entries(bands)) {
      const d = ctx.getImageData(bx, by, Math.max(1, bw), Math.max(1, bh)).data;
      let empty = 0;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        n += 1;
        // an unpainted pixel is exactly the backdrop the renderer fills in
        // before drawing (#0B0F14) — not merely a dark scene pixel, which a
        // colour-distance test would confuse it with
        if (d[i] === 11 && d[i + 1] === 15 && d[i + 2] === 20) empty += 1;
      }
      blank[name] = +(empty / n).toFixed(3);
    }
    return {
      blank,
      slab: `${w}x${h} at ${x0},${y0}`,
      backing: `${canvas.width}x${canvas.height}`,
      css: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
      dpr
    };
  });

const rungStates = [await edgeBands()];
for (let i = 0; i < 4; i += 1) {
  await page.mouse.wheel({ deltaY: -300 });
  await new Promise((r) => setTimeout(r, 320));
  rungStates.push(await edgeBands());
}
const cornerStates = [];
for (const [fx, fy] of [
  [0.2, 0.2],
  [0.8, 0.2],
  [0.2, 0.8],
  [0.8, 0.8]
]) {
  await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.w * fx, box.y + box.h * fy, { steps: 8 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 280));
  cornerStates.push(await edgeBands());
}

const states = [...rungStates, ...cornerStates].filter((s) => s && !s.empty);
let worst = 0;
for (const s of states) for (const v of Object.values(s.blank)) worst = Math.max(worst, v);
results.push([
  'the raster reaches every edge of the visible scene while zooming and panning',
  states.length >= 8 && worst < 0.02,
  `worst unpainted band ${(worst * 100).toFixed(1)}% over ${states.length} states (${rungStates.length} rungs + ${cornerStates.length} corners)`
]);

const zoomed = rungStates[rungStates.length - 1];
const backingOk = zoomed
  ? Math.abs(parseInt(zoomed.backing.split('x')[0], 10) - parseInt(zoomed.css.split('x')[0], 10) * zoomed.dpr) <= 1
  : false;
results.push([
  'the canvas backing store matches its on-screen device pixels',
  backingOk,
  zoomed ? `${zoomed.backing} backing for ${zoomed.css} css px @${zoomed.dpr}x, slab ${zoomed.slab}` : 'no canvas'
]);

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
