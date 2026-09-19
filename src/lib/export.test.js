import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SCENE_GEO, UNLOCATED_GEO, aoiCentroid } from './geo.js';
import {
  exportAnswerGeoJSON,
  exportAnswerJSON,
  exportAnswerMarkdown,
  exportSessionMarkdown
} from './export.js';
import { matchQuery } from '../data/mock.js';
import { ABSTAIN_GATE } from './model.js';

// Capture exactly what the browser is handed. jsdom runs the real Blob and
// anchor code, so the object URL is where the bytes are observable — which is
// also the last point at which a leak could escape.
const blobs = [];
let lastFilename = null;
const RealBlob = globalThis.Blob;

beforeAll(() => {
  globalThis.Blob = class extends RealBlob {
    constructor(parts, opts) {
      super(parts, opts);
      blobs.push(this);
    }
  };
  URL.createObjectURL = (blob) => {
    blobs.push(blob);
    return 'blob:test';
  };
  URL.revokeObjectURL = () => {};
  // the anchor never really navigates in jsdom; capture what it was told to save
  HTMLAnchorElement.prototype.click = function click() {
    lastFilename = this.download;
  };
});

beforeEach(() => {
  blobs.length = 0;
  lastFilename = null;
});

// jsdom's Blob has no .text(); FileReader is the standards-compatible read.
const lastText = () =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blobs[blobs.length - 1]);
  });
const flood = () => matchQuery('Where is flooding most severe?');
const reservoir = () => matchQuery('Is the reservoir reading reliable enough to act on?');
const AOI = [
  { u: 0.33, v: 0.28 },
  { u: 0.68, v: 0.35 },
  { u: 0.73, v: 0.68 },
  { u: 0.39, v: 0.74 }
];
const CENTROID = aoiCentroid(AOI);

describe('evidence bundle (JSON)', () => {
  it('withholds coordinates when the scene has no CRS', async () => {
    exportAnswerJSON(flood(), UNLOCATED_GEO, CENTROID, AOI);
    expect(lastFilename).toMatch(/^avni_result_.*\.json$/);
    const text = await lastText();
    const bundle = JSON.parse(text);
    expect(bundle.georeference.status).toBe('unlocated');
    expect(bundle.geodetic.withheld).toBe(true);
    expect(bundle.geodetic.lat).toBeUndefined();
    expect(bundle.crs).toBeUndefined();
    expect(bundle.scene.ground_sample_distance).toBeNull();
    // the exact strings that used to leak out of this file
    expect(text).not.toMatch(/12\.9[0-9]|77\.5[0-9]/);
  });

  it('writes coordinates, UTM and the derived AOI area when georeferenced', async () => {
    exportAnswerJSON(flood(), SCENE_GEO, CENTROID, AOI);
    const bundle = JSON.parse(await lastText());
    expect(bundle.geodetic.withheld).toBeUndefined();
    expect(bundle.geodetic.area_ha).toBe(4.7);
    expect(bundle.geodetic.crs).toBe('EPSG:4326');
    expect(bundle.geodetic.centroid.lat).toBeCloseTo(CENTROID.lat, 9);
    expect(bundle.geodetic.centroid.source).toBe('drawn AOI centroid');
    expect(bundle.geodetic.aoi_area_km2).toBeCloseTo(36.84, 1);
    expect(bundle.geodetic.utm.zone).toBe('43N');
    expect(bundle.georeference.status).toBe('georeferenced');
    expect(bundle.scene.ground_sample_distance).toBe('16 m/px');
  });

  it('never carries a gate that disagrees with the verdict', async () => {
    exportAnswerJSON(flood(), SCENE_GEO, CENTROID, AOI);
    const bundle = JSON.parse(await lastText());
    expect(bundle.consistency.gate).toBe(ABSTAIN_GATE);
    expect(bundle.consistency.abstained).toBe(
      bundle.consistency.consistency_score < ABSTAIN_GATE
    );
    expect(bundle.consistency.orientations).toBe(bundle.consistency.stable_of * 0 + 8);
  });

  it('ships the provenance of every class of number', async () => {
    exportAnswerJSON(flood(), SCENE_GEO, CENTROID, AOI);
    const bundle = JSON.parse(await lastText());
    expect(bundle.provenance.derived.scale_bar).toMatch(/one measurement/);
    expect(bundle.provenance.fixture.answer_text).toMatch(/answer bank/);
  });
});

describe('analyst report (Markdown)', () => {
  it('withholds coordinates when unlocated', async () => {
    exportAnswerMarkdown(flood(), UNLOCATED_GEO, CENTROID, AOI);
    expect(lastFilename).toMatch(/^avni_result_.*\.md$/);
    const text = await lastText();
    expect(text).toContain('coordinates withheld');
    expect(text).not.toMatch(/12\.9[0-9]|77\.5[0-9]/);
  });

  it('states the same gate it applied when the answer is declined', async () => {
    exportAnswerMarkdown(reservoir(), SCENE_GEO, CENTROID, AOI);
    const text = await lastText();
    expect(text).toContain('DECLINED TO ANSWER');
    expect(text).toContain(`gate < ${ABSTAIN_GATE}`);
    expect(text).toContain('2 of 8');
  });

  it('reports derived and fixture numbers side by side', async () => {
    exportAnswerMarkdown(flood(), SCENE_GEO, CENTROID, AOI);
    const text = await lastText();
    expect(text).toContain('drawn AOI area');
    expect(text).toContain('derived');
    expect(text).toContain('footprint area');
    expect(text).toContain('fixture');
    expect(text).toMatch(/UTM: `43N`/);
    expect(text).toContain('Where these numbers come from');
  });
});

describe('session report', () => {
  it('summarises only finished queries', async () => {
    exportSessionMarkdown(
      [
        { status: 'done', payload: flood() },
        { status: 'analyzing', payload: {} }
      ],
      SCENE_GEO,
      AOI
    );
    const text = await lastText();
    expect(text).toContain('# AVNI · session report');
    expect(text).toContain('queries answered: 1');
    expect(text).toContain('Where these numbers come from');
  });
});

describe('geometry export', () => {
  it('is refused without a georeference', () => {
    const written = exportAnswerGeoJSON(flood(), UNLOCATED_GEO, CENTROID, AOI);
    expect(written).toBe(false);
    expect(blobs).toHaveLength(0);
  });

  it('writes a centroid on the AOI when georeferenced', async () => {
    const written = exportAnswerGeoJSON(flood(), SCENE_GEO, CENTROID, AOI);
    expect(written).toBe(true);
    expect(lastFilename).toMatch(/^avni_answer_.*\.geojson$/);
    const gj = JSON.parse(await lastText());
    expect(gj.features).toHaveLength(2);
    expect(gj.features[0].geometry.coordinates[0]).toBeCloseTo(CENTROID.lon, 9);
    expect(gj.utm.zone).toBe('43N');
  });
});
