import { useState } from 'react';
import { Icon } from './Icons.jsx';
import { Ring, DbHistogram } from './ui.jsx';
import { useApp } from '../state/AppState.jsx';
import { ANALYZE_STAGES } from '../data/mock.js';
import { buildAnswerGeoJSON, downloadJSON, fmtLat, fmtLon, isGeoreferenced } from '../lib/geo.js';
import { exportAnswerJSON, exportAnswerMarkdown } from '../lib/export.js';

function ExportMenu({ payload }) {
  const { toast, sceneGeo } = useApp();
  const georef = isGeoreferenced(sceneGeo);
  const [open, setOpen] = useState(false);
  const item =
    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-t2 transition-colors hover:bg-white/5 hover:text-t1';
  const fire = (fn, msg) => () => {
    fn(payload, sceneGeo);
    toast(msg);
    setOpen(false);
  };
  return (
    <div className="relative mb-2 flex justify-end">
      <button className={`chip ${open ? '!border-accent/50 !text-t1' : ''}`} onClick={() => setOpen((o) => !o)}>
        <Icon name="download" size={11} />
        Export result
        <Icon name="chevron" size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="recess absolute right-0 top-7 z-20 w-56 px-1.5 py-1.5">
          <button className={item} onClick={fire(exportAnswerJSON, 'result exported · JSON evidence bundle')}>
            <span className="data-mono w-12 text-t3">.json</span>
            evidence bundle · full payload
          </button>
          <button className={item} onClick={fire(exportAnswerMarkdown, 'result exported · Markdown report')}>
            <span className="data-mono w-12 text-t3">.md</span>
            analyst report · readable
          </button>
          <button
            className={`${item} ${georef ? '' : 'cursor-not-allowed opacity-40'}`}
            disabled={!georef}
            title={georef ? 'answer footprint as GeoJSON' : 'withheld — scene is not georeferenced'}
            onClick={fire(
              (p) => downloadJSON(buildAnswerGeoJSON(p), 'avni_answer.geojson'),
              'result exported · GeoJSON footprint'
            )}
          >
            <span className="data-mono w-12 text-t3">.geojson</span>
            {georef ? 'footprint · centroid + area' : 'withheld · no georeference'}
          </button>
        </div>
      )}
    </div>
  );
}

function Analyzing({ stage }) {
  return (
    <div className="answer-card answer-in px-3.5 py-3">
      <div className="mb-2 flex items-center gap-1.5 text-t2">
        <span className="flex gap-0.5">
          <span className="dot-blink h-1 w-1 rounded-full bg-accent" />
          <span className="dot-blink h-1 w-1 rounded-full bg-accent" />
          <span className="dot-blink h-1 w-1 rounded-full bg-accent" />
        </span>
        <span className="text-[11px]">interrogating scene</span>
      </div>
      <ul className="space-y-1">
        {ANALYZE_STAGES.slice(0, stage).map((s) => (
          <li key={s} className="data-mono flex items-center gap-2 text-t3">
            <Icon name="check" size={10} className="text-accent" />
            {s}
          </li>
        ))}
        {stage < ANALYZE_STAGES.length && (
          <li className="data-mono flex items-center gap-2 text-t2">
            <span className="h-2 w-2 rounded-full border border-accent/60 border-t-transparent spin-slow" />
            {ANALYZE_STAGES[stage]}
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
          <span className="data-mono ml-auto text-warn/80">gate &lt; 0.45</span>
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
              <DbHistogram db={pc.sar_backscatter_db} tone={pc.flagged ? '#F5A623' : '#2DD4BF'} />
            </div>
          </div>
        </div>

        <p className="mt-2.5 border-t border-warn/15 pt-2 text-[11.5px] leading-[17px] text-t2">
          {pc.verdict}
        </p>
      </div>
    </div>
  );
}

function Trace({ steps }) {
  const { toast } = useApp();
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2.5 rounded-md border border-edge bg-recess">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Icon name="chevron" size={12} className={`text-t3 transition-transform ${open ? 'rotate-180' : ''}`} />
        <span className="text-[11px] font-medium text-t2">Execution trace</span>
        <span className="data-mono ml-auto text-t3">{steps.length} steps</span>
      </button>
      {open && (
        <ul className="border-t border-edge px-3 py-2">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-2 py-1.5">
              <span className="data-mono w-4 text-t3">{i + 1}</span>
              <span className="text-[11px] text-t1">{s.step}</span>
              <span className="data-mono ml-auto truncate text-t3">{s.source}</span>
              {s.value && <span className="data-mono w-[86px] text-right text-accent">{s.value}</span>}
              <button
                onClick={() => toast('replay queued — sandbox build ships without the runner')}
                className="icon-btn !h-6 !w-6 text-t3"
                title="replay step"
              >
                <Icon name="replay" size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GeodeticRow({ geo, payload }) {
  const { toast, sceneGeo } = useApp();

  // No georeference on the scene means no honest coordinates to show — the
  // fixture still carries them, so AVNI withholds them rather than lying.
  if (!isGeoreferenced(sceneGeo)) {
    return (
      <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-md border border-warn/30 bg-warn/5 px-3 py-2">
        <Icon name="warn" size={12} className="shrink-0 text-warn" />
        <span className="text-[11px] text-t2">coordinates withheld — scene is not georeferenced</span>
        <span className="data-mono ml-auto text-[10px] text-t3">{sceneGeo.source}</span>
      </div>
    );
  }

  const exportGeo = () => {
    downloadJSON(buildAnswerGeoJSON(payload), 'avni_answer.geojson');
    toast('GeoJSON written · answer footprint + centroid');
  };
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md border border-edge bg-recess px-3 py-2">
      <Icon name="crosshair" size={12} className="shrink-0 text-t3" />
      <span className="data-mono whitespace-nowrap text-t2">
        {fmtLat(geo.lat)} {fmtLon(geo.lon)}
      </span>
      <span className="data-mono whitespace-nowrap text-t3">{geo.area_ha.toFixed(1)} ha</span>
      <button
        onClick={exportGeo}
        className="ml-auto flex items-center gap-1 whitespace-nowrap rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-[10.5px] font-semibold text-accent transition-colors hover:bg-accent/20"
      >
        <Icon name="download" size={11} />
        Download GeoJSON
      </button>
    </div>
  );
}

export default function Answer({ q, onFollowup }) {
  if (q.status === 'analyzing') return <Analyzing stage={q.stage} />;
  const p = q.payload;
  return (
    <div className="answer-in">
      <ExportMenu payload={p} />
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
      <GeodeticRow geo={p.geodetic} payload={p} />
      {p.followups && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {p.followups.map((f) => (
            <button key={f} onClick={() => onFollowup(f)} className="chip">
              <span className="text-accent">↳</span>
              {f}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
