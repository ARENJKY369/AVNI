// Headless screenshot pass. Run the dev server first (npm run dev), then:
//   npm run shots            # writes shots/*.jpg
//   AVNI_URL=http://host:5173 npm run shots
import { launch, watchPage, APP_URL, SHOTS_DIR, DOWNLOAD_DIR, prepareDirs } from './browser.mjs';
import path from 'node:path';

prepareDirs();

const browser = await launch({ width: 1680, height: 950 });
const page = watchPage(await browser.newPage(), 'shot');
const shot = (name) => page.screenshot({ path: path.join(SHOTS_DIR, name), type: 'jpeg', quality: 84 });

await page.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForNetworkIdle({ idleTime: 800 });
await new Promise((r) => setTimeout(r, 900));
await shot('01-empty.jpg');
console.log('shot 01 ok');

// ask the flood question
await page.click('#composer-input');
await page.type('#composer-input', 'Where is flooding most severe, and can you trust the water reading near the buildings?', { delay: 4 });
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 900));
await shot('02-analyzing.jpg');
console.log('shot 02 ok');

await new Promise((r) => setTimeout(r, 3200));
await page.evaluate(() => {
  const els = [...document.querySelectorAll('button')];
  const t = els.find((b) => b.textContent.includes('Execution trace'));
  t && t.click();
});
await new Promise((r) => setTimeout(r, 500));
await shot('03-answer.jpg');
console.log('shot 03 ok');

// open the export menu on the answer
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Export result'));
  b && b.click();
});
await new Promise((r) => setTimeout(r, 400));
await shot('07-export.jpg');
console.log('shot 07 ok');

// exercise every export path and record what the browser downloads
const client = await page.createCDPSession();
const got = [];
client.on('Browser.downloadWillBegin', (e) => got.push(e.suggestedFilename));
await client.send('Browser.setDownloadBehavior', {
  behavior: 'allow',
  downloadPath: DOWNLOAD_DIR,
  eventsEnabled: true
});
for (const label of ['evidence bundle', 'analyst report', 'footprint']) {
  await page.evaluate((l) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(l));
    b && b.click();
  }, label);
  await new Promise((r) => setTimeout(r, 500));
  // reopen menu for next item
  if (label !== 'footprint') {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Export result'));
      b && b.click();
    });
    await new Promise((r) => setTimeout(r, 300));
  }
}
// session report from the query panel header
await page.evaluate(() => {
  const b = document.querySelector('button[title="export session report · Markdown"]');
  b && b.click();
});
await new Promise((r) => setTimeout(r, 700));
console.log('DOWNLOADS:', got.join(', '));
console.log(`downloads landed in ${DOWNLOAD_DIR}`);

await page.evaluate(() => {
  const scroller = document.querySelector('#composer-input').closest('aside').querySelector('.overflow-y-auto');
  scroller && scroller.scrollTo({ top: scroller.scrollHeight });
});
await new Promise((r) => setTimeout(r, 300));

// attach second epoch, then change mode
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('attach a second scene for optical/SAR cross-check'));
  b && b.click();
});
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('use service epoch'));
  b && b.click();
});
await new Promise((r) => setTimeout(r, 600));
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'CHANGE ΔT');
  b && b.click();
});
await new Promise((r) => setTimeout(r, 700));
await shot('04-change.jpg');
console.log('shot 04 ok');

// back to optical, ask the reservoir (declined) question
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'OPTICAL');
  b && b.click();
});
await page.click('#composer-input');
await page.type('#composer-input', 'Is the reservoir reading reliable enough to act on?', { delay: 4 });
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 4200));
await shot('05-declined.jpg');
console.log('shot 05 ok');

// SAR display source
await page.evaluate(() => {
  const pills = [...document.querySelectorAll('button')].filter((x) => x.textContent.trim() === 'SAR');
  pills[0] && pills[0].click();
});
await new Promise((r) => setTimeout(r, 700));
await shot('06-sar.jpg');
console.log('shot 06 ok');

await browser.close();
console.log('done');
