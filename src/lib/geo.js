// Geodetic helpers for AVNI. Everything here works in the scene's declared
// extent; nothing talks to a server.

import {
  BUILTIN_POLYS,
  CONFLICT_TYPES,
  DISAGREEMENT_CLUSTERS,
  LAYOVER_POLYS,
  WATER_PATHS
} from '../data/overlays.js';

// ---------------------------------------------------------------- */
// The declared footprint
// ---------------------------------------------------------------- */
// This extent is the registration reference for every product in the build,
// and it is *derived* rather than typed in — so the raster, the overlays and
// the exported coordinates can never disagree with it:
//
//   raster   1376 x 768 px (the bundled optical scene)
//   width    22.0305 km of ground, east-west, at the scene centre
//   height   follows from the raster aspect -> square 16.01 m/px ground sample
//
// Overlays, masks, AOI vertices and every export are mapped through this one
// extent (u to the right, v downward), so a mask at u=0.3 sits on the same
// ground as a lat/lon computed from u=0.3.

import {
  geodesicDistanceMetres,
  geodesicInverse,
  metresPerDegreeLat,
  metresPerDegreeLon,
  ringAreaHa,
  ringAreaKm2,
  utmForward
} from './geodesy.js';

export const SCENE_RASTER = { width: 1376, height: 768 };
export const SCENE_ASPECT = SCENE_RASTER.width / SCENE_RASTER.height;

const SCENE_CENTRE = { lat: 12.9758, lon: 77.6027 };
const SCENE_WIDTH_KM = 22.0305;

export const SCENE_GSD_M = (SCENE_WIDTH_KM * 1000) / SCENE_RASTER.width; // 16.01 m/px

// The spans come from the WGS84 radii of curvature at the scene centre
// (metres per degree of latitude / longitude), not from a round constant.
const metresLat = metresPerDegreeLat(SCENE_CENTRE.lat);
const metresLon = metresPerDegreeLon(SCENE_CENTRE.lat);
const latSpan = (SCENE_GSD_M * SCENE_RASTER.height) / metresLat;
const lonSpan = (SCENE_WIDTH_KM * 1000) / metresLon;

export const SCENE_EXTENT = {
  minLat: SCENE_CENTRE.lat - latSpan / 2,
  maxLat: SCENE_CENTRE.lat + latSpan / 2,
  minLon: SCENE_CENTRE.lon - lonSpan / 2,
  maxLon: SCENE_CENTRE.lon + lonSpan / 2,
  crs: 'EPSG:4326'
};

export function extentKm(extent = SCENE_EXTENT) {
  const midLat = (extent.minLat + extent.maxLat) / 2;
  return {
    widthKm: ((extent.maxLon - extent.minLon) * metresPerDegreeLon(midLat)) / 1000,
    heightKm: ((extent.maxLat - extent.minLat) * metresPerDegreeLat(midLat)) / 1000
  };
}

// Ground sample distance in metres per pixel, per axis. Product of the extent
// and the raster — never a typed-in constant.
export function groundSampleMetres(extent = SCENE_EXTENT, raster = SCENE_RASTER) {
  const { widthKm, heightKm } = extentKm(extent);
  return { x: (widthKm * 1000) / raster.width, y: (heightKm * 1000) / raster.height };
}

export function gsdLabel(extent = SCENE_EXTENT, raster = SCENE_RASTER) {
  const g = groundSampleMetres(extent, raster);
  const avg = (g.x + g.y) / 2;
  return avg >= 10 ? `${avg.toFixed(0)} m/px` : `${avg.toFixed(1)} m/px`;
}

// The scene sheet: the largest box with the raster's aspect ratio that fits in
// the viewer. Imagery, masks, AOI and conflicts all live inside it, so nothing
// is ever cropped away from the overlays drawn on top of it.
export function sheetSize(containerW, containerH, aspect = SCENE_ASPECT) {
  const w = Math.max(1, Math.min(containerW, containerH * aspect));
  return { w, h: Math.max(1, w / aspect) };
}

// A scale bar that cannot lie: the drawn pixel length and the labelled ground
// distance are the same number, by construction.
export function scaleBar({ extent = SCENE_EXTENT, sheetWidthPx = 1, zoom = 1, minPx = 26, maxPx = 92 } = {}) {
  const { widthKm } = extentKm(extent);
  const kmPerPx = widthKm / Math.max(1, sheetWidthPx) / zoom;
  const candidates = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
  let pick = candidates.find((c) => {
    const px = c / kmPerPx;
    return px >= minPx && px <= maxPx;
  });
  if (pick === undefined) pick = candidates.find((c) => c / kmPerPx >= minPx) ?? candidates[candidates.length - 1];
  const px = Math.max(8, Math.round(pick / kmPerPx));
  return {
    px,
    km: pick,
    label: pick >= 1 ? `${pick} km` : `${Math.round(pick * 1000)} m`,
    kmPerPx
  };
}

// ---------------------------------------------------------------- */
// Georeference + place resolution
// ---------------------------------------------------------------- */
// AVNI does not name a place it cannot locate. Coordinates come from the
// scene's declared footprint (exact by definition); the NAME is the
// nearest entry in this embedded gazetteer, always reported with its
// distance and bearing so the reader can judge it for themselves.
// Accuracy class ~1 km: enough to say "central Bengaluru", not enough to
// say which street. No network — this works air-gapped.

export const GAZETTEER_ACCURACY_KM = 1;

export const GAZETTEER = [
  { name: 'MG Road', region: 'Bengaluru, Karnataka', lat: 12.9756, lon: 77.6068 },
  { name: 'Cubbon Park', region: 'Bengaluru, Karnataka', lat: 12.9763, lon: 77.5929 },
  { name: 'Bengaluru', region: 'Karnataka', lat: 12.9716, lon: 77.5946 },
  { name: 'Rajajinagar', region: 'Bengaluru, Karnataka', lat: 12.9916, lon: 77.5523 },
  { name: 'Jayanagar', region: 'Bengaluru, Karnataka', lat: 12.9308, lon: 77.5838 },
  { name: 'Banashankari', region: 'Bengaluru, Karnataka', lat: 12.9255, lon: 77.5468 },
  { name: 'Koramangala', region: 'Bengaluru, Karnataka', lat: 12.9352, lon: 77.6245 },
  { name: 'HSR Layout', region: 'Bengaluru, Karnataka', lat: 12.9116, lon: 77.6389 },
  { name: 'Marathahalli', region: 'Bengaluru, Karnataka', lat: 12.9569, lon: 77.7011 },
  { name: 'Whitefield', region: 'Bengaluru, Karnataka', lat: 12.9698, lon: 77.75 },
  { name: 'Hebbal', region: 'Bengaluru, Karnataka', lat: 13.0358, lon: 77.597 },
  { name: 'Yelahanka', region: 'Bengaluru, Karnataka', lat: 13.1007, lon: 77.5963 },
  { name: 'Kengeri', region: 'Bengaluru, Karnataka', lat: 12.9171, lon: 77.4857 },
  { name: 'Electronic City', region: 'Bengaluru, Karnataka', lat: 12.8452, lon: 77.6602 },
  { name: 'Anekal', region: 'Karnataka', lat: 12.7083, lon: 77.6964 },
  { name: 'Hosur', region: 'Tamil Nadu', lat: 12.7409, lon: 77.8253 }
];

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/**
 * Ground distance in kilometres, on the WGS84 ellipsoid (Vincenty). The name
 * says geodesic because that is what it is — an earlier build used a spherical
 * haversine with a mean radius, which is ~0.3 % off at this latitude.
 */
export function distanceKm(lat1, lon1, lat2, lon2) {
  return geodesicDistanceMetres(lat1, lon1, lat2, lon2) / 1000;
}

/** Compass label for the geodesic azimuth from (lat1,lon1) toward (lat2,lon2). */
export function bearingLabel(lat1, lon1, lat2, lon2) {
  const { initialBearingDeg } = geodesicInverse(lat1, lon1, lat2, lon2);
  return COMPASS[Math.round(initialBearingDeg / 45) % 8];
}

export function nearestPlace(lat, lon) {
  let best = null;
  for (const p of GAZETTEER) {
    const km = distanceKm(lat, lon, p.lat, p.lon);
    if (!best || km < best.km) best = { ...p, km };
  }
  return {
    name: best.name,
    region: best.region,
    distanceKm: best.km,
    bearing: bearingLabel(lat, lon, best.lat, best.lon)
  };
}

// "MG Road 0.4 km NE" — the place is that far and that way from the point.
export function placeSummary(lat, lon) {
  const p = nearestPlace(lat, lon);
  const d =
    p.distanceKm < 0.1
      ? 'at'
      : `${p.distanceKm < 10 ? p.distanceKm.toFixed(1) : Math.round(p.distanceKm)} km ${p.bearing}`;
  return { ...p, short: d === 'at' ? p.name : `${p.name} ${d}`, distance: d };
}

export function aoiCentroid(aoiPoints, geo = null) {
  const n = aoiPoints.length;
  const u = aoiPoints.reduce((s, p) => s + p.u, 0) / n;
  const v = aoiPoints.reduce((s, p) => s + p.v, 0) / n;
  return toGeo(u, v, geo);
}

/** The drawn AOI as a lat/lon ring — the same vertices the viewer renders. */
export function aoiRing(aoiPoints = [], geo = null) {
  return aoiPoints.map((p) => toGeo(p.u, p.v, geo));
}

/**
 * Area of the drawn AOI, computed from the ring itself (WGS84 radii of
 * curvature at its centroid, shoelace on the local tangent plane). This is a
 * derived number: move the AOI and it changes. The answer card's area is the
 * analysis service's figure and is labelled as such.
 */
export function aoiAreaKm2(aoiPoints = [], geo = null) {
  return ringAreaKm2(aoiRing(aoiPoints, geo));
}

export function aoiAreaHa(aoiPoints = [], geo = null) {
  return ringAreaHa(aoiRing(aoiPoints, geo));
}

/** UTM zone label for a point, e.g. "43N". */
export function utmZoneLabel(lat, lon) {
  return utmForward(lat, lon).label;
}

/** UTM block for a point — the projection an Indian EO pipeline reports in. */
export function utmBlock(lat, lon) {
  const utm = utmForward(lat, lon);
  return {
    zone: utm.label,
    easting_m: utm.easting,
    northing_m: utm.northing,
    note: 'WGS84 / UTM, computed from the footprint centre'
  };
}

// The bundled scene carries a declared footprint; an arbitrary upload does
// not, and AVNI says so rather than reusing the last known coordinates.
export const SCENE_GEO = {
  status: 'georeferenced',
  crs: SCENE_EXTENT.crs,
  extent: SCENE_EXTENT,
  source: 'declared scene footprint',
  note: 'coordinates exact · place name ~1 km'
};

export const UNLOCATED_GEO = {
  status: 'unlocated',
  crs: null,
  extent: null,
  source: 'no CRS / georeference metadata on upload',
  note: 'no coordinates reported'
};

export const isGeoreferenced = (geo) => !!geo && geo.status === 'georeferenced';

// The one gate every export path goes through: a scene without a CRS has no
// coordinates to write, so nothing writes them.
export function withheldGeodetic(geo) {
  return {
    withheld: true,
    reason: 'scene is not georeferenced',
    source: geo?.source || 'no CRS / georeference metadata'
  };
}

/**
 * The footprint every u,v is resolved against. A registered upload brings its
 * own extent (read from GeoTIFF tags or the SAFE metadata); scenes with no
 * georeference never reach here because the geodesy features switch off.
 */
export const extentOf = (geo) => geo?.extent || SCENE_EXTENT;

// u,v are 0..1 fractions across the displayed scene (v from the top,
// image-space) -> geographic coordinates, on the *registered* footprint.
export function toGeo(u, v, geo = null) {
  const ext = extentOf(geo);
  const lat = ext.maxLat - v * (ext.maxLat - ext.minLat);
  const lon = ext.minLon + u * (ext.maxLon - ext.minLon);
  return { lat, lon };
}

export function fmtLat(lat) {
  return `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}`;
}
export function fmtLon(lon) {
  return `${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`;
}

// ------------------------------------------------------------------ */
// Overlay geometry -> geographic geometry
// ------------------------------------------------------------------ */
// The viewer's overlays are fixture geometry in 0-100 image space. The
// exports are generated from *those same* paths, mapped through the declared
// footprint — so a layer file always describes what is on screen instead of
// a hardcoded lat/lon nobody can point at.

const uvToGeo = (x, y) => {
  const g = toGeo(x / 100, y / 100);
  return [g.lon, g.lat];
};

// Flattens an SVG path made of cubic segments (the river strokes) into points.
export function flattenPath(d, steps = 10) {
  const nums = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  if (nums.length < 8) return [];
  const pts = [[nums[0], nums[1]]];
  let cur = [nums[0], nums[1]];
  for (let i = 2; i + 5 < nums.length + 1 && i + 5 <= nums.length; i += 6) {
    const [x1, y1, x2, y2, x, y] = nums.slice(i, i + 6);
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps;
      const mt = 1 - t;
      pts.push([
        mt ** 3 * cur[0] + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t ** 3 * x,
        mt ** 3 * cur[1] + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t ** 3 * y
      ]);
    }
    cur = [x, y];
  }
  return pts;
}

const pointsToRing = (points, close = true) => {
  const ring = points.map((p) => uvToGeo(p[0], p[1]));
  if (close) ring.push(ring[0]);
  return ring;
};

const polyStringToPoints = (s) =>
  s
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(',').map(Number));

// ------------------------------------------------------------------ */
// GeoJSON export
// ------------------------------------------------------------------ */

export function boxAround(lat, lon, areaHa) {
  const side = Math.sqrt(Math.max(0, areaHa) * 10000); // metres
  const dLat = side / 2 / metresPerDegreeLat(lat);
  const dLon = side / 2 / metresPerDegreeLon(lat);
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat - dLat],
    [lon + dLon, lat + dLat],
    [lon - dLon, lat + dLat],
    [lon - dLon, lat - dLat]
  ];
}

const CRS_BLOCK = { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } };

/**
 * Provenance of every number this console shows. It travels with the exports
 * so a reader never has to guess which figures are measured and which are the
 * mock analysis service's fixtures.
 */
export const PROVENANCE = Object.freeze({
  derived: {
    extent: 'declared scene footprint (raster aspect x 22.0305 km ground width)',
    ground_sample_distance: 'extent / raster pixels, WGS84 metres per degree',
    scale_bar: 'extent / sheet width / zoom — the drawn length and the label are one measurement',
    cursor_position: 'pointer -> uv -> WGS84 lat/lon through the footprint',
    aoi_centroid: 'mean of the drawn AOI vertices',
    aoi_area: 'WGS84 radii of curvature at the ring centroid, shoelace on the tangent plane',
    utm: 'Snyder forward transverse Mercator (EPSG:32643), checked against PROJ',
    place_name: `nearest embedded gazetteer entry (~${GAZETTEER_ACCURACY_KM} km accuracy class)`,
    layer_geometry: 'the overlay paths as drawn in image space, mapped through the footprint'
  },
  fixture: {
    answer_text: 'AVNI-VL 0.9 answer bank (mock analysis service)',
    consistency: 'answer bank score; the gate verdict is derived from it',
    physics_check: 'answer bank NDWI / sigma0 readings',
    area_ha: 'answer bank area, centred on the derived AOI centroid',
    acquisition_dates: 'scene metadata fixture'
  }
});

const refusal = (geo) => ({
  type: 'FeatureCollection',
  name: 'avni_refused',
  crs: CRS_BLOCK,
  georeference: georefBlock(geo),
  features: [],
  note: `no geometries written — ${geo?.source || 'scene is not georeferenced'}`
});

export function georefBlock(geo) {
  return geo
    ? { status: geo.status, crs: geo.crs, source: geo.source, note: geo.note }
    : { status: 'unknown', crs: null, source: 'no scene georeference supplied' };
}

// The answer footprint: the CENTROID comes from the AOI the user drew, the
// area from the analysis fixture. Nothing here is a hardcoded coordinate.
export function buildAnswerGeoJSON(answer, centroid, geo = SCENE_GEO, aoiPoints = []) {
  if (!isGeoreferenced(geo) || !centroid) return refusal(geo);
  const { lat, lon } = centroid;
  const areaHa = answer.geodetic?.area_ha ?? 0;
  return {
    type: 'FeatureCollection',
    name: 'avni_answer',
    crs: CRS_BLOCK,
    georeference: georefBlock(geo),
    utm: utmBlock(lat, lon),
    provenance: PROVENANCE,
    features: [
      {
        type: 'Feature',
        properties: {
          kind: 'answer_centroid',
          question: answer.question,
          consistency: answer.confidence.consistency_score,
          abstained: answer.confidence.abstained,
          ndwi: answer.physics_check.ndwi,
          sar_db: answer.physics_check.sar_backscatter_db,
          centroid_source: 'drawn AOI centroid',
          generated_at: new Date().toISOString()
        },
        geometry: { type: 'Point', coordinates: [lon, lat] }
      },
      {
        type: 'Feature',
        properties: {
          kind: 'answer_footprint',
          area_ha: areaHa,
          area_source: 'analysis-service area fixture, centred on the drawn AOI',
          aoi_area_km2: aoiPoints.length > 2 ? Number(aoiAreaKm2(aoiPoints).toFixed(4)) : null,
          aoi_area_source: 'derived from the drawn AOI ring',
          method: 'AVNI water mask ∩ AOI'
        },
        geometry: { type: 'Polygon', coordinates: [boxAround(lat, lon, areaHa)] }
      }
    ]
  };
}

// Map layers as drawn: water stroke, built-up footprints, conflicts, AOI.
export function buildLayerGeoJSON(layers, aoiPoints, geo = SCENE_GEO) {
  if (!isGeoreferenced(geo)) return refusal(geo);

  const feats = [];

  if (layers.water?.on) {
    feats.push({
      type: 'Feature',
      properties: {
        layer: 'water_mask',
        method: 'NDWI>0.45 ∩ σ0<-14dB',
        geometry_note: 'river centreline as drawn (fixture overlay, image space)'
      },
      geometry: { type: 'LineString', coordinates: flattenPath(WATER_PATHS.optical).map((p) => uvToGeo(p[0], p[1])) }
    });
  }

  if (layers.builtin?.on) {
    feats.push({
      type: 'Feature',
      properties: {
        layer: 'built_up',
        method: 'VH texture + NDBI',
        geometry_note: 'footprints as drawn (fixture overlay, image space)'
      },
      geometry: {
        type: 'MultiPolygon',
        coordinates: BUILTIN_POLYS.map((p) => [pointsToRing(polyStringToPoints(p))])
      }
    });
  }

  if (layers.layover?.on) {
    feats.push({
      type: 'Feature',
      properties: { layer: 'layover', method: 'radar geometry envelope', geometry_note: 'fixture overlay' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: LAYOVER_POLYS.map((p) => [pointsToRing(polyStringToPoints(p))])
      }
    });
  }

  if (layers.disagreement?.on) {
    for (const c of DISAGREEMENT_CLUSTERS) {
      feats.push({
        type: 'Feature',
        properties: {
          layer: 'disagreement',
          conflict_type: c.type,
          conflict_name: CONFLICT_TYPES[c.type]?.name,
          note: c.note
        },
        geometry: { type: 'Polygon', coordinates: [pointsToRing(polyStringToPoints(c.pts))] }
      });
    }
  }

  if (aoiPoints && aoiPoints.length > 2) {
    const c = aoiCentroid(aoiPoints);
    const place = placeSummary(c.lat, c.lon);
    feats.push({
      type: 'Feature',
      properties: {
        layer: 'aoi',
        area_of_interest: true,
        name: place.name,
        region: place.region,
        place_offset: place.distance,
        place_source: `embedded gazetteer (~${GAZETTEER_ACCURACY_KM} km)`,
        centroid: [Number(c.lon.toFixed(6)), Number(c.lat.toFixed(6))],
        area_km2: Number(aoiAreaKm2(aoiPoints).toFixed(4)),
        area_source: 'derived from the drawn AOI ring',
        utm_zone: utmZoneLabel(c.lat, c.lon),
        utm_easting_m: utmBlock(c.lat, c.lon).easting_m,
        utm_northing_m: utmBlock(c.lat, c.lon).northing_m
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            ...aoiPoints.map((p) => uvToGeo(p.u * 100, p.v * 100)),
            uvToGeo(aoiPoints[0].u * 100, aoiPoints[0].v * 100)
          ]
        ]
      }
    });
  }

  return {
    type: 'FeatureCollection',
    name: 'avni_map_layers',
    crs: CRS_BLOCK,
    georeference: georefBlock(geo),
    note: 'Mask/conflict geometry is synthetic fixture data traced in image space and mapped through the declared footprint (see README).',
    features: feats
  };
}

export function downloadJSON(obj, filename, mime = 'application/geo+json') {
  const blob = new Blob([JSON.stringify(obj, null, 2)], {
    type: mime
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

export function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`;
}
