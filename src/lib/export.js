// Result export — evidence bundle (JSON), analyst report (Markdown),
// geometry (GeoJSON via geo.js). All client-side, all real downloads.

import { downloadJSON, fmtLat, fmtLon } from './geo.js';

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

export function exportAnswerJSON(payload) {
  downloadJSON(
    {
      product: 'AVNI',
      model: 'AVNI-VL 0.9',
      exported_at: new Date().toISOString(),
      crs: payload.geodetic.crs,
      ...payload
    },
    `avni_result_${slug(payload.question)}.json`,
    'application/json'
  );
}

function answerMarkdown(p) {
  const c = p.confidence;
  const pc = p.physics_check;
  const g = p.geodetic;
  const lines = [];
  lines.push(`## Q · ${p.question}`, '');
  if (c.abstained) {
    lines.push(`**DECLINED TO ANSWER** — consistency ${c.consistency_score.toFixed(2)} (gate < 0.45)`);
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
  lines.push(`- centroid: \`${fmtLat(g.lat)} ${fmtLon(g.lon)}\``);
  lines.push(`- footprint: \`${g.area_ha.toFixed(1)} ha\` · \`${g.crs}\``, '');
  lines.push(`### Execution trace`);
  p.trace.forEach((t, i) => {
    lines.push(`${i + 1}. ${t.step} — _${t.source}_${t.value ? ` — \`${t.value}\`` : ''}`);
  });
  return lines.join('\n');
}

export function exportAnswerMarkdown(payload) {
  const body = [
    '# AVNI · result report',
    '',
    `generated ${new Date().toISOString()} · model AVNI-VL 0.9 · SIH 26167 / SAC-ISRO`,
    '',
    answerMarkdown(payload),
    ''
  ].join('\n');
  downloadText(body, `avni_result_${slug(payload.question)}.md`);
}

export function exportSessionMarkdown(queries) {
  const done = queries.filter((q) => q.status === 'done');
  const body = [
    '# AVNI · session report',
    '',
    `generated ${new Date().toISOString()} · model AVNI-VL 0.9 · SIH 26167 / SAC-ISRO`,
    `queries answered: ${done.length}`,
    '',
    '---',
    '',
    done.map((q) => answerMarkdown(q.payload)).join('\n\n---\n\n'),
    ''
  ].join('\n');
  downloadText(body, `avni_session_${new Date().toISOString().slice(0, 10)}.md`);
}
