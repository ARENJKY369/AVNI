import { useRef } from 'react';
import { Icon } from './Icons.jsx';
import { useFocusTrap, useEscape } from '../lib/hooks.js';
import { ABSTAIN_GATE } from '../lib/model.js';
import { GAZETTEER_ACCURACY_KM } from '../lib/geo.js';

const KEYS = [
  ['/', 'focus the query composer'],
  ['1 2 3 4', 'optical · sar · blend · change'],
  ['Enter', 'send the question · close an AOI draft'],
  ['Esc', 'cancel the AOI draft · close menus and panels'],
  ['+  −', 'zoom the scene'],
  ['0', 'fit the whole footprint'],
  ['arrows', 'pan the scene'],
  ['d', 'start an AOI draw'],
  ['?', 'this panel']
];

const DERIVED = [
  ['extent, GSD, scale bar', 'from the raster aspect and the declared ground width'],
  ['cursor lat/lon, AOI centroid and area', 'from the pointer and the ring, WGS84'],
  ['UTM zone/easting/northing', 'Snyder forward transverse Mercator, checked against PROJ'],
  ['place name', `nearest embedded gazetteer entry (~${GAZETTEER_ACCURACY_KM} km class)`],
  ['layer geometry in exports', 'the overlay paths as drawn, mapped through the footprint']
];

const FIXTURE = [
  ['answer text, consistency, physics readings', 'the AVNI-VL 0.9 answer bank'],
  ['footprint area (ha)', 'answer bank figure, centred on the derived AOI centroid'],
  ['acquisition dates and sensor labels', 'scene metadata fixture']
];

export default function HelpDialog({ open, onClose }) {
  const ref = useRef(null);
  useFocusTrap(ref, open);
  useEscape(onClose, open);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/80 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        className="recess relative max-h-[86vh] w-full max-w-[560px] overflow-y-auto px-5 py-4"
      >
        <div className="mb-3 flex items-center gap-2">
          <span className="lbl" id="help-title">
            console guide
          </span>
          <button
            onClick={onClose}
            className="icon-btn ml-auto !h-7 !w-7"
            aria-label="close the console guide"
            title="close (Esc)"
          >
            <Icon name="x" size={13} />
          </button>
        </div>

        <p className="text-[12.5px] leading-[19px] text-t2">
          Ask a question in the composer, or draw an AOI on the scene and AVNI answers with its
          evidence attached: the consistency score, the physics cross-check, the execution trace and
          the geodetic row. Press <span className="data-mono text-t1">Enter</span> to send.
        </p>

        <h3 className="lbl mt-4">keyboard</h3>
        <ul className="mt-1.5 space-y-1">
          {KEYS.map(([k, what]) => (
            <li key={k} className="flex items-center gap-3 text-[11.5px] text-t2">
              <span className="data-mono w-16 shrink-0 rounded border border-edge bg-panel px-1.5 py-0.5 text-center text-[10.5px] text-t1">
                {k}
              </span>
              {what}
            </li>
          ))}
        </ul>

        <h3 className="lbl mt-4">what is measured, what is mock</h3>
        <div className="mt-1.5 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-accent">
              derived from the scene
            </div>
            <ul className="space-y-1">
              {DERIVED.map(([what, how]) => (
                <li key={what} className="text-[11px] leading-4 text-t2">
                  <span className="text-t1">{what}</span>
                  <span className="text-t3"> — {how}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-warn">
              fixture (analysed by AVNI-VL 0.9)
            </div>
            <ul className="space-y-1">
              {FIXTURE.map(([what, how]) => (
                <li key={what} className="text-[11px] leading-4 text-t2">
                  <span className="text-t1">{what}</span>
                  <span className="text-t3"> — {how}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="mt-3 border-t border-edge pt-2.5 text-[11px] leading-4 text-t3">
          Every answer carries the gate it used: below {ABSTAIN_GATE} consistency AVNI declines
          instead of guessing, and every export withholds coordinates when the scene has no CRS.
        </p>
      </div>
    </div>
  );
}
