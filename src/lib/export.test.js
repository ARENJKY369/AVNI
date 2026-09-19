import { beforeAll, describe, expect, it } from 'vitest';
import { SCENE_GEO, UNLOCATED_GEO, aoiCentroid } from './geo.js';
import { exportAnswerGeoJSON, exportAnswerJSON, exportAnswerMarkdown } from './export.js';
import { matchQuery } from '../data/mock.js';
import { ABSTAIN_GATE } from './model.js';

// minimal DOM so the real download code path runs and we can read the blob
const blobs = [];
let lastFilename = null;
beforeAll(() => {
  globalThis.URL = { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} };
  globalThis.Blob = class {
    constructor(parts) {
      this.text = async () => parts.join('');
      blobs.push(this);
    }
  };
  globalThis.document = {
    createElement: () => ({
      click() {},
      remove() {},
      set download(v) {
        lastFilename = v;
      }
    }),
    body: { appendChild() {} }
  };
});

const lastBlob = () => blobs[blobs.length - 1];

const flood = () => matchQuery('Where is flooding most severe?');
const AOI = [
  { u: 0.33, v: 0.28 },
  { u: 0.68, v: 0.35 },
  { u: 0.73, v: 0.68 },
  { u: 0.39, v: 0.74 }
];

describe('evidence bundle (JSON)', () => {
  it('withholds coordinates when the scene has no CRS', () => {
    exportAnswerJSON(flood(), UNLOCATED_GEO);
    expect(lastFilename).toMatch(/^avni_result_.*\.json$/);
    return lastBlob().text().then((text) => {
      const bundle = JSON.parse(text);
      expect(bundle.georeference.status).toBe('unlocated');
      expect(bundle.geodetic.withheld).toBe(true);
      expect(bundle.geodetic.lat).toBeUndefined();
      expect(bundle.crs).toBeUndefined();
      // the exact string that used to leak out of this file
      expect(text).not.toMatch(/12\.9[0-9]|77\.5[0-9]/);
    });
  });

  it('writes coordinates when the scene is georeferenced', () => {
    exportAnswerJSON(flood(), SCENE_GEO);
    return lastBlob().text().then((text) => {
      const bundle = JSON.parse(text);
      expect(bundle.geodetic.withheld).toBeUndefined();
      expect(bundle.geodetic.area_ha).toBe(4.7);
      expect(bundle.geodetic.crs).toBe('EPSG:4326');
      expect(bundle.georeference.status).toBe('georeferenced');
    });
  });
});

describe('analyst report (Markdown)', () => {
  it('withholds coordinates when unlocated', () => {
    exportAnswerMarkdown(flood(), UNLOCATED_GEO);
    expect(lastFilename).toMatch(/^avni_result_.*\.md$/);
    return lastBlob().text().then((text) => {
      expect(text).toContain('coordinates withheld');
      expect(text).not.toMatch(/12\.9[0-9]|77\.5[0-9]/);
    });
  });

  it('states the same gate it applied when the answer is declined', () => {
    exportAnswerMarkdown(matchQuery('Is the reservoir reading reliable enough to act on?'), SCENE_GEO);
    return lastBlob().text().then((text) => {
      expect(text).toContain('DECLINED TO ANSWER');
      expect(text).toContain(`gate < ${ABSTAIN_GATE}`);
      expect(text).toContain('2 of 8');
    });
  });
});

describe('geometry export', () => {
  it('is refused without a georeference', () => {
    const written = exportAnswerGeoJSON(flood(), UNLOCATED_GEO, aoiCentroid(AOI));
    expect(written).toBe(false);
  });

  it('writes a centroid on the AOI when georeferenced', () => {
    const c = aoiCentroid(AOI);
    const written = exportAnswerGeoJSON(flood(), SCENE_GEO, c);
    expect(written).toBe(true);
    expect(lastFilename).toMatch(/^avni_answer_.*\.geojson$/);
    return lastBlob().text().then((text) => {
      const gj = JSON.parse(text);
      expect(gj.features).toHaveLength(2);
      expect(gj.features[0].geometry.coordinates[0]).toBeCloseTo(c.lon, 5);
    });
  });
});
