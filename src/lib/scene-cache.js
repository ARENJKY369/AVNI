// The bundled demo scenes are JPEG URLs. The renderer needs drawables and the
// segmenter needs pixels, so each scene is rasterised once into a canvas and
// kept here for the session.
//
// Everything degrades: if the browser cannot rasterise (no DOM, a test
// environment), the entry stays null and the caller falls back — the console
// still renders, it just cannot segment.

import { loadSceneSource } from './raster.js';
import { SCENES } from '../data/mock.js';

const cache = new Map();

export const DEFAULT_SCENE_KEYS = ['optical', 'sar', 'opticalB'];

export function cachedSource(key) {
  const value = cache.get(key);
  return value && !(value instanceof Promise) ? value : null;
}

/** Rasterise a bundled scene (idempotent, concurrent-safe). */
export async function ensureScene(key) {
  if (cache.has(key)) return cache.get(key);
  const scene = SCENES[key];
  if (!scene?.src) return null;
  const pending = loadSceneSource(scene.src, { name: scene.file, label: scene.label }).catch(() => null);
  cache.set(key, pending);
  const resolved = await pending;
  if (resolved) cache.set(key, resolved);
  else cache.delete(key);
  return resolved;
}

export async function ensureScenes(keys = DEFAULT_SCENE_KEYS) {
  const entries = await Promise.all(keys.map(async (k) => [k, await ensureScene(k)]));
  return Object.fromEntries(entries.filter(([, v]) => v));
}

/**
 * Synchronous access to whatever has finished loading — used by the segmenter,
 * which must answer inside a click.
 */
export const SCENE_PIXELS = {
  get optical() {
    return cachedSource('optical')?.pixels || null;
  },
  get sar() {
    return cachedSource('sar')?.pixels || null;
  },
  get opticalB() {
    return cachedSource('opticalB')?.pixels || null;
  }
};
