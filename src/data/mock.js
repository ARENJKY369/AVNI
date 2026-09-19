import sceneOptical from '../assets/scene-optical.jpg';
import sceneSar from '../assets/scene-sar.jpg';
import sceneOpticalB from '../assets/scene-optical-b.jpg';
import { ABSTAIN_GATE, confidence, consistencyValue } from '../lib/model.js';
import { isGeoreferenced, SCENE_RASTER } from '../lib/geo.js';

// ------------------------------------------------------------------ */
// registered scenes
// ------------------------------------------------------------------ */
// `raster` is the real pixel size of the bundled file: ground sample distance
// is computed from it and the declared footprint, never typed in.

export const SCENES = {
  optical: {
    id: 'optical',
    file: 'S2_L2A_2025-08-14_tile43REP.jp2',
    label: 'S2 L2A · tile 43REP',
    sensor: 'Sentinel-2 L2A',
    acquired: '2025-08-14T05:17:42Z',
    raster: SCENE_RASTER,
    src: sceneOptical,
    origin: 'bundled fixture'
  },
  sar: {
    id: 'sar',
    file: 'RISAT-1A_GRD_250813.tif',
    label: 'RISAT-1A · GRD · asc',
    sensor: 'RISAT-1A (C-band)',
    acquired: '2025-08-13T00:41:09Z',
    raster: { width: 1408, height: 768 },
    src: sceneSar,
    origin: 'bundled fixture'
  },
  opticalB: {
    id: 'opticalB',
    file: 'S2_L2A_2024-11-02_tile43REP.jp2',
    label: 'S2 L2A · tile 43REP · dry',
    sensor: 'Sentinel-2 L2A',
    acquired: '2024-11-02T05:21:16Z',
    raster: { width: 1408, height: 768 },
    src: sceneOpticalB,
    origin: 'bundled fixture'
  }
};

export const BANDS = [
  { id: 'ndvi', name: 'NDVI', code: 'B4,B8', on: true },
  { id: 'ndwi', name: 'NDWI', code: 'B3,B8', on: true },
  { id: 'vv', name: 'SAR VV', code: 'dB', on: true },
  { id: 'vh', name: 'SAR VH', code: 'dB', on: false }
];

export const LAYERS = {
  water: { id: 'water', name: 'Water mask', color: 'accent', on: true },
  disagreement: { id: 'disagreement', name: 'Disagreement', color: 'warn', on: true },
  builtin: { id: 'builtin', name: 'Built-up', color: 'accent', on: true },
  layover: { id: 'layover', name: 'Layover mask', color: 'accent', on: false }
};

// ------------------------------------------------------------------ */
// the answer bank
// ------------------------------------------------------------------ */

export const SUGGESTIONS = [
  'Where is flooding most severe, and can you trust the water reading near the buildings?',
  'How much built-up area changed between the two passes, and is it real?',
  'Is the reservoir reading reliable enough to act on?',
  'How healthy is the riparian vegetation along the corridor?'
];

// The analysis card is built from what is actually known about the scene at
// send time — an upload with no CRS never animates "scene registered ·
// EPSG:4326", and the band list is the one selected in the rail.
export function analyzeStages({ geo, bands = [], secondEpoch = false } = {}) {
  const on = bands.filter((b) => b.on).map((b) => b.name);
  return [
    isGeoreferenced(geo)
      ? `scene registered · ${geo.crs}`
      : 'scene registered · no CRS reported — coordinates withheld',
    `${on.length ? on.join(' + ') : 'full band stack'} pass`,
    secondEpoch ? 'bi-temporal co-registration · epoch pair' : 'consistency sweep · 8 orientations',
    `abstain gate < ${ABSTAIN_GATE} · composing answer`
  ];
}

const FLOOD = {
  id: 'flood',
  build: (q) => {
    const score = 0.47;
    return {
      question: q,
      answer_text:
        'Flooding is most severe on the river terraces just south of the corridor spine — 4.7 ha of standing water at NDWI 0.61, with the deepest signature against the retaining walls of the older built-up rows. Near the buildings the reading is honest but incomplete: SAR backscatter of −3.2 dB is brighter than open water should be, which is the classic double-bounce inversion of floodwater against vertical structure. Act on the open-terrace water confidently; treat any pixel within ~50 m of a structure as unverified until the geometry check clears.',
      confidence: confidence(score, 'Terrace water holds, but the built-up edge splits the classifier.'),
      physics_check: {
        ndwi: 0.61,
        sar_backscatter_db: -3.2,
        verdict:
          'possible urban flood double-bounce inversion — SAR brightness near building edges suggests floodwater interacting with structures, not dry land',
        flagged: true
      },
      geodetic: { area_ha: 4.7 },
      trace: [
        { step: 'NDWI computed', source: 'geodesy.py', value: '0.61' },
        { step: 'SAR backscatter computed', source: 'physics_check.py', value: '-3.2 dB' },
        { step: 'Consistency check run', source: 'abstain.py', value: consistencyValue(score) },
        { step: 'Answer generated', source: 'vision-language model' }
      ],
      followups: [
        { label: 'Which conflict clusters are radar geometry, not water?', action: 'query', intent: 'flood' },
        { label: 'Export the flooded footprint as GeoJSON', action: 'export', export: 'geojson' }
      ]
    };
  }
};

const CHANGE = {
  id: 'change',
  build: (q) => {
    const score = 0.81;
    return {
      question: q,
      answer_text:
        'Between the dry-season pass and the monsoon pass the built-up mask grows by 11.2 ha, but only 19% of the changed pixels survive the attribution filter — the rest is senesced vegetation and two cloud shadows the optical classifier mistook for demolition. The genuine growth is real and legible: two compact blocks extending the grid east of the corridor, VH texture consistent with rooftop scattering. I would report +2.1 ha of built-up, not the raw +11.2.',
      confidence: confidence(score, 'The growth signature survives the attribution filter.'),
      physics_check: {
        ndwi: 0.12,
        sar_backscatter_db: -9.8,
        verdict:
          'VH texture on the new blocks matches rooftop double-bounce (−9.8 dB), not bare soil (−14 dB) — the growth signature is structural, not moisture',
        flagged: false
      },
      geodetic: { area_ha: 2.1 },
      trace: [
        { step: 'Bi-temporal co-registration', source: 'coreg.py', value: 'RMSE 0.4 px' },
        { step: 'Built-up delta', source: 'change_detect.py', value: '+11.2 ha raw' },
        { step: 'Causal attribution', source: 'attribution.py', value: '19% genuine' },
        { step: 'Consistency check run', source: 'abstain.py', value: consistencyValue(score) },
        { step: 'Answer generated', source: 'vision-language model' }
      ],
      followups: [
        { label: 'Show the attribution breakdown on the map', action: 'query', intent: 'change' },
        { label: 'Which blocks grew?', action: 'query', intent: 'change' }
      ]
    };
  }
};

const RESERVOIR = {
  id: 'reservoir',
  build: (q) => {
    const score = 0.31;
    return {
      question: q,
      answer_text: '',
      confidence: confidence(
        score,
        'Neither sensor observes bathymetry, so a volume cannot be inferred from this scene.'
      ),
      physics_check: {
        ndwi: 0.58,
        sar_backscatter_db: -18.4,
        verdict:
          'Surface extent agrees across sensors (−18.4 dB is textbook still water), but volume needs a depth–area curve this scene cannot supply',
        flagged: true
      },
      geodetic: { area_ha: 68.3 },
      trace: [
        { step: 'Water extent computed', source: 'geodesy.py', value: '68.3 ha' },
        { step: 'Consistency check run', source: 'abstain.py', value: consistencyValue(score) },
        { step: 'Abstain gate tripped', source: 'abstain.py', value: `score < ${ABSTAIN_GATE}` }
      ],
      followups: [
        { label: 'What would make this answerable?', action: 'query', intent: 'reservoir' },
        { label: 'Give me the extent only, with its score', action: 'query', intent: 'reservoir' }
      ]
    };
  }
};

const VEG = {
  id: 'veg',
  build: (q) => {
    const score = 0.87;
    return {
      question: q,
      answer_text:
        'Riparian vegetation along the corridor is holding at NDVI 0.58 — healthy for mid-monsoon, with the only soft patch on the western bank where the terrace row meets the water. The SAR cross-check agrees (VV volume scattering consistent with closed canopy), so this is one of the readings I would sign without hesitation. Watch the soft patch: it has declined two passes in a row.',
      confidence: confidence(score, 'VV structure and NDVI agree along the corridor.'),
      physics_check: {
        ndwi: 0.21,
        sar_backscatter_db: -7.6,
        verdict:
          'VV volume scattering at −7.6 dB is consistent with closed canopy, not senesced grass — optical NDVI and radar structure agree',
        flagged: false
      },
      geodetic: { area_ha: 14.9 },
      trace: [
        { step: 'NDVI computed', source: 'geodesy.py', value: '0.58' },
        { step: 'VV volume scattering', source: 'physics_check.py', value: '-7.6 dB' },
        { step: 'Consistency check run', source: 'abstain.py', value: consistencyValue(score) },
        { step: 'Answer generated', source: 'vision-language model' }
      ],
      followups: [
        { label: 'Show the declining patch', action: 'query', intent: 'veg' },
        { label: 'Compare with the dry-season pass', action: 'query', intent: 'veg' }
      ]
    };
  }
};

const FALLBACK = {
  id: 'fallback',
  build: (q) => {
    const score = 0.66;
    return {
      question: q,
      answer_text:
        'Reading the scene as a mixed urban–agricultural corridor under monsoon cloud pressure: water signatures are strong and cross-verified, built-up fabric is dense along the spine, and the agricultural parcels to the east are mid-crop. Ask me about flooding, built-up change, vegetation condition, or reservoir extent and I will attach the full physics cross-check and trace to the answer.',
      confidence: confidence(score, 'Scene-wide read; no single target was specified.'),
      physics_check: {
        ndwi: 0.44,
        sar_backscatter_db: -11.2,
        verdict:
          'No sensor conflict above flag threshold on the scene-wide read; local conflicts remain listed in the Disagreement layer',
        flagged: false
      },
      geodetic: { area_ha: 212.4 },
      trace: [
        { step: 'Scene classification', source: 'scene_read.py', value: 'urban–agri mix' },
        { step: 'Consistency check run', source: 'abstain.py', value: consistencyValue(score) },
        { step: 'Answer generated', source: 'vision-language model' }
      ],
      followups: [{ label: 'Where is flooding most severe?', action: 'query', intent: 'flood' }]
    };
  }
};

// Intent routing: weighted patterns, best score wins, ties fall to the earlier
// entry, nothing matches -> FALLBACK. Patterns are matched as written, so
// /blocks?\b/ catches "block" and "blocks" but never "blocking" — the old
// /block/ rule routed "the classifier keeps blocking the read" to the
// change-detection answer.
const INTENTS = [
  {
    id: 'reservoir',
    build: RESERVOIR.build,
    terms: [
      [/\breservoir\b/, 4],
      [/bathymetr/, 4],
      [/\bvolume\b/, 3],
      [/\bstorage\b/, 3],
      [/\bcapacity\b/, 3],
      [/\blevel\b/, 2]
    ]
  },
  {
    id: 'flood',
    build: FLOOD.build,
    terms: [
      [/flood/, 4],
      [/inundat/, 3],
      [/submerg/, 3],
      [/standing water/, 3],
      [/\bwater\b/, 1],
      [/\btrust\b/, 1],
      [/\briver\b/, 1],
      [/\bsevere\b/, 1]
    ]
  },
  {
    id: 'change',
    build: CHANGE.build,
    terms: [
      [/built/, 3],
      [/attribut/, 3],
      [/blocks?\b/, 2],
      [/grew|grow/, 2],
      [/\bchange/, 2],
      [/expand/, 2],
      [/structur/, 2],
      [/\bdelta\b/, 2],
      [/two passes/, 2]
    ]
  },
  {
    id: 'veg',
    build: VEG.build,
    terms: [
      [/veget/, 3],
      [/\bndvi\b/, 3],
      [/\briparian\b/, 3],
      [/\bgreen/, 2],
      [/canop/, 2],
      [/\bcrop/, 2],
      [/\bhealth/, 2],
      [/declin/, 2],
      [/\bcorridor\b/, 1],
      [/\bpatch\b/, 1]
    ]
  }
];

export const INTENT_IDS = INTENTS.map((i) => i.id);

export function matchQuery(text, forcedIntent) {
  const hay = String(text || '').toLowerCase();
  if (forcedIntent) {
    const forced = INTENTS.find((i) => i.id === forcedIntent);
    if (forced) return { ...forced.build(text), intent: forced.id };
  }
  let best = null;
  for (const intent of INTENTS) {
    let score = 0;
    for (const [pattern, weight] of intent.terms) if (pattern.test(hay)) score += weight;
    if (score > 0 && (!best || score > best.score)) best = { score, intent };
  }
  const chosen = best ? best.intent : FALLBACK;
  return { ...chosen.build(text), intent: chosen.id };
}
