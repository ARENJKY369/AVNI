import { describe, expect, it } from 'vitest';
import { analyzeStages, BANDS, INTENT_IDS, matchQuery, SCENES, SUGGESTIONS } from './mock.js';
import { ABSTAIN_GATE, confidence, stableOrientations } from '../lib/model.js';
import { SCENE_GEO, SCENE_RASTER, UNLOCATED_GEO } from '../lib/geo.js';

describe('abstain gate', () => {
  it('derives the decision from the score, so the card and the rule agree', () => {
    expect(confidence(0.42).abstained).toBe(true);
    expect(confidence(0.44).abstained).toBe(true);
    expect(confidence(ABSTAIN_GATE).abstained).toBe(false);
    expect(confidence(0.82).abstained).toBe(false);
  });

  it('reports orientation counts that match the score', () => {
    expect(stableOrientations(0.47)).toBe(4);
    expect(confidence(0.47).reason).toContain('4 of 8');
    expect(confidence(0.31).reason).toContain('2 of 8');
    expect(confidence(0.31).reason).toContain(String(ABSTAIN_GATE));
  });

  it('holds for every fixture in the bank', () => {
    for (const q of [
      'Where is flooding most severe?',
      'How much built-up area changed?',
      'Is the reservoir reading reliable enough to act on?',
      'How healthy is the riparian vegetation?',
      'What is this scene?'
    ]) {
      const a = matchQuery(q);
      expect(a.confidence.abstained).toBe(a.confidence.consistency_score < ABSTAIN_GATE);
      const traceLine = a.trace.find((t) => t.source === 'abstain.py' && t.value.includes('stable'));
      if (traceLine) {
        expect(traceLine.value).toContain(`${stableOrientations(a.confidence.consistency_score)}/${a.confidence.orientations} stable`);
      }
    }
  });
});

describe('intent routing', () => {
  const cases = [
    ['Where is flooding most severe, and can you trust the water reading near the buildings?', 'flood'],
    ['Where is flooding most severe?', 'flood'],
    ['How much built-up area changed between the two passes, and is it real?', 'change'],
    ['Which blocks grew?', 'change'],
    ['Show the attribution breakdown on the map', 'change'],
    ['Is the reservoir reading reliable enough to act on?', 'reservoir'],
    ['Is the reservoir water level reliable?', 'reservoir'],
    ['How healthy is the riparian vegetation along the corridor?', 'veg'],
    ['Show the declining patch', 'veg'],
    ['What is this scene?', 'fallback']
  ];

  it.each(cases)('routes %s -> %s', (question, expected) => {
    expect(matchQuery(question).intent).toBe(expected);
  });

  it('honours an explicit follow-up intent', () => {
    expect(matchQuery('Compare with the dry-season pass', 'veg').intent).toBe('veg');
    expect(matchQuery('Where is flooding most severe?', 'change').intent).toBe('change');
  });

  it('does not let "blocking" look like "blocks"', () => {
    expect(matchQuery('The classifier keeps blocking the scene read.').intent).not.toBe('change');
  });
});

describe('answers keep their own numbers straight', () => {
  it('flags flood area consistently in text and geometry fixture', () => {
    const flood = matchQuery('Where is flooding most severe?');
    expect(flood.answer_text).toContain(`${flood.geodetic.area_ha} ha`);
    expect(flood.confidence.consistency_score).toBeGreaterThanOrEqual(ABSTAIN_GATE);
  });

  it('keeps the change numbers arithmetically true', () => {
    const change = matchQuery('How much built-up area changed?');
    const genuine = (11.2 * 19) / 100; // raw delta x genuine share
    expect(genuine).toBeCloseTo(change.geodetic.area_ha, 1);
  });

  it('gives every follow-up an explicit, valid action', () => {
    for (const q of [...SUGGESTIONS, 'What is this scene?']) {
      for (const f of matchQuery(q).followups) {
        const item = typeof f === 'string' ? { action: 'query' } : f;
        expect(['query', 'export']).toContain(item.action);
        if (item.action === 'query') expect(INTENT_IDS).toContain(item.intent);
        if (item.action === 'export') expect(item.export).toBe('geojson');
      }
    }
  });
});

describe('analysis stages', () => {
  it('never claims a CRS for an unlocated upload', () => {
    const stages = analyzeStages({ geo: UNLOCATED_GEO, bands: BANDS });
    expect(stages[0]).not.toContain('EPSG:4326');
    expect(stages[0]).toContain('no CRS');
    expect(stages.join(' ')).not.toContain('EPSG');
  });

  it('names the registered CRS and the selected bands', () => {
    const off = BANDS.map((b) => (b.id === 'ndvi' ? { ...b, on: false } : b));
    const stages = analyzeStages({ geo: SCENE_GEO, bands: off });
    expect(stages[0]).toContain('EPSG:4326');
    expect(stages[1]).toContain('NDWI');
    expect(stages[1]).not.toContain('NDVI');
    expect(stages[3]).toContain(String(ABSTAIN_GATE));
  });
});

describe('registered scenes', () => {
  it('declares the real raster size of the bundled optical scene', () => {
    expect(SCENES.optical.raster).toEqual(SCENE_RASTER);
  });
});
