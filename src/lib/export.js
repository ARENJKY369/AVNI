// Result export — evidence bundle (JSON), analyst report (Markdown),
// geometry (GeoJSON via geo.js). All client-side, all real downloads.
//
// Every path goes through the same georeference gate: if the scene has no
// CRS, no coordinates are written, anywhere. (The JSON bundle used to spread
// the payload back over the withheld block, which leaked lat/lon into a file
// whose own header said "unlocated".)
//
// Every bundle also carries its PROVENANCE block: which numbers were derived
// from the scene and which came from the analysis-service fixtures.

import {
  PROVENANCE,
  aoiAreaKm2,
  buildAnswerGeoJSON,
  downloadJSON,
  fmtLat,
  fmtLon,
  georefBlock,
  gsdLabel,
  isGeoreferenced,
  utmBlock,
  withheldGeodetic
} from './geo.js';
import { ABSTAIN_GATE, ORIENTATIONS } from './model.js';

export function downloadText(text, filename, mime = 'text/markdown') {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}

/** Binary download (the PDF report) — same path as text, no charset. */
export function downloadBytes(bytes, filename, mime = 'application/octet-stream') {
  downloadBlob(new Blob([bytes], { type: mime }), filename);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

export const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'result';

const geodeticBlock = (payload, geo, centroid, aoiPoints) => {
  if (!isGeoreferenced(geo)) return withheldGeodetic(geo);
  return {
    area_ha: payload.geodetic.area_ha,
    area_source: 'analysis-service fixture, centred on the derived AOI centroid',
    crs: geo.crs,
    source: geo.source,
    centroid: centroid ? { ...centroid, source: 'drawn AOI centroid' } : null,
    aoi_area_km2: aoiPoints?.length > 2 ? Number(aoiAreaKm2(aoiPoints, geo).toFixed(4)) : null,
    aoi_area_source: 'derived from the drawn AOI ring',
    utm: centroid ? utmBlock(centroid.lat, centroid.lon) : null
  };
};

export function exportAnswerJSON(payload, geo, centroid, aoiPoints, raster = null) {
  const georef = isGeoreferenced(geo);
  // Ground sample distance is extent / *this scene's* raster. Left to default it
  // fell back to the bundled raster size, so a scene whose own grid is 32 x 24
  // exported a GSD 40x too fine (0.4 m/px against the 16 m/px on screen).
  const gsdKnown = georef && raster?.width > 0 && raster?.height > 0;
  // Built explicitly rather than spread: the withheld block can never be
  // overwritten by a stray field from the payload.
  const bundle = {
    product: 'AVNI',
    model: 'AVNI-VL 0.9',
    exported_at: new Date().toISOString(),
    question: payload.question,
    intent: payload.intent,
    answer_text: payload.answer_text,
    consistency: {
      ...payload.confidence,
      gate: ABSTAIN_GATE,
      orientations: ORIENTATIONS
    },
    physics_check: payload.physics_check,
    trace: payload.trace,
    georeference: georefBlock(geo),
    geodetic: geodeticBlock(payload, geo, centroid, aoiPoints),
    scene: {
      raster: gsdKnown ? { width: raster.width, height: raster.height } : null,
      ground_sample_distance: gsdKnown ? gsdLabel(geo.extent, raster) : null,
      ground_sample_distance_source: gsdKnown
        ? PROVENANCE.derived.ground_sample_distance
        : georef
          ? 'not reported: this scene did not declare a raster size'
          : null
    },
    provenance: PROVENANCE,
    followups: payload.followups
  };
  downloadJSON(bundle, `avni_result_${slug(payload.question)}.json`, 'application/json');
}

const provenanceTable = () =>
  [
    '### Where these numbers come from',
    '',
    '| derived from the scene | fixture (mock analysis service) |',
    '| --- | --- |',
    `| ${PROVENANCE.derived.scale_bar} | ${PROVENANCE.fixture.answer_text} |`,
    `| ${PROVENANCE.derived.aoi_area} | ${PROVENANCE.fixture.area_ha} |`,
    `| ${PROVENANCE.derived.utm} | ${PROVENANCE.fixture.physics_check} |`,
    ''
  ].join('\n');

function answerMarkdown(p, geo, centroid, aoiPoints) {
  const georef = isGeoreferenced(geo);
  const c = p.confidence;
  const pc = p.physics_check;
  const g = p.geodetic;
  const lines = [];
  lines.push(`## Q · ${p.question}`, '');
  if (c.abstained) {
    lines.push(
      `**DECLINED TO ANSWER** — consistency ${c.consistency_score.toFixed(2)} (gate < ${ABSTAIN_GATE})`
    );
    lines.push(`> ${c.reason}`, '');
    lines.push('AVNI ran the full pass but held the answer at the gate.', '');
  } else {
    lines.push(p.answer_text, '');
    lines.push(`**Consistency ${c.consistency_score.toFixed(2)}** — ${c.reason}`, '');
  }
  lines.push(`### Physics check · ${pc.flagged ? 'FLAGGED' : 'clear'}`);
  lines.push(`- NDWI: \`${pc.ndwi.toFixed(2)}\` (water gate 0.45)`);
  lines.push(`- σ0 backscatter: \`${pc.sar_backscatter_db.toFixed(1)} dB\``);
  lines.push(`- Verdict: ${pc.verdict}`, '');
  lines.push('### Geodetic');
  if (georef) {
    lines.push(`- footprint area: \`${g.area_ha.toFixed(1)} ha\` (fixture, ${geo.crs})`);
    if (aoiPoints?.length > 2) {
      lines.push(`- drawn AOI area: \`${aoiAreaKm2(aoiPoints, geo).toFixed(2)} km²\` (derived)`);
    }
    if (centroid) {
      lines.push(`- centroid: ${fmtLat(centroid.lat)} ${fmtLon(centroid.lon)} — drawn AOI`);
      const utm = utmBlock(centroid.lat, centroid.lon);
      lines.push(
        `- UTM: \`${utm.zone}\` \`${utm.easting_m.toFixed(0)} E\` \`${utm.northing_m.toFixed(0)} N\``
      );
    }
    lines.push(`- georeference: ${geo.source}`, '');
  } else {
    lines.push(`- **coordinates withheld** — scene is not georeferenced (${geo.source})`, '');
  }
  lines.push('### Execution trace');
  p.trace.forEach((t, i) => {
    lines.push(`${i + 1}. ${t.step} — _${t.source}_${t.value ? ` — \`${t.value}\`` : ''}`);
  });
  return lines.join('\n');
}

export function exportAnswerMarkdown(payload, geo, centroid, aoiPoints) {
  const body = [
    '# AVNI · result report',
    '',
    `generated ${new Date().toISOString()} · model AVNI-VL 0.9 · SIH 26167 / SAC-ISRO`,
    `scene georeference: ${georefBlock(geo).status}`,
    '',
    answerMarkdown(payload, geo, centroid, aoiPoints),
    '',
    provenanceTable()
  ].join('\n');
  downloadText(body, `avni_result_${slug(payload.question)}.md`);
}

// One geometry path for the export menu, the geodetic row and the
// "export footprint" follow-up action.
export function exportAnswerGeoJSON(payload, geo, centroid, aoiPoints) {
  if (!isGeoreferenced(geo)) return false;
  downloadJSON(
    buildAnswerGeoJSON(payload, centroid, geo, aoiPoints),
    `avni_answer_${slug(payload.question)}.geojson`
  );
  return true;
}

export function exportSessionMarkdown(queries, geo, aoiPoints) {
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
    done.map((q) => answerMarkdown(q.payload, geo, null, aoiPoints)).join('\n\n---\n\n'),
    '',
    provenanceTable()
  ].join('\n');
  downloadText(body, `avni_session_${new Date().toISOString().slice(0, 10)}.md`);
}

export { fmtLat, fmtLon };
