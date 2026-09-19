import sceneOptical from '../assets/scene-optical.jpg';
import sceneSar from '../assets/scene-sar.jpg';
import sceneOpticalB from '../assets/scene-optical-b.jpg';

// ------------------------------------------------------------------ */
// registered scenes
// ------------------------------------------------------------------ */

export const SCENES = {
  optical: {
    id: 'optical',
    file: 'images.jpg',
    label: 'S2 L2A · tile 43REP',
    sensor: 'Sentinel-2 L2A',
    acquired: '2025-08-14T05:17:42Z',
    res: '10 m/px',
    src: sceneOptical,
    origin: 'uploaded'
  },
  sar: {
    id: 'sar',
    file: 'RISAT-1A_GRD_250813.tif',
    label: 'RISAT-1A · GRD · asc',
    sensor: 'RISAT-1A (C-band)',
    acquired: '2025-08-13T00:41:09Z',
    res: '10 m/px',
    src: sceneSar,
    origin: 'analysis service'
  },
  opticalB: {
    id: 'opticalB',
    file: 'S2_L2A_2024-11-02.jp2',
    label: 'S2 L2A · tile 43REP · dry',
    sensor: 'Sentinel-2 L2A',
    acquired: '2024-11-02T05:21:16Z',
    res: '10 m/px',
    src: sceneOpticalB,
    origin: 'attached'
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
// vector overlays, in 0–100 image space
// ------------------------------------------------------------------ */

// river drawn as a stroked path; the two sensors see slightly different
// shorelines, which is exactly the point of the disagreement layer.
export const WATER_PATHS = {
  optical: 'M 103 1 C 92 12 84 20 75 31 C 66 42 58 50 48 59 C 38 68 27 76 16 85 C 9 91 2 96 -3 99',
  sar: 'M -3 7 C 9 15 18 22 28 30 C 40 40 49 47 58 56 C 67 65 74 73 82 82 C 89 90 96 96 103 102'
};

export const BUILTIN_POLYS = [
  '62,8 78,10 80,24 66,26 60,18',
  '14,40 30,42 32,58 16,60 10,50',
  '70,62 88,64 90,80 74,82 68,72'
];

export const LAYOVER_POLYS = ['55,47 63,50 60,58 52,55'];

// disagreement clusters: where optical and SAR classifications fight
export const CONFLICT_TYPES = {
  cloud: { id: 'cloud', name: 'cloud occlusion', color: '#7A8CA3' },
  geometry: { id: 'geometry', name: 'radar geometry', color: '#B48EF0' },
  anomaly: { id: 'anomaly', name: 'genuine anomaly', color: '#F5A623' },
  temporal: { id: 'temporal', name: 'temporal offset', color: '#8A6A2B' }
};

export const DISAGREEMENT_CLUSTERS = [
  { type: 'anomaly', pts: '47,58 55,60 54,68 46,66', note: 'water in optical, bright σ0 in SAR' },
  { type: 'geometry', pts: '61,44 68,46 66,53 59,51', note: 'layover on high-rise block' },
  { type: 'cloud', pts: '18,24 30,26 28,36 16,34', note: 'cirrus fringe — optical blind' },
  { type: 'temporal', pts: '76,70 86,72 84,82 74,80', note: '27 h between passes, tank drained' }
];

// annotations shown with the annotate tool
export const PINS = [
  { u: 0.51, v: 0.62, label: 'flood extent edge — field verified 14 Aug' },
  { u: 0.63, v: 0.48, label: 'double-bounce zone, treat σ0 with care' }
];

export const COMMENTS = [
  {
    who: 'r.iyer · SAC hydrol',
    when: '2025-08-14 11:02 IST',
    text: 'Ground team confirms standing water at the terrace row. Keep the double-bounce flag on until we re-fly.'
  }
];

// change-detection causal attribution (bi-temporal pair)
export const ATTRIBUTION = [
  { cause: 'seasonal vegetation cycle', pct: 54, tone: 't2' },
  { cause: 'cloud / shadow residual', pct: 27, tone: 'warn' },
  { cause: 'genuine change', pct: 19, tone: 'accent' }
];

// ------------------------------------------------------------------ */
// the answer bank
// ------------------------------------------------------------------ */

export const ANALYZE_STAGES = [
  'scene registered · EPSG:4326',
  'NDWI + σ0 backscatter pass',
  'consistency sweep · 8 orientations',
  'abstain gate · composing answer'
];

export const SUGGESTIONS = [
  'Where is flooding most severe, and can you trust the water reading near the buildings?',
  'How much built-up area changed between the two passes, and is it real?',
  'Is the reservoir reading reliable enough to act on?',
  'How healthy is the riparian vegetation along the corridor?'
];

const FLOOD = {
  id: 'flood',
  match: /flood|water|inundat|trust|submerg|river/i,
  build: (q) => ({
    question: q,
    answer_text:
      'Flooding is most severe on the river terraces just south of the corridor spine — 4.7 ha of standing water at NDWI 0.61, with the deepest signature against the retaining walls of the older built-up rows. Near the buildings the reading is honest but incomplete: SAR backscatter of −3.2 dB is brighter than open water should be, which is the classic double-bounce inversion of floodwater against vertical structure. Act on the open-terrace water confidently; treat any pixel within ~50 m of a structure as unverified until the geometry check clears.',
    confidence: {
      consistency_score: 0.42,
      abstained: false,
      reason: 'Answer stable across 6 of 8 image orientations'
    },
    physics_check: {
      ndwi: 0.61,
      sar_backscatter_db: -3.2,
      verdict:
        'possible urban flood double-bounce inversion — SAR brightness near building edges suggests floodwater interacting with structures, not dry land',
      flagged: true
    },
    geodetic: { lat: 12.9716, lon: 77.5946, area_ha: 4.7, crs: 'EPSG:4326' },
    trace: [
      { step: 'NDWI computed', source: 'geodesy.py', value: '0.61' },
      { step: 'SAR backscatter computed', source: 'physics_check.py', value: '-3.2 dB' },
      { step: 'Consistency check run', source: 'abstain.py', value: '0.42 (6/8 stable)' },
      { step: 'Answer generated', source: 'vision-language model' }
    ],
    followups: [
      'Which conflict clusters are radar geometry, not water?',
      'Export the flooded footprint as GeoJSON'
    ]
  })
};

const CHANGE = {
  id: 'change',
  match: /built|grow|change|expand|new.*struct|delta|block|attribut/i,
  build: (q) => ({
    question: q,
    answer_text:
      'Between the dry-season pass and the monsoon pass the built-up mask grows by 11.2 ha, but only 19% of the changed pixels survive the attribution filter — the rest is senesced vegetation and two cloud shadows the optical classifier mistook for demolition. The genuine growth is real and legible: two compact blocks extending the grid east of the corridor, VH texture consistent with rooftop scattering. I would report +2.1 ha of built-up, not the raw +11.2.',
    confidence: {
      consistency_score: 0.81,
      abstained: false,
      reason: 'Answer stable across 7 of 8 image orientations'
    },
    physics_check: {
      ndwi: 0.12,
      sar_backscatter_db: -9.8,
      verdict:
        'VH texture on the new blocks matches rooftop double-bounce (−9.8 dB), not bare soil (−14 dB) — the growth signature is structural, not moisture',
      flagged: false
    },
    geodetic: { lat: 12.9802, lon: 77.6113, area_ha: 2.1, crs: 'EPSG:4326' },
    trace: [
      { step: 'Bi-temporal co-registration', source: 'coreg.py', value: 'RMSE 0.4 px' },
      { step: 'Built-up delta', source: 'change_detect.py', value: '+11.2 ha raw' },
      { step: 'Causal attribution', source: 'attribution.py', value: '19% genuine' },
      { step: 'Consistency check run', source: 'abstain.py', value: '0.81 (7/8 stable)' },
      { step: 'Answer generated', source: 'vision-language model' }
    ],
    followups: ['Show the attribution breakdown on the map', 'Which blocks grew?']
  })
};

const RESERVOIR = {
  id: 'reservoir',
  match: /reservoir|volume|storage|bathy|capacity|act on/i,
  build: (q) => ({
    question: q,
    answer_text: '',
    confidence: {
      consistency_score: 0.31,
      abstained: true,
      reason:
        'Water extent stable in only 3 of 8 orientations; neither sensor observes bathymetry. AVNI declines rather than guess a volume.'
    },
    physics_check: {
      ndwi: 0.58,
      sar_backscatter_db: -18.4,
      verdict:
        'Surface extent agrees across sensors (−18.4 dB is textbook still water), but volume needs a depth–area curve this scene cannot supply',
      flagged: true
    },
    geodetic: { lat: 12.9431, lon: 77.5612, area_ha: 68.3, crs: 'EPSG:4326' },
    trace: [
      { step: 'Water extent computed', source: 'geodesy.py', value: '68.3 ha' },
      { step: 'Consistency check run', source: 'abstain.py', value: '0.31 (3/8 stable)' },
      { step: 'Abstain gate tripped', source: 'abstain.py', value: 'score < 0.45' }
    ],
    followups: ['What would make this answerable?', 'Give me the extent only, with its score']
  })
};

const VEG = {
  id: 'veg',
  match: /veget|ndvi|green|canopy|riparian|crop|health/i,
  build: (q) => ({
    question: q,
    answer_text:
      'Riparian vegetation along the corridor is holding at NDVI 0.58 — healthy for mid-monsoon, with the only soft patch on the western bank where the terrace row meets the water. The SAR cross-check agrees (VV volume scattering consistent with closed canopy), so this is one of the readings I would sign without hesitation. Watch the soft patch: it has declined two passes in a row.',
    confidence: {
      consistency_score: 0.87,
      abstained: false,
      reason: 'Answer stable across 8 of 8 image orientations'
    },
    physics_check: {
      ndwi: 0.21,
      sar_backscatter_db: -7.6,
      verdict:
        'VV volume scattering at −7.6 dB is consistent with closed canopy, not senesced grass — optical NDVI and radar structure agree',
      flagged: false
    },
    geodetic: { lat: 12.9587, lon: 77.5788, area_ha: 14.9, crs: 'EPSG:4326' },
    trace: [
      { step: 'NDVI computed', source: 'geodesy.py', value: '0.58' },
      { step: 'VV volume scattering', source: 'physics_check.py', value: '-7.6 dB' },
      { step: 'Consistency check run', source: 'abstain.py', value: '0.87 (8/8 stable)' },
      { step: 'Answer generated', source: 'vision-language model' }
    ],
    followups: ['Show the declining patch', 'Compare with the dry-season pass']
  })
};

const FALLBACK = {
  id: 'fallback',
  match: /.*/,
  build: (q) => ({
    question: q,
    answer_text:
      'Reading the scene as a mixed urban–agricultural corridor under monsoon cloud pressure: water signatures are strong and cross-verified, built-up fabric is dense along the spine, and the agricultural parcels to the east are mid-crop. Ask me about flooding, built-up change, vegetation condition, or reservoir extent and I will attach the full physics cross-check and trace to the answer.',
    confidence: {
      consistency_score: 0.66,
      abstained: false,
      reason: 'Answer stable across 6 of 8 image orientations'
    },
    physics_check: {
      ndwi: 0.44,
      sar_backscatter_db: -11.2,
      verdict:
        'No sensor conflict above flag threshold on the scene-wide read; local conflicts remain listed in the Disagreement layer',
      flagged: false
    },
    geodetic: { lat: 12.9664, lon: 77.5881, area_ha: 212.4, crs: 'EPSG:4326' },
    trace: [
      { step: 'Scene classification', source: 'scene_read.py', value: 'urban–agri mix' },
      { step: 'Consistency check run', source: 'abstain.py', value: '0.66 (6/8 stable)' },
      { step: 'Answer generated', source: 'vision-language model' }
    ],
    followups: ['Where is flooding most severe?']
  })
};

// order matters: more specific intents first
export const QUERY_BANK = [FLOOD, RESERVOIR, VEG, CHANGE, FALLBACK];

export function matchQuery(text) {
  const hit = QUERY_BANK.find((e) => e.match.test(text));
  return hit.build(text);
}
