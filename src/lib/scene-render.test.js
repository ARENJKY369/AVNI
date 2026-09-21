// The projection behind the zoom fix, and the two overlay paths that must draw
// (the scene raster, and the segmented mask on top of it).
import { describe, expect, it } from 'vitest';
import { SMOOTHING_QUALITY, clampView, drawScene, pointFromUv, projectRect, sheetRect, uvFromPoint, viewportFor } from '../lib/scene-render.js';

const box = { w: 1000, h: 800 };
const sheet = { w: 1000, h: 500 }; // a 2:1 scene in a container that is not 2:1

/** Enough of a 2d context to record what a paint pass did. */
function stubCtx() {
  const calls = [];
  const ctx = {
    calls,
    globalAlpha: 1,
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    setTransform: (...a) => calls.push(['setTransform', ...a]),
    clearRect: (...a) => calls.push(['clearRect', ...a]),
    fillRect: (...a) => calls.push(['fillRect', ...a]),
    rect: (...a) => calls.push(['rect', ...a]),
    beginPath: () => calls.push(['beginPath']),
    clip: () => calls.push(['clip']),
    fillStyle: '',
    drawImage: (...a) => calls.push(['drawImage', ...a]),
    draws: () => calls.filter((c) => c[0] === 'drawImage').map((c) => c.slice(1))
  };
  return ctx;
}

const bitmap = (width, height) => ({ width, height });

describe('sheet and view maths', () => {
  it('letterboxes the sheet in the container, keeping the raster aspect', () => {
    const rect = sheetRect(box, sheet);
    expect(rect.w / rect.h).toBeCloseTo(2, 3);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(150); // (800 - 500) / 2
  });

  it('projects the same rect the overlays use, for any zoom and pan', () => {
    const atFit = projectRect(box, sheet, { z: 1, x: 0, y: 0 });
    const zoomed = projectRect(box, sheet, { z: 4, x: -200, y: 60 });
    expect(atFit).toMatchObject({ x: 0, y: 150, w: 1000, h: 500 });
    expect(zoomed.w).toBe(4000);
    expect(zoomed.h).toBe(2000);
    expect(zoomed.x).toBe(0 + -200 + (1000 - 4000) / 2);
    expect(zoomed.y).toBe(150 + 60 + (500 - 2000) / 2);
  });

  it('never lets the sheet be dragged past its own edge', () => {
    const clamped = clampView({ z: 2, x: 9999, y: -9999 }, box, sheet);
    // at z=2 the sheet is 1000 px wider and 200 px taller than the container
    expect(clamped.x).toBe(500);
    expect(clamped.y).toBe(-100);
  });

  it('round-trips a point through sheet fractions', () => {
    const view = { z: 3, x: 40, y: -30 };
    const uv = { u: 0.3, v: 0.7 };
    const point = pointFromUv({ box, sheet, view, uv });
    const back = uvFromPoint({ box, sheet, view, point });
    expect(back.u).toBeCloseTo(0.3, 6);
    expect(back.v).toBeCloseTo(0.7, 6);
    expect(back.inside).toBe(true);
  });

  it('marks a click outside the sheet as outside', () => {
    const back = uvFromPoint({ box, sheet, view: { z: 1, x: 0, y: 0 }, point: { x: 500, y: 20 } });
    expect(back.inside).toBe(false);
  });
});

describe('viewport sampling (the zoom fix)', () => {
  it('samples the whole bitmap at fit and only the visible window when zoomed', () => {
    const img = bitmap(2000, 1000);
    const fit = viewportFor({ box, sheet, view: { z: 1, x: 0, y: 0 }, bitmap: img, dpr: 1 });
    expect(fit.src).toMatchObject({ x: 0, y: 0, w: 2000, h: 1000 });
    expect(fit.dst).toMatchObject({ x: 0, y: 150, w: 1000, h: 500 });

    const zoomed = viewportFor({ box, sheet, view: { z: 4, x: 0, y: 0 }, bitmap: img, dpr: 1 });
    // 4x of a 1000x500 sheet is 4000x2000 centred on the container, so the
    // visible 1000x800 window is half the sheet's width and 40 % of its height
    expect(zoomed.src.w).toBeCloseTo(500, 3);
    expect(zoomed.src.h).toBeCloseTo(400, 3);
    expect(zoomed.src.x).toBeCloseTo(750, 3);
    expect(zoomed.src.y).toBeCloseTo(300, 3);
    expect(zoomed.dst).toMatchObject({ x: 0, y: 0, w: 1000, h: 800 });
  });

  it('snaps destination pixels to the device grid so a zoomed raster cannot shimmer', () => {
    const vp = viewportFor({ box, sheet, view: { z: 2.7, x: 13.4, y: -7.9 }, bitmap: bitmap(2000, 1000), dpr: 2 });
    for (const value of Object.values(vp.dst)) expect(Math.abs(value * 2 - Math.round(value * 2))).toBeLessThan(1e-9);
  });

  it('is cheap at high zoom: the sampled window shrinks as the zoom grows', () => {
    const img = bitmap(4000, 2000);
    const at2 = viewportFor({ box, sheet, view: { z: 2, x: 0, y: 0 }, bitmap: img, dpr: 1 });
    const at8 = viewportFor({ box, sheet, view: { z: 8, x: 0, y: 0 }, bitmap: img, dpr: 1 });
    expect(at8.src.w).toBeLessThan(at2.src.w);
    expect(at8.src.w).toBeCloseTo(500, 3);
  });
});

describe('painting a scene', () => {
  it('draws each source once, with smoothing on', () => {
    const ctx = stubCtx();
    drawScene(ctx, {
      box,
      sheet,
      view: { z: 1, x: 0, y: 0 },
      sources: [{ bitmap: bitmap(1000, 500) }, { bitmap: bitmap(1000, 500), alpha: 0.6 }],
      background: '#0B0F14'
    });
    const draws = ctx.draws();
    expect(draws.length).toBe(2);
    expect(ctx.imageSmoothingEnabled).toBe(true);
    expect(ctx.imageSmoothingQuality).toBe(SMOOTHING_QUALITY);
    expect(ctx.calls.some((c) => c[0] === 'fillRect')).toBe(true);
  });

  it('draws a canvas-backed mask over the raster (the invisible-overlay regression)', () => {
    const ctx = stubCtx();
    const maskCanvas = { width: 512, height: 256 };
    drawScene(ctx, {
      box,
      sheet,
      view: { z: 1, x: 0, y: 0 },
      sources: [{ bitmap: bitmap(1000, 500) }],
      mask: { canvas: maskCanvas, width: 512, height: 256, alpha: 0.55 }
    });
    const draws = ctx.draws();
    expect(draws.length).toBe(2);
    expect(draws[1][0]).toBe(maskCanvas);
    // the mask is projected from sheet fractions, and drawn with its own alpha
    expect(draws[1].slice(1, 5)).toEqual([0, 0, 512, 256]);
    expect(draws[1].slice(5, 9)).toEqual([0, 150, 1000, 500]);
    expect(ctx.calls.filter((c) => c[0] === 'drawImage').length).toBe(2);
  });

  it('also accepts a raw {data,width,height} mask', () => {
    const ctx = stubCtx();
    const raw = { data: new Uint8Array(4 * 4), width: 4, height: 4 };
    drawScene(ctx, { box, sheet, view: { z: 1, x: 0, y: 0 }, sources: [], mask: raw });
    const draws = ctx.draws();
    expect(draws.length).toBe(1);
    expect(draws[0][0]).toBe(raw);
  });

  it('skips a source that has no decoded pixels yet', () => {
    const ctx = stubCtx();
    drawScene(ctx, { box, sheet, view: { z: 1, x: 0, y: 0 }, sources: [{ bitmap: null }, { bitmap: { width: 0, height: 0 } }] });
    expect(ctx.draws().length).toBe(0);
  });

  it('clips a swipe window instead of painting the whole sheet', () => {
    const ctx = stubCtx();
    drawScene(ctx, {
      box,
      sheet,
      view: { z: 1, x: 0, y: 0 },
      sources: [{ bitmap: bitmap(1000, 500), clipU: [0, 0.5] }]
    });
    // one clip for the container, one for the swipe window
    expect(ctx.calls.filter((c) => c[0] === 'clip').length).toBe(2);
  });
});
