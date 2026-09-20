// Accessibility pass with axe-core over the states a reader actually reaches:
// the shell at rest, the console mid-answer, the guide dialog, and the phone
// drawer. package.json has pointed at this script since the a11y batch, so a
// missing file here means `npm run verify` stops part way through.
//   npm run verify:a11y
import { readFileSync } from 'node:fs';
import { launch, watchPage, APP_URL, prepareDirs } from './browser.mjs';

prepareDirs();
const axe = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');

const browser = await launch({ width: 1680, height: 950 });
const page = watchPage(await browser.newPage(), 'a11y');
await page.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForNetworkIdle({ idleTime: 600 });
await new Promise((r) => setTimeout(r, 900));

const results = [];
const IMPACT_FAILS = new Set(['critical', 'serious']);

const audit = async (label) => {
  await page.evaluate(axe);
  const report = await page.evaluate(async () => {
    const out = await window.axe.run(document, {
      resultTypes: ['violations'],
      rules: { region: { enabled: false } } // the app is a single region by design
    });
    return out.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' '))
    }));
  });
  const blocking = report.filter((v) => IMPACT_FAILS.has(v.impact));
  results.push([
    `${label}: no serious or critical axe violations`,
    blocking.length === 0,
    report.length ? report.map((v) => `${v.impact}:${v.id}(${v.nodes.join(',')})`).join(' | ') : 'clean'
  ]);
  return report;
};

await audit('shell at rest');

// mid-answer, with the console populated
await page.type('#composer-input', 'Where is flooding most severe?', { delay: 2 });
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 5000));
await audit('after an answer');

// the guide dialog
await page.click('[aria-label="open the console guide"]');
await new Promise((r) => setTimeout(r, 600));
await audit('guide dialog open');
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 400));

// keyboard reachability of the scene and the rail controls
const focus = await page.evaluate(() => {
  const ids = [...document.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])')].filter(
    (el) => el.offsetParent !== null && !el.disabled
  );
  const names = ids.map((el) => (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim());
  const unnamed = names.filter((n) => !n).length;
  return { count: names.length, unnamed };
});
results.push(['every visible control has an accessible name', focus.unnamed === 0, `${focus.count} controls, ${focus.unnamed} unnamed`]);

// the phone drawer
const small = watchPage(await browser.newPage(), 'a11y-phone');
await small.setViewport({ width: 390, height: 844 });
await small.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 60000 });
await small.waitForNetworkIdle({ idleTime: 600 });
await new Promise((r) => setTimeout(r, 600));
await small.click('button[title="imagery panel"]');
await new Promise((r) => setTimeout(r, 500));
await small.evaluate(axe);
const phone = await small.evaluate(async () => {
  const out = await window.axe.run(document, { resultTypes: ['violations'] });
  return out.violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => `${v.impact}:${v.id}`);
});
results.push(['phone drawer: no serious or critical axe violations', phone.length === 0, phone.join(' | ') || 'clean']);

await browser.close();
for (const [name, ok, detail] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
const failed = results.filter((r) => !r[1]).length;
console.log(failed ? `${failed} check(s) failed` : 'ALL PASS');
process.exit(failed ? 1 : 0);
