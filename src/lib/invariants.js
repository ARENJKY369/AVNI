// Dev-only sanity checks for the promises the console makes. They run after
// state changes in development, so a regression fails loudly on the bench
// instead of quietly on a projector.
import { isGeoreferenced } from './geo.js';

const looksLikeCoordinate = (value) =>
  typeof value === 'string' && /(1[23]\.\d{3,}|7[78]\.\d{3,})/.test(value);

export function checkStoreInvariants({ sceneGeo, queries = [], aoi = [] }) {
  if (import.meta.env?.MODE === 'production') return [];
  const problems = [];

  if (!isGeoreferenced(sceneGeo)) {
    for (const q of queries) {
      const payload = q.payload;
      if (!payload) continue;
      // the withheld paths must never carry numbers
      const text = JSON.stringify({
        geodetic: payload.geodetic,
        answer: payload.answer_text
      });
      if (looksLikeCoordinate(text) && !/withheld|unverified|no CRS/i.test(text)) {
        problems.push(`query ${q.id}: geodetic payload carries coordinates for an unlocated scene`);
      }
    }
  }

  if (aoi.length && aoi.some((p) => !Number.isFinite(p.u) || !Number.isFinite(p.v))) {
    problems.push('AOI contains non-finite vertices');
  }
  if (aoi.length && aoi.some((p) => p.u < 0 || p.u > 1 || p.v < 0 || p.v > 1)) {
    problems.push('AOI vertices escaped the scene sheet');
  }

  if (problems.length && typeof console !== 'undefined') {
    console.error('AVNI invariant violation', problems);
  }
  return problems;
}
