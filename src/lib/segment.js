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
  const raw = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) raw[i] = LUM(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  // Blur before differencing. On raw SAR amplitude nearly half the pixels clear
  // any usable Sobel threshold (measured: mean 50, 48% over 46 on the bundled
  // scene), so every pixel read as an edge and growth was walled into a handful
  // of pixels. A 3x3 box smooth first leaves real boundaries standing and
  // treats speckle as texture, which is what an edge barrier is supposed to do.
  const lum = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          sum += raw[ny * width + nx];
          n += 1;
        }
      }
      lum[y * width + x] = sum / n;
    }
  }
  const mag = new Float32Array(width * height);
  const grad = new Float32Array(width * height);
  const gxs = new Float32Array(width * height);
  const gys = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const at = (xx, yy) => lum[yy * width + xx];
      const gx =
        -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) + at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
      const gy =
        -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      const i = y * width + x;
      gxs[i] = gx;
      gys[i] = gy;
      grad[i] = Math.sqrt(gx * gx + gy * gy) / 4;
    }
  }
  // Non-maximum suppression along the gradient direction, so an edge is a thin
  // ridge rather than a two-pixel band. The flood treats edge pixels as leaves
  // (included in the region, never expanded from), so a wide band would inset
  // every AOI by its width and quietly under-report the area it marks.
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const m = grad[i];
      if (m <= 0) continue;
      const ax = Math.abs(gxs[i]);
      const ay = Math.abs(gys[i]);
      const alongX = ax >= ay;
      const a = alongX ? grad[i - 1] : grad[i - width];
      const b = alongX ? grad[i + 1] : grad[i + width];
      mag[i] = m >= a && m >= b ? m : 0;
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
  const sx = clamp(Math.round(seed.x), 0, width - 1);
  const sy = clamp(Math.round(seed.y), 0, height - 1);
  const start = sy * width + sx;

  // Seed statistics from a small neighbourhood — but only from the neighbours
  // that are *the same colour as the pixel that was clicked*. A plain 5x5 mean
  // across a boundary describes neither side (click a 2 px speck and the window
  // is mostly background, so the flood leaves with the background's colour and
  // the speck is lost); weighting by the clicked pixel's own colour keeps a
  // click on a boundary honest.
  const centre = (sy * width + sx) * 4;
  const cr = data[centre];
  const cg = data[centre + 1];
  const cb = data[centre + 2];
  const sameAsCentre = (i) => {
    const o = i * 4;
    const dr = data[o] - cr;
    const dg = data[o + 1] - cg;
    const db = data[o + 2] - cb;
    return Math.sqrt((0.35 * dr * dr + 0.5 * dg * dg + 0.35 * db * db) / 3) <= tolerance;
  };
  let sr = cr;
  let sg = cg;
  let sb = cb;
  let n = 1;
  for (let y = Math.max(0, sy - 2); y <= Math.min(height - 1, sy + 2); y += 1) {
    for (let x = Math.max(0, sx - 2); x <= Math.min(width - 1, sx + 2); x += 1) {
      const i = y * width + x;
      if (i === sy * width + sx || !sameAsCentre(i)) continue;
      const o = i * 4;
      sr += data[o];
      sg += data[o + 1];
      sb += data[o + 2];
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

  // Tolerance means what the slider says: the region is the connected set of
  // pixels within `tolerance` of the seed's colour. The previous rule walked
  // the lowest-cost frontier and stopped at the *first* pixel over tolerance,
  // which on real imagery ends the region as soon as the frontier meets an
  // ordinary pixel — measured on the bundled scene, raising the slider from 34
  // to 65 moved coverage from 0.3% to 0.7%, and at 95 it jumped to 45%. Now the
  // control is monotone and predictable: a wider tolerance is a strictly larger
  // region, and the region is a genuine connected area of similar colour.
  //
  // The edge map stays in play as a barrier the flood will not cross, so a
  // similar-looking area on the far side of a real boundary is not swallowed.
  // A few seed-adjacent pixels are allowed through even on an edge, so a click
  // that lands exactly on a boundary still produces a region instead of one
  // pixel.
  const CLEARANCE = 4;
  const cap = Math.max(1, maxArea);
  const queue = new Int32Array(Math.min(width * height, cap + 1));
  let head = 0;
  let tail = 0;
  mask[start] = 1;
  queue[tail++] = start;
  let area = 1;
  let stopReason = 'exhausted';
  let barrierBlocked = 0;
  let clipped = false;
  let sumColourDistance = 0;
  let maxColourDistance = 0;
  let sawBorder = false;

  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    const y = (i - x) / width;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) sawBorder = true;
    const neighbours = [
      x > 0 ? i - 1 : -1,
      x < width - 1 ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y < height - 1 ? i + width : -1
    ];
    for (const j of neighbours) {
      if (j < 0 || mask[j]) continue;
      const d = colourDistance(j);
      if (d > tolerance) {
        // not the same colour as the seed: this is where the region ends
        stopReason = stopReason === 'area-cap' ? stopReason : 'boundary';
        continue;
      }
      const onEdge = edges && edges[j] > edgeStop && area > CLEARANCE;
      if (onEdge) {
        // A real edge. The pixel is part of the object (it is within
        // tolerance), so it belongs in the mask — the AOI has to reach the rim
        // of the feature — but the flood does not continue *through* it: it is
        // a leaf. That keeps the region inside the boundary instead of leaking
        // into the field next door.
        barrierBlocked += 1;
        if (stopReason === 'exhausted') stopReason = 'edge';
      }
      if (area >= cap) {
        clipped = true;
        stopReason = 'area-cap';
        break;
      }
      mask[j] = 1;
      area += 1;
      sumColourDistance += d;
      if (d > maxColourDistance) maxColourDistance = d;
      // an edge pixel is a leaf: included, never expanded from
      if (!onEdge && tail < queue.length) queue[tail++] = j;
    }
    if (stopReason === 'area-cap') break;
  }

  // A region that drained after being walled in by image edges is a clean
  // result; one that drained with nothing in its way filled the frame, which is
  // the case the UI already explains. Reaching the frame border counts as
  // filling the frame: nothing else stopped it.
  if (sawBorder) stopReason = stopReason === 'exhausted' ? 'exhausted' : stopReason;
  else if (stopReason === 'exhausted' && barrierBlocked > 0) stopReason = 'edge';

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
/**
 * Every part of a mask, largest first, each traced as its own ring.
 *
 * `traceOutline` returns one contour — the one that starts highest in the
 * frame. That is the right answer for a single region, but a shift-click
 * selection can hold several disjoint regions, and silently reporting only the
 * topmost one threw the rest of the selection away. The parts are counted and
 * returned so the caller can either keep the one polygon an AOI can hold and
 * say what it dropped, or report the count.
 */
export function traceOutlines(mask, width, height) {
  const seen = new Uint8Array(mask.length);
  const parts = [];
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i] || seen[i]) continue;
    const queue = [i];
    seen[i] = 1;
    const pixels = [];
    while (queue.length) {
      const j = queue.pop();
      pixels.push(j);
      const x = j % width;
      const y = (j - x) / width;
      if (x > 0 && mask[j - 1] && !seen[j - 1]) ((seen[j - 1] = 1), queue.push(j - 1));
      if (x < width - 1 && mask[j + 1] && !seen[j + 1]) ((seen[j + 1] = 1), queue.push(j + 1));
      if (y > 0 && mask[j - width] && !seen[j - width]) ((seen[j - width] = 1), queue.push(j - width));
      if (y < height - 1 && mask[j + width] && !seen[j + width]) ((seen[j + width] = 1), queue.push(j + width));
    }
    const part = new Uint8Array(mask.length);
    for (const j of pixels) part[j] = 1;
    parts.push({ pixels: pixels.length, ring: traceOutline(part, width, height) });
  }
  return parts.sort((a, b) => b.pixels - a.pixels);
}

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
  const attempt = (tolerance) => {
    const grown = growRegion(work, { seed, tolerance, edgeStop: opts.edgeStop, maxArea, edges });
    const cleaned = cleanMask(grown.mask, work.width, work.height, opts.cleanPasses ?? 2);
    return { grown, mask: cleaned, area: cleaned.reduce((a, b) => a + b, 0), tolerance };
  };

  // If the first pass lands under the minimum the click is not necessarily
  // useless — the frame may just be noisier than the chosen tolerance. Widening
  // and retrying keeps the tool usable on speckled scenes; `relaxed` carries the
  // multiplier through to the UI so the report stays honest about it.
  let best = attempt(opts.tolerance);
  let relaxed = 1;
  for (const factor of [1.6, 2.6]) {
    if (best.area >= opts.minArea) break;
    const next = attempt(opts.tolerance * factor);
    if (next.area > best.area) {
      best = next;
      relaxed = factor;
    }
  }
  const { grown, mask, area } = best;
  const coverage = area / (work.width * work.height);
  // cleaning can push a capped region slightly past the cap: report what the
  // caller actually got, not what the raw growth did
  const clipped = grown.clipped || coverage > opts.maxAreaFraction;

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
    clipped,
    stopReason: grown.stopReason,
    meanColourDistance: grown.meanColourDistance,
    seed: { u: seedUv.u, v: seedUv.v },
    options: opts,
    tolerance: best.tolerance,
    relaxed,
    stats: {
      coverage,
      tolerance: best.tolerance,
      relaxed,
      clipped,
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
  const relaxed = result.relaxed ?? result.stats?.relaxed ?? 1;
  const widened = relaxed > 1 ? `widened the tolerance to ${Math.round(result.tolerance ?? result.stats?.tolerance)}` : null;
  if (reason === 'area-cap') {
    const cap = Math.round((result.options?.maxAreaFraction ?? DEFAULT_SEGMENT_OPTIONS.maxAreaFraction) * 100);
    return [`hit the ${cap}% area cap — narrow the click or raise TOL`, widened].filter(Boolean).join(' · ');
  }
  if (reason === 'exhausted') {
    return ['nothing stopped this region — it ran to the edge of the scene', widened].filter(Boolean).join(' · ');
  }
  return widened;
}

/** One sentence for the toast, quoting the numbers the mask actually has. */
export function describeSegment(result, { areaKm2 = null, aoi = null } = {}) {
  if (!result?.ok) return result?.reason || 'segmentation produced nothing';
  // a real but small selection must not read as "0.0%": two decimals below 1%
  const share = result.stats.coverage * 100;
  const pct = share < 1 ? share.toFixed(2) : share.toFixed(1);
  const km = areaKm2 ?? aoi;
  const parts = result.stats.parts ?? 1;
  return [
    `region segmented · ${result.stats.outlineVertices} vertices`,
    `${pct}% of the scene`,
    km ? `${km.toFixed(1)} km²` : null,
    parts > 1 ? `${parts} separate areas — the AOI follows the largest` : null,
    stopNote(result)
  ]
    .filter(Boolean)
    .join(' · ');
}
