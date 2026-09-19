import { useEffect, useState } from 'react';
import { AvniMark, Icon } from './Icons.jsx';
import { Dot } from './ui.jsx';
import { useApp } from '../state/AppState.jsx';
import { AOI_NAME, buildLayerGeoJSON, downloadJSON, stamp } from '../lib/geo.js';

function useClock() {
  const [t, setT] = useState(stamp);
  useEffect(() => {
    const i = setInterval(() => setT(stamp()), 1000);
    return () => clearInterval(i);
  }, []);
  return t;
}

export default function Header() {
  const { layers, aoi, toast } = useApp();
  const clock = useClock();

  const exportLayers = () => {
    const gj = buildLayerGeoJSON(layers, aoi);
    downloadJSON(gj, `avni_layers_${clock.replace(/[:Z]/g, '')}.geojson`);
    toast('map layer exported · GeoJSON');
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-6 border-b hair bg-panel px-4">
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

      <div className="h-6 w-px bg-white/10" />

      {/* current AOI */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="lbl">AOI</span>
        <span className="truncate text-[12.5px] font-medium text-t1">{AOI_NAME}</span>
      </div>

      <div className="ml-auto flex items-center gap-5">
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
          className="flex items-center gap-1.5 text-[11.5px] text-accent transition-opacity hover:opacity-80"
        >
          <Icon name="download" size={14} />
          Download map layer
        </button>
      </div>
    </header>
  );
}
