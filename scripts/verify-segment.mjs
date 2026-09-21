// Segmentation, held to the promise the rail makes: click a feature and the
// region is marked. On the bundled scene the earlier growth rule refused most
// clicks ("nothing to segment here") and barely responded to the tolerance
// slider — both are checked here, in a real browser.
//   npm run verify:segment
import { launch, watchPage, APP_URL, SHOTS_DIR, prepareDirs } from './browser.mjs';
import path from 'node:path';

prepareDirs();
const browser = await launch({ width: 1680, height: 950 });
const page = watchPage(await browser.newPage(), 'segment');
await page.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForNetworkIdle({ idleTime: 600 });
await new Promise((r) => setTimeout(r, 1400));

const results = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const box = await page.evaluate(() => {
  const r = document.querySelector('.scanlines').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});

const readout = () =>
  page.evaluate(() => {
    const panel = document.querySelector('aside')?.innerText || '';
    const m = panel.match(/(\d+) vertices · ([\d.]+)% of the scene([^\n]*)/);
    const areas = panel.match(/· (\d+) areas/);
    const toast = [...document.querySelectorAll('div,span,p')]
      .filter((el) => el.childElementCount === 0 && /region segmented|nothing to segment|cap|widened/i.test(el.textContent))
      .map((el) => el.textContent.trim())
      .pop();
    return {
      vertices: m ? parseInt(m[1], 10) : null,
      pct: m ? parseFloat(m[2]) : null,
      note: m ? m[3].trim() : '',
      areas: areas ? parseInt(areas[1], 10) : 1,
      toast: toast || '',
      handleCircles: document.querySelectorAll('svg circle').length
    };
  });

const setTolerance = async (value) => {
  await page.evaluate((v) => {
    const el = document.querySelector('#seg-tolerance');
    if (!el) throw new Error('no tolerance control');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await wait(500);
};

// 1. the tool opens with its help
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((x) => /Segment (region|AOI)/.test(x.textContent));
  if (!btn) throw new Error('no segment control on the rail');
  btn.click();
});
await wait(400);
const opened = await page.evaluate(() => ({
  pressed: [...document.querySelectorAll('button')].some((b) => /Segmenting/.test(b.textContent) && b.getAttribute('aria-pressed') === 'true'),
  slider: !!document.querySelector('#seg-tolerance'),
  hint: /region you mean/i.test(document.body.innerText)
}));
results.push(['the segment tool opens with a tolerance control', opened.pressed && opened.slider && opened.hint, JSON.stringify(opened)]);

// 2. the headline promise: a click anywhere reasonable marks a region
const grid = [];
for (let gx = 1; gx <= 4; gx += 1) for (let gy = 1; gy <= 3; gy += 1) grid.push([gx / 5, gy / 4]);
let marked = 0;
let refused = 0;
const sizes = [];
const readUntilSettled = async (ms = 2000) => {
  const deadline = Date.now() + ms;
  let r = await readout();
  // growing a region on the working grid is not instant, and the rail shows
  // "growing region from the seed…" until it lands
  while (r.vertices === null && Date.now() < deadline) {
    await wait(120);
    r = await readout();
  }
  return r;
};

for (const [fx, fy] of grid) {
  await page.mouse.click(box.x + box.w * fx, box.y + box.h * fy);
  const r = await readUntilSettled();
  if (/nothing to segment/.test(r.toast) || r.vertices === null) refused += 1;
  else {
    // a ring with 3+ vertices is a marked region; its size is judged below
    marked += 1;
    sizes.push(r.pct);
  }
}
results.push([
  'every click marks a region — none are refused',
  refused === 0 && marked === grid.length,
  `${marked}/${grid.length} marked, ${refused} refused`
]);

// 3. the marked areas are actually areas, not specks
const median = sizes.slice().sort((a, b) => a - b)[Math.floor(sizes.length / 2)];
const solid = sizes.filter((s) => s >= 0.1).length;
results.push([
  'the marked regions are areas, not specks',
  median >= 0.5 && solid >= grid.length - 2,
  `${solid}/${grid.length} at 0.1% or more; median ${median}%, sizes ${sizes.map((s) => `${s}%`).join(' ')}`
]);

// 4. the tolerance slider is monotone, live, from the same seeds
await page.mouse.click(box.x + box.w * 0.25, box.y + box.h * 0.7);
await wait(400);
await setTolerance(20);
const tight = await readout();
await setTolerance(45);
const loose = await readout();
await setTolerance(75);
const wide = await readout();
results.push([
  'a wider tolerance grows the same seed, monotonically',
  tight.pct > 0 && loose.pct > tight.pct && wide.pct >= loose.pct,
  `tol 20 → ${tight.pct}%, 45 → ${loose.pct}%, 75 → ${wide.pct}%`
]);

// 5. alt-click subtracts, and shift-click adds a second region
await setTolerance(34);
await page.mouse.click(box.x + box.w * 0.25, box.y + box.h * 0.7);
await wait(400);
const first = await readout();
await page.keyboard.down('Shift');
await page.mouse.click(box.x + box.w * 0.35, box.y + box.h * 0.35);
await page.keyboard.up('Shift');
await wait(400);
const added = await readout();
results.push([
  'shift-click adds a second region',
  added.pct > first.pct * 1.05,
  `${first.pct}% → ${added.pct}% (${added.vertices} outline vertices, ${added.handleCircles} handles)`
]);

// 5b. an AOI is one polygon, so a selection that ends up in several pieces has
// to say which part the outline follows instead of quietly dropping the rest
results.push([
  'a multi-part selection is reported, not silently dropped',
  added.areas > 1 ? /separate areas/.test(added.toast) : true,
  added.areas > 1 ? `${added.areas} areas · ${added.toast}` : `selection stayed in one piece (${added.areas})`
]);

// 6. Enter turns the outline into the AOI
await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.5);
await page.keyboard.press('Enter');
await wait(700);
const applied = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('aside .data-mono')].map((n) => n.textContent.trim());
  return {
    aoi: rows.find((r) => r.startsWith('AOI')) || null,
    toast: [...document.querySelectorAll('div,span,p')]
      .filter((el) => el.childElementCount === 0 && /AOI/.test(el.textContent))
      .map((el) => el.textContent.trim())
      .pop()
  };
});
results.push([
  'Enter applies the segmented outline as the AOI',
  !!applied.aoi && /AOI/.test(applied.toast || ''),
  `${applied.aoi} · ${applied.toast}`
]);
await page.screenshot({ path: path.join(SHOTS_DIR, 'feat-08-segment-aoi.jpg'), type: 'jpeg', quality: 84 });

await browser.close();
for (const [name, ok, detail] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
const failed = results.filter((r) => !r[1]).length;
console.log(failed ? `${failed} check(s) failed` : 'ALL PASS');
process.exit(failed ? 1 : 0);
