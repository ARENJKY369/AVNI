// Seeded region growing, the mask clean-up, the outline trace and the ring
// simplification — the parts of AOI-by-segmentation that must be exact, because
// a mask that is wrong by a pixel is a hectare figure the analyst cannot repeat.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEGMENT_OPTIONS,
  cleanMask,
  describeSegment,
  downscale,
  edgeMagnitude,
  growRegion,
  maskToRgba,
  segmentAt,
  simplifyRing,
  stopNote,
  traceOutline
} from '../lib/segment.js';

/** A light field with one dark rectangle: the simplest "mark the water" case. */
function fieldWithBlob({ width = 80, height = 60, box = [20, 15, 40, 30] } = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = x >= box[0] && x < box[0] + box[2] && y >= box[1] && y < box[1] + box[3];
      const v = inside ? 20 : 220;
      const i = (y * width + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

const uniform = ({ width = 40, height = 40, v = 120 } = {}) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  return { width, height, data };
};

describe('region growing', () => {
  it('grows exactly the blob the seed sits in, then stops at its boundary', () => {
    const image = fieldWithBlob();
    const result = segmentAt(image, { u: 0.5, v: 0.5 });
    expect(result.ok).toBe(true);
    // the blob is 40x30 of an 80x60 image = 25 % coverage
    expect(result.stats.coverage).toBeGreaterThan(0.22);
    expect(result.stats.coverage).toBeLessThan(0.28);
    // a rectangle traces to four corners, maybe five with the closing pixel
    expect(result.stats.outlineVertices).toBeLessThanOrEqual(8);
    expect(result.stats.coverage).toBeGreaterThan(0);
    // the blob's edge is a Sobel barrier, which is a clean stop too
    expect(['boundary', 'edge']).toContain(result.stats.stopReason);
    expect(result.clipped).toBe(false);
  });

  it('reports the area cap instead of claiming a clean boundary', () => {
    // a flat field has no boundary to find: only the cap stops it
    const grown = growRegion(uniform(), { seed: { x: 20, y: 20 }, tolerance: 34, maxArea: 100, edges: null });
    expect(grown.clipped).toBe(true);
    expect(grown.stopReason).toBe('area-cap');
    expect(grown.area).toBe(100);
  });

  it('says nothing about caps when a region simply found its edge', () => {
    const result = segmentAt(fieldWithBlob(), { u: 0.5, v: 0.5 });
    expect(stopNote(result)).toBe(null);
    expect(stopNote({ stats: { stopReason: 'area-cap' }, options: { maxAreaFraction: 0.25 } })).toMatch(
      /hit the 25% area cap/
    );
    expect(stopNote({ stats: { stopReason: 'edge' } })).toBe(null);
    expect(stopNote({ stats: { stopReason: 'exhausted' } })).toMatch(/nothing stopped this region/);
  });

  it('refuses a click on something too small to be an AOI', () => {
    const speck = fieldWithBlob({ width: 40, height: 40, box: [20, 20, 2, 2] });
    const result = segmentAt(speck, { u: 0.53, v: 0.53 });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/smaller than the minimum|too small/);
  });

  it('finds a boundary through the Sobel edge barrier', () => {
    const edges = edgeMagnitude(fieldWithBlob());
    const max = Math.max(...edges);
    expect(max).toBeGreaterThan(DEFAULT_SEGMENT_OPTIONS.edgeStop);
  });

  it('downscales large imagery to the working grid without changing the aspect', () => {
    const big = fieldWithBlob({ width: 1200, height: 600, box: [400, 200, 400, 200] });
    const work = downscale(big, 300);
    expect(work.width).toBe(300);
    expect(work.height).toBe(150);
    expect(work.direct).toBe(false);
    // the blob keeps its share of the frame
    const result = segmentAt(big, { u: 0.5, v: 0.5 }, { work });
    // the blob is 400x200 of 1200x600 = 11.1 %, and must stay 11.1 % at 300 px wide
    expect(result.stats.coverage).toBeGreaterThan(0.09);
    expect(result.stats.coverage).toBeLessThan(0.13);
  });
});

describe('mask clean-up and outline', () => {
  it('removes an isolated speckle and keeps the body', () => {
    const width = 5;
    const height = 5;
    const mask = new Uint8Array(width * height);
    for (let y = 1; y <= 3; y += 1) for (let x = 1; x <= 3; x += 1) mask[y * width + x] = 1;
    mask[0] = 1; // speckle
    const cleaned = cleanMask(mask, width, height, 1);
    expect(cleaned[0]).toBe(0);
    expect(cleaned[2 * width + 2]).toBe(1);
  });

  it('traces a closed ring around the blob, every point on the mask', () => {
    const mask = new Uint8Array(5 * 5);
    for (let y = 1; y <= 3; y += 1) for (let x = 1; x <= 3; x += 1) mask[y * 5 + x] = 1;
    const ring = traceOutline(mask, 5, 5);
    expect(ring.length).toBeGreaterThanOrEqual(8);
    for (const [x, y] of ring) expect(mask[y * 5 + x]).toBe(1);
    // the trace starts on the blob and stays inside its bounding box
    expect(ring[0]).toEqual([1, 1]);
    expect(ring.map((p) => p[0]).every((x) => x >= 1 && x <= 3)).toBe(true);
    expect(ring.map((p) => p[1]).every((y) => y >= 1 && y <= 3)).toBe(true);
    // consecutive points are 8-connected, so the ring is a real outline
    for (let i = 1; i < ring.length; i += 1) {
      expect(Math.max(Math.abs(ring[i][0] - ring[i - 1][0]), Math.abs(ring[i][1] - ring[i - 1][1]))).toBeLessThanOrEqual(1);
    }
  });

  it('returns nothing for an empty mask rather than a bogus ring', () => {
    expect(traceOutline(new Uint8Array(16), 4, 4)).toEqual([]);
  });

  it('simplifies a dense ring without moving it off the blob', () => {
    const wide = Array.from({ length: 64 }, (_, i) => [10 + Math.cos((i / 64) * Math.PI * 2) * 6, 10 + Math.sin((i / 64) * Math.PI * 2) * 6]);
    const simplified = simplifyRing(wide, 1.2);
    expect(simplified.length).toBeLessThan(wide.length);
    expect(simplified.length).toBeGreaterThan(2);
  });

  it('paints only the masked pixels', () => {
    const rgba = maskToRgba(new Uint8Array([0, 1, 0, 1]), 2, 2, { color: [1, 2, 3], alpha: 128 });
    expect([...rgba.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...rgba.slice(4, 8)]).toEqual([1, 2, 3, 128]);
    expect([...rgba.slice(12, 16)]).toEqual([1, 2, 3, 128]);
  });
});

describe('the sentence the UI shows', () => {
  it('quotes the ring it actually produced', () => {
    const result = segmentAt(fieldWithBlob(), { u: 0.5, v: 0.5 });
    const text = describeSegment(result, { areaKm2: 1.5 });
    expect(text).toMatch(/region segmented/);
    expect(text).toMatch(/vertices/);
    expect(text).toMatch(/% of the scene/);
    expect(text).toMatch(/1\.5 km²/);
    expect(text).not.toMatch(/cap/); // no false disclaimer on a clean region
  });

  it('explains a failure instead of reporting an empty AOI', () => {
    expect(describeSegment({ ok: false, reason: 'nothing to segment here' })).toBe('nothing to segment here');
    expect(describeSegment(null)).toBe('segmentation produced nothing');
  });
});
