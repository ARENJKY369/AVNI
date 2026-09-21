// Reference values generated with PROJ (pyproj 3.7.2):
//
//   from pyproj import Geod, Transformer
//   g = Geod(ellps='WGS84'); t = Transformer.from_crs('EPSG:4326','EPSG:32643')
//   g.inv(lon1, lat1, lon2, lat2)        -> distance, azimuth
//   g.polygon_area_perimeter(lons, lats)-> area
//   t.transform(lon, lat)                -> UTM easting, northing
//
// If any of these tests ever fail, the console is claiming something about the
// ground that a GIS would disagree with.
import { describe, expect, it } from 'vitest';
import {
  SEMI_MINOR,
  WGS84,
  authalicRadius,
  geodesicDistanceMetres,
  initialBearing,
  meridionalRadius,
  metresPerDegreeLat,
  metresPerDegreeLon,
  normalRadius,
  ringAreaHa,
  ringAreaKm2,
  ringAreaM2,
  utmForward,
  utmZone
} from './geodesy.js';

const CENTRE = { lat: 12.9758, lon: 77.6027 }; // scene centre
const AOI_CENTROID = { lat: 12.9739, lon: 77.6093 };
const MG_ROAD = { lat: 12.9716, lon: 77.5946 };

describe('WGS84 ellipsoid', () => {
  it('carries the defining constants', () => {
    expect(WGS84.a).toBe(6378137);
    expect(WGS84.f).toBeCloseTo(1 / 298.257223563, 15);
    expect(SEMI_MINOR).toBeCloseTo(6356752.314245, 6); // PROJ: b
    expect(authalicRadius()).toBeCloseTo(6371007.1809, 4); // PROJ: R_a
  });

  it('matches PROJ radii of curvature at the scene latitude', () => {
    // PROJ: g.inv over a 1e-7 deg step at 12.9758 N gives the *local* scale
    // (110630.27998 m per degree of latitude, 108495.25757 per degree of
    // longitude). The 1-degree average is a different quantity - the meridian
    // arc - and is checked separately below.
    expect(metresPerDegreeLat(CENTRE.lat)).toBeCloseTo(110630.28, 2);
    expect(metresPerDegreeLon(CENTRE.lat)).toBeCloseTo(108495.258, 3);
    expect(meridionalRadius(0)).toBeCloseTo(6335439.327, 3);
    expect(normalRadius(0)).toBeCloseTo(6378137, 3);
    expect(normalRadius(90)).toBeCloseTo(6399593.626, 3);
  });

  it('integrates a meridian arc that PROJ agrees with', () => {
    // Simpson integration of M (the way Snyder computes meridian distance)
    // over one degree from the scene latitude: PROJ reports 110634.625567 m.
    const DEG = Math.PI / 180;
    const a = CENTRE.lat * DEG;
    const b = (CENTRE.lat + 1) * DEG;
    const n = 64;
    const h = (b - a) / n;
    const M = (rad) => meridionalRadius(rad / DEG);
    let sum = M(a) + M(b);
    for (let i = 1; i < n; i += 1) {
      sum += M(a + i * h) * (i % 2 ? 4 : 2);
    }
    expect((sum * h) / 3).toBeCloseTo(110634.625567, 1);
  });
});

describe('geodesic distance and bearing', () => {
  it('matches PROJ for a short line', () => {
    // PROJ: 746.2849807042388 m from the scene centre to the AOI centroid
    expect(
      geodesicDistanceMetres(CENTRE.lat, CENTRE.lon, AOI_CENTROID.lat, AOI_CENTROID.lon)
    ).toBeCloseTo(746.285, 3);
  });

  it('matches PROJ for the gazetteer point', () => {
    // PROJ: 1615.0695698465786 m from MG Road to the AOI centroid
    expect(
      geodesicDistanceMetres(MG_ROAD.lat, MG_ROAD.lon, AOI_CENTROID.lat, AOI_CENTROID.lon)
    ).toBeCloseTo(1615.07, 2);
  });

  it('is zero for coincident points and symmetric otherwise', () => {
    expect(geodesicDistanceMetres(12.1, 77.1, 12.1, 77.1)).toBe(0);
    const a = geodesicDistanceMetres(12.9, 77.5, 13.1, 77.8);
    const b = geodesicDistanceMetres(13.1, 77.8, 12.9, 77.5);
    expect(a).toBeCloseTo(b, 9);
  });

  it('does not diverge on near-antipodal pairs (haversine fallback)', () => {
    const d = geodesicDistanceMetres(0, 0, 0.5, 179.7);
    expect(d).toBeGreaterThan(19e6);
    expect(d).toBeLessThan(20.1e6);
  });

  it('matches PROJ initial azimuth', () => {
    // PROJ: g.inv(...) -> (az12 106.35847394406618, az21 -73.64004420193658)
    const az = initialBearing(CENTRE.lat, CENTRE.lon, AOI_CENTROID.lat, AOI_CENTROID.lon);
    expect(az).toBeCloseTo(106.3584739, 4);
    expect(initialBearing(12.9, 77.6, 13.1, 77.6)).toBeCloseTo(0, 3);
    expect(initialBearing(12.9, 77.6, 12.9, 77.8)).toBeCloseTo(90, 0);
  });
});

describe('UTM projection (EPSG:32643)', () => {
  it('puts the scene centre where PROJ puts it', () => {
    // PROJ: (782355.5692210561, 1435900.2603941525)
    const u = utmForward(CENTRE.lat, CENTRE.lon);
    expect(u.zone).toBe(43);
    expect(u.label).toBe('43N');
    expect(u.easting).toBeCloseTo(782355.569, 2);
    expect(u.northing).toBeCloseTo(1435900.26, 2);
  });

  it('matches PROJ at the footprint corners', () => {
    // PROJ: (771393.241017601, 1429638.9493379595) and (793313.5212610494, 1442166.8932540799)
    const sw = utmForward(12.920226, 77.501156);
    const ne = utmForward(13.031374, 77.704244);
    expect(sw.easting).toBeCloseTo(771393.241, 2);
    expect(sw.northing).toBeCloseTo(1429638.949, 2);
    expect(ne.easting).toBeCloseTo(793313.521, 2);
    expect(ne.northing).toBeCloseTo(1442166.893, 2);
  });

  it('assigns zones by longitude', () => {
    expect(utmZone(77.6)).toBe(43);
    expect(utmZone(-0.1)).toBe(30);
    expect(utmZone(179.9)).toBe(60);
    expect(utmForward(-33.9, 151.2).hemisphere).toBe('S');
  });
});

describe('ring areas', () => {
  // PROJ: g.polygon_area_perimeter for a 0.02 deg square near the centre
  const square = [
    { lat: 12.9658, lon: 77.5927 },
    { lat: 12.9858, lon: 77.5927 },
    { lat: 12.9858, lon: 77.6127 },
    { lat: 12.9658, lon: 77.6127 }
  ];

  it('matches PROJ to better than 0.01 %', () => {
    const proj = 4801144.329927921;
    expect(ringAreaM2(square)).toBeCloseTo(proj, -4);
    expect(Math.abs(ringAreaM2(square) - proj) / proj).toBeLessThan(1e-4);
  });

  it('exposes hectares and square kilometres', () => {
    expect(ringAreaHa(square)).toBeCloseTo(480.114, 2);
    expect(ringAreaKm2(square)).toBeCloseTo(4.80114, 4);
  });

  it('is zero below three points and independent of winding order', () => {
    expect(ringAreaM2([])).toBe(0);
    expect(ringAreaM2(square.slice(0, 2))).toBe(0);
    expect(ringAreaM2([...square].reverse())).toBeCloseTo(ringAreaM2(square), 6);
  });

  it('ignores malformed vertices', () => {
    expect(ringAreaM2([...square, { lat: NaN, lon: 77 }])).toBeCloseTo(
      ringAreaM2(square),
      6
    );
  });
});
