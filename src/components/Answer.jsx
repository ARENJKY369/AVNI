import { useState } from 'react';
import { Icon } from './Icons.jsx';
import { Ring, DbScale } from './ui.jsx';
import { useApp } from '../state/AppState.jsx';
import { ABSTAIN_GATE } from '../lib/model.js';
import { SCENES } from '../data/mock.js';
import {
  aoiAreaKm2,
  aoiCentroid,
  fmtLat,
  fmtLon,
  isGeoreferenced,
  utmBlock
} from '../lib/geo.js';
import { exportAnswerGeoJSON, exportAnswerJSON, exportAnswerMarkdown } from '../lib/export.js';
import { exportAnswerPDF } from '../lib/report.js';
import { reportSnapshot } from '../lib/report-map.js';

// The export row: both downloads are buttons on the card, not items behind a
// menu — a report you cannot find is a report nobody files. The PDF is the
// primary action, the geometry export sits next to it, and the two older
// text exports stay visible as small chips.
function ExportRow({ payload, query, centroid, georef, aoiPoints }) {
  const {
    toast, sceneGeo, opticalFile, sceneB, sceneSources, layers, aoi, segment, mode, blend, swipe
  } = useApp();
  const [busy, setBusy] = useState(null);

  // what the viewer has on screen, in the viewer's own draw order
  const drawSources = () => {
    const uploaded =
      opticalFile.uploaded && opticalFile.canvas ? { bitmap: opticalFile.canvas } : null;
    const optical = uploaded || sceneSources.optical || null;
    const sar = sceneSources.sar || null;
    const epoch = sceneB?.canvas ? { bitmap: sceneB.canvas } : sceneSources.opticalB || null;
    if (mode === 'sar' && sar) return [sar];
    if (mode === 'blend' && sar && optical) return [sar, { bitmap: optical.bitmap, alpha: blend }];
    if (mode === 'change' && epoch && optical) {
      const edge = swipe / 100;
      return [
        { bitmap: optical.bitmap, clipU: [edge, 1] },
        { bitmap: epoch.bitmap, clipU: [0, edge] }
      ];
    }
    return optical ? [optical] : [];
  };

  const reportScenes = () => {
    const rows = [
      {
        role: 'primary scene',
        file: opticalFile.file,
        sensor: opticalFile.sensor,
        label: opticalFile.uploaded ? opticalFile.formatLabel || opticalFile.label : opticalFile.label,
        acquired: opticalFile.acquired || null
      },
      { role: 'SAR scene', ...SCENES.sar }
    ];
    if (sceneB) {
      rows.push({
        role: 'second epoch',
        file: sceneB.file,
        sensor: sceneB.sensor,
        label: sceneB.label,
        acquired: sceneB.acquired || null
      });
    }
    return rows;
  };

  const downloadPdf = async () => {
    setBusy('pdf');
    try {
      // the snapshot is best-effort: a report without its map still beats no
      // report, and the document says which one you are holding
      let snapshot = null;
      try {
        snapshot = await reportSnapshot({
          sources: drawSources(),
          mask: segment?.mask || null,
          layers,
          aoi,
          segment,
          geo: sceneGeo,
          mode
        });
      } catch {
        snapshot = null;
      }
      const { filename } = await exportAnswerPDF({
        payload,
        query,
        geo: sceneGeo,
        centroid,
        aoiPoints,
        scenes: reportScenes(),
        raster: opticalFile?.raster || null,
        snapshot
      });
      toast(`result exported · ${filename}`);
    } catch (e) {
      toast(`report failed · ${e?.message || 'could not compose the PDF'}`);
    } finally {
      setBusy(null);
    }
  };

  const downloadGeoJSON = () => {
    const written = exportAnswerGeoJSON(payload, sceneGeo, centroid, aoiPoints);
    toast(written ? 'result exported · GeoJSON footprint' : 'withheld — the scene is not georeferenced');
  };

  const downloadBundle = () => {
    exportAnswerJSON(payload, sceneGeo, centroid, aoiPoints, opticalFile?.raster || null);
    toast('result exported · JSON evidence bundle');
  };

  const downloadMarkdown = () => {
    exportAnswerMarkdown(payload, sceneGeo, centroid, aoiPoints);
    toast('result exported · Markdown report');
  };

  const primary =
    'no-print flex items-center gap-1.5 rounded-md border border-accent/50 bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent transition-colors hover:bg-accent/20 disabled:cursor-wait disabled:opacity-60';
  const secondary = 'chip no-print !text-[10.5px]';

  return (
    <div className="no-print mb-2 flex flex-wrap items-center justify-end gap-1.5">
      <button className={primary} onClick={downloadPdf} disabled={busy === 'pdf'} title="compose a printable PDF field report from this result">
        <Icon name="download" size={11} />
        {busy === 'pdf' ? 'composing report…' : 'Download report (PDF)'}
      </button>
      <button
        className={`${primary} ${georef ? '' : 'cursor-not-allowed opacity-40'}`}
        onClick={downloadGeoJSON}
        disabled={!georef}
        title={georef ? 'answer footprint as GeoJSON' : 'withheld — scene is not georeferenced'}
      >
        <Icon name="download" size={11} />
        Download GeoJSON
      </button>
      <button className={secondary} onClick={downloadBundle} title="full payload as JSON">
        <span className="data-mono text-t3">.json</span>
        evidence bundle
      </button>
      <button className={secondary} onClick={downloadMarkdown} title="the same result as Markdown">
        <span className="data-mono text-t3">.md</span>
        analyst report
      </button>
    </div>
  );
}

function Analyzing({ stages, stage }) {
  const list = stages || [];
  return (
    <div className="answer-card answer-in px-3.5 py-3" role="status" aria-live="polite">
      <div className="mb-2 flex items-center gap-1.5 text-t2">
        <span className="flex gap-0.5">
          <span className="dot-blink h-1 w-1 rounded-full bg-accent" />
          <span className="dot-blink h-1 w-1 rounded-full bg-accent" />
          <span className="dot-blink h-1 w-1 rounded-full bg-accent" />
        </span>
        <span className="text-[11px]">interrogating scene</span>
      </div>
      <ul className="space-y-1">
        {list.slice(0, stage).map((s) => (
          <li key={s} className="data-mono flex items-center gap-2 text-t3">
            <Icon name="check" size={10} className="text-accent" />
            {s}
          </li>
        ))}
        {stage < list.length && (
          <li className="data-mono flex items-center gap-2 text-t2">
            <span className="h-2 w-2 rounded-full border border-accent/60 border-t-transparent spin-slow" />
            {list[stage]}
          </li>
        )}
      </ul>
      <div className="mt-2.5 h-[2px] overflow-hidden rounded bg-edge">
        <div className="sweep-bar h-full w-1/3 rounded bg-accent/70" />
      </div>
    </div>
  );
}

function ConfidenceRow({ conf }) {
  if (conf.abstained) {
    return (
      <div className="mt-2.5 rounded-md border border-warn/35 bg-warn/[0.07] px-3 py-2.5">
        <div className="mb-1 flex items-center gap-2">
          <Ring score={conf.consistency_score} size={26} aborted />
          <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-warn">
            declined to answer
          </span>
          <span className="data-mono ml-auto text-warn/80">gate &lt; {ABSTAIN_GATE}</span>
        </div>
        <p className="text-[11.5px] leading-[17px] text-t2">{conf.reason}</p>
      </div>
    );
  }
  const tone = conf.consistency_score >= 0.7 ? 'text-accent' : 'text-warn';
  return (
    <div className="mt-2.5 flex items-center gap-2.5">
      <Ring score={conf.consistency_score} size={30} />
      <div className="leading-tight">
        <div className={`text-[11px] font-semibold ${tone}`}>
          consistency {conf.consistency_score.toFixed(2)}
          {conf.consistency_score >= 0.7 ? ' · confident' : ' · borderline'}
        </div>
        <div className="text-[10.5px] text-t3">{conf.reason}</div>
      </div>
    </div>
  );
}

function PhysicsCallout({ pc }) {
  return (
    <div className="relative mt-2.5 overflow-hidden rounded-md border border-warn/40 bg-[#12100B]">
      <div className="absolute inset-y-0 left-0 w-[3px] bg-warn" />
      <div className="px-3.5 py-3 pl-4">
        <div className="mb-2 flex items-center gap-2">
          <Icon name="flag" size={12} className="text-warn" />
          <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-warn">
            physics check
          </span>
          <span
            className={`ml-auto rounded-full border px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider ${
              pc.flagged ? 'border-warn/50 text-warn' : 'border-accent/40 text-accent'
            }`}
          >
            {pc.flagged ? 'flagged' : 'clear'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="mb-0.5 text-[9.5px] uppercase tracking-wider text-t3">NDWI</div>
            <div className="data-mono text-[13px] text-t1">{pc.ndwi.toFixed(2)}</div>
            <div className="mt-1 h-[3px] rounded bg-edge">
              <div
                className="h-full rounded bg-accent"
                style={{ width: `${Math.min(100, pc.ndwi * 100)}%` }}
              />
            </div>
            <div className="mt-0.5 data-mono text-[9px] text-t3">water gate 0.45</div>
          </div>
          <div>
            <div className="mb-0.5 text-[9.5px] uppercase tracking-wider text-t3">σ0 backscatter</div>
            <div className="data-mono text-[13px] text-t1">{pc.sar_backscatter_db.toFixed(1)} dB</div>
            <div className="mt-1">
              <DbScale db={pc.sar_backscatter_db} tone={pc.flagged ? '#F5A623' : '#2DD4BF'} />
            </div>
          </div>
        </div>

        <p className="mt-2.5 border-t border-warn/15 pt-2 text-[11.5px] leading-[17px] text-t2">
          {pc.verdict}
        </p>
        <p className="mt-1.5 text-[10px] leading-4 text-t3" title="provenance">
          readings: analysis-service fixture · scale and marker positions derived
        </p>
      </div>
    </div>
  );
}

function Trace({ steps }) {
  const { toast } = useApp();
  const [open, setOpen] = useState(false);

  const copy = async (s, i) => {
    const line = `${i + 1}. ${s.step} — ${s.source}${s.value ? ` — ${s.value}` : ''}`;
    try {
      await navigator.clipboard.writeText(line);
      toast('trace step copied to clipboard');
    } catch {
      toast('clipboard unavailable in this browser');
    }
  };

  return (
    <div className="mt-2.5 rounded-md border border-edge bg-recess">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Icon name="chevron" size={12} className={`text-t3 transition-transform ${open ? 'rotate-180' : ''}`} />
        <span className="text-[11px] font-medium text-t2">Execution trace</span>
        <span className="data-mono ml-auto text-t3">{steps.length} steps</span>
      </button>
      {open && (
        <ul className="border-t border-edge px-3 py-2">
          {steps.map((s, i) => (
            <li key={`${s.step}-${i}`} className="flex items-center gap-2 py-1.5">
              <span className="data-mono w-4 text-t3">{i + 1}</span>
              <span className="text-[11px] text-t1">{s.step}</span>
              <span className="data-mono ml-auto truncate text-t3">{s.source}</span>
              {s.value && <span className="data-mono w-[86px] text-right text-accent">{s.value}</span>}
              <button
                onClick={() => copy(s, i)}
                className="icon-btn !h-6 !w-6 text-t3"
                title="copy this step"
                aria-label={`copy step ${i + 1}`}
              >
                <Icon name="copy" size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The geodetic row keeps the two kinds of number visibly apart: the centroid
// and the AOI area are derived from what the user drew, the hectare figure is
// the answer fixture, and the UTM block is projected from the centroid.
function GeodeticRow({ payload, centroid, georef, aoiPoints }) {
  const { toast, sceneGeo } = useApp();
  const geo = payload.geodetic;

  if (!georef) {
    return (
      <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-md border border-warn/30 bg-warn/5 px-3 py-2">
        <Icon name="warn" size={12} className="shrink-0 text-warn" />
        <span className="text-[11px] text-t2">coordinates withheld — scene is not georeferenced</span>
        <span className="data-mono ml-auto text-[10px] text-t3">{sceneGeo.source}</span>
      </div>
    );
  }

  const utm = utmBlock(centroid.lat, centroid.lon);
  const derivedArea = aoiPoints?.length > 2 ? aoiAreaKm2(aoiPoints, sceneGeo) : null;

  const exportGeo = () => {
    const written = exportAnswerGeoJSON(payload, sceneGeo, centroid, aoiPoints);
    toast(written ? 'GeoJSON written · footprint centred on the drawn AOI' : 'withheld — scene is not georeferenced');
  };

  return (
    <div className="mt-2.5 rounded-md border border-edge bg-recess px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <Icon name="crosshair" size={12} className="shrink-0 text-t3" />
        <span
          className="data-mono whitespace-nowrap text-t2"
          title="centroid of the AOI you drew — recomputed whenever the AOI moves"
        >
          {fmtLat(centroid.lat)} {fmtLon(centroid.lon)}
        </span>
        <span className="text-[9.5px] uppercase tracking-wider text-t3">AOI centroid</span>
        <button
          onClick={exportGeo}
          className="no-print ml-auto flex items-center gap-1 whitespace-nowrap rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-[10.5px] font-semibold text-accent transition-colors hover:bg-accent/20"
        >
          <Icon name="download" size={11} />
          Download GeoJSON
        </button>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-edge pt-2 sm:grid-cols-3">
        <div title="derived from the ring you drew, WGS84">
          <dt className="text-[9px] uppercase tracking-wider text-t3">AOI area · derived</dt>
          <dd className="data-mono text-[11px] text-t1">
            {derivedArea != null ? `${derivedArea.toFixed(1)} km²` : '—'}
          </dd>
        </div>
        <div title="the analysis service's figure, labelled as a fixture">
          <dt className="text-[9px] uppercase tracking-wider text-t3">footprint · fixture</dt>
          <dd className="data-mono text-[11px] text-t1">{geo.area_ha.toFixed(1)} ha</dd>
        </div>
        <div title="Snyder forward transverse Mercator, checked against PROJ">
          <dt className="text-[9px] uppercase tracking-wider text-t3">UTM {utm.zone}</dt>
          <dd className="data-mono text-[11px] text-t1">
            {utm.easting_m.toFixed(0)} E · {utm.northing_m.toFixed(0)} N
          </dd>
        </div>
      </dl>
    </div>
  );
}

export default function Answer({ q, onFollowup }) {
  const { aoi, sceneGeo, toast } = useApp();
  if (q.status === 'analyzing') return <Analyzing stages={q.stages} stage={q.stage} />;

  const p = q.payload;
  const georef = isGeoreferenced(sceneGeo);
  const centroid = aoiCentroid(aoi, sceneGeo);

  const copyAnswer = async () => {
    const parts = [
      `Q · ${p.question}`,
      p.confidence.abstained
        ? `DECLINED TO ANSWER — consistency ${p.confidence.consistency_score.toFixed(2)} (gate < ${ABSTAIN_GATE})`
        : p.answer_text,
      `consistency ${p.confidence.consistency_score.toFixed(2)} — ${p.confidence.reason}`
    ];
    try {
      await navigator.clipboard.writeText(parts.join('\n'));
      toast('answer copied to clipboard');
    } catch {
      toast('clipboard unavailable in this browser');
    }
  };

  const runFollowup = (f) => {
    const item = typeof f === 'string' ? { label: f, action: 'query' } : f;
    if (item.action === 'export') {
      const written = exportAnswerGeoJSON(p, sceneGeo, centroid, aoi);
      toast(written ? 'footprint exported · GeoJSON' : 'withheld — the scene is not georeferenced');
      return;
    }
    onFollowup(item.label, item.intent);
  };

  return (
    <article className="answer-in" aria-label={`answer to: ${p.question}`}>
      <ExportRow payload={p} query={q} centroid={centroid} georef={georef} aoiPoints={aoi} />
      {!p.confidence.abstained && (
        <p className="text-[12.5px] leading-[19px] text-t1">{p.answer_text}</p>
      )}
      {p.confidence.abstained && (
        <p className="text-[12px] leading-[18px] text-t3">
          AVNI ran the full pass but held the answer at the gate —
        </p>
      )}
      <ConfidenceRow conf={p.confidence} />
      <PhysicsCallout pc={p.physics_check} />
      <Trace steps={p.trace} />
      <GeodeticRow payload={p} centroid={centroid} georef={georef} aoiPoints={aoi} />
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <button className="chip no-print" onClick={copyAnswer} title="copy the answer as text">
          <Icon name="copy" size={11} />
          Copy answer
        </button>
        {p.followups?.map((f) => {
          const item = typeof f === 'string' ? { label: f, action: 'query' } : f;
          const exportBlocked = item.action === 'export' && !georef;
          return (
            <button
              key={item.label}
              onClick={() => runFollowup(item)}
              disabled={exportBlocked}
              title={exportBlocked ? 'withheld — scene is not georeferenced' : item.label}
              className={`chip ${exportBlocked ? 'cursor-not-allowed opacity-40' : ''}`}
            >
              <span className="text-accent">{item.action === 'export' ? '⤓' : '↳'}</span>
              {item.label}
            </button>
          );
        })}
      </div>
    </article>
  );
}
