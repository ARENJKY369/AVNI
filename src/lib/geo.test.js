import { describe, expect, it } from 'vitest';
import {
  aoiCentroid,
  SCENE_EXTENT,
  SCENE_GEO,
  SCENE_RASTER,
  UNLOCATED_GEO,
  bearingLabel,
  boxAround,
  buildAnswerGeoJSON,
  buildLayerGeoJSON,
  extentKm,
  flattenPath,
  fmtLat,
  fmtLon,
  groundSampleMetres,
  haversineKm,
  nearestPlace,
  placeSummary,
  scaleBar,
  sheetSize,
  toGeo
} from './geo.js';
import { BUILTIN_POLYS, WATER_PATHS } from '../data/overlays.js';

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

describe('declared footprint', () => {
  it('matches the raster aspect ratio, so imagery and overlays share one grid', () => {
    const { widthKm, heightKm } = extentKm();
    expect(widthKm / heightKm).toBeCloseTo(SCENE_RASTER.width / SCENE_RASTER.height, 2);
  });

  it('yields a square ground sample distance derived from extent and raster', () => {
    const g = groundSampleMetres();
    expect(g.x).toBeCloseTo(g.y, 1);
    expect(g.x).toBeGreaterThan(15);
    // the old build printed "10 m/px" from a constant that no raster could honour
    expect(g.x).not.toBeCloseTo(10, 0);
  });

  it('maps the corners of uv space onto the extent', () => {
    expect(toGeo(0, 0)).toEqual({ lat: SCENE_EXTENT.maxLat, lon: SCENE_EXTENT.minLon });
    expect(toGeo(1, 1)).toEqual({ lat: SCENE_EXTENT.minLat, lon: SCENE_EXTENT.maxLon });
  });

  it('formats hemispheres with the right suffix', () => {
    expect(fmtLat(12.9739)).toBe('12.9739°N');
    expect(fmtLat(-12.9739)).toBe('12.9739°S');
    expect(fmtLon(77.6093)).toBe('77.6093°E');
  });
});

describe('geodesy', () => {
  it('measures a known short distance', () => {
    // MG Road -> Cubbon Park, independent re-computation: ~0.33 km
    expect(haversineKm(12.9756, 77.6068, 12.9763, 77.5929)).toBeCloseTo(1.5, 0);
    expect(haversineKm(12.9756, 77.6068, 12.9756, 77.6068)).toBe(0);
  });

  it('labels bearings', () => {
    expect(bearingLabel(12.9, 77.6, 13.1, 77.6)).toBe('N');
    expect(bearingLabel(12.9, 77.6, 12.9, 77.8)).toBe('E');
    expect(bearingLabel(12.9, 77.6, 12.7, 77.6)).toBe('S');
  });

  it('resolves the AOI centroid to a real gazetteer entry', () => {
    const c = aoiCentroid(AOI);
    const place = nearestPlace(c.lat, c.lon);
    expect(place.name).toBe('MG Road');
    expect(place.distanceKm).toBeLessThan(10);
    expect(placeSummary(c.lat, c.lon).short).toContain('MG Road');
  });

  it('keeps boxAround area honest', () => {
    const ring = boxAround(12.9716, 77.5946, 4.7);
    const mLat = 110630;
    const mLon = 111320 * Math.cos((12.9716 * Math.PI) / 180);
    let area = 0;
    for (let i = 0; i < ring.length - 1; i += 1) {
      const [x1, y1] = [ring[i][0] * mLon, ring[i][1] * mLat];
      const [x2, y2] = [ring[i + 1][0] * mLon, ring[i + 1][1] * mLat];
      area += x1 * y2 - x2 * y1;
    }
    expect(Math.abs(area / 2) / 10000).toBeCloseTo(4.7, 1);
  });
});

describe('scale bar', () => {
  it('describes exactly the ground the drawn bar covers', () => {
    for (const [w, z] of [[1010, 1], [1010, 2.4], [640, 1], [1600, 5]]) {
      const bar = scaleBar({ sheetWidthPx: w, zoom: z });
      expect(bar.px * bar.kmPerPx).toBeCloseTo(bar.km, 1);
    }
  });

  it('scales km-per-pixel with zoom', () => {
    const fit = scaleBar({ sheetWidthPx: 1000, zoom: 1 });
    const zoomed = scaleBar({ sheetWidthPx: 1000, zoom: 2 });
    expect(zoomed.kmPerPx).toBeCloseTo(fit.kmPerPx / 2, 6);
  });
});

describe('scene sheet', () => {
  it('fits inside the viewer without cropping the footprint', () => {
    const s = sheetSize(1010, 854);
    expect(s.w / s.h).toBeCloseTo(SCENE_RASTER.width / SCENE_RASTER.height, 2);
    expect(s.w).toBeLessThanOrEqual(1010.001);
    expect(s.h).toBeLessThanOrEqual(854.001);
  });
});

describe('layer geometry', () => {
  it('flattens the drawn water path instead of inventing a box', () => {
    const pts = flattenPath(WATER_PATHS.optical);
    expect(pts.length).toBeGreaterThan(20);
    expect(pts[0]).toEqual([103, 1]);
  });

  it('writes nothing at all when the scene is unlocated', () => {
    const gj = buildLayerGeoJSON(ALL_LAYERS, AOI, UNLOCATED_GEO);
    expect(gj.features).toHaveLength(0);
    expect(gj.georeference.status).toBe('unlocated');
    expect(JSON.stringify(gj)).not.toMatch(/12\.9|77\.5/);
  });

  it('derives features from the drawn overlays inside the declared extent', () => {
    const gj = buildLayerGeoJSON(ALL_LAYERS, AOI, SCENE_GEO);
    const byLayer = Object.fromEntries(gj.features.map((f) => [f.properties.layer, f]));
    expect(byLayer.water_mask.geometry.type).toBe('LineString');
    expect(byLayer.built_up.geometry.type).toBe('MultiPolygon');
    expect(byLayer.built_up.geometry.coordinates).toHaveLength(BUILTIN_POLYS.length);
    expect(byLayer.aoi.properties.name).toBeTruthy();

    const flat = [];
    const collect = (c) => (typeof c[0] === 'number' ? flat.push(c) : c.forEach(collect));
    gj.features.forEach((f) => collect(f.geometry.coordinates));
    for (const [lon, lat] of flat) {
      expect(lon).toBeGreaterThanOrEqual(SCENE_EXTENT.minLon - 0.02);
      expect(lon).toBeLessThanOrEqual(SCENE_EXTENT.maxLon + 0.02);
      expect(lat).toBeGreaterThanOrEqual(SCENE_EXTENT.minLat - 0.02);
      expect(lat).toBeLessThanOrEqual(SCENE_EXTENT.maxLat + 0.02);
    }
    // the old hardcoded "water"/"built-up" boxes must be gone
    expect(JSON.stringify(gj)).not.toContain('77.5936007');
  });
});

describe('answer footprint', () => {
  const answer = {
    question: 'q',
    confidence: { consistency_score: 0.47, abstained: false },
    physics_check: { ndwi: 0.61, sar_backscatter_db: -3.2 },
    geodetic: { area_ha: 4.7 }
  };

  it('centres on the AOI the user drew, not a fixture constant', () => {
    const c = aoiCentroid(AOI);
    const gj = buildAnswerGeoJSON(answer, c, SCENE_GEO);
    expect(gj.features[0].geometry.coordinates[0]).toBeCloseTo(c.lon, 6);
    expect(gj.features[0].geometry.coordinates[1]).toBeCloseTo(c.lat, 6);
    expect(gj.features[0].properties.centroid_source).toMatch(/AOI/);
  });

  it('refuses to write geometry for an unlocated scene', () => {
    const gj = buildAnswerGeoJSON(answer, aoiCentroid(AOI), UNLOCATED_GEO);
    expect(gj.features).toHaveLength(0);
    expect(gj.name).toBe('avni_refused');
  });
});
