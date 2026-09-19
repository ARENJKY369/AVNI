# AVNI — अवनि · scene interrogation console

AVNI ("the earth") is a frontend-only console for asking natural-language
questions of co-registered optical + SAR scenes, built for the SIH 26167 /
SAC-ISRO problem statement. There is no backend in this repository: the
analysis service, consistency scoring, physics cross-check and execution
traces are all simulated against realistic mock payloads, but every panel is
wired to behave as if it were live.

## Run it

```
npm install
npm run dev        # http://localhost:5173
npm run build      # production bundle in dist/
```

## What is in the box

- **Three-panel instrument shell** — imagery/bands/layers rail, scene viewer,
  query panel. Flat hairline borders, monospace reserved strictly for real
  data (coordinates, dB, EPSG codes, band math).
- **Viewer** — OPTICAL / SAR / BLEND display sources with an adjustable
  optical↔SAR blend, live cursor-derived lat/lon/elevation readout, dashed
  AOI polygon with click-to-draw redraw (`Draw AOI`, Enter closes, Esc
  cancels), water / built-up / layover masks, and a disagreement overlay
  where optical and SAR classifications fight, colour-coded by conflict type
  (cloud occlusion, radar geometry, genuine anomaly, temporal offset).
- **Real map navigation** — scroll to zoom anchored on the pointer, drag to
  pan, `+` / `−` / `0` for step-zoom and fit, and a scale bar that re-labels
  itself as you zoom (500 m → 2 km). Imagery, masks, AOI and conflict
  polygons zoom as one registered sheet, so overlays never drift off the
  terrain; annotation and coordinate readouts stay truthful under transform.
- **Runs on the kit you have** — the full three-panel console on a desktop;
  below 1024 px the imagery rail and query panel become slide-over drawers,
  so the same build stays usable on a phone or tablet.
- **Offline-safe typography** — Inter and JetBrains Mono are self-hosted
  woff2 subsets (165 KB), not a CDN fetch: the instrument panel renders
  identically on conference Wi-Fi or an air-gapped SAC network.
- **Answers with evidence** — every answer carries a consistency ring with a
  hard abstain gate (AVNI declines instead of guessing), an amber
  physics-check callout (NDWI vs σ0 backscatter with verdict), a collapsible
  execution trace with source files, and a geodetic row that downloads the
  answer footprint as real GeoJSON.
- **Cross-modal + bi-temporal work** — attach a second epoch from the query
  panel to unlock CHANGE ΔT mode: a draggable swipe compare plus a causal
  attribution breakdown (seasonal vs shadow vs genuine change).
- **Export everything** — per-answer "Export result" menu (JSON evidence
  bundle, Markdown analyst report, GeoJSON footprint), a session-level
  Markdown report from the query panel header, and layer export from the
  app header.
- **Field texture** — annotations, analyst comments, north arrow, scale bar,
  UTC session clock, toasts.

## Keyboard

| key | action |
| --- | ------ |
| `/` | focus the query composer |
| `1` `2` `3` `4` | OPTICAL / SAR / BLEND / CHANGE display source |
| `Enter` | send query · close AOI draft |
| `Esc` | cancel AOI draft |
| `+` / `−` | zoom the scene in / out |
| `0` | fit the scene (reset zoom + pan) |

## Stack

React 18 + Vite + Tailwind. Inter for UI, JetBrains Mono for data, both
self-hosted. No backend: scene, tiles and model responses are fixture data
wired through a single app store, so the console runs from a static build.
