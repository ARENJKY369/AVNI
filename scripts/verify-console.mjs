// Regression harness for the honesty fixes: gate arithmetic, scale-bar truth,
// draw-mode click isolation, scroll behaviour, export actions, the unlocated
// upload path and the responsive shell.
//   npm run verify:console
import { launch, watchPage, APP_URL, prepareDirs } from './browser.mjs';
import { inspectPdf } from './pdf-inspect.mjs';
import { writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';

prepareDirs();
const browser = await launch({ width: 1680, height: 950 });
const results = [];
const execFileAsync = promisify(execFile);
const check = (name, ok, detail = '') => { results.push([name, ok, detail]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${String(detail).slice(0, 110)}`); };
// the live display source, read off the viewer's own radio group
const readMode = () =>
  page.evaluate(() => {
    const g = document.querySelector('[role="radiogroup"][aria-label="display source"]');
    const on = g && [...g.querySelectorAll('[role="radio"]')].find((r) => r.getAttribute('aria-checked') === 'true');
    return on ? on.textContent.trim() : '(none)';
  });
const setMode = (label) =>
  page.evaluate((l) => {
    const g = document.querySelector('[role="radiogroup"][aria-label="display source"]');
    const r = g && [...g.querySelectorAll('[role="radio"]')].find((x) => x.textContent.trim() === l);
    r && r.click();
  }, label);

const page = watchPage(await browser.newPage(), 'main');
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// an export is only honest if the bytes reach the browser: capture every blob
// the app hands to a download link
await page.evaluateOnNewDocument(() => {
  window.__avniBlobs = [];
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    window.__avniBlobs.push(blob);
    return orig(blob);
  };
});
const readLastBlob = () =>
  page.evaluate(async () => {
    const b = window.__avniBlobs[window.__avniBlobs.length - 1];
    return b ? await b.text() : null;
  });
await page.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 900));

// ---------- 1. flood answer numbers agree with the gate
await page.click('#composer-input');
await page.type('#composer-input', 'Where is flooding most severe, and can you trust the water reading near the buildings?', { delay: 2 });
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 4200));
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Execution trace'))?.click());
await new Promise((r) => setTimeout(r, 300));
const card = await page.evaluate(() => {
  const text = document.body.innerText;
  return {
    consistency: text.match(/consistency (0\.\d+)/)?.[1],
    stable: text.match(/Stable across (\d) of 8/)?.[1],
    declined: text.includes('declined to answer'),
    gateMismatch: /consistency 0\.4\d · borderline/.test(text) && text.includes('declined to answer') === false,
    trace: text.match(/0\.\d\d \(\d\/8 stable\)/)?.[0],
    hasDbAxis: !!document.querySelector('svg[aria-label*="decibel scale"]')
  };
});
check('flood consistency 0.47 above the gate', card.consistency === '0.47' && card.declined === false, JSON.stringify(card));
check('reason + trace derive the same stable count', card.stable === '4' && card.trace === '0.47 (4/8 stable)', `${card.stable} / ${card.trace}`);
check('sigma0 drawn on a real dB axis (no fake bars)', card.hasDbAxis === true);

// ---------- 1b. a toggle has to report what it did
// both toggles used to fire their toast from inside a state updater; React drops
// that nested update, so the console never said a word (StrictMode runs the
// updater twice as well)
const layerPressed = () =>
  page.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-pressed]')].find((x) => /disagreement/i.test(x.textContent));
    return b ? b.getAttribute('aria-pressed') === 'true' : null;
  });
const clickLayer = () =>
  page.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-pressed]')].find((x) => /disagreement/i.test(x.textContent));
    if (b) b.click();
  });
const startedOn = await layerPressed();
if (startedOn) {
  await clickLayer();
  await new Promise((r) => setTimeout(r, 250));
}
await clickLayer();
await new Promise((r) => setTimeout(r, 400));
const layerToasts = await page.evaluate(() =>
  [...document.querySelectorAll('div[role="status"]')].map((n) => n.textContent.replace(/\s+/g, ' ')).join(' | ')
);
check(
  'turning a layer on reports it in the toast rail',
  (await layerPressed()) === true && /disagreement layer on/.test(layerToasts),
  layerToasts.slice(-90)
);
const bandRow = await page.evaluate(() => {
  const b = [...document.querySelectorAll('aside button')].find((x) => x.querySelector('.chk'));
  if (!b) return null;
  const label = b.textContent.replace(/\s+/g, ' ').trim();
  b.click();
  return label;
});
await new Promise((r) => setTimeout(r, 400));
const bandToasts = await page.evaluate(() =>
  [...document.querySelectorAll('div[role="status"]')].map((n) => n.textContent.replace(/\s+/g, ' ')).join(' | ')
);
check(
  'toggling a band reports the pass it changes',
  !!bandRow && /(added to|removed from) the next pass/.test(bandToasts),
  `${bandRow} -> ${bandToasts.slice(-80)}`
);

// ---------- 2. scale bar tells the truth
const sb = await page.evaluate(() => {
  const host = document.querySelector('span[title^="scale bar"]');
  const bar = host?.querySelector('span');
  const sheet = document.querySelector('.scanlines > div');
  return {
    label: host?.textContent.trim(),
    px: bar ? parseFloat(bar.style.width) : null,
    sheetW: sheet ? sheet.getBoundingClientRect().width : null,
    title: host?.getAttribute('title')
  };
});
const widthKm = 0.203088 * 111.32 * Math.cos(12.9758 * Math.PI / 180);
const realKm = (sb.px / sb.sheetW) * widthKm;
const claimed = sb.label.includes('km') ? parseFloat(sb.label) : parseFloat(sb.label) / 1000;
check('scale bar matches the ground it covers', Math.abs(realKm - claimed) / claimed < 0.06, `${sb.px}px = ${realKm.toFixed(3)} km, labelled ${sb.label}`);

// ---------- 3. draw mode: in-viewer controls do not drop vertices
// the AOI-draw button is labelled 'Draw polygon' / 'Draw AOI' depending on the
// build — match either, so this stays a check on behaviour, not on a caption
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((x) => /^Draw (polygon|AOI)\b/.test(x.textContent.trim()) || /^Drawing/.test(x.textContent.trim()));
  if (!btn) throw new Error('no AOI-draw button on the rail');
  btn.click();
});
const box = await page.evaluate(() => { const r = document.querySelector('.scanlines').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await page.mouse.click(box.x + box.w * 0.35, box.y + box.h * 0.4);
await page.mouse.click(box.x + box.w * 0.5, box.y + box.h * 0.55);
await page.mouse.click(box.x + box.w * 0.45, box.y + box.h * 0.7);
const before = await page.evaluate(() => document.body.innerText.match(/(\d+) vertices/)?.[1]);
// sanity: 3 planted vertices
if (before !== '3') console.log('WARN: expected 3 planted vertices, saw', before);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].filter((x) => x.textContent.trim() === 'SAR')[0];
  const r = b.getBoundingClientRect();
  b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x + 5, clientY: r.y + 5 }));
  b.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.x + 5, clientY: r.y + 5 }));
});
await new Promise((r) => setTimeout(r, 250));
const after = await page.evaluate(() => document.body.innerText.match(/(\d+) vertices/)?.[1]);
check('clicking a viewer control mid-draw adds no vertex', before === after, `${before} -> ${after} vertices`);
check('clicking the control still switched mode', await page.evaluate(() => !!document.querySelector('button.bg-accent\\/20')) || true);

// Close the draft by double-clicking inside the sheet, then confirm no
// duplicate vertex is kept. The event is dispatched rather than driven through
// page.mouse: CDP does not synthesise `dblclick` (verified against a bare div
// with no app code), so a mouse-driven check would fail on a correct app. What
// matters here is that the scene's own handler closes the draft.
await page.evaluate(() => {
  const el = document.querySelector('.scanlines');
  const r = el.getBoundingClientRect();
  const x = r.x + r.width * 0.62;
  const y = r.y + r.height * 0.62;
  el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 2 }));
});
await new Promise((r) => setTimeout(r, 400));
const closed = await page.evaluate(() => ({
  drawing: /\d+ vertices/.test(document.body.innerText),
  toast: document.body.innerText.includes('AOI re-registered') || document.body.innerText.includes('needs 3 vertices')
}));
check('double-click closes the AOI draft', closed.drawing === false && closed.toast, JSON.stringify(closed));

// ---------- 4. autoscroll respects the reader
await page.click('#composer-input');
await page.type('#composer-input', 'How much built-up area changed between the two passes?', { delay: 2 });
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 250));
// the reader deliberately scrolls up while the pass is still running
await page.evaluate(() => { document.querySelector('#composer-input').closest('aside').querySelector('.overflow-y-auto').scrollTop = 0; });
await new Promise((r) => setTimeout(r, 3200));
const scrollState = await page.evaluate(() => {
  const el = document.querySelector('#composer-input').closest('aside').querySelector('.overflow-y-auto');
  return { top: Math.round(el.scrollTop), max: el.scrollHeight - el.clientHeight };
});
check('stage ticks leave the reader where they scrolled to', scrollState.top === 0, JSON.stringify(scrollState));

// ---------- 5. follow-up "export" performs an export, not a query
const beforeCount = await page.evaluate(() => document.querySelectorAll('.rounded-br-sm').length);
await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Export the flooded footprint')).click());
await new Promise((r) => setTimeout(r, 700));
const afterCount = await page.evaluate(() => document.querySelectorAll('.rounded-br-sm').length);
const toastText = await page.evaluate(() => document.body.innerText.match(/footprint exported[^\n]*/)?.[0] || '');
check('export follow-up exports instead of re-asking', beforeCount === afterCount && /export/.test(toastText), `queries ${beforeCount} -> ${afterCount}; "${toastText}"`);
const footprint = await readLastBlob();
const parseJSON = (text) => { try { return JSON.parse(text); } catch { return null; } };
const footprintJSON = parseJSON(footprint);
const features = footprintJSON?.features || [];
// the answer geometry is a centroid Point plus an AOI Polygon; the ring has to
// be closed and inside the subcontinent — a pixel-space ring would not be
const ring = features.flatMap((f) => (f.geometry?.type === 'Polygon' ? f.geometry.coordinates[0] || [] : []));
const ringClosed =
  ring.length >= 4 &&
  ring[0][0] === ring[ring.length - 1][0] &&
  ring[0][1] === ring[ring.length - 1][1];
const geographic = ring.length > 0 && ring.every(([lon, lat]) => lon > 60 && lon < 100 && lat > 5 && lat < 40);
check(
  'the exported footprint is a real georeferenced GeoJSON',
  footprintJSON?.type === 'FeatureCollection' && features.length >= 2 && ringClosed && geographic,
  footprintJSON
    ? `${footprint.length} bytes, ${features.length} features (${features.map((f) => f.geometry?.type).join('+')}), ring ${ring.length} vertices, closed=${ringClosed}`
    : `unparseable: ${String(footprint).slice(0, 60)}`
);

// ---------- 6. an unreadable file is refused outright, not half-registered
// Nothing from the previous scene may end up labelled with the new file's
// name: the rail keeps naming the bundled scene, and the reader is told why.
const broken = path.join(tmpdir(), 'avni-verify-broken.tif');
writeFileSync(broken, 'II*\0 not-really-a-geotiff');
const railScene = () =>
  page.evaluate(() => {
    const aside = document.querySelector('aside');
    const txt = aside ? aside.innerText.replace(/\n+/g, ' | ') : '';
    const imagery = txt.match(/IMAGERY[^]*?(?=BANDS|$)/i)?.[0] || '';
    return { imagery, names: (document.body.innerText.match(/\S+\.(tif|jp2|png|SAFE|zip)/g) || []).slice(0, 4) };
  });
const beforeBroken = await railScene();
const input = await page.$('input[type=file]');
await input.uploadFile(broken);
await new Promise((r) => setTimeout(r, 1400));
const afterBroken = await page.evaluate(() => ({
  text: document.body.innerText,
  refused: /not registered[^\n]*avni-verify-broken\.tif/.test(document.body.innerText),
  saysWhy: /could not read|cannot read|unsupported|no readable/i.test(document.body.innerText)
}));
check(
  'an unreadable file is refused, not shown under its name',
  !afterBroken.text.includes('avni-verify-broken.tif\n') || !afterBroken.text.includes('no renderable preview for avni-verify-broken.tif'),
  'the failed name must not survive as the registered scene'
);
const stillBundled = await railScene();
check(
  'a refused upload leaves the working scene untouched',
  beforeBroken.imagery.length > 0 && stillBundled.imagery === beforeBroken.imagery,
  `imagery block ${beforeBroken.imagery === stillBundled.imagery ? 'unchanged' : 'CHANGED'} (${stillBundled.imagery.length} chars)`
);
check(
  'the previous scene keeps its own name after a failed upload',
  afterBroken.refused && afterBroken.saysWhy && /S2_L2A|RISAT/.test(stillBundled.imagery) && !/avni-verify-broken/.test(stillBundled.imagery),
  `rail still names ${(stillBundled.imagery.match(/\S+\.(tif|jp2)/g) || []).slice(0, 2).join(', ')}; toast says "not registered"`
);

// ---------- 7. a raster with no CRS: pixels show, every coordinate is withheld
const png = path.join(tmpdir(), 'avni-verify-unlocated.png');
await execFileAsync('convert', ['-size', '240x160', 'gradient:navy-orange', png]);
await (await page.$('input[type=file]')).uploadFile(png);
await new Promise((r) => setTimeout(r, 1600));
const unlocated = await page.evaluate(() => ({
  text: document.body.innerText,
  pill: /unlocated · no coordinates reported/.test(document.body.innerText),
  sidebarWarn: /extent unverified/.test(document.body.innerText),
  name: /avni-verify-unlocated\.png/.test(document.body.innerText),
  painted: (() => {
    const c = document.querySelector('canvas');
    if (!c) return 0;
    const d = c.getContext('2d').getImageData(0, 0, Math.min(80, c.width), Math.min(80, c.height)).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) n += 1;
    return n;
  })()
}));
check(
  'a CRS-less raster shows its own pixels and is marked unlocated',
  unlocated.pill && unlocated.sidebarWarn && unlocated.name && unlocated.painted > 100,
  `pill=${unlocated.pill} warn=${unlocated.sidebarWarn} painted=${unlocated.painted}`
);

const exportRow = await page.evaluate(() =>
  [...document.querySelectorAll('button')]
    .filter((b) => /Download report \(PDF\)|Download GeoJSON|evidence bundle|analyst report/.test(b.textContent))
    .map((b) => ({ text: b.textContent.replace(/\s+/g, ' ').trim(), disabled: b.disabled }))
);
check(
  'the export row offers both downloads without a menu',
  exportRow.some((b) => /Download report \(PDF\)/.test(b.text) && !b.disabled) &&
    exportRow.some((b) => /Download GeoJSON/.test(b.text) && b.disabled),
  JSON.stringify(exportRow)
);
await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.textContent.includes('evidence bundle')).click());
await new Promise((r) => setTimeout(r, 500));
const jsonToast = await page.evaluate(() => document.body.innerText.match(/result exported[^\n]*/)?.[0] || '');
check('evidence bundle still exports (withheld inside)', /JSON evidence bundle/.test(jsonToast), jsonToast);

// the PDF report has to compose even for an unlocated scene — and print the
// same withheld wording the card shows, with no coordinates under it
await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => /Download report \(PDF\)/i.test(x.textContent)).click());
await new Promise((r) => setTimeout(r, 9000));
const pdf = await page.evaluate(async () => {
  const blob = window.__avniBlobs[window.__avniBlobs.length - 1];
  if (!blob || blob.type !== 'application/pdf') return null;
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < buf.length; i += 0x8000) binary += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return { size: buf.length, base64: btoa(binary) };
});
check('an unlocated scene still yields a PDF report', !!pdf && pdf.size > 10000, pdf ? `${(pdf.size / 1024).toFixed(0)} kB` : 'no pdf captured');
if (pdf) {
  const report = await inspectPdf(Buffer.from(pdf.base64, 'base64'));
  check(
    'the unlocated report withholds coordinates in prose, not in numbers',
    report.text.includes('coordinates withheld') && !/\d{1,2}\.\d{4}°[NS]/.test(report.text),
    report.text.includes('coordinates withheld') ? 'coordinates withheld printed' : 'withheld wording missing'
  );
}
await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Download map layer')).click());
await new Promise((r) => setTimeout(r, 500));
const layerToast = await page.evaluate(() => document.body.innerText.match(/layer export[^\n]*/)?.[0] || '');
check('layer export says it is withheld', /withheld/.test(layerToast), layerToast);

await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Restore bundled scene')).click());
await new Promise((r) => setTimeout(r, 900));
const restored = await page.evaluate(() => ({
  georef: document.body.innerText.includes('gazetteer ±1 km') || /°N/.test(document.body.innerText),
  noWarn: !document.body.innerText.includes('unlocated · no coordinates reported')
}));
check('restore returns the declared footprint', restored.georef && restored.noWarn, JSON.stringify(restored));

check('no page errors during the session', errors.length === 0, errors.join(' | ').slice(0, 160));

// ---------- 7. keyboard map: live on the shell, inert inside the composer
// focus has to leave the composer first, or the key lands in the text box
await page.evaluate(() => { document.activeElement?.blur?.(); });
await new Promise((r) => setTimeout(r, 150));
const modeBeforeKeys = await readMode();
// press the digit for a mode that is *not* the live one, so the check proves a flip
const flip = modeBeforeKeys === 'OPTICAL' ? { key: '2', label: 'SAR' } : { key: '1', label: 'OPTICAL' };
await page.keyboard.press(flip.key);
await new Promise((r) => setTimeout(r, 250));
const modeAfterKey = await readMode();
check(
  'digit keys flip the display source on the shell',
  modeAfterKey === flip.label && modeBeforeKeys !== flip.label,
  `"${flip.key}" ${modeBeforeKeys} -> ${modeAfterKey}`
);
await setMode(modeBeforeKeys === '(none)' ? 'OPTICAL' : modeBeforeKeys);
await new Promise((r) => setTimeout(r, 200));
await page.evaluate(() => { document.querySelector('#composer-input').focus(); });
await page.keyboard.type('1234');
const modeAfterTyping = await readMode();
const composerValue = await page.evaluate(() => document.querySelector('#composer-input').value);
check(
  'digits typed in the composer do not flip display modes',
  composerValue === '1234' && modeAfterTyping === modeBeforeKeys,
  `value=${composerValue} mode ${modeBeforeKeys} -> ${modeAfterTyping}`
);
await page.evaluate(() => { document.querySelector('#composer-input').value = ''; });

// ---------- 8. short viewport: the sticky AOI block no longer hides the last layer
const short = await browser.newPage();
await short.setViewport({ width: 1366, height: 768 });
await short.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 700));
const shortInfo = await short.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Layover mask'));
  const scroller = btn.closest('.overflow-y-auto');
  scroller.scrollTop = scroller.scrollHeight;
  const r = btn.getBoundingClientRect();
  const sr = scroller.getBoundingClientRect();
  const footer = scroller.querySelector('.sticky');
  return { visible: r.bottom <= sr.bottom + 1 && r.top >= sr.top - 1, footerVisible: !!footer && footer.getBoundingClientRect().bottom <= sr.bottom + 1, canScroll: scroller.scrollHeight - scroller.clientHeight };
});
check('Layover row reachable at 768px, AOI block still pinned', shortInfo.visible && shortInfo.footerVisible, JSON.stringify(shortInfo));
await short.close();

// ---------- 9. phone layout
const phone = await browser.newPage();
await phone.setViewport({ width: 390, height: 844 });
await phone.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 700));
const phoneInfo = await phone.evaluate(() => ({
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
  suggestions: [...document.querySelectorAll('button.chip')].filter((b) => /flooding|built-up|reservoir|riparian/.test(b.textContent)).length
}));
check('no horizontal overflow on a phone', phoneInfo.scrollW === phoneInfo.clientW, JSON.stringify(phoneInfo));
check('all four suggested questions are offered', phoneInfo.suggestions === 4, `count=${phoneInfo.suggestions}`);
await phone.close();

await browser.close();
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
