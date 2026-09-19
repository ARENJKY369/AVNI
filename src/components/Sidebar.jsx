import { useRef } from 'react';
import { Icon } from './Icons.jsx';
import { Dot } from './ui.jsx';
import { useApp } from '../state/AppState.jsx';
import { SCENES } from '../data/mock.js';
import { fmtLat, fmtLon, gsdLabel, isGeoreferenced } from '../lib/geo.js';

function Section({ label, right, children, className = '' }) {
  return (
    <div className={`px-4 ${className}`}>
      <div className="mb-2.5 flex items-center justify-between">
        <span className="lbl">{label}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

function Dropzone() {
  const { uploadHover, setUploadHover, registerUpload } = useApp();
  const inputRef = useRef(null);

  const onFiles = (files) => {
    const f = files && files[0];
    if (f) registerUpload(f);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setUploadHover(true);
      }}
      onDragLeave={() => setUploadHover(false)}
      onDrop={(e) => {
        e.preventDefault();
        setUploadHover(false);
        onFiles(e.dataTransfer.files);
      }}
      className={`recess flex cursor-pointer flex-col items-center gap-1.5 border-dashed px-4 py-5 text-center transition-colors ${
        uploadHover ? '!border-accent/60 bg-accent/5' : ''
      }`}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        aria-label="register a scene file"
        accept="image/*,.tif,.tiff,.jp2,.safe"
        onChange={(e) => onFiles(e.target.files)}
      />
      <span className="text-accent">
        <Icon name="file" size={20} sw={1.4} />
      </span>
      <span className="text-[12.5px] font-semibold text-t1">
        {uploadHover ? 'release to register scene' : 'Drop optical or SAR scene'}
      </span>
      <span className="text-[10.5px] text-t3">Sentinel-2 L2A / Sentinel-1 GRD</span>
      <span className="mt-1 flex items-center gap-1 text-[11px] font-medium text-accent">
        <Icon name="upload" size={12} />
        Browse files
      </span>
    </div>
  );
}

export default function Sidebar() {
  const {
    bands,
    toggleBand,
    layers,
    toggleLayer,
    drawMode,
    setDrawMode,
    opticalFile,
    sceneB,
    toast,
    drawer,
    sceneGeo,
    restoreScene
  } = useApp();
  const georef = isGeoreferenced(sceneGeo);
  const bandsOn = bands.filter((b) => b.on).length;

  return (
    <aside
      className={`fixed bottom-0 left-0 top-14 z-40 flex w-[290px] max-w-[86vw] shrink-0 flex-col border-r hair bg-panel transition-transform duration-200 lg:relative lg:inset-auto lg:z-auto lg:translate-x-0 ${
        drawer === 'imagery' ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      {/* one scroll region for the whole rail: on short viewports the AOI
          block pins to the bottom instead of covering the last layer row */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-6 py-4">
          {/* IMAGERY */}
          <Section label="Imagery">
            <Dropzone />
            <div className="mt-2.5 space-y-1.5 px-0.5">
              <div className="flex items-center gap-2 text-[11.5px] text-t2">
                <Dot tone={opticalFile.uploaded ? 'warn' : 'live'} />
                <span className="truncate font-mono text-[11px] text-t1" title={opticalFile.file}>
                  {opticalFile.file}
                </span>
                <span className="ml-auto shrink-0 whitespace-nowrap text-[10px] text-t3">
                  {opticalFile.label}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11.5px] text-t2">
                <Dot tone="live" />
                <span className="truncate font-mono text-[11px] text-t1">{SCENES.sar.file}</span>
                <span className="ml-auto shrink-0 whitespace-nowrap text-[10px] text-t3">co-registered</span>
              </div>
              {sceneB && (
                <div className="flex items-center gap-2 text-[11.5px] text-t2">
                  <Dot tone="warn" />
                  <span className="truncate font-mono text-[11px] text-t1">{sceneB.file}</span>
                  <span className="ml-auto shrink-0 whitespace-nowrap text-[10px] text-warn">ΔT epoch</span>
                </div>
              )}
              {opticalFile.uploaded && (
                <button
                  onClick={restoreScene}
                  className="mt-1 flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/10"
                >
                  <Icon name="refresh" size={12} />
                  Restore bundled scene
                </button>
              )}
            </div>
          </Section>

          {/* BANDS */}
          <Section label="Bands" right={<span className="data-mono text-[10px] text-t3">{bandsOn} on</span>}>
            <ul className="space-y-1">
              {bands.map((b) => (
                <li key={b.id}>
                  <button
                    onClick={() => toggleBand(b.id)}
                    aria-pressed={b.on}
                    className="group flex w-full items-center gap-2.5 rounded-md px-2 py-[7px] text-left transition-colors hover:bg-white/[0.03]"
                  >
                    <span className={`chk ${b.on ? 'chk-on' : ''}`}>
                      {b.on && <Icon name="check" size={11} sw={2.4} />}
                    </span>
                    <span className={`text-[12px] ${b.on ? 'text-t1' : 'text-t2'}`}>{b.name}</span>
                    <span className="data-mono ml-auto text-t3 group-hover:text-t2">{b.code}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 px-2 text-[10px] leading-4 text-t3">
              Selected bands name the pass the next query runs.
            </p>
          </Section>

          {/* LAYERS */}
          <Section label="Layers">
            <ul className="space-y-1">
              {Object.values(layers).map((l) => (
                <li key={l.id}>
                  <button
                    onClick={() => toggleLayer(l.id)}
                    aria-pressed={l.on}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-[7px] text-left transition-colors hover:bg-white/[0.03]"
                  >
                    <span className="w-1.5">{l.on && <Dot tone={l.id === 'disagreement' ? 'warn' : 'accent'} />}</span>
                    <span className={`text-[12px] ${l.on ? 'text-t1' : 'text-t2'}`}>{l.name}</span>
                    <span className={`data-mono ml-auto ${l.on ? 'text-t2' : 'text-t3'}`}>
                      {l.on ? 'on' : 'off'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 px-2 text-[10px] leading-4 text-t3">
              Mask geometry is fixture data traced in image space; exports carry the same note.
            </p>
          </Section>
        </div>

        {/* AOI — pinned to the bottom of the scroll region */}
        <div className="sticky bottom-0 border-t hair bg-panel px-4 py-3.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="lbl">AOI</span>
            <span className="data-mono text-t3">{georef ? sceneGeo.crs : 'no CRS'}</span>
          </div>
          <button
            onClick={() => {
              setDrawMode(!drawMode);
              toast(drawMode ? 'AOI draw cancelled' : 'click the scene to place AOI vertices · Enter closes');
            }}
            aria-pressed={drawMode}
            className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] font-medium transition-colors ${
              drawMode ? 'bg-accent/15 text-accent' : 'text-accent hover:bg-accent/10'
            }`}
          >
            <Icon name="crosshair" size={13} />
            {drawMode ? 'Drawing… click scene' : 'Draw AOI'}
          </button>
          <div className="mt-2 space-y-0.5 text-[10.5px] leading-4 text-t3">
            {georef ? (
              <>
                <div className="data-mono">
                  {fmtLat(sceneGeo.extent.minLat)}–{fmtLat(sceneGeo.extent.maxLat)}
                </div>
                <div className="data-mono">
                  {fmtLon(sceneGeo.extent.minLon)}–{fmtLon(sceneGeo.extent.maxLon)}
                </div>
                <div>{gsdLabel(sceneGeo.extent, opticalFile.raster)} · declared footprint</div>
              </>
            ) : (
              <>
                <div className="text-warn">extent unverified — no CRS on this upload</div>
                <div>resolution unknown</div>
              </>
            )}
            <div>Acquisition date supplied by the analysis service</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
