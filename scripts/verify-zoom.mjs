// Verifies the zoom/pan inverse transform: the scene point under the pointer
// must not move when you zoom or drag. Also captures the new states.
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';

mkdirSync('shots/responsive', { recursive: true });

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

const pills = () =>
  page.evaluate(() => {
    const spans = [...document.querySelectorAll('span.pill.data-mono')];
    const lat = spans.find((s) => s.textContent.includes('°N'))?.textContent.trim();
    const lon = spans.find((s) => s.textContent.includes('°E'))?.textContent.trim();
    const zoom = document.querySelector('button[title="fit scene to view (0)"]')?.textContent.trim();
    return { lat, lon, zoom };
  });

const box = await page.evaluate(() => {
  const el = document.querySelector('.scanlines');
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});

const P = { x: box.x + box.w * 0.34, y: box.y + box.h * 0.42 };
const results = [];

// 1. zoom anchored off-center: the point under the cursor must hold still
await page.mouse.move(P.x, P.y);
await new Promise((r) => setTimeout(r, 150));
const before = await pills();

await page.mouse.wheel({ deltaY: -420 });
await new Promise((r) => setTimeout(r, 250));
await page.mouse.move(P.x + 1, P.y + 1); // nudge to retrigger the readout
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
await page.mouse.move(P.x + D.x + 1, P.y + D.y + 1);
await new Promise((r) => setTimeout(r, 200));
const panned = await pills();
results.push(['pan follows sheet', panned.lat === after.lat && panned.lon === after.lon, `${after.lat},${after.lon} → ${panned.lat},${panned.lon}`]);

await page.screenshot({ path: 'shots/08-zoom.png' });

// 3. fit restores
await page.click('button[title="fit scene to view (0)"]');
await new Promise((r) => setTimeout(r, 250));
const fitted = await pills();
results.push(['fit restores 100%', fitted.zoom === '100%', `zoom ${fitted.zoom}`]);

// 4. imagery and query stay registered to the imagery under zoom
await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.5);
await page.mouse.wheel({ deltaY: -300 });
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: 'shots/09-zoom-masks.png' });
console.log('captured 08-zoom + 09-zoom-masks');

for (const [name, ok, detail, extra] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}  ${extra || ''}`);
}

// ---- small screens: drawers ----
const small = await browser.newPage();
await small.setViewport({ width: 390, height: 844 });
await small.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 60000 });
await small.waitForNetworkIdle({ idleTime: 600 });
await new Promise((r) => setTimeout(r, 800));
await small.screenshot({ path: 'shots/responsive/phone-390x844-empty.png' });

const drawerOpen = () =>
  small.evaluate(() => {
    const a = document.querySelector('aside');
    const r = a.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) };
  });
console.log('phone imagery drawer (closed):', JSON.stringify(await drawerOpen()));

await small.click('button[title="imagery panel"]');
await new Promise((r) => setTimeout(r, 450));
await small.screenshot({ path: 'shots/responsive/phone-imagery-drawer.png' });
console.log('phone imagery drawer (open):', JSON.stringify(await drawerOpen()));

await small.click('button[title="query panel"]');
await new Promise((r) => setTimeout(r, 450));
await small.type('#composer-input', 'Where is flooding most severe?', { delay: 3 });
await small.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 4300));
await small.screenshot({ path: 'shots/responsive/phone-query-drawer.png' });
console.log('captured phone drawer states');

await browser.close();
console.log('done');
