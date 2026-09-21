// The map snapshot that goes into the PDF report.
//
// The report has to stand on its own: a reader with no access to the console
// should see the scene, the drawn AOI and whichever overlay the answer leans on
// (water mask, disagreement clusters, the segmented region). The viewer canvas
// cannot be copied for that — the overlays live in SVG above it — so the same
// projection is replayed here on an offscreen canvas, in the report's palette
// (dark ink on light paper) rather than the console's dark theme.
//
// Everything is drawn through the viewer's own functions: `drawScene` for the
// imagery and the segmentation mask, `pointFromUv` for the geometry, so a
// vertex at u=0.34 lands on the same ground pixel it does on screen.

import { scaleBar } from './geo.js';
import { drawScene, pointFromUv } from './scene-render.js';
import { maskToRgba } from './segment.js';
import {
  BUILTIN_POLYS,
  CONFLICT_TYPES,
  DISAGREEMENT_CLUSTERS,
  LAYOVER_POLYS,
  WATER_PATHS
} from '../data/overlays.js';

const PAPER = '#FFFFFF';
const FRAME = '#B9BEC4';
const AOI_INK = '#12333D';
const WATER_INK = '#1E6F8C';
const BUILTIN_INK = '#B26B00';
const LAYOVER_INK = '#6B4FA8';

const parsePoly = (s) =>
  String(s)
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(',').map(Number))
    .filter((p) => p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));

const pathToPoints = (d, steps = 12) => {
  const nums = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  if (nums.length < 8) return [];
  const pts = [[nums[0], nums[1]]];
  let cur = [nums[0], nums[1]];
  for (let i = 2; i + 5 <= nums.length; i += 6) {
    const [x1, y1, x2, y2, x, y] = nums.slice(i, i + 6);
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps;
      const mt = 1 - t;
      pts.push([
        mt ** 3 * cur[0] + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t ** 3 * x,
        mt ** 3 * cur[1] + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t ** 3 * y
      ]);
    }
    cur = [x, y];
  }
  return pts;
};

// 0-100 image space -> canvas pixels, through the viewer's projection
const projectPoints = (pts, { box, sheet, view }) =>
  pts.map(([x, y]) => {
    const p = pointFromUv({ box, sheet, view, uv: { u: x / 100, v: y / 100 } });
    return [p.x, p.y];
  });

const strokePoly = (ctx, pts, { stroke, fill, width, dash = null, alpha = 1 }) => {
  if (pts.length < 2) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.setLineDash(dash || []);
    ctx.lineWidth = width;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
  ctx.restore();
};

const drawScaleBar = (ctx, { width, height, bar }) => {
  if (!bar) return;
  const pad = 12;
  const x = pad + 1;
  const y = height - pad - 1;
  ctx.save();
  ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
  const label = `${bar.label}`;
  const textW = ctx.measureText(label).width;
  const barW = Math.max(bar.px, textW + 10);
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.fillRect(x - 6, y - 26, barW + 14, 32);
  ctx.strokeStyle = FRAME;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 6, y - 26, barW + 14, 32);
  ctx.fillStyle = '#22262B';
  ctx.fillRect(x, y - 6, bar.px, 6);
  ctx.strokeStyle = '#22262B';
  ctx.strokeRect(x, y - 6, bar.px, 6);
  ctx.fillStyle = '#22262B';
  ctx.fillText(label, x, y - 12);
  ctx.restore();
  void width;
};

/**
 * Render the snapshot. `sources` / `mask` are the viewer's own draw sources, so
 * what the report shows is what the analyst had on screen.
 */
export function renderReportSnapshot({
  sources = [],
  mask = null,
  layers = null,
  aoi = [],
  segment = null,
  geo = null,
  mode = 'optical',
  width = 1200,
  dpr = 1.5
} = {}) {
  if (typeof document === 'undefined') return null;
  const aspect = (() => {
    const bitmap = sources.find((s) => s?.bitmap)?.bitmap;
    return bitmap?.width > 0 && bitmap?.height > 0 ? bitmap.width / bitmap.height : 16 / 9;
  })();
  const box = { w: width, h: Math.max(240, Math.round(width / aspect)) };
  const sheet = { w: box.w, h: box.h };
  const view = { z: 1, x: 0, y: 0 };
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(box.w * dpr);
  canvas.height = Math.round(box.h * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // the segmentation arrives as raw data; rasterise it here so the caller does
  // not have to own a second canvas just to export
  const maskDrawable = (() => {
    if (!mask?.data || !(mask.width > 0) || !(mask.height > 0)) return mask?.canvas ? mask : null;
    const canvas = document.createElement('canvas');
    canvas.width = mask.width;
    canvas.height = mask.height;
    const mctx = canvas.getContext('2d');
    if (!mctx) return null;
    mctx.putImageData(new ImageData(maskToRgba(mask.data, mask.width, mask.height), mask.width, mask.height), 0, 0);
    return { canvas, width: mask.width, height: mask.height, alpha: mask.alpha ?? 0.5 };
  })();

  drawScene(ctx, { box, sheet, view, dpr, sources, mask: maskDrawable, background: PAPER });
  // `drawScene` restores the identity transform, so overlays are drawn in CSS
  // pixels here — the same units `pointFromUv` returns
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  const at = { box, sheet, view };
  const on = (key) => !layers || layers[key]?.on;

  // overlays: the same fixture geometry the viewer draws, in print colours
  if (on('water') && mode !== 'change') {
    const pts = projectPoints(pathToPoints(WATER_PATHS[mode === 'sar' ? 'sar' : 'optical']), at);
    if (pts.length > 2) {
      strokePoly(ctx, pts, { stroke: WATER_INK, width: 2.4, alpha: 0.75 });
      strokePoly(ctx, pts, { stroke: WATER_INK, width: 0.9, dash: [6, 4] });
    }
  }
  if (on('builtin') && mode !== 'change') {
    BUILTIN_POLYS.forEach((poly) => strokePoly(ctx, projectPoints(parsePoly(poly), at), { stroke: BUILTIN_INK, fill: 'rgba(178,107,0,0.10)', width: 1.2 }));
  }
  if (on('layover')) {
    LAYOVER_POLYS.forEach((poly) => strokePoly(ctx, projectPoints(parsePoly(poly), at), { stroke: LAYOVER_INK, fill: 'rgba(107,79,168,0.12)', width: 1.2, dash: [5, 3] }));
  }
  if (on('disagreement') && mode !== 'change') {
    DISAGREEMENT_CLUSTERS.forEach((c) => {
      const colour = CONFLICT_TYPES[c.type]?.color || '#8A6A2B';
      strokePoly(ctx, projectPoints(parsePoly(c.pts), at), { stroke: colour, fill: `${colour}22`, width: 1.4, dash: c.type === 'temporal' ? [5, 4] : null });
    });
  }
  if (segment?.ring?.length > 2) {
    strokePoly(ctx, projectPoints(segment.ring.map((p) => [p.u * 100, p.v * 100]), at), { stroke: WATER_INK, fill: 'rgba(30,111,140,0.14)', width: 1.6 });
  }

  // the drawn AOI last, so nothing paints over it — with a white casing, the
  // way a printed map draws a boundary, or it disappears over dark imagery
  const aoiPts = projectPoints(aoi.map((p) => [p.u * 100, p.v * 100]), at);
  strokePoly(ctx, aoiPts, { stroke: '#FFFFFF', width: 4.5, fill: 'rgba(255,255,255,0.10)' });
  strokePoly(ctx, aoiPts, { stroke: AOI_INK, width: 2.2, dash: [8, 5] });
  aoiPts.forEach(([x, y]) => {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
    ctx.fillStyle = AOI_INK;
    ctx.fillRect(x - 2, y - 2, 4, 4);
  });

  drawScaleBar(ctx, {
    width: box.w,
    height: box.h,
    bar: scaleBar({ extent: geo?.extent || undefined, sheetWidthPx: box.w, zoom: 1 })
  });
  ctx.restore();

  ctx.strokeStyle = FRAME;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, box.w * dpr - 2, box.h * dpr - 2);

  return { canvas, width: box.w, height: box.h, dpr, aspect };
}

/**
 * Canvas -> PNG bytes for the PDF, plus the caption the report prints under it.
 * Returns null when there is nothing decodable to draw.
 */
export async function reportSnapshot({ sources = [], caption = null, ...rest } = {}) {
  const drawn = renderReportSnapshot({ sources, ...rest });
  if (!drawn) return null;
  // JPEG, not PNG: the snapshot is photographic, and a lossless 2800 px raster
  // turned a two-page report into a 12 MB attachment
  const blob = await new Promise((resolve) => drawn.canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const bar = scaleBar({ extent: rest.geo?.extent || undefined, sheetWidthPx: drawn.width, zoom: 1 });
  return {
    bytes,
    mediaType: 'image/jpeg',
    width: drawn.width,
    height: drawn.height,
    caption:
      caption ||
      `map snapshot · ${rest.geo?.crs || 'no CRS declared'} · full scene · scale bar ${bar.label} · AOI outline dashed, ${rest.aoi?.length || 0} vertices`
  };
}
