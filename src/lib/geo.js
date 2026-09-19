// Geodetic helpers for AVNI. Everything here works in the scene's
// registered extent; nothing talks to a server.

export const SCENE_EXTENT = {
  minLat: 12.9024,
  maxLat: 13.0491,
  minLon: 77.5011,
  maxLon: 77.7042,
  crs: 'EPSG:4326'
};

export const AOI_NAME = 'Bengaluru–Hosur corridor';

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

export function buildLayerGeoJSON(layers, aoiPoints) {
  const feats = [];
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
      properties: { layer: 'aoi', name: AOI_NAME },
      geometry: { type: 'Polygon', coordinates: [ring] }
    });
  }
  return {
    type: 'FeatureCollection',
    name: 'avni_map_layers',
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
    features: feats
  };
}

export function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], {
    type: 'application/geo+json'
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
