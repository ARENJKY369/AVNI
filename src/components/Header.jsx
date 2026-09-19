import { useEffect, useMemo, useState } from 'react';
import { AvniMark, Icon } from './Icons.jsx';
import { Dot } from './ui.jsx';
import { useApp } from '../state/AppState.jsx';
import {
  aoiCentroid,
  buildLayerGeoJSON,
  downloadJSON,
  fmtLat,
  fmtLon,
  isGeoreferenced,
  placeSummary,
  stamp
} from '../lib/geo.js';

function useClock() {
  const [t, setT] = useState(stamp);
  useEffect(() => {
    const i = setInterval(() => setT(stamp()), 1000);
    return () => clearInterval(i);
  }, []);
  return t;
}

export default function Header() {
  const { layers, aoi, toast, drawer, setDrawer, sceneGeo } = useApp();
  const clock = useClock();

  const georef = isGeoreferenced(sceneGeo);
  const place = useMemo(
    () => (georef ? placeSummary(aoiCentroid(aoi).lat, aoiCentroid(aoi).lon) : null),
    [georef, aoi]
  );

  const exportLayers = () => {
    const gj = buildLayerGeoJSON(layers, aoi, sceneGeo);
    downloadJSON(gj, `avni_layers_${clock.replace(/[:Z]/g, '')}.geojson`);
    toast('map layer exported · GeoJSON');
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b hair bg-panel px-3 md:gap-6 md:px-4">
      {/* small screens: the imagery rail slides over the viewer */}
      <button
        className={`icon-btn shrink-0 lg:hidden ${drawer === 'imagery' ? 'icon-btn-on' : ''}`}
        title="imagery panel"
        onClick={() => setDrawer(drawer === 'imagery' ? null : 'imagery')}
      >
        <Icon name="layers" size={16} />
      </button>

      {/* identity */}
      <div className="flex items-center gap-2.5">
        <AvniMark size={30} />
        <div className="leading-none">
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-bold tracking-wide text-t1">AVNI</span>
            <span className="hidden font-mono text-[9px] text-t3 sm:inline">अवनि · the earth</span>
          </div>
          <div className="mt-1 text-[10px] text-t3">SIH 26167 · SAC/ISRO</div>
        </div>
      </div>

      <div className="hidden h-6 w-px bg-white/10 md:block" />

      {/* current AOI — name resolved from the AOI centroid, never hardcoded */}
      <div className="hidden min-w-0 items-center gap-2 sm:flex">
        <span className="lbl">AOI</span>
        {georef ? (
          <span
            className="flex min-w-0 items-center gap-1.5"
            title={`AOI centroid ${fmtLat(aoiCentroid(aoi).lat)} ${fmtLon(aoiCentroid(aoi).lon)} · scene footprint declared in ${sceneGeo.crs} (exact) · place name from embedded gazetteer (~1 km)`}
          >
            <span className="truncate text-[12.5px] font-medium text-t1">{place.name}</span>
            <span className="hidden shrink-0 text-[11px] text-t3 lg:inline">{place.distance}</span>
            <span className="pill hidden shrink-0 !h-[19px] !px-1.5 !text-[9.5px] xl:inline-flex">
              gazetteer ±1 km
            </span>
          </span>
        ) : (
          <span
            className="flex min-w-0 items-center gap-1.5"
            title={`${sceneGeo.source} — AVNI withholds coordinates and place names it cannot verify`}
          >
            <span className="pill shrink-0 !h-[19px] !border-warn/50 !bg-warn/10 !px-1.5 !text-[9.5px] font-semibold uppercase tracking-wider !text-warn">
              unlocated
            </span>
            <span className="truncate text-[11.5px] text-t3">no CRS on this upload</span>
          </span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-3 md:gap-5">
        <div className="hidden items-center gap-2 md:flex">
          <span className="lbl">Session</span>
          <span className="pill pill-active !h-[20px] !px-2 font-semibold">ACTIVE</span>
          <span className="data-mono text-t3">{clock}</span>
        </div>

        <div className="hidden items-center gap-1.5 text-[11.5px] text-t2 lg:flex">
          <Dot tone="live" pulse />
          analysis service
        </div>

        <button
          onClick={exportLayers}
          title="download map layer · GeoJSON"
          className="flex items-center gap-1.5 text-[11.5px] text-accent transition-opacity hover:opacity-80"
        >
          <Icon name="download" size={14} />
          <span className="hidden sm:inline">Download map layer</span>
        </button>

        <button
          className={`icon-btn shrink-0 lg:hidden ${drawer === 'query' ? 'icon-btn-on' : ''}`}
          title="query panel"
          onClick={() => setDrawer(drawer === 'query' ? null : 'query')}
        >
          <Icon name="comment" size={16} />
        </button>
      </div>
    </header>
  );
}
