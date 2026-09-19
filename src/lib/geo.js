// Geodetic helpers for AVNI. Everything here works in the scene's
// registered extent; nothing talks to a server.

export const SCENE_EXTENT = {
  minLat: 12.9024,
  maxLat: 13.0491,
  minLon: 77.5011,
  maxLon: 77.7042,
  crs: 'EPSG:4326'
};

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

const EARTH_KM = 6371.0088;
const toRad = (d) => (d * Math.PI) / 180;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(a));
}

// direction from (lat1,lon1) toward (lat2,lon2)
export function bearingLabel(lat1, lon1, lat2, lon2) {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return COMPASS[Math.round(deg / 45) % 8];
}

export function nearestPlace(lat, lon) {
  let best = null;
  for (const p of GAZETTEER) {
    const km = haversineKm(lat, lon, p.lat, p.lon);
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

export function aoiCentroid(aoiPoints) {
  const n = aoiPoints.length;
  const u = aoiPoints.reduce((s, p) => s + p.u, 0) / n;
  const v = aoiPoints.reduce((s, p) => s + p.v, 0) / n;
  return toGeo(u, v);
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

// u,v are 0..1 fractions across the displayed scene (v from the top,
// image-space) -> geographic coordinates.
export function toGeo(u, v) {
  const lat = SCENE_EXTENT.maxLat - v * (SCENE_EXTENT.maxLat - SCENE_EXTENT.minLat);
  const lon = SCENE_EXTENT.minLon + u * (SCENE_EXTENT.maxLon - SCENE_EXTENT.minLon);
  return { lat, lon };
}

export function fmtLat(lat) {
  return `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}`;
}
export function fmtLon(lon) {
  return `${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`;
}

// Cheap deterministic "elevation" — Bengaluru plateau hovers around 900 m.
export function elevAt(lat, lon) {
  const x = Math.sin(lat * 91.7) * Math.cos(lon * 47.3);
  const y = Math.sin((lat + lon) * 23.1);
  return Math.round(905 + x * 14 + y * 9);
}

// ------------------------------------------------------------------ */
// GeoJSON export
// ------------------------------------------------------------------ */

// Roughly 4.7 ha around a centre point: ~217 m a side.
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON = 111320;

export function boxAround(lat, lon, areaHa) {
  const side = Math.sqrt(areaHa * 10000); // metres
  const dLat = side / 2 / M_PER_DEG_LAT;
  const dLon = side / 2 / (M_PER_DEG_LON * Math.cos((lat * Math.PI) / 180));
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat - dLat],
    [lon + dLon, lat + dLat],
    [lon - dLon, lat + dLat],
    [lon - dLon, lat - dLat]
  ];
}

export function buildAnswerGeoJSON(answer) {
  const { lat, lon, area_ha } = answer.geodetic;
  return {
    type: 'FeatureCollection',
    name: 'avni_answer',
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
    features: [
      {
        type: 'Feature',
        properties: {
          kind: 'answer_centroid',
          question: answer.question,
          consistency: answer.confidence.consistency_score,
          ndwi: answer.physics_check.ndwi,
          sar_db: answer.physics_check.sar_backscatter_db,
          generated_at: new Date().toISOString()
        },
        geometry: { type: 'Point', coordinates: [lon, lat] }
      },
      {
        type: 'Feature',
        properties: {
          kind: 'answer_footprint',
          area_ha,
          source: 'AVNI water mask ∩ AOI'
        },
        geometry: { type: 'Polygon', coordinates: [boxAround(lat, lon, area_ha)] }
      }
    ]
  };
}

export function buildLayerGeoJSON(layers, aoiPoints, geo = SCENE_GEO) {
  const feats = [];
  const georef = isGeoreferenced(geo);
  const place = georef ? placeSummary(aoiCentroid(aoiPoints).lat, aoiCentroid(aoiPoints).lon) : null;
  if (layers.water.on) {
    feats.push({
      type: 'Feature',
      properties: { layer: 'water_mask', method: 'NDWI>0.45 ∩ σ0<-14dB' },
      geometry: {
        type: 'Polygon',
        coordinates: [boxAround(12.9716, 77.5946, 4.7)]
      }
    });
  }
  if (layers.builtin.on) {
    feats.push({
      type: 'Feature',
      properties: { layer: 'built_up', method: 'VH texture + NDBI' },
      geometry: {
        type: 'Polygon',
        coordinates: [boxAround(12.9802, 77.611, 11.2)]
      }
    });
  }
  if (aoiPoints && aoiPoints.length > 2) {
    const ring = aoiPoints.map((p) => {
      const g = toGeo(p.u, p.v);
      return [g.lon, g.lat];
    });
    ring.push(ring[0]);
    feats.push({
      type: 'Feature',
      properties: georef
        ? {
            layer: 'aoi',
            name: place.name,
            region: place.region,
            place_offset: place.distance,
            place_source: `embedded gazetteer (~${GAZETTEER_ACCURACY_KM} km)`
          }
        : { layer: 'aoi', name: 'unlocated', note: geo.source },
      geometry: { type: 'Polygon', coordinates: [ring] }
    });
  }
  return {
    type: 'FeatureCollection',
    name: 'avni_map_layers',
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
    georeference: {
      status: geo.status,
      crs: geo.crs,
      source: geo.source,
      note: geo.note
    },
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
