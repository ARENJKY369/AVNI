// Robustness pass: what happens when the console is fed rubbish, and what
// happens when it is used at random.
//
//   npm run verify:robustness      # dev server must be running
//
// Part 1 — malformed uploads. Nine files, each wrong in a different way: empty,
// one byte, a text file renamed .tif, a real GeoTIFF cut off after 120 bytes, a
// JPEG2000 cut off after 60, a JPEG renamed .jp2, an empty SAFE zip, a zip that
// is not a SAFE product, and a header that claims 2 MB of TIFF that is not
// there. Every one has to be refused by name, for a stated reason, and leave the
// scene that is on screen exactly as it was.
//
// Part 2 — a deterministic random walk over the real controls (clicks, the mode
// keys, +/-/0, wheel zoom, drags, double-clicks), with the invariant checker
// armed. Fourteen real defects in this repo were of the "throws only when you
// do it in that order" kind, so this is the cheapest way to keep finding them.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { launch, watchPage, APP_URL, prepareDirs } from './browser.mjs';

prepareDirs();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const JUNK_DIR = path.join(tmpdir(), 'avni-junk');
mkdirSync(JUNK_DIR, { recursive: true });
const fixture = (...parts) => path.join(process.cwd(), ...parts);
const realTiff = readFileSync(fixture('fixtures', 'geotiff', 'T43REP-tiled-utm43n.tif'));

const JUNK = [
  ['empty.tif', Buffer.alloc(0)],
  ['one-byte.tif', Buffer.from([0x49])],
  ['text.tif', Buffer.from('this is not a tiff at all, not even close\n'.repeat(20))],
  ['truncated.tif', realTiff.subarray(0, 120)],
  ['truncated.jp2', readFileSync(fixture('fixtures', 'jp2', 'T43REP_20250814T051742_B04_10m.jp2')).subarray(0, 60)],
  ['jpeg-named.jp2', readFileSync(fixture('src', 'assets', 'scene-optical.jpg')).subarray(0, 400)],
  ['empty.SAFE.zip', Buffer.from(zipSync({}))],
  ['junk.SAFE.zip', Buffer.from(zipSync({ 'readme.txt': strToU8('no metadata here'), 'MTD_MSIL2A.xml': strToU8('<nope') }))],
  ['huge-lie.tif', Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00]), Buffer.alloc(2_000_000, 7)])]
].map(([name, bytes]) => {
  const file = path.join(JUNK_DIR, name);
  writeFileSync(file, bytes);
  return { name, file, bytes: bytes.length };
});

const browser = await launch({ width: 1500, height: 900 });
const page = watchPage(await browser.newPage(), 'robustness');
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
});

await page.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForNetworkIdle({ idleTime: 700 });
await wait(1200);

const readScene = () =>
  page.evaluate(() => {
    // the registered scene is the mono row in the imagery panel; the toast rail
    // is the fixed status region, not the viewer's readout pills
    const rail = document.querySelector('#imagery-panel') || document.querySelector('aside');
    const sceneRow = (rail?.querySelector('.font-mono')?.textContent || rail?.innerText.split('\n')[0] || '').replace(/\s+/g, ' ').trim();
    const aoi = (document.body.innerText.match(/AOI [\d.]+ km²[^\n]*/) || ['(no AOI)'])[0];
    const toastRail = [...document.querySelectorAll('div[role="status"]')].find((n) => n.className.includes('fixed'));
    const lastToast = toastRail?.lastElementChild?.textContent?.replace(/\s+/g, ' ').trim() || '';
    return {
      scene: sceneRow.slice(0, 90),
      aoi,
      lastToast,
      boundary: /console fault/i.test(document.body.innerText)
    };
  });

// ---------------------------------------------------------------- 1. rubbish
const start = await readScene();
check('the console starts on the bundled scene', /S2_L2A|RISAT/.test(start.scene), start.scene);

let refused = 0;
let survived = 0;
let named = 0;
for (const junk of JUNK) {
  const input = await page.$('input[aria-label="register a scene file"]');
  await input.uploadFile(junk.file);
  await wait(1300);
  const after = await readScene();
  const refusedHere = /not registered/.test(after.lastToast);
  const stillThere = after.scene === start.scene && after.aoi === start.aoi;
  const saidWho = after.lastToast.includes(junk.name);
  if (refusedHere) refused += 1;
  if (stillThere) survived += 1;
  if (saidWho) named += 1;
  if (after.boundary) check(`${junk.name} must not trip the error boundary`, false, 'error boundary shown');
  console.log(
    `      ${junk.name.padEnd(16)} ${String(junk.bytes).padStart(9)} B  ${refusedHere ? 'refused' : 'NOT REFUSED'}  ${
      stillThere ? 'scene intact' : 'SCENE CHANGED'
    }  ${saidWho ? 'named' : 'UNNAMED'}  "${after.lastToast.slice(0, 72)}"`
  );
}
check(`all ${JUNK.length} malformed uploads are refused`, refused === JUNK.length, `${refused}/${JUNK.length} refused`);
check('every refusal names the file it refused', named === JUNK.length, `${named}/${JUNK.length} named the file`);
check(
  'a refused upload leaves the working scene in place',
  survived === JUNK.length,
  `${survived}/${JUNK.length} kept ${start.scene} · ${start.aoi}`
);

// ---------------------------------------------------------------- 2. random walk
// deterministic: a fixed LCG seeds the action sequence, so a failure can be
// replayed by running this script again
let seed = 987654321;
const rnd = (n) => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % n;
};
const KEYS = ['1', '2', '3', '4', '+', '-', '0', '/', '?', 'Escape', 'Enter', 'Tab', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'a', 'Delete'];
const box = await page.evaluate(() => {
  const r = document.querySelector('.scanlines').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const at = (x, y) => [box.x + 30 + (x % Math.max(1, Math.floor(box.w - 90))), box.y + 30 + (y % Math.max(1, Math.floor(box.h - 90)))];

const walkErrors = [];
const pressed = [];
for (let i = 0; i < 120; i += 1) {
  const kind = rnd(7);
  try {
    if (kind === 0) {
      // exports, downloads and the panel toggles stay out of the walk: the
      // first two are covered by the dedicated suites (and would fill the
      // download directory), the last two hide the very panels being sampled
      const names = await page.evaluate(() =>
        [...document.querySelectorAll('main button, header button, aside button')]
          .filter(
            (b) =>
              !b.disabled &&
              !/export|download|report|bundle|fullscreen|print|imagery panel|query panel|drawer/i.test(
                `${b.textContent} ${b.getAttribute('aria-label') || ''} ${b.getAttribute('title') || ''}`
              )
          )
          .map((b) => (b.textContent || b.getAttribute('aria-label') || b.title || '?').replace(/\s+/g, ' ').trim().slice(0, 40))
      );
      if (names.length) {
        const choice = rnd(names.length);
        pressed.push(names[choice]);
        await page.evaluate((i) => {
          const btns = [...document.querySelectorAll('main button, header button, aside button')].filter(
            (b) =>
              !b.disabled &&
              !/export|download|report|bundle|fullscreen|print|imagery panel|query panel|drawer/i.test(
                `${b.textContent} ${b.getAttribute('aria-label') || ''} ${b.getAttribute('title') || ''}`
              )
          );
          if (btns[i]) btns[i].click();
        }, choice);
      }
    } else if (kind === 1) {
      await page.keyboard.press(KEYS[rnd(KEYS.length)]);
    } else if (kind === 2) {
      const [x, y] = at(rnd(box.w), rnd(box.h));
      await page.mouse.move(x, y);
      await page.mouse.wheel({ deltaY: (rnd(2) ? -1 : 1) * (100 + rnd(400)) });
    } else if (kind === 3) {
      const [x, y] = at(rnd(box.w), rnd(box.h));
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + rnd(160) - 80, y + rnd(160) - 80, { steps: 3 });
      await page.mouse.up();
    } else if (kind === 4) {
      const [x, y] = at(rnd(box.w), rnd(box.h));
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.up();
      await page.mouse.down();
      await page.mouse.up();
    } else if (kind === 5) {
      const howMany = await page.evaluate(() => document.querySelectorAll('[role="radio"]').length);
      if (howMany) {
        await page.evaluate((i) => document.querySelectorAll('[role="radio"]')[i].click(), rnd(howMany));
      }
    } else {
      const howMany = await page.evaluate(
        () => [...document.querySelectorAll('button[aria-pressed]')].filter((b) => !/segment|draw/i.test(b.textContent || '')).length
      );
      if (howMany) {
        await page.evaluate((i) => {
          const rows = [...document.querySelectorAll('button[aria-pressed]')].filter((b) => !/segment|draw/i.test(b.textContent || ''));
          rows[i].click();
        }, rnd(howMany));
      }
    }
    await wait(30 + rnd(70));
  } catch (e) {
    walkErrors.push(String(e).slice(0, 120));
  }
}
await wait(1200);
const health = await page.evaluate(() => ({
  boundary: /console fault/i.test(document.body.innerText),
  header: !!document.querySelector('header'),
  canvas: !!document.querySelector('.scanlines canvas'),
  railPresent: !!document.querySelector('#imagery-panel'),
  aoi: (document.body.innerText.match(/AOI [\d.]+ km²/) || ['(no AOI)'])[0]
}));

check('120 random interactions did not throw', walkErrors.length === 0, walkErrors.slice(0, 2).join(' | '));
check('no error boundary after the walk', health.boundary === false, JSON.stringify(health));
check(
  'the console is still live after the walk',
  health.header && health.canvas && health.railPresent && /km²/.test(health.aoi),
  `${JSON.stringify(health)} — e.g. pressed ${JSON.stringify([...new Set(pressed)].slice(0, 4))}`
);
const invariants = consoleErrors.filter((m) => /invariant/i.test(m));
const others = consoleErrors.filter((m) => !/invariant/i.test(m));
check('no promise or render exceptions from the walk', pageErrors.length === 0, [...new Set(pageErrors)].slice(0, 3).join(' | '));
check('the store invariants held throughout', invariants.length === 0, [...new Set(invariants)].slice(0, 3).join(' | '));
check('no console errors from the walk', others.length === 0, [...new Set(others)].slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} check(s) FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
