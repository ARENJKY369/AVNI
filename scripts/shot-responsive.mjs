// Responsive sanity pass: laptop + phone. Evidence for the "is it shippable" review.
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';

mkdirSync('shots/responsive', { recursive: true });

const browser = await puppeteer.launch({
  args: [...chromium.args, '--force-color-profile=srgb'],
  executablePath: await chromium.executablePath(),
  headless: true
});

const run = async (name, width, height) => {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForNetworkIdle({ idleTime: 600 });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: `shots/responsive/${name}-empty.png` });
  // below lg the query panel is a drawer — open it before typing
  if (width < 1024) {
    await page.click('button[title="query panel"]');
    await new Promise((r) => setTimeout(r, 450));
  }
  await page.click('#composer-input');
  await page.type('#composer-input', 'Where is flooding most severe?', { delay: 3 });
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 4200));
  await page.screenshot({ path: `shots/responsive/${name}-answer.png` });
  // measure overflow
  const m = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    viewerW: document.querySelector('main')?.getBoundingClientRect().width ?? 0,
    bodyH: document.body.scrollHeight,
    winH: window.innerHeight
  }));
  console.log(name, JSON.stringify(m));
  await page.close();
};

await run('laptop-1366x768', 1366, 768);
await run('phone-390x844', 390, 844);

await browser.close();
console.log('responsive done');
