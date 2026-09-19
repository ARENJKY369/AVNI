// Result export — evidence bundle (JSON), analyst report (Markdown),
// geometry (GeoJSON via geo.js). All client-side, all real downloads.
//
// Every path goes through the same georeference gate: if the scene has no
// CRS, no coordinates are written, anywhere. (The JSON bundle used to spread
// the payload back over the withheld block, which leaked lat/lon into a file
// whose own header said "unlocated".)

import {
  buildAnswerGeoJSON,
  downloadJSON,
  fmtLat,
  fmtLon,
  georefBlock,
  isGeoreferenced,
  withheldGeodetic
} from './geo.js';
import { ABSTAIN_GATE } from './model.js';

export function downloadText(text, filename, mime = 'text/markdown') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'result';

export function exportAnswerJSON(payload, geo) {
  const georef = isGeoreferenced(geo);
  // Built explicitly rather than spread: the withheld block can never be
  // overwritten by a stray field from the payload.
  const bundle = {
    product: 'AVNI',
    model: 'AVNI-VL 0.9',
    exported_at: new Date().toISOString(),
    question: payload.question,
    intent: payload.intent,
    answer_text: payload.answer_text,
    confidence: payload.confidence,
    physics_check: payload.physics_check,
    trace: payload.trace,
    georeference: georefBlock(geo),
    geodetic: georef ? { ...payload.geodetic, crs: geo.crs, source: geo.source } : withheldGeodetic(geo),
    followups: payload.followups
  };
  downloadJSON(bundle, `avni_result_${slug(payload.question)}.json`, 'application/json');
}

function answerMarkdown(p, geo) {
  const georef = isGeoreferenced(geo);
  const c = p.confidence;
  const pc = p.physics_check;
  const g = p.geodetic;
  const lines = [];
  lines.push(`## Q · ${p.question}`, '');
  if (c.abstained) {
    lines.push(`**DECLINED TO ANSWER** — consistency ${c.consistency_score.toFixed(2)} (gate < ${ABSTAIN_GATE})`);
    lines.push(`> ${c.reason}`, '');
    lines.push(`AVNI ran the full pass but held the answer at the gate.`, '');
  } else {
    lines.push(p.answer_text, '');
    lines.push(`**Consistency ${c.consistency_score.toFixed(2)}** — ${c.reason}`, '');
  }
  lines.push(`### Physics check · ${pc.flagged ? 'FLAGGED' : 'clear'}`);
  lines.push(`- NDWI: \`${pc.ndwi.toFixed(2)}\` (water gate 0.45)`);
  lines.push(`- σ0 backscatter: \`${pc.sar_backscatter_db.toFixed(1)} dB\``);
  lines.push(`- Verdict: ${pc.verdict}`, '');
  lines.push(`### Geodetic`);
  if (georef) {
    lines.push(`- footprint area: \`${g.area_ha.toFixed(1)} ha\` (\`${geo.crs}\`)`);
    lines.push(`- centroid: from the drawn AOI — see the GeoJSON footprint export`);
    lines.push(`- georeference: ${geo.source}`, '');
  } else {
    lines.push(`- **coordinates withheld** — scene is not georeferenced (${geo.source})`, '');
  }
  lines.push(`### Execution trace`);
  p.trace.forEach((t, i) => {
    lines.push(`${i + 1}. ${t.step} — _${t.source}_${t.value ? ` — \`${t.value}\`` : ''}`);
  });
  return lines.join('\n');
}

export function exportAnswerMarkdown(payload, geo) {
  const body = [
    '# AVNI · result report',
    '',
    `generated ${new Date().toISOString()} · model AVNI-VL 0.9 · SIH 26167 / SAC-ISRO`,
    '',
    answerMarkdown(payload, geo),
    ''
  ].join('\n');
  downloadText(body, `avni_result_${slug(payload.question)}.md`);
}

// One geometry path for the export menu, the geodetic row and the
// "export footprint" follow-up action.
export function exportAnswerGeoJSON(payload, geo, centroid) {
  if (!isGeoreferenced(geo)) return false;
  downloadJSON(
    buildAnswerGeoJSON(payload, centroid, geo),
    `avni_answer_${slug(payload.question)}.geojson`
  );
  return true;
}

export function exportSessionMarkdown(queries, geo) {
  const done = queries.filter((q) => q.status === 'done');
  const body = [
    '# AVNI · session report',
    '',
    `generated ${new Date().toISOString()} · model AVNI-VL 0.9 · SIH 26167 / SAC-ISRO`,
    `queries answered: ${done.length}`,
    `scene georeference: ${georefBlock(geo).status}`,
    '',
    '---',
    '',
    done.map((q) => answerMarkdown(q.payload, geo)).join('\n\n---\n\n'),
    ''
  ].join('\n');
  downloadText(body, `avni_session_${new Date().toISOString().slice(0, 10)}.md`);
}

export { fmtLat, fmtLon };
