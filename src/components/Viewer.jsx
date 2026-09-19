import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';
import { useApp } from '../state/AppState.jsx';
import {
  ATTRIBUTION,
  BUILTIN_POLYS,
  COMMENTS,
  CONFLICT_TYPES,
  DISAGREEMENT_CLUSTERS,
  LAYOVER_POLYS,
  PINS,
  SCENES,
  WATER_PATHS
} from '../data/mock.js';
import { elevAt, fmtLat, fmtLon, toGeo } from '../lib/geo.js';

function ModePills() {
  const { mode, setMode, blend, setBlend, sceneB } = useApp();
  const [blendOpen, setBlendOpen] = useState(false);

  const pill = (m, label) => (
    <button
      onClick={() => setMode(m)}
      className={`h-[26px] rounded-full px-3 text-[11px] font-semibold tracking-wide transition-colors ${
        mode === m ? 'bg-accent/20 text-accent' : 'text-t2 hover:text-t1'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="absolute left-3 top-3 z-20 flex items-center gap-2">
      <div className="flex items-center gap-0.5 rounded-full border border-edge bg-panel/90 p-0.5 backdrop-blur">
        {pill('optical', 'OPTICAL')}
        {pill('sar', 'SAR')}
        {sceneB && pill('change', 'CHANGE ΔT')}
      </div>
      <div className="relative">
        <button onClick={() => setBlendOpen((o) => !o)} className={`pill ${mode === 'blend' ? 'pill-active' : ''}`}>
          BLEND <span className="font-mono text-[10px]">{blend.toFixed(1)}</span>
        </button>
        {blendOpen && (
          <div className="recess absolute left-0 top-8 z-30 w-44 px-3 py-2.5">
            <div className="mb-1.5 flex justify-between font-mono text-[9.5px] text-t3">
              <span>OPT {blend.toFixed(2)}</span>
              <span>SAR {(1 - blend).toFixed(2)}</span>
            </div>
            <input
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
}

function ConflictLegend() {
  const { layers, conflictFilter, setConflictFilter, mode } = useApp();
  if (!layers.disagreement.on || mode === 'change') return null;
  const counts = DISAGREEMENT_CLUSTERS.reduce((a, c) => ((a[c.type] = (a[c.type] || 0) + 1), a), {});
  return (
    <div className="absolute right-3 top-3 z-20 flex flex-col items-end gap-1.5">
      <div className="pill !border-warn/40 !bg-warn/10 !text-warn">
        <Icon name="split" size={12} />
        optical ↔ SAR conflicts
      </div>
      <div className="flex max-w-[300px] flex-wrap justify-end gap-1">
        {Object.values(CONFLICT_TYPES).map((t) => (
          <button
            key={t.id}
            onClick={() => setConflictFilter(conflictFilter === t.id ? null : t.id)}
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
}

function Overlays() {
  const { mode, layers, conflictFilter, aoi, draftAoi } = useApp();
  const waterKey = mode === 'sar' ? 'sar' : 'optical';
  const clusters = DISAGREEMENT_CLUSTERS.filter((c) => !conflictFilter || c.type === conflictFilter);

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-10 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
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
            key={i}
            points={p}
            fill="#2DD4BF"
            fillOpacity="0.06"
            stroke="#2DD4BF"
            strokeOpacity="0.4"
            strokeWidth="0.22"
          />
        ))}

      {layers.layover.on &&
        LAYOVER_POLYS.map((p, i) => (
          <polygon
            key={i}
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
        clusters.map((c, i) => (
          <polygon
            key={i}
            points={c.pts}
            fill={CONFLICT_TYPES[c.type].color}
            fillOpacity="0.13"
            stroke={CONFLICT_TYPES[c.type].color}
            strokeOpacity="0.9"
            strokeWidth="0.28"
            strokeDasharray={c.type === 'temporal' ? '1.2 0.9' : undefined}
          />
        ))}

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
            <circle key={i} cx={p.u * 100} cy={p.v * 100} r="0.55" fill="#2DD4BF" />
          ))}
        </>
      )}
    </svg>
  );
}

function AttributionCard() {
  return (
    <div className="recess absolute bottom-14 left-3 z-20 w-[240px] px-3.5 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="lbl">Causal attribution</span>
        <span className="data-mono text-t3">ΔT 285 d</span>
      </div>
      {ATTRIBUTION.map((a) => (
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
      <div className="mt-1 text-[10px] text-t3">raw Δ +11.2 ha · genuine +2.1 ha</div>
    </div>
  );
}

export default function Viewer() {
  const {
    mode, blend, layers, queries, opticalFile, sceneB, bands,
    drawMode, setDrawMode, draftAoi, setDraftAoi, aoi, setAoi,
    tools, setTools, toast, swipe, setSwipe, setAttachOpen
  } = useApp();

  const ref = useRef(null);
  const [cursor, setCursor] = useState(() => toGeo(0.52, 0.55));
  const draggingSwipe = useRef(false);

  const analyzing = queries.some((q) => q.status === 'analyzing');
  const flaggedDone = queries.filter((q) => q.status === 'done' && q.payload.physics_check.flagged).length;
  const flags = flaggedDone + (layers.disagreement.on ? 1 : 0);

  const topLayer = useMemo(() => {
    const order = ['disagreement', 'water', 'builtin', 'layover'];
    const on = order.filter((k) => layers[k].on);
    return on.length ? layers[on[0]] : null;
  }, [layers]);

  const bandsOn = bands.filter((b) => b.on).length;

  // Enter closes the AOI draft, Esc cancels — same muscle memory as QGIS
  useEffect(() => {
    const onKey = (e) => {
      if (!drawMode) return;
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Enter' && draftAoi && draftAoi.length > 2) {
        setAoi(draftAoi);
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
    return {
      u: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      v: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    };
  };

  const onMove = (e) => {
    const uv = toUV(e);
    setCursor(toGeo(uv.u, uv.v));
    if (draggingSwipe.current) setSwipe(Math.min(96, Math.max(4, uv.u * 100)));
  };

  const onClick = (e) => {
    if (!drawMode) return;
    setDraftAoi([...(draftAoi || []), toUV(e)]);
  };

  const onDblClick = () => {
    if (drawMode && draftAoi && draftAoi.length > 2) {
      setAoi(draftAoi);
      setDraftAoi(null);
      setDrawMode(false);
      toast('AOI re-registered · extent recomputed');
    }
  };

  const img = (src, style) => (
    <img
      src={src}
      alt=""
      draggable={false}
      className="absolute inset-0 h-full w-full select-none object-cover"
      style={style}
    />
  );

  return (
    <div className="relative flex min-w-0 flex-1 flex-col bg-ink">
      <div
        ref={ref}
        className={`scanlines grain relative flex-1 overflow-hidden ${drawMode ? 'cursor-crosshair' : ''}`}
        onPointerMove={onMove}
        onPointerDown={() => {
          if (mode === 'change') draggingSwipe.current = true;
        }}
        onPointerUp={() => (draggingSwipe.current = false)}
        onPointerLeave={() => (draggingSwipe.current = false)}
        onClick={onClick}
        onDoubleClick={onDblClick}
      >
        {mode === 'optical' && img(opticalFile.src)}
        {mode === 'sar' && img(SCENES.sar.src)}
        {mode === 'blend' && (
          <>
            {img(SCENES.sar.src)}
            {img(opticalFile.src, { opacity: blend })}
          </>
        )}
        {mode === 'change' && sceneB && (
          <>
            {img(sceneB.src, { clipPath: `inset(0 ${100 - swipe}% 0 0)` })}
            {img(opticalFile.src, { clipPath: `inset(0 0 0 ${swipe}%)` })}
            <div
              className="absolute inset-y-0 z-20 w-[2px] cursor-ew-resize bg-t1/80"
              style={{ left: `${swipe}%` }}
              onPointerDown={(e) => {
                e.stopPropagation();
                draggingSwipe.current = true;
              }}
            >
              <div className="absolute left-1/2 top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-edge bg-panel text-t1">
                <Icon name="split" size={12} />
              </div>
            </div>
            <span className="data-mono absolute left-3 top-12 z-10 rounded bg-ink/70 px-1.5 py-0.5 text-t2">
              2024-11-02
            </span>
            <span className="data-mono absolute right-3 top-12 z-10 rounded bg-ink/70 px-1.5 py-0.5 text-t2">
              2025-08-14
            </span>
          </>
        )}

        <div className="viewer-vignette pointer-events-none absolute inset-0" />
        <Overlays />

        <span
          className="absolute z-10 -translate-y-full rounded-sm border border-white/25 bg-ink/80 px-1.5 py-0.5 text-[9.5px] font-semibold tracking-widest text-t1"
          style={{
            left: `${Math.min(...aoi.map((p) => p.u)) * 100}%`,
            top: `${Math.min(...aoi.map((p) => p.v)) * 100}%`
          }}
        >
          AOI
        </span>

        {tools.annotate &&
          PINS.map((p, i) => (
            <div key={i} className="absolute z-20" style={{ left: `${p.u * 100}%`, top: `${p.v * 100}%` }}>
              <span className="block h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-accent" />
              <span className="absolute left-2 top-1 whitespace-nowrap rounded border border-edge bg-panel/95 px-1.5 py-0.5 text-[10px] text-t2">
                {p.label}
              </span>
            </div>
          ))}

        {tools.comments && (
          <div className="recess absolute bottom-14 right-3 z-30 w-[260px] px-3.5 py-3">
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

        <ModePills />
        <ConflictLegend />

        {drawMode && (
          <div className="pill absolute left-1/2 top-3 z-30 -translate-x-1/2 !border-accent/40 !text-accent">
            {draftAoi?.length || 0} vertices · double-click or Enter closes · Esc cancels
          </div>
        )}

        <div className="absolute bottom-14 right-3 z-10">
          <span className="flex items-center gap-1 text-t2/90" title="scene north">
            <Icon name="north" size={12} />
            <span className="font-mono text-[9.5px]">N</span>
          </span>
        </div>

        <div className="absolute bottom-3 left-3 z-20 flex items-center gap-1.5">
          <span className="pill data-mono !text-accent">{fmtLat(cursor.lat)}</span>
          <span className="pill data-mono !text-accent">{fmtLon(cursor.lon)}</span>
          <span className="pill data-mono !text-t2">elev {elevAt(cursor.lat, cursor.lon)} m</span>
          <span className="ml-1 hidden items-end gap-1 xl:flex" title="2 km at scene scale">
            <span className="h-[5px] w-14 border-b border-l border-r border-t2/70" />
            <span className="data-mono text-t3">2 km</span>
          </span>
        </div>

        <div className="absolute bottom-3 right-3 z-20">
          <span className={`pill ${analyzing ? '!text-t2' : '!border-accent/40 !text-accent'}`}>
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
        <span className="flex items-center gap-1.5 text-[11.5px] text-t1">
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

        <div className="mx-1 h-5 w-px bg-white/10" />

        <div className="flex items-center gap-0.5">
          <button
            className={`icon-btn ${tools.fullscreen ? 'icon-btn-on' : ''}`}
            title="expand viewer (hides side panels)"
            onClick={() => setTools({ ...tools, fullscreen: !tools.fullscreen })}
          >
            <Icon name="expand" size={15} />
          </button>
          <button
            className={`icon-btn ${tools.annotate ? 'icon-btn-on' : ''}`}
            title="annotations"
            onClick={() => setTools({ ...tools, annotate: !tools.annotate })}
          >
            <Icon name="pen" size={15} />
          </button>
          <button
            className="icon-btn"
            title="attach second scene"
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
            onClick={() => setTools({ ...tools, comments: !tools.comments })}
          >
            <Icon name="comment" size={15} />
          </button>
        </div>

        <span className="data-mono ml-auto text-t3">{bandsOn} bands selected</span>
      </div>
    </div>
  );
}
