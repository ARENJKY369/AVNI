import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';
import { useApp } from '../state/AppState.jsx';
import {
  BUILTIN_POLYS,
  CHANGE_DELTA,
  COMMENTS,
  CONFLICT_TYPES,
  DISAGREEMENT_CLUSTERS,
  genuineChangeHa,
  LAYOVER_POLYS,
  PINS,
  WATER_PATHS
} from '../data/overlays.js';
import { clampView, drawScene, pointFromUv, uvFromPoint } from '../lib/scene-render.js';
import { maskToRgba, stopNote } from '../lib/segment.js';
import {
  fmtLat,
  fmtLon,
  gsdLabel,
  isGeoreferenced,
  SCENE_ASPECT,
  scaleBar,
  sheetSize,
  toGeo
} from '../lib/geo.js';

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

const clamp01 = (n) => Math.min(1, Math.max(0, n));

// A double-click arrives as one or two extra clicks at the same spot before
// the dblclick event. Collapsing near-identical neighbours keeps the closing
// vertex and loses the duplicates, whichever way the browser reports them.
const dedupeRing = (points, tol = 0.004) => {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.u - last.u, p.v - last.v) > tol) out.push(p);
  }
  if (out.length > 2) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a.u - b.u, a.v - b.v) <= tol) out.pop();
  }
  return out;
};

// In-viewer controls must never leak a click into the scene: in draw mode a
// click on these would otherwise drop an AOI vertex under the pill.
const stop = {
  onClick: (e) => e.stopPropagation(),
  onPointerDown: (e) => e.stopPropagation(),
  onDoubleClick: (e) => e.stopPropagation()
};

const ModePills = memo(function ModePills() {
  const { mode, setMode, blend, setBlend, sceneB } = useApp();
  const [blendOpen, setBlendOpen] = useState(false);

  const pill = (m, label) => (
    <button
      role="radio"
      aria-checked={mode === m}
      onClick={(e) => {
        e.stopPropagation();
        setMode(m);
      }}
      className={`h-[26px] rounded-full px-3 text-[11px] font-semibold tracking-wide transition-colors ${
        mode === m ? 'bg-accent/20 text-accent' : 'text-t2 hover:text-t1'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div {...stop} className="absolute left-3 top-3 z-20 flex items-center gap-2">
      <div
        role="radiogroup"
        aria-label="display source"
        className="flex items-center gap-0.5 rounded-full border border-edge bg-panel/90 p-0.5 backdrop-blur"
      >
        {pill('optical', 'OPTICAL')}
        {pill('sar', 'SAR')}
        {sceneB && pill('change', 'CHANGE ΔT')}
      </div>
      <div className="relative">
        <button
          onClick={() => setBlendOpen((o) => !o)}
          aria-expanded={blendOpen}
          aria-label="optical to SAR blend"
          className={`pill ${mode === 'blend' ? 'pill-active' : ''}`}
        >
          BLEND <span className="font-mono text-[10px]">{blend.toFixed(1)}</span>
        </button>
        {blendOpen && (
          <div className="recess absolute left-0 top-8 z-30 w-44 px-3 py-2.5">
            <label className="mb-1.5 flex justify-between font-mono text-[9.5px] text-t3" htmlFor="blend-range">
              <span>OPT {blend.toFixed(2)}</span>
              <span>SAR {(1 - blend).toFixed(2)}</span>
            </label>
            <input
              id="blend-range"
              aria-label="optical to SAR blend ratio"
              aria-valuetext={`optical ${blend.toFixed(2)}, SAR ${(1 - blend).toFixed(2)}`}
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={blend}
              onChange={(e) => {
                setBlend(parseFloat(e.target.value));
                setMode('blend');
              }}
              className="slim w-full"
            />
          </div>
        )}
      </div>
    </div>
  );
});

const ConflictLegend = memo(function ConflictLegend() {
  const { layers, conflictFilter, setConflictFilter, mode } = useApp();
  if (!layers.disagreement.on || mode === 'change') return null;
  const counts = DISAGREEMENT_CLUSTERS.reduce((a, c) => ((a[c.type] = (a[c.type] || 0) + 1), a), {});
  return (
    <div {...stop} className="absolute right-3 top-3 z-20 hidden flex-col items-end gap-1.5 md:flex">
      <div className="pill !border-warn/40 !bg-warn/10 !text-warn">
        <Icon name="split" size={12} />
        optical ↔ SAR conflicts
      </div>
      <div className="flex max-w-[300px] flex-wrap justify-end gap-1">
        {Object.values(CONFLICT_TYPES).map((t) => (
          <button
            key={t.id}
            onClick={() => setConflictFilter(conflictFilter === t.id ? null : t.id)}
            aria-pressed={conflictFilter === t.id}
            className={`chip !py-0.5 ${conflictFilter === t.id ? '!border-warn/60 !text-t1' : ''}`}
          >
            <span className="h-1.5 w-1.5 rounded-sm" style={{ background: t.color }} />
            {t.name}
            <span className="font-mono text-[9px] text-t3">{counts[t.id] || 0}</span>
          </button>
        ))}
      </div>
    </div>
  );
});

const Overlays = memo(function Overlays() {
  const { mode, layers, conflictFilter, aoi, draftAoi, segment } = useApp();
  const waterKey = mode === 'sar' ? 'sar' : 'optical';
  const clusters = DISAGREEMENT_CLUSTERS.filter((c) => !conflictFilter || c.type === conflictFilter);

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-10 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {layers.water.on && mode !== 'change' && (
        <>
          <path d={WATER_PATHS[waterKey]} fill="none" stroke="#2DD4BF" strokeOpacity="0.16" strokeWidth="5.5" />
          <path
            d={WATER_PATHS[waterKey]}
            fill="none"
            stroke="#2DD4BF"
            strokeOpacity="0.6"
            strokeWidth="0.35"
            strokeDasharray="2 1.4"
          />
        </>
      )}

      {layers.builtin.on &&
        mode !== 'change' &&
        BUILTIN_POLYS.map((p, i) => (
          <polygon
            key={p}
            points={p}
            fill="#2DD4BF"
            fillOpacity="0.06"
            stroke="#2DD4BF"
            strokeOpacity="0.4"
            strokeWidth="0.22"
          />
        ))}

      {layers.layover.on &&
        LAYOVER_POLYS.map((p) => (
          <polygon
            key={p}
            points={p}
            fill="#B48EF0"
            fillOpacity="0.1"
            stroke="#B48EF0"
            strokeOpacity="0.5"
            strokeWidth="0.22"
            strokeDasharray="1 0.8"
          />
        ))}

      {layers.disagreement.on &&
        mode !== 'change' &&
        clusters.map((c) => (
          <polygon
            key={c.pts}
            points={c.pts}
            fill={CONFLICT_TYPES[c.type].color}
            fillOpacity="0.13"
            stroke={CONFLICT_TYPES[c.type].color}
            strokeOpacity="0.9"
            strokeWidth="0.28"
            strokeDasharray={c.type === 'temporal' ? '1.2 0.9' : undefined}
          />
        ))}

      {segment?.ring?.length > 2 && (
        <g>
          <polygon
            points={segment.ring.map((p) => `${p.u * 100},${p.v * 100}`).join(' ')}
            fill="#2DD4BF"
            fillOpacity="0.1"
            stroke="#2DD4BF"
            strokeOpacity="0.95"
            strokeWidth="0.3"
          />
          {segment.ring.map((p, i) => (
            <circle key={`${p.u}-${p.v}-${i}`} cx={p.u * 100} cy={p.v * 100} r="0.42" fill="#2DD4BF" />
          ))}
        </g>
      )}

      <polygon
        points={aoi.map((p) => `${p.u * 100},${p.v * 100}`).join(' ')}
        fill="none"
        stroke="#E6EDF3"
        strokeOpacity="0.85"
        strokeWidth="0.24"
        strokeDasharray="1.6 1.1"
      />

      {draftAoi && draftAoi.length > 0 && (
        <>
          <polyline
            points={draftAoi.map((p) => `${p.u * 100},${p.v * 100}`).join(' ')}
            fill="none"
            stroke="#2DD4BF"
            strokeWidth="0.3"
          />
          {draftAoi.map((p, i) => (
            <circle key={`${p.u}-${p.v}-${i}`} cx={p.u * 100} cy={p.v * 100} r="0.55" fill="#2DD4BF" />
          ))}
        </>
      )}
    </svg>
  );
});

const AttributionCard = memo(function AttributionCard() {
  return (
    <div {...stop} className="recess absolute bottom-14 left-3 z-20 w-[240px] px-3.5 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="lbl">Causal attribution</span>
        <span className="data-mono text-t3">ΔT {CHANGE_DELTA.days} d</span>
      </div>
      {CHANGE_DELTA.attribution.map((a) => (
        <div key={a.cause} className="mb-1.5">
          <div className="mb-1 flex justify-between text-[10.5px]">
            <span className="text-t2">{a.cause}</span>
            <span className="data-mono text-t1">{a.pct}%</span>
          </div>
          <div className="h-[3px] rounded bg-edge">
            <div
              className="h-full rounded"
              style={{
                width: `${a.pct}%`,
                background: a.tone === 'accent' ? '#2DD4BF' : a.tone === 'warn' ? '#F5A623' : '#5B6B7A'
              }}
            />
          </div>
        </div>
      ))}
      <div className="mt-1 data-mono text-[10px] text-t3">
        raw Δ +{CHANGE_DELTA.rawDeltaHa} ha · genuine +{genuineChangeHa().toFixed(1)} ha
      </div>
    </div>
  );
});

export default function Viewer() {
  const {
    mode, blend, layers, queries, opticalFile, sceneB, bands,
    drawMode, setDrawMode, draftAoi, setDraftAoi, aoi, setAoi,
    tools, setTools, toast, swipe, setSwipe, setAttachOpen, sceneGeo,
    segmentMode, setSegmentMode, segTolerance, setSegTolerance, segment, segBusy,
    markRegion, applySegment, clearSegment, sceneSources
  } = useApp();

  const georef = isGeoreferenced(sceneGeo);

  const ref = useRef(null);
  const canvasRef = useRef(null);
  const maskCanvasRef = useRef(null);
  const [box, setBox] = useState({ w: 1200, h: 700 });
  const [cursor, setCursor] = useState(() => toGeo(0.52, 0.55));
  const [view, setView] = useState({ z: 1, x: 0, y: 0 });
  // where a keyboard user is about to drop an AOI vertex
  const [kbd, setKbd] = useState({ u: 0.5, v: 0.5 });
  const draggingSwipe = useRef(false);
  const panDrag = useRef(null);
  const cursorFrame = useRef(0);
  const pendingCursor = useRef(null);

  // The sheet is the declared footprint: the raster's aspect ratio, fitted
  // inside the viewer. Imagery is drawn *fill* into it, so a mask at u=0.3
  // sits on the same pixels as the lat/lon computed from u=0.3 — and the
  // optical and SAR rasters (different pixel sizes) land on the same grid.
  // The aspect belongs to the scene that is on screen: an upload used to be
  // stretched into the bundled fixture's rectangle.
  const aspect = useMemo(() => {
    const r = opticalFile?.raster;
    return r?.width > 0 && r?.height > 0 ? r.width / r.height : SCENE_ASPECT;
  }, [opticalFile?.raster]);
  const sheet = useMemo(() => sheetSize(box.w, box.h, aspect), [box.w, box.h, aspect]);
  const sheetRef = useRef(sheet);

  const analyzing = queries.some((q) => q.status === 'analyzing');
  const flaggedDone = queries.filter((q) => q.status === 'done' && q.payload.physics_check.flagged).length;
  const flags = flaggedDone + (layers.disagreement.on ? 1 : 0);

  const topLayer = useMemo(() => {
    const order = ['disagreement', 'water', 'builtin', 'layover'];
    const on = order.filter((k) => layers[k].on);
    return on.length ? layers[on[0]] : null;
  }, [layers]);

  const bandsOn = bands.filter((b) => b.on).length;

  // dragging pans in every mode except the swipe comparison; a click that
  // arrives at the end of a drag must not also mark a region
  const pannable = !drawMode && mode !== 'change';
  const panMoved = useRef(0);

  // what each display shows: an uploaded scene brings its own canvas, the
  // bundled demo scenes come from the rasterised cache
  const sources = useMemo(() => {
    const uploaded = opticalFile.uploaded && opticalFile.canvas
      ? { bitmap: opticalFile.canvas, width: opticalFile.raster?.width, height: opticalFile.raster?.height }
      : null;
    return {
      optical: uploaded || sceneSources.optical || null,
      sar: sceneSources.sar || null,
      epochB: sceneB?.canvas
        ? { bitmap: sceneB.canvas, width: sceneB.raster?.width, height: sceneB.raster?.height }
        : sceneSources.opticalB || null
    };
  }, [opticalFile, sceneB, sceneSources]);

  const drawSources = useMemo(() => {
    const opt = sources.optical;
    const sar = sources.sar;
    const epoch = sources.epochB;
    if (mode === 'sar' && sar) return [{ bitmap: sar.bitmap }];
    if (mode === 'blend' && sar && opt) return [{ bitmap: sar.bitmap }, { bitmap: opt.bitmap, alpha: blend }];
    if (mode === 'change' && epoch && opt) {
      const edge = swipe / 100;
      return [
        { bitmap: opt.bitmap, clipU: [edge, 1] },
        { bitmap: epoch.bitmap, clipU: [0, edge] }
      ];
    }
    return opt ? [{ bitmap: opt.bitmap }] : [];
  }, [mode, blend, swipe, sources]);

  // keep the scene box measured so pan bounds and the scale bar stay honest
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    sheetRef.current = sheet;
  }, [sheet]);

  // wheel zoom, anchored on the pointer. Native listener on purpose —
  // React attaches wheel passively, so preventDefault() is a no-op there.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const cu = (e.clientX - r.left) / r.width;
      const cv = (e.clientY - r.top) / r.height;
      const factor = Math.exp(-e.deltaY * 0.0018);
      setView((v) => {
        const { w, h } = sheetRef.current;
        const z2 = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.z * factor));
        if (Math.abs(z2 - v.z) < 1e-4) return v;
        // sheet fraction under the pointer, then re-solve the pan so the same
        // ground point stays under the pointer at the new zoom
        const su = 0.5 + ((cu - 0.5) * r.width - v.x) / (w * v.z);
        const sv = 0.5 + ((cv - 0.5) * r.height - v.y) / (h * v.z);
        const p = {
          x: (cu - 0.5) * r.width - (su - 0.5) * w * z2,
          y: (cv - 0.5) * r.height - (sv - 0.5) * h * z2
        };
        const next = clampView({ z: z2, ...p }, box, sheetRef.current);
        return { z: next.z, x: next.x, y: next.y };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // `box` is a dependency: clampView needs the *current* container size, and
    // a listener captured at mount would clamp against the first measurement
  }, [box]);

  // The mask is built once per segmentation and kept as a canvas so the
  // renderer can project it exactly like the imagery it came from.
  const maskDrawable = useMemo(() => {
    if (!segment?.mask) return null;
    if (typeof document === 'undefined') return null;
    const { data, width, height } = segment.mask;
    const canvas = maskCanvasRef.current || document.createElement('canvas');
    maskCanvasRef.current = canvas;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.putImageData(new ImageData(maskToRgba(data, width, height), width, height), 0, 0);
    return { canvas, width, height, alpha: 0.55 };
  }, [segment]);

  // Paint the scene. This is the zoom fix: the imagery is *sampled* at the
  // current zoom with high-quality smoothing and pixel-snapped translation,
  // instead of being a composited CSS-scaled layer (which is what tore apart
  // when magnified).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !box.w || !box.h) return;
    const dpr = Math.min(2.5, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const pw = Math.max(1, Math.round(box.w * dpr));
    const ph = Math.max(1, Math.round(box.h * dpr));
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    drawScene(ctx, {
      box,
      sheet,
      view,
      dpr,
      sources: drawSources,
      mask: maskDrawable,
      background: '#0B0F14'
    });
  }, [box, sheet, view, drawSources, maskDrawable]);

  const zoomBy = useCallback((f) => {
    setView((v) => {
      const z2 = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.z * f));
      if (z2 <= MIN_ZOOM + 1e-4) return { z: 1, x: 0, y: 0 };
      const next = clampView({ z: z2, x: v.x * (z2 / v.z), y: v.y * (z2 / v.z) }, box, sheetRef.current);
      return { z: next.z, x: next.x, y: next.y };
    });
  }, [box]);
  const fitScene = useCallback(() => setView({ z: 1, x: 0, y: 0 }), []);

  // +/- zoom, 0 fits the scene — same map muscle memory as QGIS
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (e.key === '+' || e.key === '=') zoomBy(1.4);
      else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.4);
      else if (e.key === '0') fitScene();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomBy, fitScene]);

  const inv = 1 / view.z;

  // Scale bar: drawn length and labelled distance are the same measurement.
  // The bar is drawn from the *scene's* extent: with the bundled footprint as a
  // default it stayed honest only until you uploaded something 45x smaller,
  // where it still claimed 1 km across a 0.5 km scene.
  const bar = useMemo(
    () => (georef ? scaleBar({ extent: sceneGeo.extent, sheetWidthPx: sheet.w, zoom: view.z }) : null),
    [georef, sceneGeo.extent, sheet.w, view.z]
  );

  const closeAoi = (points) => {
    const cleaned = points && points.length ? dedupeRing(points) : points;
    if (cleaned && cleaned.length > 2) {
      points = cleaned;
      setAoi(points);
      setDraftAoi(null);
      setDrawMode(false);
      toast('AOI re-registered · extent recomputed');
    } else {
      setDraftAoi(null);
      setDrawMode(false);
      toast('AOI needs at least 3 vertices — draft discarded');
    }
  };

  // Enter closes the AOI draft, Esc cancels — same muscle memory as QGIS
  useEffect(() => {
    const onKey = (e) => {
      if (!drawMode) return;
      if (isTypingTarget(e.target)) return;
      if (e.key === 'Enter' && draftAoi && dedupeRing(draftAoi).length > 2) {
        setAoi(dedupeRing(draftAoi));
        setDraftAoi(null);
        setDrawMode(false);
        toast('AOI re-registered · extent recomputed');
      } else if (e.key === 'Escape') {
        setDraftAoi(null);
        setDrawMode(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawMode, draftAoi, setAoi, setDraftAoi, setDrawMode, toast]);

  const toUV = (e) => {
    const r = ref.current.getBoundingClientRect();
    return uvFromPoint({
      box,
      sheet,
      view,
      point: { x: e.clientX - r.left, y: e.clientY - r.top }
    });
  };

  // cursor readout is throttled to one state update per frame: pointermove
  // fires far faster than a paint, and this used to re-render the overlays
  // on every event
  const onMove = (e) => {
    const uv = toUV(e);
    pendingCursor.current = toGeo(uv.u, uv.v, sceneGeo);
    if (!cursorFrame.current) {
      cursorFrame.current = requestAnimationFrame(() => {
        cursorFrame.current = 0;
        if (pendingCursor.current) setCursor(pendingCursor.current);
      });
    }
    if (draggingSwipe.current) setSwipe(Math.min(96, Math.max(4, uv.u * 100)));

    const d = panDrag.current;
    if (!d) return;
    panMoved.current += Math.abs(e.clientX - d.px) + Math.abs(e.clientY - d.py);
    setView((v) =>
      clampView({ z: v.z, x: d.x + (e.clientX - d.px), y: d.y + (e.clientY - d.py) }, box, sheet)
    );
  };

  useEffect(() => () => cancelAnimationFrame(cursorFrame.current), []);

  const onClick = (e) => {
    // a click that ended a pan is not a marking gesture
    if (panMoved.current > 4) {
      panMoved.current = 0;
      return;
    }
    if (!drawMode && !segmentMode) return;
    const uv = toUV(e);
    if (!uv.inside) return;
    if (segmentMode) {
      const op = e.shiftKey ? 'add' : e.altKey || e.metaKey ? 'subtract' : 'replace';
      markRegion({
        u: uv.u,
        v: uv.v,
        op,
        which: mode === 'sar' ? 'sar' : mode === 'change' ? 'change' : 'optical'
      });
      return;
    }
    setDraftAoi([...(draftAoi || []), { u: uv.u, v: uv.v }]);
  };

  const onDblClick = (e) => {
    if (!drawMode) return;
    e.preventDefault();
    const pts = dedupeRing(draftAoi || []);
    if (pts.length > 2) closeAoi(pts);
    else {
      setDraftAoi(pts);
      toast('keep clicking — the AOI needs 3 vertices, double-click to close');
    }
  };

  // Keyboard path for the scene: arrows pan, +/- zoom, 0 fits, d draws a
  // polygon, s segments a region. In draw/segment mode the same arrow keys
  // move a crosshair and Enter acts on it, so an AOI can be marked without a
  // pointing device.
  const onCanvasKeyDown = (e) => {
    const step = e.shiftKey ? 0.06 : 0.02;
    if (drawMode || segmentMode) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (segmentMode) {
          if (segment) applySegment();
          else markRegion({ u: kbd.u, v: kbd.v, which: mode === 'sar' ? 'sar' : 'optical' });
        } else {
          setDraftAoi((prev) => [...(prev || []), { ...kbd }]);
          toast('vertex placed · Enter adds another, c closes the ring');
        }
        return;
      }
      if (drawMode && (e.key === 'c' || e.key === 'C')) {
        const pts = dedupeRing([...(draftAoi || [])]);
        if (pts.length > 2) closeAoi(pts);
        else toast('the AOI needs at least 3 vertices');
        return;
      }
      if (segmentMode && (e.key === '[' || e.key === ']')) {
        e.preventDefault();
        const next = Math.min(80, Math.max(8, segTolerance + (e.key === ']' ? 4 : -4)));
        setSegTolerance(next);
        toast(`segmentation tolerance ${next}`);
        return;
      }
      const moves = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step]
      };
      if (moves[e.key] && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const [du, dv] = moves[e.key];
        setKbd((k) => ({ u: clamp01(k.u + du), v: clamp01(k.v + dv) }));
        return;
      }
    }

    const panKeys = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    if (!drawMode && !segmentMode && panKeys[e.key] && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const [dx, dy] = panKeys[e.key];
      const px = 60 * (e.shiftKey ? 3 : 1);
      setView((v) => clampView({ z: v.z, x: v.x + dx * px, y: v.y + dy * px }, box, sheet));
      return;
    }

    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      zoomBy(1.4);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      zoomBy(1 / 1.4);
    } else if (e.key === '0') {
      e.preventDefault();
      fitScene();
    } else if (e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      setSegmentMode(false);
      setDrawMode(true);
      toast('draw mode · arrows move the crosshair, Enter places a vertex');
    } else if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      setDrawMode(false);
      setSegmentMode(true);
      toast('segment mode · click the region you mean; shift adds, alt subtracts');
    } else if (e.key === 'Escape' && segment) {
      clearSegment();
      toast('segmented region discarded');
    }
  };

  const gsd = gsdLabel(sceneGeo.extent || undefined, opticalFile.raster || undefined);

  // the keyboard crosshair and the swipe divider are drawn on the same
  // projection the imagery uses
  const kbdPoint = pointFromUv({ box, sheet, view, uv: kbd });
  const swipePoint = pointFromUv({ box, sheet, view, uv: { u: swipe / 100, v: 0.5 } });

  return (
    <div className="relative flex min-w-0 flex-1 flex-col bg-ink">
      <div
        ref={ref}
        id="scene-region"
        role="application"
        tabIndex={0}
        aria-label="scene viewer"
        aria-describedby="scene-help"
        onKeyDown={onCanvasKeyDown}
        className={`scanlines grain relative flex-1 overflow-hidden outline-none focus-visible:ring-1 focus-visible:ring-accent/60 ${
          drawMode ? 'cursor-crosshair' : pannable ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
        onPointerDown={(e) => {
          if (mode === 'change') {
            draggingSwipe.current = true;
            return;
          }
          if (!pannable) return;
          panMoved.current = 0;
          panDrag.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y };
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* older engines */
          }
        }}
        onPointerMove={onMove}
        onPointerUp={(e) => {
          draggingSwipe.current = false;
          panDrag.current = null;
          if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onPointerLeave={() => {
          draggingSwipe.current = false;
          panDrag.current = null;
        }}
        onClick={onClick}
        onDoubleClick={onDblClick}
      >
        {/* the scene raster: one canvas, sampled at the current zoom (see
            drawScene — this is what stopped the imagery tearing apart) */}
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="absolute inset-0 h-full w-full"
          style={{ width: '100%', height: '100%' }}
        />

        {!sources.optical && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-recess/80 px-6 text-center">
            <Icon name="warn" size={18} className="text-warn" />
            <span className="text-[12px] font-semibold text-t1">
              {opticalFile.file ? `no renderable preview for ${opticalFile.file}` : 'no scene registered'}
            </span>
            <span className="max-w-[360px] text-[10.5px] leading-4 text-t2">
              AVNI reads GeoTIFF/COG, JPEG2000 and Sentinel SAFE directly. A file it cannot decode is
              never shown under the previous scene's pixels — register a readable raster, or fix the
              one that failed.
            </span>
          </div>
        )}

        {/* the sheet — overlays, labels and the AOI share this one projection */}
        <div
          className="absolute border border-white/10"
          style={{
            left: (box.w - sheet.w) / 2,
            top: (box.h - sheet.h) / 2,
            width: sheet.w,
            height: sheet.h,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
            transformOrigin: '50% 50%',
            pointerEvents: 'none'
          }}
        >
          <Overlays />

          {/* labels counter-scale so annotation stays legible at any zoom */}
          <span
            className="absolute z-10 rounded-sm border border-white/25 bg-ink/80 px-1.5 py-0.5 text-[9.5px] font-semibold tracking-widest text-t1"
            style={{
              left: `${Math.min(...aoi.map((p) => p.u)) * 100}%`,
              top: `${Math.min(...aoi.map((p) => p.v)) * 100}%`,
              transform: `translateY(-100%) scale(${inv})`,
              transformOrigin: 'left bottom'
            }}
          >
            AOI
          </span>

          {segment?.seed && (
            <span
              aria-hidden="true"
              className="absolute z-10 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent bg-ink"
              style={{ left: `${segment.seed.u * 100}%`, top: `${segment.seed.v * 100}%` }}
            />
          )}

          {tools.annotate &&
            PINS.map((p, i) => (
              <div
                key={i}
                className="absolute z-20"
                style={{
                  left: `${p.u * 100}%`,
                  top: `${p.v * 100}%`,
                  transform: `scale(${inv})`,
                  transformOrigin: '0 0'
                }}
              >
                <span className="block h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-accent" />
                <span className="absolute left-2 top-1 whitespace-nowrap rounded border border-edge bg-panel/95 px-1.5 py-0.5 text-[10px] text-t2">
                  {p.label}
                </span>
              </div>
            ))}
        </div>

        {/* HUD — sits above the sheet, never scales */}
        <div className="viewer-vignette pointer-events-none absolute inset-0" />

        {mode === 'change' && sceneB && (
          <div
            {...stop}
            className="absolute inset-y-0 z-20 cursor-ew-resize"
            style={{ left: `${swipePoint.x}px`, width: 1 }}
            onPointerDown={(e) => {
              e.stopPropagation();
              draggingSwipe.current = true;
            }}
          >
            <span className="absolute inset-y-0 left-0 w-px bg-t1/80" />
            <span className="absolute left-0 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-edge bg-panel p-1 text-t1">
              <Icon name="split" size={12} />
            </span>
            <span className="data-mono absolute left-2 top-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-ink/80 px-1 py-0.5 text-[9.5px] text-t2">
              {Math.round(swipe)}% · A | B
            </span>
          </div>
        )}

        {mode === 'change' && sceneB && (
          <>
            <span className="data-mono absolute left-3 top-12 z-10 rounded bg-ink/70 px-1.5 py-0.5 text-t2">
              {CHANGE_DELTA.epochA.slice(0, 10)}
            </span>
            <span className="data-mono absolute right-3 top-12 z-10 rounded bg-ink/70 px-1.5 py-0.5 text-t2">
              {CHANGE_DELTA.epochB.slice(0, 10)}
            </span>
            {sceneB.note && (
              <span className="pill absolute left-1/2 top-12 z-20 hidden -translate-x-1/2 !border-warn/40 !bg-warn/10 !text-warn sm:inline-flex">
                <Icon name="warn" size={11} />
                {sceneB.note}
              </span>
            )}
          </>
        )}

        {tools.comments && (
          <div {...stop} className="recess absolute bottom-14 right-3 z-30 w-[260px] px-3.5 py-3">
            {COMMENTS.map((c, i) => (
              <div key={i}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-t1">{c.who}</span>
                  <span className="data-mono text-[9.5px] text-t3">{c.when}</span>
                </div>
                <p className="text-[11px] leading-[17px] text-t2">{c.text}</p>
              </div>
            ))}
          </div>
        )}

        <p id="scene-help" className="sr-only">
          Scene viewer. Arrow keys pan, plus and minus zoom, zero fits the footprint, d starts an
          AOI draw and s starts segmentation. In segment mode clicking a region grows a mask and
          traces it; shift adds a second region, alt subtracts, Enter applies it as the AOI,
          bracket keys change the tolerance and Escape discards it. In draw mode the arrow keys move
          a crosshair, Enter places a vertex and c closes the ring.
        </p>

        <ModePills />
        <ConflictLegend />

        {drawMode && (
          <div
            {...stop}
            className="pill absolute left-3 top-12 z-30 hidden max-w-[92%] text-center !border-accent/40 !text-accent sm:inline-flex"
          >
            {draftAoi?.length || 0} vertices · click, or arrows + Enter · c or double-click closes
          </div>
        )}

        {segmentMode && (
          <div
            {...stop}
            className="recess absolute left-3 top-12 z-30 flex w-[min(440px,90%)] flex-col gap-2 px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="pill !border-accent/50 !bg-accent/10 !text-accent">
                <Icon name="crosshair" size={12} />
                {segBusy ? 'segmenting…' : segment ? 'region traced' : 'segment mode'}
              </span>
              <span className="hidden text-[11px] text-t2 sm:inline">
                {segment
                  ? [
                      `${segment.stats.outlineVertices} vertices`,
                      `${(segment.stats.coverage * 100).toFixed(1)}% of the scene`,
                      stopNote(segment)
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : 'click the water, the crop, the built-up block — shift adds, alt subtracts'}
              </span>
              <span className="ml-auto flex items-center gap-1.5">
                <label className="flex items-center gap-1.5 text-[10px] text-t3" htmlFor="seg-tolerance">
                  TOL
                  <input
                    id="seg-tolerance"
                    type="range"
                    min="8"
                    max="80"
                    step="2"
                    value={segTolerance}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setSegTolerance(next);
                      if (segment?.seed) {
                        markRegion({
                          u: segment.seed.u,
                          v: segment.seed.v,
                          op: segment.op || 'replace',
                          tolerance: next
                        });
                      }
                    }}
                    className="slim w-24"
                    aria-valuetext={`tolerance ${segTolerance}`}
                  />
                </label>
                <button
                  className="icon-btn !h-6"
                  title="apply the segmented region as the AOI (Enter)"
                  aria-label="use the segmented region as the AOI"
                  disabled={!segment}
                  onClick={() => applySegment()}
                >
                  <Icon name="check" size={14} />
                </button>
                <button
                  className="icon-btn !h-6"
                  title="clear the segmented region (Escape)"
                  aria-label="clear the segmented region"
                  disabled={!segment}
                  onClick={() => clearSegment()}
                >
                  <Icon name="x" size={14} />
                </button>
                <button
                  className="icon-btn !h-6"
                  title="leave segment mode"
                  aria-label="leave segment mode"
                  onClick={() => setSegmentMode(false)}
                >
                  <Icon name="chevron" size={14} />
                </button>
              </span>
            </div>
          </div>
        )}

        {drawMode && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2 text-accent"
            style={{ left: `${kbdPoint.x}px`, top: `${kbdPoint.y}px` }}
          >
            <Icon name="crosshair" size={16} sw={1.6} />
          </span>
        )}

        <div {...stop} className="absolute bottom-14 right-3 z-10">
          <span className="flex items-center gap-1 text-t2/90" title="scene north">
            <Icon name="north" size={12} />
            <span className="font-mono text-[9.5px]">N</span>
          </span>
        </div>

        <div
          {...stop}
          aria-hidden="true"
          className="absolute bottom-3 left-3 z-20 flex flex-wrap items-center gap-1.5"
        >
          {georef ? (
            <>
              <span className="pill data-mono !text-accent">{fmtLat(cursor.lat)}</span>
              <span className="pill data-mono !text-accent">{fmtLon(cursor.lon)}</span>
              <span
                className="pill data-mono !text-t2 max-sm:hidden"
                title="ground sample distance computed from the declared footprint and the raster"
              >
                {gsd}
              </span>
              <span
                className="ml-1 hidden items-end gap-1 xl:flex"
                title={`scale bar · ${Math.round(view.z * 100)}% zoom · 1 px = ${(bar?.kmPerPx * 1000).toFixed(1)} m`}
              >
                <span
                  className="border-b border-l border-r border-t2/70"
                  style={{ height: 5, width: `${bar?.px}px` }}
                />
                <span className="data-mono text-t3">{bar?.label}</span>
              </span>
            </>
          ) : (
            <span className="pill !border-warn/50 !bg-warn/10 !text-warn" title={sceneGeo.source}>
              <Icon name="warn" size={12} />
              unlocated · no coordinates reported
            </span>
          )}
        </div>

        <div {...stop} className="absolute bottom-3 right-3 z-20 flex items-center gap-1.5">
          <span className="pill hidden data-mono !text-t3 sm:inline-flex">
            {Math.round(view.z * 100)}%
          </span>
          <span className={`pill ${analyzing ? '!text-t2' : '!border-accent/40 !text-accent'}`} role="status">
            <span className={analyzing ? 'spin-slow inline-flex' : 'inline-flex'}>
              <Icon name="refresh" size={12} />
            </span>
            {analyzing ? 'analysis running' : 'cross-check ready'}
          </span>
        </div>

        {mode === 'change' && <AttributionCard />}
      </div>

      {/* bottom toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-3 border-t hair bg-panel px-3">
        <span className="lbl">Display</span>
        <span className="hidden items-center gap-1.5 text-[11.5px] text-t1 2xl:flex">
          {topLayer ? (
            <>
              <Icon
                name={
                  topLayer.id === 'water'
                    ? 'droplet'
                    : topLayer.id === 'builtin'
                    ? 'grid'
                    : topLayer.id === 'disagreement'
                    ? 'split'
                    : 'radar'
                }
                size={13}
                className={topLayer.id === 'disagreement' ? 'text-warn' : 'text-accent'}
              />
              {topLayer.name}
            </>
          ) : (
            <span className="text-t3">base scene only</span>
          )}
        </span>

        <button
          className={`icon-btn ${flags ? 'text-warn' : 'text-t3'}`}
          title={flags ? `${flags} open verification flags` : 'no open flags'}
          aria-label={flags ? `${flags} open verification flags` : 'no open flags'}
          onClick={() =>
            toast(
              flags
                ? `${flags} open verification flags — physics checks live in the query panel`
                : 'no open verification flags'
            )
          }
        >
          <Icon name="warn" size={15} />
        </button>

        <div className="mx-1 hidden h-5 w-px bg-white/10 md:block" />

        <div className="hidden items-center gap-0.5 sm:flex">
          <button
            className={`icon-btn ${tools.fullscreen ? 'icon-btn-on' : ''}`}
            title="expand viewer (hides side panels)"
            aria-label="expand viewer"
            aria-pressed={tools.fullscreen}
            onClick={() => setTools({ ...tools, fullscreen: !tools.fullscreen })}
          >
            <Icon name="expand" size={15} />
          </button>
          <button
            className={`icon-btn ${segmentMode ? 'icon-btn-on' : ''}`}
            title="segment a region into an AOI (s)"
            aria-label="segment a region into an AOI"
            aria-pressed={segmentMode}
            onClick={() => {
              setDrawMode(false);
              setSegmentMode(!segmentMode);
            }}
          >
            <Icon name="crosshair" size={15} />
          </button>
          <button
            className={`icon-btn ${drawMode ? 'icon-btn-on' : ''}`}
            title="draw an AOI vertex by vertex (d)"
            aria-label="draw an AOI polygon"
            aria-pressed={drawMode}
            onClick={() => {
              setSegmentMode(false);
              setDrawMode(!drawMode);
            }}
          >
            <Icon name="pen" size={15} />
          </button>
          <button
            className={`icon-btn ${tools.annotate ? 'icon-btn-on' : ''}`}
            title="annotations"
            aria-label="annotations"
            aria-pressed={tools.annotate}
            onClick={() => setTools({ ...tools, annotate: !tools.annotate })}
          >
            <Icon name="pen" size={15} />
          </button>
          <button
            className="icon-btn"
            title="attach second scene"
            aria-label="attach second scene"
            onClick={() => {
              setAttachOpen(true);
              toast('attach a second epoch to unlock CHANGE ΔT');
            }}
          >
            <Icon name="paperclip" size={15} />
          </button>
          <button
            className={`icon-btn ${tools.comments ? 'icon-btn-on' : ''}`}
            title="field comments"
            aria-label="field comments"
            aria-pressed={tools.comments}
            onClick={() => setTools({ ...tools, comments: !tools.comments })}
          >
            <Icon name="comment" size={15} />
          </button>
        </div>

        <div className="mx-1 hidden h-5 w-px bg-white/10 md:block" />

        {/* zoom — wheel also works; these are the deliberate, clickable controls */}
        <div className="flex items-center gap-0.5">
          <button className="icon-btn" title="zoom out (−)" aria-label="zoom out" onClick={() => zoomBy(1 / 1.4)}>
            <Icon name="minus" size={15} />
          </button>
          <button
            className={`icon-btn w-10 data-mono text-[10.5px] ${view.z > 1.01 ? 'text-accent' : 'text-t3'}`}
            title="fit scene to view (0)"
            aria-label="fit scene to view"
            onClick={fitScene}
          >
            {Math.round(view.z * 100)}%
          </button>
          <button className="icon-btn" title="zoom in (+)" aria-label="zoom in" onClick={() => zoomBy(1.4)}>
            <Icon name="plus" size={15} />
          </button>
        </div>

        <button
          className={`icon-btn sm:hidden ${tools.fullscreen ? 'icon-btn-on' : ''}`}
          title="expand viewer (hides side panels)"
          aria-label="expand viewer"
          onClick={() => setTools({ ...tools, fullscreen: !tools.fullscreen })}
        >
          <Icon name="expand" size={15} />
        </button>

        <span className="data-mono ml-auto hidden text-t3 sm:inline">{bandsOn} bands selected</span>
      </div>
    </div>
  );
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}
