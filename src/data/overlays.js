// Vector overlays, in 0–100 image space.
//
// These are FIXTURE geometry: hand-traced shapes shipped with the demo build,
// not detections derived from the raster. The UI says so, and the exports
// carry the same note — a mask drawn here is mapped through the declared
// footprint and is never presented as a measurement.

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

// change-detection causal attribution (bi-temporal pair).
// pct values are shares of the raw delta; rawDeltaHa × pct/100 = the hectares
// quoted in the answer text and the attribution card.
export const CHANGE_DELTA = {
  epochA: '2024-11-02T05:21:16Z',
  epochB: '2025-08-14T05:17:42Z',
  days: 285,
  rawDeltaHa: 11.2,
  attribution: [
    { cause: 'seasonal vegetation cycle', pct: 54, tone: 't2' },
    { cause: 'cloud / shadow residual', pct: 27, tone: 'warn' },
    { cause: 'genuine change', pct: 19, tone: 'accent' }
  ]
};

export const genuineChangeHa = (d = CHANGE_DELTA) =>
  (d.rawDeltaHa * (d.attribution.find((a) => a.cause === 'genuine change')?.pct ?? 0)) / 100;
