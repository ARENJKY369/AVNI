// Responsive sanity pass: laptop + phone. Measures horizontal overflow and
// FAILS the run if any appears — the previous version printed the numbers and
// nobody ever looked at them.
//   npm run shots:responsive
import { launch, watchPage, APP_URL, SHOTS_DIR, prepareDirs } from './browser.mjs';
import path from 'node:path';

prepareDirs();
const browser = await launch({ width: 1366, height: 768 });
const results = [];

const measure = (page, label) =>
  page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    bodyScrollW: document.body.scrollWidth,
    bodyH: document.body.scrollHeight,
    winH: window.innerHeight
  })).then((m) => {
    const overflow = m.scrollW > m.clientW || m.bodyScrollW > m.clientW;
    results.push([label, !overflow, JSON.stringify(m)]);
    console.log(`${overflow ? 'FAIL' : 'PASS'}  ${label}  ${JSON.stringify(m)}`);
    return m;
  });

const run = async (name, width, height) => {
  const page = watchPage(await browser.newPage(), name);
  await page.setViewport({ width, height });
  await page.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForNetworkIdle({ idleTime: 600 });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: path.join(SHOTS_DIR, 'responsive', `${name}-empty.jpg`), type: 'jpeg', quality: 84 });
  await measure(page, `${name} empty`);
  // below lg the query panel is a drawer — open it before typing
  if (width < 1024) {
    await page.click('button[title="query panel"]');
    await new Promise((r) => setTimeout(r, 450));
    await measure(page, `${name} query drawer`);
  }
  await page.click('#composer-input');
  await page.type('#composer-input', 'Where is flooding most severe?', { delay: 3 });
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 4200));
  await page.screenshot({ path: path.join(SHOTS_DIR, 'responsive', `${name}-answer.jpg`), type: 'jpeg', quality: 84 });
  await measure(page, `${name} answered`);
  await page.close();
};

await run('laptop-1366x768', 1366, 768);
await run('phone-390x844', 390, 844);

await browser.close();
const failed = results.filter((r) => !r[1]);
console.log(failed.length ? `OVERFLOW FOUND in ${failed.map((f) => f[0]).join(', ')}` : 'responsive done — no overflow');
process.exit(failed.length ? 1 : 0);
