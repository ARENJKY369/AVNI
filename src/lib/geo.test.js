import { describe, expect, it } from 'vitest';
import {
  GAZETTEER,
  PROVENANCE,
  SCENE_ASPECT,
  SCENE_EXTENT,
  SCENE_GEO,
  SCENE_GSD_M,
  SCENE_RASTER,
  UNLOCATED_GEO,
  aoiAreaHa,
  aoiAreaKm2,
  aoiCentroid,
  aoiRing,
  bearingLabel,
  boxAround,
  buildAnswerGeoJSON,
  buildLayerGeoJSON,
  distanceKm,
  extentKm,
  flattenPath,
  fmtLat,
  fmtLon,
  georefBlock,
  groundSampleMetres,
  gsdLabel,
  nearestPlace,
  placeSummary,
  scaleBar,
  sheetSize,
  toGeo,
  utmBlock,
  utmZoneLabel
} from './geo.js';
import { BUILTIN_POLYS, DISAGREEMENT_CLUSTERS, WATER_PATHS } from '../data/overlays.js';
import { ringAreaHa } from './geodesy.js';

const AOI = [
  { u: 0.33, v: 0.28 },
  { u: 0.68, v: 0.35 },
  { u: 0.73, v: 0.68 },
  { u: 0.39, v: 0.74 }
];

const ALL_LAYERS = {
  water: { on: true },
  builtin: { on: true },
  layover: { on: true },
  disagreement: { on: true }
};

const ANSWER = {
  question: 'Where is flooding most severe?',
  confidence: { consistency_score: 0.47, abstained: false },
  physics_check: { ndwi: 0.61, sar_backscatter_db: -3.2, flagged: true },
  geodetic: { area_ha: 4.7 }
};

describe('the declared footprint', () => {
  it('matches the raster aspect ratio, so imagery and overlays share one grid', () => {
    const { widthKm, heightKm } = extentKm();
    expect(widthKm / heightKm).toBeCloseTo(SCENE_ASPECT, 4);
    expect(SCENE_RASTER.width / SCENE_RASTER.height).toBeCloseTo(SCENE_ASPECT, 12);
  });

  it('is 22.03 km wide on the ground, at the centre latitude', () => {
    expect(extentKm().widthKm).toBeCloseTo(22.0305, 3);
    expect(extentKm().heightKm).toBeCloseTo(12.296, 3);
  });

  it('yields a square ground sample distance derived from extent and raster', () => {
    const g = groundSampleMetres();
    expect(g.x).toBeCloseTo(g.y, 2);
    expect(g.x).toBeCloseTo(SCENE_GSD_M, 6);
    expect(g.x).toBeGreaterThan(15.9);
    expect(g.x).toBeLessThan(16.1);
    // the old build printed "10 m/px" from a constant no raster could honour
    expect(gsdLabel()).toBe('16 m/px');
  });

  it('maps uv space onto the extent, north-west first', () => {
    expect(toGeo(0, 0)).toEqual({ lat: SCENE_EXTENT.maxLat, lon: SCENE_EXTENT.minLon });
    expect(toGeo(1, 1)).toEqual({ lat: SCENE_EXTENT.minLat, lon: SCENE_EXTENT.maxLon });
    const c = toGeo(0.5, 0.5);
    expect(c.lat).toBeCloseTo(12.9758, 4);
    expect(c.lon).toBeCloseTo(77.6027, 4);
  });

  it('formats hemispheres with the right suffix', () => {
    expect(fmtLat(12.9739)).toBe('12.9739°N');
    expect(fmtLat(-12.9739)).toBe('12.9739°S');
    expect(fmtLon(77.6093)).toBe('77.6093°E');
    expect(fmtLon(-77.6093)).toBe('77.6093°W');
  });
});

describe('the scene sheet', () => {
  it('fits inside the container without distorting the footprint', () => {
    const s = sheetSize(1000, 900);
    expect(s.w / s.h).toBeCloseTo(SCENE_ASPECT, 6);
    expect(s.w).toBeLessThanOrEqual(1000);
    expect(s.h).toBeLessThanOrEqual(900);
  });

  it('falls back to a finite box for degenerate containers', () => {
    const s = sheetSize(0, 0);
    expect(s.w).toBeGreaterThan(0);
    expect(s.h).toBeGreaterThan(0);
  });
});

describe('the scale bar', () => {
  it('is one measurement: the drawn length and the label agree', () => {
    for (const [w, z] of [
      [1010, 1],
      [1010, 2.5],
      [640, 1],
      [400, 8]
    ]) {
      const bar = scaleBar({ sheetWidthPx: w, zoom: z });
      // the bar covers exactly as much ground as it is labelled with
      expect(bar.px * bar.kmPerPx).toBeCloseTo(bar.km, 1);
      expect(bar.label).toMatch(/^(\d+(\.\d+)? km|\d+ m)$/);
    }
  });

  it('keeps the bar a sane on-screen size', () => {
    const bar = scaleBar({ sheetWidthPx: 1010, zoom: 1 });
    expect(bar.px).toBeGreaterThanOrEqual(24);
    expect(bar.px).toBeLessThanOrEqual(92);
  });

  it('re-labels in metres when the ground resolution gets fine', () => {
    const bar = scaleBar({ sheetWidthPx: 1010, zoom: 8 });
    expect(bar.label).toMatch(/m$/);
  });
});

describe('distance, bearing and place names', () => {
  it('measures geodesic distance (WGS84), not a mean-radius haversine', () => {
    // PROJ: 1510.0702 m between these two gazetteer points
    expect(distanceKm(12.9756, 77.6068, 12.9763, 77.5929)).toBeCloseTo(1.51007, 4);
    expect(distanceKm(12.9, 77.6, 12.9, 77.6)).toBe(0);
  });

  it('labels bearings from the geodesic azimuth', () => {
    expect(bearingLabel(12.9, 77.6, 13.1, 77.6)).toBe('N');
    expect(bearingLabel(12.9, 77.6, 12.9, 77.8)).toBe('E');
    expect(bearingLabel(12.9, 77.6, 12.7, 77.6)).toBe('S');
  });

  it('resolves the AOI centroid to a real gazetteer entry', () => {
    const c = aoiCentroid(AOI);
    const place = nearestPlace(c.lat, c.lon);
    expect(GAZETTEER.some((p) => p.name === place.name)).toBe(true);
    expect(place.distanceKm).toBeLessThan(5);
  });

  it('always reports the place with its distance and bearing off the point', () => {
    const c = aoiCentroid(AOI);
    const summary = placeSummary(c.lat, c.lon);
    expect(summary.short).toContain(summary.name);
    expect(summary.distance === 'at' || /km [NSEW]/.test(summary.distance)).toBe(true);
  });
});

describe('the drawn AOI', () => {
  it('reports a centroid inside the extent', () => {
    const c = aoiCentroid(AOI);
    expect(c.lat).toBeGreaterThan(SCENE_EXTENT.minLat);
    expect(c.lat).toBeLessThan(SCENE_EXTENT.maxLat);
    expect(c.lon).toBeGreaterThan(SCENE_EXTENT.minLon);
    expect(c.lon).toBeLessThan(SCENE_EXTENT.maxLon);
  });

  it('derives an area from the ring itself (km² and ha agree)', () => {
    expect(aoiAreaKm2(AOI)).toBeCloseTo(36.84, 1);
    expect(aoiAreaHa(AOI)).toBeCloseTo(aoiAreaKm2(AOI) * 100, 6);
  });

  it('returns the ring as lat/lon in the same order as the vertices', () => {
    const ring = aoiRing(AOI);
    expect(ring).toHaveLength(AOI.length);
    expect(ring[0].lon).toBeCloseTo(toGeo(0.33, 0.28).lon, 12);
    expect(ring[0].lat).toBeCloseTo(toGeo(0.33, 0.28).lat, 12);
  });

  it('has an area of zero for a degenerate ring', () => {
    expect(aoiAreaKm2([])).toBe(0);
    expect(aoiAreaKm2([{ u: 0.5, v: 0.5 }])).toBe(0);
  });
});

describe('footprint boxes', () => {
  it('encloses the requested area on the ground', () => {
    const box = boxAround(12.9758, 77.6027, 4.7);
    const ring = box.slice(0, 4).map(([lon, lat]) => ({ lat, lon }));
    // 4.7 ha is a 216.8 m square
    expect(ringAreaHa(ring)).toBeCloseTo(4.7, 2);
    expect(box[0]).toEqual(box[box.length - 1]);
  });
});

describe('UTM', () => {
  it('reports the zone an Indian EO pipeline would file this under', () => {
    const c = aoiCentroid(AOI);
    const utm = utmBlock(c.lat, c.lon);
    expect(utm.zone).toBe('43N');
    expect(utm.easting_m).toBeGreaterThan(700000);
    expect(utm.easting_m).toBeLessThan(900000);
    expect(utm.northing_m).toBeGreaterThan(1400000);
    expect(utmZoneLabel(c.lat, c.lon)).toBe('43N');
  });
});

describe('overlay geometry -> geography', () => {
  it('flattens the river strokes into a path inside image space', () => {
    const pts = flattenPath(WATER_PATHS.optical, 8);
    expect(pts.length).toBeGreaterThan(30);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(-5);
      expect(x).toBeLessThanOrEqual(105);
      expect(y).toBeGreaterThanOrEqual(-5);
      expect(y).toBeLessThanOrEqual(105);
    }
  });

  it('ignores a path with too few numbers to be a curve', () => {
    expect(flattenPath('M 1 2')).toEqual([]);
  });
});

describe('GeoJSON exports', () => {
  const centroid = aoiCentroid(AOI);

  it('withholds everything on an unlocated scene — geometry, not just the header', () => {
    const answer = buildAnswerGeoJSON(ANSWER, centroid, UNLOCATED_GEO, AOI);
    const layers = buildLayerGeoJSON(ALL_LAYERS, AOI, UNLOCATED_GEO);
    for (const fc of [answer, layers]) {
      expect(fc.features).toHaveLength(0);
      expect(fc.georeference.status).toBe('unlocated');
      expect(JSON.stringify(fc)).not.toMatch(/1[23]\.\d{3,}|7[78]\.\d{3,}/);
    }
  });

  it('puts the answer footprint on the drawn AOI centroid', () => {
    const fc = buildAnswerGeoJSON(ANSWER, centroid, SCENE_GEO, AOI);
    const point = fc.features.find((f) => f.properties.kind === 'answer_centroid');
    expect(point.geometry.coordinates[0]).toBeCloseTo(centroid.lon, 9);
    expect(point.geometry.coordinates[1]).toBeCloseTo(centroid.lat, 9);
    expect(point.properties.centroid_source).toBe('drawn AOI centroid');
    const footprint = fc.features.find((f) => f.properties.kind === 'answer_footprint');
    expect(footprint.properties.area_ha).toBe(4.7);
    expect(footprint.properties.aoi_area_km2).toBeCloseTo(36.84, 1);
    expect(fc.utm.zone).toBe('43N');
    expect(fc.provenance.derived.utm).toMatch(/PROJ/);
  });

  it('writes layer geometry from the overlays that are on screen, not from constants', () => {
    const fc = buildLayerGeoJSON(ALL_LAYERS, AOI, SCENE_GEO);
    const water = fc.features.find((f) => f.properties.layer === 'water_mask');
    expect(water.geometry.type).toBe('LineString');
    expect(water.geometry.coordinates.length).toBeGreaterThan(30);
    // the old export wrote a hardcoded box around 12.9716 / 77.5946
    expect(JSON.stringify(fc)).not.toContain('12.9716');
    const built = fc.features.find((f) => f.properties.layer === 'built_up');
    expect(built.geometry.coordinates).toHaveLength(BUILTIN_POLYS.length);
    const conflicts = fc.features.filter((f) => f.properties.layer === 'disagreement');
    expect(conflicts).toHaveLength(DISAGREEMENT_CLUSTERS.length);
    const aoi = fc.features.find((f) => f.properties.layer === 'aoi');
    expect(aoi.properties.area_km2).toBeCloseTo(36.84, 1);
    expect(aoi.geometry.coordinates[0]).toHaveLength(AOI.length + 1);
  });

  it('maps every exported coordinate into the scene it was given, not the bundled one', () => {
    // an upload 14 km east of the bundled footprint: nothing in the file may
    // land on the old rectangle, whatever the header says
    const shifted = {
      ...SCENE_GEO,
      extent: { minLat: 12.99, maxLat: 12.9965, minLon: 77.73, maxLon: 77.7345 },
      crs: 'EPSG:4326',
      source: 'GeoTIFF tags'
    };
    const fc = buildLayerGeoJSON(ALL_LAYERS, AOI, shifted);
    const lons = [];
    const lats = [];
    for (const f of fc.features) {
      const walk = (c) => (typeof c[0] === 'number' ? (lons.push(c[0]), lats.push(c[1])) : c.forEach(walk));
      walk(f.geometry.coordinates);
    }
    expect(lons.length).toBeGreaterThan(30);
    // the fixture river is drawn from -3 % to 103 % of the frame, so it hangs a
    // hair over the footprint edge on purpose; the margin allows that overhang
    // and nothing else — the old bug was 14 km, not 15 m
    const marginLon = (shifted.extent.maxLon - shifted.extent.minLon) * 0.05;
    const marginLat = (shifted.extent.maxLat - shifted.extent.minLat) * 0.05;
    expect(Math.min(...lons)).toBeGreaterThan(shifted.extent.minLon - marginLon);
    expect(Math.max(...lons)).toBeLessThan(shifted.extent.maxLon + marginLon);
    expect(Math.min(...lats)).toBeGreaterThan(shifted.extent.minLat - marginLat);
    expect(Math.max(...lats)).toBeLessThan(shifted.extent.maxLat + marginLat);
    const aoi = fc.features.find((f) => f.properties.layer === 'aoi');
    expect(aoi.properties.centroid[0]).toBeGreaterThanOrEqual(shifted.extent.minLon);
    // the area is the AOI's, measured on this footprint: the same ring 14 km
    // east is not the same number of square kilometres
    expect(aoi.properties.area_km2).toBeCloseTo(aoiAreaKm2(AOI, shifted), 3);
    expect(aoi.properties.area_km2).not.toBeCloseTo(aoiAreaKm2(AOI, SCENE_GEO), 1);
  });

  it('measures the answer AOI area on the scene the answer came from', () => {
    const shifted = { ...SCENE_GEO, extent: { minLat: 12.99, maxLat: 12.9965, minLon: 77.73, maxLon: 77.7345 } };
    const fc = buildAnswerGeoJSON(ANSWER, aoiCentroid(AOI, shifted), shifted, AOI);
    const footprint = fc.features.find((f) => f.properties.kind === 'answer_footprint');
    expect(footprint.properties.aoi_area_km2).toBeCloseTo(aoiAreaKm2(AOI, shifted), 3);
  });

  it('treats a null extent or raster as "not stated", never as a crash', () => {
    // an unlocated scene carries extent: null; the scale bar is only rendered
    // for a georeferenced scene, but the maths must not throw before that gate
    expect(() => extentKm(null)).not.toThrow();
    expect(extentKm(null)).toEqual(extentKm(SCENE_EXTENT));
    expect(groundSampleMetres(SCENE_EXTENT, { width: 0, height: 0 })).toEqual(
      groundSampleMetres(SCENE_EXTENT, SCENE_RASTER)
    );
    expect(gsdLabel(null, null)).toBe(gsdLabel(SCENE_EXTENT, SCENE_RASTER));
    expect(scaleBar({ extent: null, sheetWidthPx: 900, zoom: 1 }).label).toBe(
      scaleBar({ extent: SCENE_EXTENT, sheetWidthPx: 900, zoom: 1 }).label
    );
  });

  it('respects the layer switches', () => {
    const fc = buildLayerGeoJSON({ water: { on: false }, builtin: { on: false } }, [], SCENE_GEO);
    expect(fc.features).toHaveLength(0);
    expect(fc.georeference.status).toBe('georeferenced');
  });

  it('carries the provenance of every number it ships', () => {
    expect(PROVENANCE.derived.aoi_area).toMatch(/shoelace/);
    expect(PROVENANCE.fixture.area_ha).toMatch(/answer bank/);
    expect(georefBlock(UNLOCATED_GEO).status).toBe('unlocated');
    expect(georefBlock(SCENE_GEO).crs).toBe('EPSG:4326');
    expect(georefBlock(null).status).toBe('unknown');
  });
});
