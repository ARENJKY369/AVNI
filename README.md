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
- **Answers with evidence** — every answer carries a consistency ring with a
  hard abstain gate (AVNI declines instead of guessing), an amber
  physics-check callout (NDWI vs σ0 backscatter with verdict), a collapsible
  execution trace with source files, and a geodetic row that downloads the
  answer footprint as real GeoJSON.
- **Cross-modal + bi-temporal work** — attach a second epoch from the query
  panel to unlock CHANGE ΔT mode: a draggable swipe compare plus a causal
  attribution breakdown (seasonal vs shadow vs genuine change).
- **Field texture** — annotations, analyst comments, north arrow, scale bar,
  UTC session clock, toasts.

## Keyboard

| key | action |
| --- | ------ |
| `/` | focus the query composer |
| `1` `2` `3` `4` | OPTICAL / SAR / BLEND / CHANGE display source |
| `Enter` | send query · close AOI draft |
| `Esc` | cancel AOI draft |

## Stack

React 18 + Vite + Tailwind. Inter for UI, JetBrains Mono for data.
