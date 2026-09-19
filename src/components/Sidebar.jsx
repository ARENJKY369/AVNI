import { useRef, useState } from 'react';
import { Icon } from './Icons.jsx';
import { Dot } from './ui.jsx';
import { useApp } from '../state/AppState.jsx';
import { SCENES } from '../data/mock.js';
import { useFocusTrap, useMedia } from '../lib/hooks.js';
import {
  aoiAreaKm2,
  aoiCentroid,
  fmtLat,
  fmtLon,
  gsdLabel,
  isGeoreferenced,
  utmBlock
} from '../lib/geo.js';
import { ACCEPT_ATTR, SUPPORT_MATRIX, UNSUPPORTED_NOTE } from '../lib/scene-format.js';
import { stopNote } from '../lib/segment.js';

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
  const { uploadHover, setUploadHover, registerUpload, registerSafeFolder, registerUrl, sceneBusy, opticalFile } =
    useApp();
  const inputRef = useRef(null);
  const folderRef = useRef(null);
  const [showUrl, setShowUrl] = useState(false);
  const [url, setUrl] = useState('');

  const onFiles = (files) => {
    if (!files || !files.length) return;
    // a folder drop arrives as many files with webkitRelativePath set
    const isFolder = Array.from(files).some((f) => f.webkitRelativePath) || files.length > 1;
    if (isFolder) registerSafeFolder(files);
    else registerUpload(files[0]);
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
      className={`recess flex flex-col gap-2 border-dashed px-4 py-4 transition-colors ${
        uploadHover ? '!border-accent/60 bg-accent/5' : ''
      }`}
    >
      <div className="flex cursor-pointer flex-col items-center gap-1.5 text-center" onClick={() => inputRef.current?.click()}>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          aria-label="register a scene file"
          accept={ACCEPT_ATTR}
          onChange={(e) => onFiles(e.target.files)}
        />
        <input
          ref={folderRef}
          type="file"
          className="hidden"
          multiple
          // @ts-ignore — webkitdirectory is the only way to hand the browser a folder
          webkitdirectory=""
          directory=""
          aria-label="register a Sentinel SAFE folder"
          onChange={(e) => onFiles(e.target.files)}
        />
        <span className="text-accent">
          <Icon name="file" size={20} sw={1.4} />
        </span>
        <span className="text-[12.5px] font-semibold text-t1">
          {uploadHover ? 'release to register scene' : 'Drop imagery — file, folder or ZIP'}
        </span>
        <span className="text-[10px] leading-4 text-t3">
          GeoTIFF · COG · JPEG2000 · Sentinel SAFE (folder or .zip)
          <br />
          PNG/JPEG accepted as a fallback — no CRS, geodesy off
        </span>
        <span className="mt-1 flex items-center gap-1 text-[11px] font-medium text-accent">
          <Icon name="upload" size={12} />
          Browse files
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 border-t hair pt-2">
        <button
          className="text-[10.5px] font-medium text-t2 transition-colors hover:text-t1"
          onClick={() => folderRef.current?.click()}
        >
          open a .SAFE folder
        </button>
        <button
          className="text-[10.5px] font-medium text-t2 transition-colors hover:text-t1"
          aria-expanded={showUrl}
          onClick={() => setShowUrl((v) => !v)}
        >
          load from URL
        </button>
      </div>

      {showUrl && (
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            registerUrl(url);
            setUrl('');
          }}
        >
          <input
            className="input h-7 flex-1 text-[11px]"
            placeholder="https://…/tile.tif (COG reads ranges)"
            aria-label="scene URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button type="submit" className="icon-btn !h-7 !w-7">
            <Icon name="send" size={12} />
          </button>
        </form>
      )}

      {sceneBusy && (
        <span className="flex items-center gap-1.5 text-[10.5px] text-accent" role="status">
          <span className="spin-slow inline-flex">
            <Icon name="refresh" size={11} />
          </span>
          {sceneBusy.stage}
          {sceneBusy.name ? ` · ${String(sceneBusy.name).split('/').pop().slice(0, 32)}` : ''}
        </span>
      )}

      <details className="text-[10px] text-t3">
        <summary className="cursor-pointer">what AVNI reads</summary>
        <ul className="mt-1.5 space-y-1">
          {SUPPORT_MATRIX.map((row) => (
            <li key={row.id} className="flex justify-between gap-2">
              <span className="text-t2">{row.name}</span>
              <span className="text-right">{row.read}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-t3">{UNSUPPORTED_NOTE}.</p>
      </details>
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
    restoreScene,
    aoi,
    resetAoi,
    segmentMode,
    setSegmentMode,
    segment,
    segBusy,
    applySegment,
    clearSegment
  } = useApp();
  const georef = isGeoreferenced(sceneGeo);
  const bandsOn = bands.filter((b) => b.on).length;
  const panelRef = useRef(null);
  const isDesktop = useMedia('(min-width: 1024px)');
  const asDrawer = !isDesktop && drawer === 'imagery';
  const offscreen = !isDesktop && drawer !== 'imagery';
  useFocusTrap(panelRef, asDrawer);
  const centroid = aoiCentroid(aoi, sceneGeo);
  const aoiArea = aoiAreaKm2(aoi, sceneGeo);

  return (
    <aside
      ref={panelRef}
      id="imagery-panel"
      aria-label="imagery rail"
      role={asDrawer ? 'dialog' : undefined}
      aria-modal={asDrawer ? 'true' : undefined}
      aria-hidden={offscreen || undefined}
      inert={offscreen ? '' : undefined}
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
                  {opticalFile.uploaded ? opticalFile.formatLabel || opticalFile.label : opticalFile.label}
                </span>
              </div>
              {opticalFile.uploaded && (opticalFile.notes?.length > 0 || opticalFile.georef) && (
                <div className="rounded-md border hair bg-recess/60 px-2 py-1.5 text-[10px] leading-4 text-t3">
                  {opticalFile.georef?.status === 'georeferenced' ? (
                    <span className="text-accent">
                      {opticalFile.georef.crs} · footprint from {opticalFile.georef.source}
                    </span>
                  ) : (
                    <span className="text-warn">no CRS in this file — geodesy features are off</span>
                  )}
                  {opticalFile.notes?.slice(0, 3).map((n) => (
                    <span key={n} className="block truncate">
                      {n}
                    </span>
                  ))}
                </div>
              )}
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
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => {
                setSegmentMode(!segmentMode);
                toast(
                  segmentMode
                    ? 'segment mode off'
                    : 'click the region you mean — AVNI grows a mask and traces its outline'
                );
              }}
              aria-pressed={segmentMode}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] font-medium transition-colors ${
                segmentMode ? 'bg-accent/15 text-accent' : 'text-accent hover:bg-accent/10'
              }`}
            >
              <Icon name="crosshair" size={13} />
              {segmentMode ? 'Segmenting… click region' : 'Segment region'}
            </button>
            <button
              onClick={() => {
                setDrawMode(!drawMode);
                toast(drawMode ? 'AOI draw cancelled' : 'click the scene to place AOI vertices · Enter closes');
              }}
              aria-pressed={drawMode}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] font-medium transition-colors ${
                drawMode ? 'bg-accent/15 text-accent' : 'text-t2 hover:bg-white/5 hover:text-t1'
              }`}
            >
              <Icon name="pen" size={13} />
              {drawMode ? 'Drawing…' : 'Draw polygon'}
            </button>
            <button
              onClick={resetAoi}
              title="restore the AOI to the scene default"
              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] font-medium text-t3 transition-colors hover:bg-white/5 hover:text-t1"
            >
              <Icon name="refresh" size={12} />
              Reset
            </button>
          </div>

          {(segmentMode || segment) && (
            <div className="mt-2 rounded-md border border-accent/30 bg-accent/5 px-2 py-1.5 text-[10.5px] leading-4 text-t2">
              {segBusy
                ? 'growing region from the seed…'
                : segment
                  ? `${segment.stats.outlineVertices} vertices · ${(segment.stats.coverage * 100).toFixed(1)}% of the scene${stopNote(segment) ? ` · ${stopNote(segment)}` : ''}`
                  : 'click a region on the scene · shift adds · alt subtracts'}
              {segment && (
                <span className="mt-1 flex gap-1.5">
                  <button
                    onClick={applySegment}
                    className="rounded bg-accent/15 px-1.5 py-0.5 font-medium text-accent"
                  >
                    Use as AOI
                  </button>
                  <button onClick={clearSegment} className="rounded px-1.5 py-0.5 text-t3 hover:text-t1">
                    Clear
                  </button>
                </span>
              )}
            </div>
          )}
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
                <div className="data-mono" title="derived from the drawn AOI ring, WGS84">
                  AOI {aoiArea.toFixed(1)} km² · {fmtLat(centroid.lat)} {fmtLon(centroid.lon)}
                </div>
                <div className="data-mono" title="Snyder forward transverse Mercator, checked against PROJ">
                  UTM {utmBlock(centroid.lat, centroid.lon).zone} ·{' '}
                  {utmBlock(centroid.lat, centroid.lon).easting_m.toFixed(0)} E
                </div>
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
