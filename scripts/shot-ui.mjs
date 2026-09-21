// Showcase pass for the current UI. Run the dev server first (npm run dev), then:
//   node scripts/shot-ui.mjs      # writes shots/ui-*.jpg
//
// Companion to shot.mjs (which drives the export/verify flows): this one just
// photographs the shell, an answered question, the accessibility guide and the
// phone drawer, at full size.
import path from 'node:path';
import { launch, watchPage, APP_URL, SHOTS_DIR, prepareDirs } from './browser.mjs';

prepareDirs();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clickText = (page, text) =>
  page.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(t));
    if (b) b.click();
    return Boolean(b);
  }, text);

const browser = await launch({ width: 1680, height: 950 });
const page = watchPage(await browser.newPage(), 'ui');
const shot = (name) =>
  page.screenshot({ path: path.join(SHOTS_DIR, name), type: 'jpeg', quality: 88 });

await page.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForNetworkIdle({ idleTime: 700 });
await wait(900);
await shot('ui-01-shell.jpg');
console.log('ui 01 ok · shell');

// ask the flagship question, open the trace, land on the geodetic row
await page.click('#composer-input');
await page.type('#composer-input', 'Where is flooding most severe, and can you trust the water reading near the buildings?', { delay: 3 });
await page.keyboard.press('Enter');
await wait(4400);
await clickText(page, 'Execution trace');
await wait(600);
await shot('ui-02-answer.jpg');
console.log('ui 02 ok · answered question');

// scroll the answer panel to its foot, where the derived geodetic row lives
await page.evaluate(() => {
  const scroller = document.querySelector('#composer-input').closest('aside').querySelector('.overflow-y-auto');
  if (scroller) scroller.scrollTo({ top: scroller.scrollHeight });
});
await wait(500);
await shot('ui-03-geodetic.jpg');
console.log('ui 03 ok · geodetic foot');

// accessibility guide
// the guide lives behind the header's ⓘ — click it by its accessible name so
// the shot documents the real affordance, not a synthetic keypress
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(
    (x) => x.getAttribute('aria-label') === 'open the console guide'
  );
  if (b) b.click();
  return Boolean(b);
});
await wait(600);
await shot('ui-04-help.jpg');
console.log('ui 04 ok · help');
await page.keyboard.press('Escape');
await wait(400);

// phone: imagery drawer over the scene
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await wait(700);
await page.evaluate(() => {
  const b = document.querySelector('[aria-controls="imagery-panel"]');
  if (b) b.click();
});
await wait(600);
await shot('ui-05-mobile-imagery.jpg');
console.log('ui 05 ok · mobile imagery drawer');

await browser.close();
console.log('done');
