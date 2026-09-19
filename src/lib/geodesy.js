// WGS84 geodesy, in one place and with no dependencies.
//
// Everything AVNI claims about the ground comes out of these functions: the
// declared footprint, the ground sample distance, the cursor readout, the AOI
// area, the place-name distance/bearing, and the UTM block in the exports.
//
// The reference values in geodesy.test.js are generated with PROJ (pyproj
// 3.7.2: `Geod(ellps="WGS84")` for distance/bearing/area and the EPSG:32643
// transform for UTM), so this module is checked against the same library a GIS
// would use rather than against itself.

export const WGS84 = Object.freeze({
  a: 6378137, // semi-major axis, metres
  f: 1 / 298.257223563 // flattening
});

export const SEMI_MINOR = WGS84.a * (1 - WGS84.f);
export const E2 = WGS84.f * (2 - WGS84.f); // first eccentricity squared
const EP2 = E2 / (1 - E2); // second eccentricity squared
const DEG = Math.PI / 180;

const sin2 = (lat) => Math.sin(lat * DEG) ** 2;

/** Meridional radius of curvature at a latitude (metres). */
export function meridionalRadius(lat) {
  return (WGS84.a * (1 - E2)) / Math.pow(1 - E2 * sin2(lat), 1.5);
}

/** Radius of curvature in the prime vertical at a latitude (metres). */
export function normalRadius(lat) {
  return WGS84.a / Math.sqrt(1 - E2 * sin2(lat));
}

/** Metres of northing per degree of latitude (meridional arc length). */
export function metresPerDegreeLat(lat) {
  return meridionalRadius(lat) * DEG;
}

/** Metres of easting per degree of longitude along a parallel. */
export function metresPerDegreeLon(lat) {
  return normalRadius(lat) * Math.cos(lat * DEG) * DEG;
}

/** Radius of the sphere with the same surface area as the ellipsoid (metres). */
export function authalicRadius() {
  return 6371007.180918475;
}

function haversineMetres(lat1, lon1, lat2, lon2) {
  const R = authalicRadius();
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Vincenty's inverse solution on the WGS84 ellipsoid: distance plus both end
 * azimuths, to millimetres and millionths of a degree over the spans this
 * console deals with. Falls back to a spherical solution for near-antipodal
 * pairs, where the iteration does not converge.
 */
export function geodesicInverse(lat1, lon1, lat2, lon2) {
  const spherical = () => ({
    distanceMetres: haversineMetres(lat1, lon1, lat2, lon2),
    initialBearingDeg: sphericalBearing(lat1, lon1, lat2, lon2),
    finalBearingDeg: (sphericalBearing(lat2, lon2, lat1, lon1) + 180) % 360,
    method: 'spherical'
  });
  if (lat1 === lat2 && lon1 === lon2) {
    return { distanceMetres: 0, initialBearingDeg: 0, finalBearingDeg: 0, method: 'exact' };
  }

  const { a, f } = WGS84;
  const b = SEMI_MINOR;
  const L = (lon2 - lon1) * DEG;
  const U1 = Math.atan((1 - f) * Math.tan(lat1 * DEG));
  const U2 = Math.atan((1 - f) * Math.tan(lat2 * DEG));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);

  let lambda = L;
  let lambdaP;
  let iterations = 0;
  let sinSigma = 0;
  let cosSigma = 0;
  let sigma = 0;
  let sinAlpha = 0;
  let cosSqAlpha = 0;
  let cos2SigmaM = 0;

  do {
    const sinLambda = Math.sin(lambda);
    const cosLambda = Math.cos(lambda);
    sinSigma = Math.hypot(cosU2 * sinLambda, cosU1 * sinU2 - sinU1 * cosU2 * cosLambda);
    if (sinSigma === 0) {
      return { distanceMetres: 0, initialBearingDeg: 0, finalBearingDeg: 0, method: 'exact' };
    }
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cosSqAlpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cosSqAlpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha;
    const C = (f / 16) * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
    lambdaP = lambda;
    lambda =
      L +
      (1 - C) *
        f *
        sinAlpha *
        (sigma +
          C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
  } while (Math.abs(lambda - lambdaP) > 1e-12 && ++iterations < 64);

  if (iterations >= 64) return spherical();

  const uSq = (cosSqAlpha * (a * a - b * b)) / (b * b);
  const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma =
    B *
    sinSigma *
    (cos2SigmaM +
      (B / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
          (B / 6) *
            cos2SigmaM *
            (-3 + 4 * sinSigma * sinSigma) *
            (-3 + 4 * cos2SigmaM * cos2SigmaM)));

  const sinLambda = Math.sin(lambda);
  const cosLambda = Math.cos(lambda);
  const deg = (rad) => ((rad / DEG) % 360 + 360) % 360;

  return {
    distanceMetres: b * A * (sigma - deltaSigma),
    initialBearingDeg: deg(
      Math.atan2(cosU2 * sinLambda, cosU1 * sinU2 - sinU1 * cosU2 * cosLambda)
    ),
    finalBearingDeg: deg(
      Math.atan2(cosU1 * sinLambda, -sinU1 * cosU2 + cosU1 * sinU2 * cosLambda)
    ),
    method: 'vincenty'
  };
}

/** Geodesic distance on the WGS84 ellipsoid (Vincenty inverse, mm-level here). */
export function geodesicDistanceMetres(lat1, lon1, lat2, lon2) {
  return geodesicInverse(lat1, lon1, lat2, lon2).distanceMetres;
}

/** Great-circle initial bearing (spherical fallback), degrees from north. */
function sphericalBearing(lat1, lon1, lat2, lon2) {
  const phi1 = lat1 * DEG;
  const phi2 = lat2 * DEG;
  const dLambda = (lon2 - lon1) * DEG;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/** Geodesic initial azimuth from point 1 to point 2, degrees clockwise from north. */
export function initialBearing(lat1, lon1, lat2, lon2) {
  return geodesicInverse(lat1, lon1, lat2, lon2).initialBearingDeg;
}

/** UTM zone number for a longitude (1–60). */
export function utmZone(lon) {
  return Math.floor((lon + 180) / 6) + 1;
}

/**
 * Forward Transverse Mercator (Snyder, "Map Projections — A Working Manual",
 * eq. 8-9…8-17) for the WGS84 ellipsoid, returning UTM easting/northing.
 * Agrees with PROJ to well under a centimetre inside a zone.
 */
export function utmForward(lat, lon) {
  const zone = utmZone(lon);
  const lon0 = (zone - 1) * 6 - 180 + 3; // central meridian
  const k0 = 0.9996;
  const E0 = 500000;
  const N0 = lat < 0 ? 10000000 : 0;

  const phi = lat * DEG;
  const A = (lon - lon0) * DEG * Math.cos(phi);
  const N = normalRadius(lat);
  const T = Math.tan(phi) ** 2;
  const C = EP2 * Math.cos(phi) ** 2;
  const e4 = E2 * E2;
  const e6 = e4 * E2;

  const M =
    WGS84.a *
    ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi -
      ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) -
      ((35 * e6) / 3072) * Math.sin(6 * phi));

  const easting =
    E0 +
    k0 *
      N *
      (A +
        ((1 - T + C) * A ** 3) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * A ** 5) / 120);

  const northing =
    N0 +
    k0 *
      (M +
        N *
          Math.tan(phi) *
          (A ** 2 / 2 +
            ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 +
            ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * A ** 6) / 720));

  return {
    zone,
    hemisphere: lat < 0 ? 'S' : 'N',
    easting: Math.round(easting * 1000) / 1000,
    northing: Math.round(northing * 1000) / 1000,
    label: `${zone}${lat < 0 ? 'S' : 'N'}`
  };
}

/**
 * Inverse Transverse Mercator (Snyder eq. 8-18…8-25): UTM easting/northing
 * back to latitude/longitude on WGS84. Used to turn the projected footprint
 * of a GeoTIFF/COG into the lat/lon box this console reports.
 *
 * `hemisphere` defaults to north (what every Indian UTM scene uses); pass 'S'
 * for southern-hemisphere northing conventions.
 */
export function utmToLatLon(easting, northing, zone, hemisphere = 'N') {
  const k0 = 0.9996;
  const E0 = 500000;
  const N0 = hemisphere === 'S' ? 10000000 : 0;

  const M = (northing - N0) / k0;
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  const mu = M / (WGS84.a * (1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));

  // footprint latitude
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const sin1 = Math.sin(phi1);
  const cos1 = Math.cos(phi1);
  const tan1 = Math.tan(phi1);
  const N1 = WGS84.a / Math.sqrt(1 - E2 * sin1 * sin1);
  const R1 = (WGS84.a * (1 - E2)) / (1 - E2 * sin1 * sin1) ** 1.5;
  const T1 = tan1 * tan1;
  const C1 = EP2 * cos1 * cos1;
  const D = (easting - E0) / (N1 * k0);

  const lat =
    phi1 -
    ((N1 * tan1) / R1) *
      (D ** 2 / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6) / 720);

  const lon0 = ((zone - 1) * 6 - 180 + 3) * DEG;
  const lon =
    lon0 +
    (D -
      ((1 + 2 * T1 + C1) * D ** 3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5) / 120) /
      cos1;

  return { lat: lat / DEG, lon: lon / DEG };
}

/** UTM zone number from an EPSG code (326xx = north, 327xx = south). */
export function utmZoneFromEpsg(epsg) {
  const code = Number(epsg);
  if (code >= 32601 && code <= 32660) return { zone: code - 32600, hemisphere: 'N' };
  if (code >= 32701 && code <= 32760) return { zone: code - 32700, hemisphere: 'S' };
  return null;
}

/**
 * Area of a lat/lon ring in square metres.
 *
 * The ring is projected onto the local tangent plane at its own centroid
 * (metres-per-degree from the WGS84 radii of curvature) and measured with the
 * shoelace formula. For the footprint-scale polygons this console deals with
 * the error against a geodesic computation is < 0.01 %.
 */
export function ringAreaM2(ring) {
  const pts = (ring || []).filter(
    (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon)
  );
  if (pts.length < 3) return 0;
  const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const mLat = metresPerDegreeLat(lat0);
  const mLon = metresPerDegreeLon(lat0);
  const o = pts[0];
  let sum = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const x1 = (p.lon - o.lon) * mLon;
    const y1 = (p.lat - o.lat) * mLat;
    const x2 = (q.lon - o.lon) * mLon;
    const y2 = (q.lat - o.lat) * mLat;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum / 2);
}

/** Ring area in square kilometres. */
export function ringAreaKm2(ring) {
  return ringAreaM2(ring) / 1e6;
}

/** Ring area in hectares. */
export function ringAreaHa(ring) {
  return ringAreaM2(ring) / 1e4;
}
