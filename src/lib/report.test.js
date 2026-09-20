// The PDF report: what it prints, and that it prints only what it was given.
//
// The document is inspected the way a reader would see it — the content streams
// are decompressed and searched for the text, so an assertion here is about
// what is on the page, not about the model that produced it.
import { describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { SCENE_GEO, UNLOCATED_GEO } from '../lib/geo.js';
import {
  buildReportModel,
  buildReportPdf,
  geojsonFilename,
  reportFilename,
  sanitize
} from '../lib/report.js';
import { slug } from '../lib/export.js';

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const payload = {
  question: 'Where is flooding most severe, and can you trust the water reading near the buildings?',
  intent: 'flood',
  answer_text:
    'Flooding is most severe along the northern channel, where the optical and SAR passes agree on standing water for 11 km. The cluster next to the buildings is not flood: NDWI reads water while sigma0 stays bright, which is radar layover on the high-rise block.',
  confidence: {
    consistency_score: 0.82,
    reason: 'optical and SAR water masks agree across 84 % of the drawn AOI',
    abstained: false
  },
  physics_check: {
    ndwi: 0.61,
    sar_backscatter_db: -14.2,
    flagged: true,
    verdict: 'NDWI reads water where sigma0 stays bright — layover, not flooding.'
  },
  geodetic: { area_ha: 1240.5 },
  trace: [
    { step: 'read scene footprint', source: 'S2_L2A_2025-08-14_tile43REP.jp2', value: 'EPSG:32643' },
    { step: 'compose true colour from B04/B03/B02', source: 'MTD_MSIL2A.xml', value: '2025-08-14T05:17:42Z' },
    { step: 'cross-check water mask against VV', source: 'RISAT-1A_GRD_250813.tif', value: '-14.2 dB' }
  ]
};

const scenes = [
  {
    role: 'primary scene',
    file: 'S2_L2A_2025-08-14_tile43REP.jp2',
    sensor: 'Sentinel-2 L2A',
    label: 'S2 L2A · tile 43REP',
    acquired: '2025-08-14T05:17:42Z'
  },
  { role: 'SAR scene', file: 'RISAT-1A_GRD_250813.tif', sensor: 'RISAT-1A (C-band)', acquired: null }
];

const centroid = { lat: 12.9716, lon: 77.5946 };
const aoi = [
  { u: 0.33, v: 0.28 },
  { u: 0.68, v: 0.35 },
  { u: 0.73, v: 0.68 },
  { u: 0.39, v: 0.74 }
];

const model = (over = {}) =>
  buildReportModel({
    payload,
    query: { id: 3, at: Date.UTC(2025, 7, 14, 5, 20, 11) },
    geo: SCENE_GEO,
    centroid,
    aoiPoints: aoi,
    scenes,
    raster: { width: 1376, height: 768 },
    now: new Date(Date.UTC(2025, 7, 14, 6, 0, 0)),
    ...over
  });

/**
 * The report is WinAnsi-encoded, so bytes are decoded the same way a PDF reader
 * decodes them: a 0x97 on the page is an em dash, not a control byte.
 */
const winAnsi = (bytes) => {
  try {
    return new TextDecoder('windows-1252').decode(bytes);
  } catch {
    return Buffer.from(bytes).toString('latin1');
  }
};

/**
 * The text operators of a content stream. pdf-lib writes strings as hex, so
 * decoding them is the difference between reading the page and reading bytes.
 */
const decodeOperators = (stream) =>
  stream
    .split('\n')
    .filter((line) => /\bTj\b|\bTJ\b/.test(line))
    .map((line) =>
      [...line.matchAll(/<([0-9A-Fa-f]*)>|\(((?:\\.|[^)\\])*)\)/g)]
        .map((m) => (m[1] !== undefined ? winAnsi(Buffer.from(m[1], 'hex')) : m[2].replace(/\\([()\\])/g, '$1')))
        .join('')
    )
    .join('\n');

/** Every stream in the file, inflated where it is compressed. */
const extractText = async (bytes) => {
  const doc = await PDFDocument.load(bytes);
  const flat = Buffer.from(await doc.save({ useObjectStreams: false }));
  const out = [];
  let i = 0;
  for (;;) {
    const start = flat.indexOf('stream', i);
    if (start < 0) break;
    const end = flat.indexOf('endstream', start);
    if (end < 0) break;
    // the keyword is followed by an end-of-line that is not part of the data
    let from = start + 6;
    if (flat[from] === 0x0d) from += 1;
    if (flat[from] === 0x0a) from += 1;
    let chunk = flat.subarray(from, end);
    try {
      chunk = zlib.inflateSync(chunk);
    } catch {
      /* not a Flate stream — keep the raw bytes */
    }
    out.push(decodeOperators(winAnsi(chunk)));
    i = end + 9;
  }
  return out.filter(Boolean).join('\n');
};

const readDoc = async (bytes, over = {}) => {
  const doc = await PDFDocument.load(bytes);
  return { pages: doc.getPageCount(), text: await extractText(bytes), model: model(over) };
};

describe('the report model', () => {
  it('prints the payload numbers rather than recomputing them', () => {
    const m = model();
    expect(m.question).toBe(payload.question);
    expect(m.answer.text).toBe(payload.answer_text);
    expect(m.verification.find((r) => r.label === 'consistency score').value).toBe('0.82');
    expect(m.verification.find((r) => r.label === 'reason').value).toBe(payload.confidence.reason);
    expect(m.physics.find((r) => r.label === 'NDWI').value).toBe('0.61 (water gate 0.45)');
    expect(m.physics.find((r) => r.label === 'SAR backscatter').value).toBe('-14.2 dB');
    expect(m.physics.find((r) => r.label === 'verdict').value).toBe(payload.physics_check.verdict);
    expect(m.geodetic.rows.find((r) => r.label === 'footprint area (fixture)').value).toBe('1240.5 ha');
    expect(m.trace.map((t) => t.value)).toEqual(['EPSG:32643', '2025-08-14T05:17:42Z', '-14.2 dB']);
    expect(m.trace[0].source).toBe('S2_L2A_2025-08-14_tile43REP.jp2');
  });

  it('names the AOI the way the header does, not as an object', () => {
    const place = model().header.find((r) => r.label === 'area of interest').value;
    expect(typeof place).toBe('string');
    expect(place).not.toContain('[object');
    expect(place).toMatch(/ · /); // place · region
  });

  it('derives the AOI area from the drawn ring and keeps the fixture area separate', () => {
    const m = model();
    const aoiRow = m.geodetic.rows.find((r) => r.label === 'AOI area');
    expect(aoiRow.value).toMatch(/^\d+\.\d ha \(\d+\.\d+ km²\)$/);
  });

  it('lists the scene identifiers and acquisition dates from the imagery rail', () => {
    const m = model();
    expect(m.scenes[0]).toMatchObject({ role: 'primary scene', file: 'S2_L2A_2025-08-14_tile43REP.jp2' });
    expect(m.scenes[0].acquired).toBe('2025-08-14 05:17:42Z');
    // a scene that never declared an acquisition date says so instead of
    // printing nothing where a reader expects a date
    expect(m.scenes[1].acquired).toBe('acquisition date not reported in the file');
  });

  it('withholds every coordinate when the scene is not georeferenced', () => {
    const m = model({ geo: UNLOCATED_GEO });
    expect(m.geodetic.withheld).toBe(true);
    expect(m.geodetic.rows).toEqual([]);
    expect(m.header.find((r) => r.label === 'AOI centroid').value).toBe('coordinates withheld');
    expect(m.geojson.withheld).toBe(true);
    expect(m.geojson.filename).toBeNull();
    expect(JSON.stringify(m)).not.toContain('77.59');
  });

  it('carries the query timestamp it was handed, and says so when there is none', () => {
    expect(model().header.find((r) => r.label === 'query raised').value).toBe('2025-08-14 05:20:11 UTC');
    expect(model({ query: null }).header.find((r) => r.label === 'query raised').value).toBe(
      'not recorded for this session'
    );
  });

  it('marks the answer as declined when it was held at the gate', () => {
    const m = buildReportModel({
      ...model(),
      payload: undefined,
      geo: SCENE_GEO,
      now: new Date(Date.UTC(2025, 7, 14))
    });
    expect(m.answer.abstained).toBe(false); // no payload at all is not the same as an abstention
    const held = buildReportModel({
      payload: { ...payload, confidence: { ...payload.confidence, abstained: true, consistency_score: 0.31 } },
      geo: SCENE_GEO,
      centroid,
      aoiPoints: aoi,
      now: new Date(Date.UTC(2025, 7, 14))
    });
    expect(held.answer.abstained).toBe(true);
    expect(held.verification.find((r) => r.label === 'gate').value).toMatch(/declined/);
  });
});

describe('the document', () => {
  it('is a PDF with the report sections in it', async () => {
    const bytes = await buildReportPdf(model());
    const head = Buffer.from(bytes.subarray(0, 8)).toString('latin1');
    expect(head.startsWith('%PDF-')).toBe(true);
    const { pages, text } = await readDoc(bytes);
    expect(pages).toBeGreaterThanOrEqual(1);
    for (const section of ['Confidence & Verification', 'Geodetic Evidence', 'Execution Trace', 'Physics check']) {
      expect(text).toContain(section);
    }
    expect(text).toContain('Where is flooding most severe');
    expect(text).toContain('Flooding is most severe along the northern channel');
    expect(text).toContain('1240.5 ha');
    expect(text).toContain('read scene footprint');
    expect(text).toContain('Generated by SatQuery AI');
    expect(text).toContain(geojsonFilename(payload.question));
  });

  it('transliterates characters the standard fonts cannot carry', async () => {
    const { text } = await readDoc(await buildReportPdf(model()));
    expect(text).toContain('sigma0'); // from σ0
    // ...while the em dash the answer text carries stays an em dash
    expect(text).toContain('bright — layover');
  });

  it('says so when the map snapshot could not be taken', async () => {
    const bytes = await buildReportPdf(model());
    const text = await extractText(bytes);
    expect(text).toContain('map snapshot unavailable');
    expect(Buffer.from(await (await PDFDocument.load(bytes)).save({ useObjectStreams: false })).toString('latin1')).not.toContain(
      '/Subtype /Image'
    );
  });

  it('embeds the snapshot and its caption when one is supplied', async () => {
    const snapshot = {
      // a jsdom-realm Uint8Array: a Node Buffer is a different realm's
      // Uint8Array, which pdf-lib's instanceof check rejects
      bytes: new Uint8Array(Buffer.from(PNG_1X1, 'base64')),
      mediaType: 'image/png',
      width: 1400,
      height: 788,
      caption: 'map snapshot · EPSG:32643 · full scene · scale bar 1 km'
    };
    const bytes = await buildReportPdf(model({ snapshot }));
    const text = await extractText(bytes);
    expect(text).toContain('map snapshot');
    expect(text).not.toContain('snapshot unavailable');
    const flat = Buffer.from(await (await PDFDocument.load(bytes)).save({ useObjectStreams: false })).toString('latin1');
    expect(flat).toContain('/Subtype /Image');
  });

  it('paginates a long answer and numbers the pages', async () => {
    const long = {
      ...payload,
      answer_text: Array.from({ length: 60 }, (_, i) => `paragraph ${i + 1} of a long field answer about the flood extent.`).join(' ')
    };
    const bytes = await buildReportPdf(model({ payload: long }));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    const text = await extractText(bytes);
    expect(text).toContain(`page 1 of ${doc.getPageCount()}`);
    expect(text).toMatch(new RegExp(`page ${doc.getPageCount()} of ${doc.getPageCount()}`));
  });

  it('writes the withheld wording, and no coordinates, for an unlocated scene', async () => {
    const bytes = await buildReportPdf(model({ geo: UNLOCATED_GEO }));
    const text = await extractText(bytes);
    expect(text).toContain('coordinates withheld');
    expect(text).toContain('not written');
    expect(text).not.toContain('77.5946');
    expect(text).not.toContain('12.9716');
  });
});

describe('filenames', () => {
  it('keeps the report and the geometry export on the same slug', () => {
    expect(reportFilename('Where is flooding most severe?')).toBe('avni_report_where-is-flooding-most-severe.pdf');
    expect(geojsonFilename('Where is flooding most severe?')).toBe('avni_answer_where-is-flooding-most-severe.geojson');
    expect(reportFilename('')).toBe('avni_report_result.pdf');
    expect(slug('Where is flooding most severe?')).toBe('where-is-flooding-most-severe');
  });

  it('sanitizes to WinAnsi without losing the Latin-1 the app already uses', () => {
    expect(sanitize('σ0 ≈ 0.6 → water')).toBe('sigma0 ~ 0.6 -> water');
    expect(sanitize('café 22 °C · 3 km²')).toBe('café 22 °C · 3 km²');
    // CP1252 carries em dashes, curly quotes and the U+2212 minus the answer
    // bank writes negative dB with — none of them may become a question mark
    expect(sanitize('water — \u22123.2 dB \u2018flagged\u2019')).toBe('water — -3.2 dB \u2018flagged\u2019');
    expect(sanitize('日本')).toBe('??');
  });
});
