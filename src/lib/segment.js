// Segmentation-based AOI marking.
//
// Drawing an AOI vertex by vertex is the wrong interaction for "mark the water
// on this scene": the pixels already say where the water is. This module grows
// a region from a clicked seed — colour similarity to the seed statistics,
// stopped at image edges, capped so a click on the sky cannot swallow the
// scene — and traces the resulting mask into a polygon ring in AOI space.
//
// It is a real segmentation (seeded region growing / geodesic distance with an
// edge barrier), deterministic, and cheap enough to run inside a click: the
// work happens on a downscaled grid and the ring is simplified before it
// reaches the store.

const LUM = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

export const DEFAULT_SEGMENT_OPTIONS = {
  tolerance: 34, // colour distance that still counts as "same region" (0-100)
  edgeStop: 46, // Sobel gradient magnitude that blocks growth (0-255)
  maxAreaFraction: 0.45, // a region bigger than this is reported as capped
  minArea: 24, // working-grid pixels; below this the click is "nothing here"
  workSize: 512 // long edge of the working grid
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Downscale an RGBA image for segmentation work. Box filter, integer-friendly. */
export function downscale(image, workSize = DEFAULT_SEGMENT_OPTIONS.workSize) {
  const { width, height, data } = image;
  const long = Math.max(width, height);
  if (long <= workSize) return { width, height, data, scaleX: 1, scaleY: 1, direct: true };
  const scale = workSize / long;
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = width / w;
  const sy = height / h;
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.min(height, Math.max(y0 + 1, Math.floor((y + 1) * sy)));
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.min(width, Math.max(x0 + 1, Math.floor((x + 1) * sx)));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy += 1) {
        for (let xx = x0; xx < x1; xx += 1) {
          const i = (yy * width + xx) * 4;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n += 1;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: out, scaleX: sx, scaleY: sy, direct: false };
}

/** Sobel edge magnitude on luminance — the barrier region growing must not cross. */
export function edgeMagnitude({ width, height, data }) {
  const lum = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) lum[i] = LUM(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  const mag = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const at = (xx, yy) => lum[yy * width + xx];
      const gx =
        -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) + at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
      const gy =
        -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      mag[y * width + x] = Math.sqrt(gx * gx + gy * gy) / 4;
    }
  }
  return mag;
}

/**
 * Seeded region growing with a priority queue on colour distance.
 * Grows in order of similarity, so the tolerance slider means the same thing
 * everywhere: "how far from the seed colour still belongs".
 */
export function growRegion(work, { seed, tolerance, edgeStop, maxArea, edges }) {
  const { width, height, data } = work;
  const mask = new Uint8Array(width * height);
  const cost = new Float32Array(width * height).fill(Infinity);
  const sx = clamp(Math.round(seed.x), 0, width - 1);
  const sy = clamp(Math.round(seed.y), 0, height - 1);
  const start = sy * width + sx;

  // seed statistics from a small neighbourhood, so a single noisy pixel does
  // not define the whole region
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let n = 0;
  for (let y = Math.max(0, sy - 2); y <= Math.min(height - 1, sy + 2); y += 1) {
    for (let x = Math.max(0, sx - 2); x <= Math.min(width - 1, sx + 2); x += 1) {
      const i = (y * width + x) * 4;
      sr += data[i];
      sg += data[i + 1];
      sb += data[i + 2];
      n += 1;
    }
  }
  sr /= n;
  sg /= n;
  sb /= n;

  const colourDistance = (i) => {
    const o = i * 4;
    const dr = data[o] - sr;
    const dg = data[o + 1] - sg;
    const db = data[o + 2] - sb;
    // luminance-weighted so brightness edges dominate, as the eye sees them
    return Math.sqrt((0.35 * dr * dr + 0.5 * dg * dg + 0.35 * db * db) / 3);
  };

  // a small binary heap keyed by cost
  const heap = [start];
  const push = (i) => {
    heap.push(i);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (cost[heap[p]] <= cost[heap[c]]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let p = 0;
      for (;;) {
        const l = p * 2 + 1;
        const r = l + 1;
        let m = p;
        if (l < heap.length && cost[heap[l]] < cost[heap[m]]) m = l;
        if (r < heap.length && cost[heap[r]] < cost[heap[m]]) m = r;
        if (m === p) break;
        [heap[p], heap[m]] = [heap[m], heap[p]];
        p = m;
      }
    }
    return top;
  };

  cost[start] = 0;
  let area = 0;
  // Why growth stopped matters to the user: hitting the area cap means the
  // result is truncated, whereas meeting the tolerance is the *normal* end of
  // a region and must not be reported as a failure.
  let stopReason = 'exhausted';
  let barrierBlocked = 0;
  let clipped = false;
  let sumColourDistance = 0;
  let maxColourDistance = 0;

  while (heap.length) {
    const i = pop();
    if (mask[i]) continue;
    const d = colourDistance(i);
    if (d > tolerance) {
      stopReason = 'boundary';
      break;
    }
    mask[i] = 1;
    area += 1;
    sumColourDistance += d;
    if (d > maxColourDistance) maxColourDistance = d;
    if (area >= maxArea) {
      clipped = true;
      stopReason = 'area-cap';
      break;
    }
    const x = i % width;
    const y = (i - x) / width;
    const neighbours = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1]
    ];
    for (const [nx, ny] of neighbours) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (mask[j]) continue;
      // an edge is a wall: growth continues around it, not through it
      if (edges && edges[j] > edgeStop) {
        barrierBlocked += 1;
        continue;
      }
      const step = colourDistance(j);
      const c = Math.max(cost[i], step) + step * 0.25;
      if (c < cost[j]) {
        cost[j] = c;
        push(j);
      }
    }
  }

  // A region that drained the queue after being walled in by image edges is a
  // clean result; one that drained with nothing in its way filled the frame.
  if (stopReason === 'exhausted' && barrierBlocked > 0) stopReason = 'edge';

  return {
    mask,
    width,
    height,
    area,
    clipped,
    stopReason,
    barrierBlocked,
    meanColourDistance: area ? sumColourDistance / area : 0,
    maxColourDistance
  };
}

/** 3x3 majority vote, twice: kills speckle and closes pinholes. */
export function cleanMask(mask, width, height, passes = 2) {
  let current = mask;
  for (let p = 0; p < passes; p += 1) {
    const next = new Uint8Array(current.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let on = 0;
        let total = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            total += 1;
            on += current[ny * width + nx];
          }
        }
        next[y * width + x] = on * 2 > total ? 1 : 0;
      }
    }
    current = next;
  }
  return current;
}

/** Moore-neighbour boundary trace of the largest blob. Returns pixel-space ring. */
export function traceOutline(mask, width, height) {
  let start = -1;
  for (let i = 0; i < mask.length && start === -1; i += 1) if (mask[i]) start = i;
  if (start === -1) return [];
  const sx = start % width;
  const sy = (start - sx) / width;
  const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : mask[y * width + x]);

  const dirs = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1]
  ];
  const ring = [];
  let cx = sx;
  let cy = sy;
  let dir = 0;
  const guard = width * height * 8;
  for (let step = 0; step < guard; step += 1) {
    ring.push([cx, cy]);
    let found = false;
    for (let k = 0; k < 8; k += 1) {
      const d = (dir + k) % 8;
      const nx = cx + dirs[d][0];
      const ny = cy + dirs[d][1];
      if (at(nx, ny)) {
        cx = nx;
        cy = ny;
        dir = (d + 5) % 8; // step back to the previous neighbour first
        found = true;
        break;
      }
    }
    if (!found) break;
    if (cx === sx && cy === sy && ring.length > 2) break;
  }
  return ring;
}

const perpendicular = (p, a, b) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
};

/** Douglas-Peucker on an open polyline. */
export function simplifyPath(points, tolerance) {
  if (points.length < 3) return points.slice();
  let worst = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = perpendicular(points[i], points[0], points[points.length - 1]);
    if (d > worst) {
      worst = d;
      index = i;
    }
  }
  if (worst <= tolerance) return [points[0], points[points.length - 1]];
  const left = simplifyPath(points.slice(0, index + 1), tolerance);
  const right = simplifyPath(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

/** Simplify a closed ring by splitting it at its two farthest-apart vertices. */
export function simplifyRing(ring, tolerance) {
  if (ring.length < 6) return ring;
  let a = 0;
  let b = 0;
  let best = -1;
  const step = Math.max(1, Math.floor(ring.length / 32));
  for (let i = 0; i < ring.length; i += step) {
    for (let j = i + step; j < ring.length; j += step) {
      const d = (ring[i][0] - ring[j][0]) ** 2 + (ring[i][1] - ring[j][1]) ** 2;
      if (d > best) {
        best = d;
        a = i;
        b = j;
      }
    }
  }
  const first = simplifyPath(ring.slice(a, b + 1), tolerance);
  const second = simplifyPath([...ring.slice(b), ...ring.slice(0, a + 1)], tolerance);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

/**
 * The whole interaction, in one call: seed pixel in, ring in image fractions
 * out (u,v — the same space the AOI store and every overlay use).
 */
export function segmentAt(image, seedUv, options = {}) {
  const opts = { ...DEFAULT_SEGMENT_OPTIONS, ...options };
  const work = options.work ?? downscale(image, opts.workSize);
  const edges = options.edges ?? edgeMagnitude(work);
  const seed = {
    x: clamp(seedUv.u * work.width, 0, work.width - 1),
    y: clamp(seedUv.v * work.height, 0, work.height - 1)
  };
  const maxArea = Math.max(opts.minArea + 1, Math.round(work.width * work.height * opts.maxAreaFraction));
  const grown = growRegion(work, {
    seed,
    tolerance: opts.tolerance,
    edgeStop: opts.edgeStop,
    maxArea,
    edges
  });
  const mask = cleanMask(grown.mask, work.width, work.height, opts.cleanPasses ?? 2);
  const area = mask.reduce((a, b) => a + b, 0);

  if (area < opts.minArea) {
    return {
      ok: false,
      reason: 'nothing to segment here — the region around this point is smaller than the minimum',
      area,
      work
    };
  }

  const outline = traceOutline(mask, work.width, work.height);
  const simplified = simplifyRing(outline, opts.simplify ?? Math.max(1.2, work.width / 220));
  const ring = simplified
    .map(([x, y]) => ({ u: x / work.width, v: y / work.height }))
    .map(({ u, v }) => ({ u: clamp(u, 0, 1), v: clamp(v, 0, 1) }));

  return {
    ok: ring.length >= 3,
    reason: ring.length >= 3 ? null : 'the traced outline was too small to be an AOI',
    ring,
    mask,
    work,
    area,
    clipped: grown.clipped,
    stopReason: grown.stopReason,
    meanColourDistance: grown.meanColourDistance,
    seed: { u: seedUv.u, v: seedUv.v },
    options: opts,
    stats: {
      coverage: area / (work.width * work.height),
      clipped: grown.clipped,
      stopReason: grown.stopReason,
      meanColourDistance: grown.meanColourDistance,
      maxColourDistance: grown.maxColourDistance,
      outlineVertices: ring.length,
      workWidth: work.width,
      workHeight: work.height
    }
  };
}

/** RGBA overlay for the mask, in the working grid's resolution. */
export function maskToRgba(mask, width, height, { color = [45, 212, 191], alpha = 96 } = {}) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue;
    out[i * 4] = color[0];
    out[i * 4 + 1] = color[1];
    out[i * 4 + 2] = color[2];
    out[i * 4 + 3] = alpha;
  }
  return out;
}

/**
 * Why the region stopped growing, in words — or null when it simply found its
 * boundary, which is the normal case and needs no disclaimer.
 */
export function stopNote(result) {
  if (!result) return null;
  const reason = result.stats?.stopReason ?? result.stopReason;
  if (reason === 'area-cap') {
    const cap = Math.round((result.options?.maxAreaFraction ?? DEFAULT_SEGMENT_OPTIONS.maxAreaFraction) * 100);
    return `hit the ${cap}% area cap — narrow the click or raise TOL`;
  }
  if (reason === 'exhausted') return 'nothing stopped this region — it ran to the edge of the scene';
  return null;
}

/** One sentence for the toast, quoting the numbers the mask actually has. */
export function describeSegment(result, { areaKm2 = null, aoi = null } = {}) {
  if (!result?.ok) return result?.reason || 'segmentation produced nothing';
  const pct = (result.stats.coverage * 100).toFixed(1);
  const km = areaKm2 ?? aoi;
  return [
    `region segmented · ${result.stats.outlineVertices} vertices`,
    `${pct}% of the scene`,
    km ? `${km.toFixed(1)} km²` : null,
    stopNote(result)
  ]
    .filter(Boolean)
    .join(' · ');
}
