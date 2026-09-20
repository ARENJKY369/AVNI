// Evidence pass for the three fixes: format ingestion, the canvas zoom path
// and segmentation-based AOI marking.
//
//   node scripts/verify-features.mjs      # dev server must be running
//
// Writes shots/feat-*.jpg and prints PASS/FAIL per check, so the claims about
// GeoTIFF/COG/JP2/SAFE reading, the raster sampler and the segmentation are
// backed by what the browser actually did.
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { launch, watchPage, APP_URL, SHOTS_DIR, prepareDirs } from './browser.mjs';

prepareDirs();
const execFileAsync = promisify(execFile);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await launch({ width: 1680, height: 950 });
const page = watchPage(await browser.newPage(), 'features');
const shot = (name) => page.screenshot({ path: path.join(SHOTS_DIR, name), type: 'jpeg', quality: 88 });

// record how the scene raster is sampled, straight from the 2d context
await page.evaluateOnNewDocument(() => {
  const original = CanvasRenderingContext2D.prototype.drawImage;
  window.__avniDraws = [];
  CanvasRenderingContext2D.prototype.drawImage = function patched(...args) {
    if (args.length >= 9) {
      window.__avniDraws.push({
        smooth: this.imageSmoothingEnabled,
        quality: this.imageSmoothingQuality,
        img: [args[0].width, args[0].height],
        alpha: this.globalAlpha,
        src: args.slice(1, 5),
        dst: args.slice(5, 9),
        canvas: [this.canvas.width, this.canvas.height]
      });
    }
    return original.apply(this, args);
  };
});

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160));
});

await page.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForNetworkIdle({ idleTime: 700 });
await wait(1200);

const readState = () =>
  page.evaluate(() => {
    const text = (sel) => document.querySelector(sel)?.textContent?.trim() || null;
    const sceneRows = [...document.querySelectorAll('#imagery-panel .font-mono')].map((n) => n.textContent.trim());
    return {
      sceneRows,
      aoiFooter: text('#imagery-panel .data-mono'),
      hasCanvas: !!document.querySelector('#scene-region canvas'),
      imgTags: document.querySelectorAll('#scene-region img').length,
      zoomLabel: text('button[title="fit scene to view (0)"]'),
      status: [...document.querySelectorAll('[role="status"]')].map((n) => n.textContent.trim()).slice(0, 3)
    };
  });

const uploadFixture = async (relPath) => {
  const input = await page.$('input[aria-label="register a scene file"]');
  await input.uploadFile(path.resolve(relPath));
  await page.waitForNetworkIdle({ idleTime: 500 }).catch(() => {});
  await wait(1400);
};

// ---------------------------------------------------------------- formats
const formats = [
  ['fixtures/geotiff/T43REP-tiled-utm43n.tif', 'cloud-optimised GeoTIFF', 'EPSG:32643'],
  ['fixtures/geotiff/T43REP-geographic-wgs84.tif', 'GeoTIFF', 'EPSG:4326'],
  ['fixtures/jp2/T43REP_20250814T051742_B04_10m.jp2', 'JPEG2000', null],
  [
    'fixtures/safe/S2B_MSIL2A_20250814T051742_N0510_R076_T43REP_20250814T071234.SAFE.zip',
    'Sentinel-2 SAFE',
    'EPSG:4326'
  ]
];

let index = 0;
for (const [file, expectLabel, expectCrs] of formats) {
  index += 1;
  await uploadFixture(file);
  const state = await readState();
  const panel = await page.evaluate(() => document.querySelector('#imagery-panel')?.textContent || '');
  const labelOk = panel.includes(expectLabel.replace('cloud-optimised GeoTIFF', 'cloud-optimised GeoTIFF'));
  const crsOk = expectCrs ? panel.includes(expectCrs) : !/EPSG:/.test(panel.split('Bands')[0]);
  check(`format ${expectLabel} registered`, labelOk, `row says: ${state.sceneRows[0]?.slice(0, 90)}`);
  check(`format ${expectLabel} georeference`, crsOk, expectCrs ? `looked for ${expectCrs}` : 'expected no CRS');
  await shot(`feat-${String(index).padStart(2, '0')}-${expectLabel.split(' ')[0].toLowerCase()}.jpg`);
}

// back to the bundled scene for the zoom + segmentation passes
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('bundled scene'));
  if (b) b.click();
});
await wait(1200);

// ---------------------------------------------------------------- second epoch
// An attached epoch has to be decoded and actually compared — naming your file
// as the second epoch while the swipe shows the shipped pair is a lie.
const epochPng = path.join(tmpdir(), 'avni-verify-epochB.png');
await execFileAsync('convert', ['-size', '240x180', 'xc:#00b000', epochPng]);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) =>
    /attach second/i.test(x.textContent + ' ' + (x.getAttribute('aria-label') || '') + ' ' + (x.getAttribute('title') || ''))
  );
  if (b) b.click();
});
const epochInput = await page.$('input[aria-label="attach second scene file"]');
check('the second-epoch dropzone offers a file input', !!epochInput, epochInput ? 'input[aria-label="attach second scene file"]' : 'not rendered');
if (epochInput) {
  await epochInput.uploadFile(epochPng);
  await wait(1800);
  const attached = await page.evaluate(() => ({
    modes: [...document.querySelectorAll('[role="radio"]')].map((r) => r.textContent.trim()),
    status: [...document.querySelectorAll('[role="status"]')].map((n) => n.textContent).join(' | '),
    epochRow: document.querySelector('button[aria-label="detach second epoch"]')?.closest('div')?.textContent?.trim() || '(no epoch row)'
  }));
  check(
    'a file attaches as the second epoch',
    /second epoch registered/.test(attached.status) && attached.modes.includes('CHANGE ΔT'),
    `${attached.epochRow} · ${attached.status.slice(0, 90)}`
  );
  await page.evaluate(() => {
    const r = [...document.querySelectorAll('[role="radio"]')].find((x) => x.textContent.trim() === 'CHANGE ΔT');
    if (r) r.click();
  });
  await wait(700);
  const swiped = await page.evaluate(() => {
    const canvas = document.querySelector('.scanlines canvas');
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const d = ctx.getImageData(Math.round(w * 0.15), Math.round(h * 0.4), Math.round(w * 0.2), Math.max(1, Math.round(h * 0.2))).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
      n += 1;
    }
    return {
      r: Math.round(r / n),
      g: Math.round(g / n),
      b: Math.round(b / n),
      mode: [...document.querySelectorAll('[role="radio"]')].find((x) => x.getAttribute('aria-checked') === 'true')?.textContent.trim()
    };
  });
  check(
    'the change view compares the attached epoch, not the shipped pair',
    swiped.mode === 'CHANGE ΔT' && swiped.g > 120 && swiped.r < 60 && swiped.b < 60,
    `epoch side of the swipe is rgb(${swiped.r}, ${swiped.g}, ${swiped.b})`
  );
  await shot('feat-09-second-epoch.jpg');
  await page.evaluate(() => document.querySelector('button[aria-label="detach second epoch"]')?.click());
  await wait(500);
  const detached = await page.evaluate(() => ({
    modes: [...document.querySelectorAll('[role="radio"]')].map((r) => r.textContent.trim()),
    status: [...document.querySelectorAll('[role="status"]')].map((n) => n.textContent).join(' | ')
  }));
  check(
    'detaching returns to the single-epoch view',
    !detached.modes.includes('CHANGE ΔT') && /second epoch detached/.test(detached.status),
    detached.modes.join('/')
  );
}

// ---------------------------------------------------------------- zoom path
const before = await readState();
check('scene raster is a canvas, not a CSS-scaled <img>', before.hasCanvas && before.imgTags === 0,
  `canvas=${before.hasCanvas} img=${before.imgTags}`);

await page.evaluate(() => {
  const region = document.querySelector('#scene-region');
  const rect = region.getBoundingClientRect();
  const opts = { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  for (let i = 0; i < 6; i += 1) region.dispatchEvent(new WheelEvent('wheel', { ...opts, deltaY: -240, cancelable: true }));
});
await wait(900);
const afterZoom = await readState();
const draws = await page.evaluate(() => window.__avniDraws.slice(-3));
check('zoom reached 400 %+ (wheel)', /5[0-9][0-9]%|[4-9][0-9][0-9]%/.test(afterZoom.zoomLabel || ''),
  `zoom label ${afterZoom.zoomLabel}`);
check('raster sampled with high-quality smoothing', draws.every((d) => d.smooth && d.quality === 'high'),
  JSON.stringify(draws.map((d) => ({ smooth: d.smooth, quality: d.quality }))));
check(
  'destination rect scales with zoom (windowed sampling)',
  draws.some((d) => d.dst[2] > d.src[2]),
  draws.map((d) => `${Math.round(d.src[2])}px source -> ${Math.round(d.dst[2])}px dest`).join(', ')
);
await shot('feat-05-zoom-500.jpg');

// ---------------------------------------------------------------- segmentation
await page.evaluate(() => {
  const region = document.querySelector('#scene-region');
  region.focus();
  region.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }));
});
await wait(600);

// click the river: the darkest water pixels in the demo scene
const seed = await page.evaluate(() => {
  const region = document.querySelector('#scene-region');
  const rect = region.getBoundingClientRect();
  return { x: rect.left + rect.width * 0.42, y: rect.top + rect.height * 0.62 };
});
// the pixel under the seed, read back off the visible canvas: the segmented
// region must actually change what the user sees
const seedPixel = () =>
  page.evaluate(() => {
    const canvas = document.querySelector('#scene-region canvas');
    const ctx = canvas.getContext('2d');
    const d = ctx.getImageData(Math.round(canvas.width * 0.42), Math.round(canvas.height * 0.62), 1, 1).data;
    return [...d].slice(0, 3);
  });
const pixelBefore = await seedPixel();
await page.evaluate(() => {
  window.__avniDraws.length = 0;
});
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Segment region'));
  if (b) b.click();
});
await wait(400);
await page.mouse.click(seed.x, seed.y);
await wait(1800);
const segState = await page.evaluate(() => {
  const panel = document.querySelector('#imagery-panel')?.textContent || '';
  const overlay = document.querySelector('#scene-region')?.textContent || '';
  return {
    panel: panel.replace(/\s+/g, ' ').slice(0, 400),
    traced: /region traced|vertices ·/.test(panel) || /vertices/.test(overlay),
    vertices: (panel.match(/(\d+) vertices/) || [])[1] || null
  };
});
check('segmentation traced a region from one click', segState.traced, `vertices=${segState.vertices}`);

const pixelAfter = await seedPixel();
check(
  'mask overlay is painted (seed pixel changes)',
  pixelBefore.join() !== pixelAfter.join(),
  `${pixelBefore.join(',')} -> ${pixelAfter.join(',')}`
);
const segDraws = await page.evaluate(() => window.__avniDraws.slice(-3));
check(
  'mask drawn as a transparent overlay over the raster',
  segDraws.some((d) => d.alpha < 1 && d.img[0] !== d.canvas[0]),
  segDraws.map((d) => `img ${d.img.join('x')} alpha ${d.alpha}`).join(', ')
);
const ringHandles = await page.$$eval('svg circle', (nodes) => nodes.length);
check('segment ring rendered with vertex handles', ringHandles > 0, `${ringHandles} handle circles in the sheet overlay`);
await shot('feat-06-segmentation.jpg');

const aoiBefore = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#imagery-panel .data-mono')].map((n) => n.textContent.trim());
  return rows.find((r) => r.startsWith('AOI')) || null;
});
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Use as AOI'));
  if (b) b.click();
});
await wait(900);
const aoiAfter = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#imagery-panel .data-mono')].map((n) => n.textContent.trim());
  return rows.find((r) => r.startsWith('AOI')) || null;
});
check('segmented region became the AOI', aoiBefore !== aoiAfter, `${aoiBefore} -> ${aoiAfter}`);
await shot('feat-07-aoi-from-segment.jpg');

check('no console errors during the pass', consoleErrors.length === 0, consoleErrors.join(' | ').slice(0, 200));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
