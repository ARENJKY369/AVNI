// Headless screenshot pass over the running dev server.
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';

mkdirSync('shots', { recursive: true });

const browser = await puppeteer.launch({
  args: [...chromium.args, '--force-color-profile=srgb', '--hide-scrollbars'],
  executablePath: await chromium.executablePath(),
  headless: true,
  defaultViewport: { width: 1680, height: 950 }
});

const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text().slice(0, 200));
});

await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForNetworkIdle({ idleTime: 800 });
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: 'shots/01-empty.png' });
console.log('shot 01 ok');

// ask the flood question
await page.click('#composer-input');
await page.type('#composer-input', 'Where is flooding most severe, and can you trust the water reading near the buildings?', { delay: 4 });
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: 'shots/02-analyzing.png' });
console.log('shot 02 ok');

await new Promise((r) => setTimeout(r, 3200));
await page.evaluate(() => {
  const els = [...document.querySelectorAll('button')];
  const t = els.find((b) => b.textContent.includes('Execution trace'));
  t && t.click();
});
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: 'shots/03-answer.png' });
console.log('shot 03 ok');

// scroll the conversation so the physics callout + trace + geo row are visible
await page.evaluate(() => {
  const scroller = document.querySelector('#composer-input').closest('aside').querySelector('.flex-1.overflow-y-auto');
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
await page.screenshot({ path: 'shots/04-change.png' });
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
await page.screenshot({ path: 'shots/05-declined.png' });
console.log('shot 05 ok');

// SAR display source
await page.evaluate(() => {
  const pills = [...document.querySelectorAll('button')].filter((x) => x.textContent.trim() === 'SAR');
  pills[0] && pills[0].click();
});
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: 'shots/06-sar.png' });
console.log('shot 06 ok');

await browser.close();
console.log('done');
