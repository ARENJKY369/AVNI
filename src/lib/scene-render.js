// Scene raster projection: where the imagery goes, and how it is sampled.
//
// The scene used to be a stack of <img> elements inside a CSS
// `transform: scale()` layer. Two things fall out of that: the compositor
// magnifies a 1x texture, so a 400 % zoom shows the layer's pixels breaking
// apart, and the raster has no relationship with the pixels the analysis code
// can read. This module computes the projection and paints the *visible*
// window with `drawImage`, at device resolution, with high-quality smoothing
// and pixel-snapped translation — no composited layer, nothing to tear.
//
// The same projection feeds the SVG overlays, so a mask at u=0.3 sits on the
// same ground as the lat/lon computed from u=0.3.

/**
 * Pan bounds: the sheet may be pulled to the edge of the viewport, never past.
 * `view.x/y` are the translation of the sheet centre in CSS pixels.
 */
export function clampView(view, box, sheet) {
  const z = view.z;
  const maxX = Math.max(0, (sheet.w * z - box.w) / 2);
  const maxY = Math.max(0, (sheet.h * z - box.h) / 2);
  return {
    z,
    x: Math.min(maxX, Math.max(-maxX, view.x)),
    y: Math.min(maxY, Math.max(-maxY, view.y))
  };
}

/** The sheet's own rect in container coordinates, before pan/zoom. */
export function sheetRect(box, sheet) {
  return { x: (box.w - sheet.w) / 2, y: (box.h - sheet.h) / 2, w: sheet.w, h: sheet.h };
}

/** The sheet after translate + scale: the rect the overlays live in. */
export function projectRect(box, sheet, view) {
  const base = sheetRect(box, sheet);
  const w = base.w * view.z;
  const h = base.h * view.z;
  return {
    x: base.x + view.x + (base.w - w) / 2,
    y: base.y + view.y + (base.h - h) / 2,
    w,
    h
  };
}

/**
 * Source rect (bitmap pixels) and destination rect (device pixels) for the
 * visible window. When the sheet is larger than the viewport only the visible
 * part of the bitmap is sampled, so an 8x zoom costs no more than a fit.
 */
export function viewportFor({ box, sheet, view, bitmap, dpr = 1 }) {
  const rect = projectRect(box, sheet, view);
  const clip = {
    x0: Math.max(0, rect.x),
    y0: Math.max(0, rect.y),
    x1: Math.min(box.w, rect.x + rect.w),
    y1: Math.min(box.h, rect.y + rect.h)
  };
  const scaleX = bitmap.width / rect.w;
  const scaleY = bitmap.height / rect.h;

  const sx = (clip.x0 - rect.x) * scaleX;
  const sy = (clip.y0 - rect.y) * scaleY;
  const sw = Math.max(0.001, (clip.x1 - clip.x0) * scaleX);
  const sh = Math.max(0.001, (clip.y1 - clip.y0) * scaleY);

  return {
    rect,
    clip,
    src: { x: sx, y: sy, w: sw, h: sh },
    // snapped to whole device pixels: fractional destinations are what makes a
    // zoomed raster shimmer
    dst: {
      x: Math.round(clip.x0 * dpr) / dpr,
      y: Math.round(clip.y0 * dpr) / dpr,
      w: Math.round((clip.x1 - clip.x0) * dpr) / dpr,
      h: Math.round((clip.y1 - clip.y0) * dpr) / dpr
    }
  };
}

/** Fine scale used for one drawing pass; kept separate so tests can assert it. */
export const SMOOTHING_QUALITY = 'high';

function assertReady(ctx, bitmap) {
  if (!ctx || !bitmap) return false;
  if (!bitmap.width || !bitmap.height) return false;
  return true;
}

/**
 * Paint the scene.
 *
 *   sources: [{ bitmap, alpha?, clipU? }]  — bottom layer first; `clipU` is a
 *   [from, to] window in sheet fractions, which is how the swipe comparison
 *   and the optical/SAR blend are drawn.
 *   mask: { data, width, height, alpha } — segmentation overlay, projected
 *   exactly like the imagery it came from.
 */
export function drawScene(ctx, { box, sheet, view, dpr = 1, sources = [], mask = null, background = null }) {
  if (!ctx) return;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, box.w, box.h);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, box.w, box.h);
  }
  ctx.beginPath();
  ctx.rect(0, 0, box.w, box.h);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = SMOOTHING_QUALITY;

  for (const source of sources) {
    const { bitmap, alpha = 1, clipU = null } = source;
    if (!assertReady(ctx, bitmap)) continue;
    const vp = viewportFor({ box, sheet, view, bitmap, dpr });
    if (vp.dst.w <= 0 || vp.dst.h <= 0) continue;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (clipU) {
      // a window in sheet space, converted to container space and intersected
      // with the viewport
      const rect = projectRect(box, sheet, view);
      const x0 = Math.max(0, rect.x + rect.w * clipU[0]);
      const x1 = Math.min(box.w, rect.x + rect.w * clipU[1]);
      ctx.beginPath();
      ctx.rect(x0, 0, Math.max(0, x1 - x0), box.h);
      ctx.clip();
    }
    ctx.drawImage(bitmap, vp.src.x, vp.src.y, vp.src.w, vp.src.h, vp.dst.x, vp.dst.y, vp.dst.w, vp.dst.h);
    ctx.restore();
  }

  // The mask arrives either as raw data ({data,width,height}) or already
  // rasterised into a canvas — the viewer hands over the canvas so the mask is
  // only converted once. Both must be drawable, or the segmented region is
  // invisible while the UI claims it exists.
  const maskImage = mask?.canvas || (mask?.data ? mask : null);
  if (maskImage && mask.width > 0 && mask.height > 0) {
    const rect = projectRect(box, sheet, view);
    const clip = {
      x0: Math.max(0, rect.x),
      y0: Math.max(0, rect.y),
      x1: Math.min(box.w, rect.x + rect.w),
      y1: Math.min(box.h, rect.y + rect.h)
    };
    if (clip.x1 > clip.x0 && clip.y1 > clip.y0) {
      ctx.save();
      ctx.globalAlpha = mask.alpha ?? 0.42;
      const dst = {
        x: Math.round(clip.x0 * dpr) / dpr,
        y: Math.round(clip.y0 * dpr) / dpr,
        w: Math.round((clip.x1 - clip.x0) * dpr) / dpr,
        h: Math.round((clip.y1 - clip.y0) * dpr) / dpr
      };
      const src = {
        x: ((clip.x0 - rect.x) / rect.w) * mask.width,
        y: ((clip.y0 - rect.y) / rect.h) * mask.height,
        w: ((clip.x1 - clip.x0) / rect.w) * mask.width,
        h: ((clip.y1 - clip.y0) / rect.h) * mask.height
      };
      ctx.drawImage(maskImage, src.x, src.y, src.w, src.h, dst.x, dst.y, dst.w, dst.h);
      ctx.restore();
    }
  }

  ctx.restore();
}

/** Container point (CSS px) -> sheet fraction, the inverse of the projection. */
export function uvFromPoint({ box, sheet, view, point }) {
  const rect = projectRect(box, sheet, view);
  const u = (point.x - rect.x) / rect.w;
  const v = (point.y - rect.y) / rect.h;
  return {
    u: Math.min(1, Math.max(0, u)),
    v: Math.min(1, Math.max(0, v)),
    inside: u >= 0 && u <= 1 && v >= 0 && v <= 1
  };
}

/** Sheet fraction -> container point (what the keyboard crosshair is drawn at). */
export function pointFromUv({ box, sheet, view, uv }) {
  const rect = projectRect(box, sheet, view);
  return { x: rect.x + uv.u * rect.w, y: rect.y + uv.v * rect.h };
}

/**
 * Pixel access for segmentation: the same window the viewer is showing, but on
 * a canvas we can read. An offscreen canvas keeps the main canvas cheap.
 */
export function readRegionPixels(bitmap, { maxPixels = 4_000_000 } = {}) {
  const scale = Math.min(1, Math.sqrt(maxPixels / (bitmap.width * bitmap.height)));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas =
    typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = SMOOTHING_QUALITY;
  ctx.drawImage(bitmap, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  return { data, width, height, canvas };
}
