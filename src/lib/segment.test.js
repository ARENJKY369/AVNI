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
  traceOutline,
  traceOutlines
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

  it('grows monotonically with the tolerance, from the same seed', () => {
    // the slider has to mean something: a wider tolerance is a larger region.
    // A flat blob cannot show this (any tolerance past the blob's own contrast
    // marks the whole blob), so the frame is a ramp: the seed sits in a bright
    // patch and every further ring is a little closer to the background.
    const width = 200;
    const height = 200;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const r = Math.hypot(x - 100, y - 100);
        const v = r < 10 ? 200 : r < 25 ? 170 : r < 40 ? 140 : 110;
        const i = (y * width + x) * 4;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    const ramp = { width, height, data };
    const areas = [10, 30, 60, 90].map((tolerance) => segmentAt(ramp, { u: 0.5, v: 0.5 }, { tolerance }).area);
    for (let i = 1; i < areas.length; i += 1) expect(areas[i]).toBeGreaterThanOrEqual(areas[i - 1]);
    expect(areas[areas.length - 1]).toBeGreaterThan(areas[0]);
  });

  it('keeps the rim of the feature and never crosses the edge into the field', () => {
    // the rim is part of the object: a region that stops short of it silently
    // under-reports the area, and one that steps through it leaks into the
    // neighbouring field
    const image = fieldWithBlob();
    const result = segmentAt(image, { u: 0.5, v: 0.5 });
    const { width, height, data } = result.work;
    for (let i = 0; i < width * height; i += 1) {
      if (!result.mask[i]) continue;
      const x = i % width;
      const y = (i - x) / width;
      expect(x).toBeGreaterThanOrEqual(20);
      expect(x).toBeLessThanOrEqual(59);
      expect(y).toBeGreaterThanOrEqual(15);
      expect(y).toBeLessThanOrEqual(44);
    }
    // the blob's top row, in full bar the two corners the clean-up pass trims
    const rim = [...result.mask.slice(15 * width + 20, 15 * width + 60)].reduce((a, b) => a + b, 0);
    expect(rim).toBeGreaterThanOrEqual(38);
    const blobPixels = 40 * 30;
    const kept = [...result.mask].reduce((a, b) => a + b, 0);
    expect(kept).toBeGreaterThan(blobPixels * 0.95);
    expect(data.length).toBeGreaterThan(0);
  });

  it('widens the tolerance rather than refusing a click that is just too tight', () => {
    // a 4x4 bright patch inside a disc, in a darker field: at the analyst's
    // tolerance the patch alone is under the minimum, one rung up the ladder
    // reaches the disc — the click must mark it and say the tolerance moved
    const width = 200;
    const height = 200;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const r = Math.hypot(x - 100, y - 100);
        const v = r < 20 ? 122 : 120;
        const i = (y * width + x) * 4;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    for (let y = 98; y < 102; y += 1) {
      for (let x = 98; x < 102; x += 1) {
        const i = (y * width + x) * 4;
        data[i] = 130;
        data[i + 1] = 130;
        data[i + 2] = 130;
      }
    }
    const tight = segmentAt({ width, height, data }, { u: 0.5, v: 0.5 }, { tolerance: 5 });
    expect(tight.ok).toBe(true);
    expect(tight.relaxed).toBeGreaterThan(1);
    expect(tight.stats.coverage).toBeGreaterThan(0.02);
    expect(stopNote(tight)).toMatch(/widened the tolerance/);
  });

  it('counts every part of a multi-part selection', () => {
    // two blobs, one mask: the AOI can only follow the largest, but the caller
    // has to be able to say how many parts there were
    const image = fieldWithBlob({ width: 120, height: 60, box: [10, 20, 20, 20] });
    const second = fieldWithBlob({ width: 120, height: 60, box: [80, 20, 20, 20] });
    for (let i = 0; i < image.data.length; i += 4) {
      if (second.data[i] < 100) {
        image.data[i] = second.data[i];
        image.data[i + 1] = second.data[i + 1];
        image.data[i + 2] = second.data[i + 2];
      }
    }
    const a = segmentAt(image, { u: 0.17, v: 0.5 });
    const b = segmentAt(image, { u: 0.75, v: 0.5 });
    expect(a.ok && b.ok).toBe(true);
    const merged = new Uint8Array(a.mask.length);
    for (let i = 0; i < merged.length; i += 1) merged[i] = a.mask[i] | b.mask[i];
    const parts = traceOutlines(merged, a.work.width, a.work.height);
    expect(parts.length).toBe(2);
    expect(parts[0].pixels).toBeGreaterThan(parts[1].pixels - 1);
    expect(parts[0].ring.length).toBeGreaterThan(3);
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
