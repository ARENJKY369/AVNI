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
npm test           # unit + contract tests (vitest)
```

## What is in the box

- **Three-panel instrument shell** — imagery/bands/layers rail, scene viewer,
  query panel. Flat hairline borders, monospace reserved strictly for real
  data (coordinates, dB, EPSG codes, band math).
- **Viewer** — OPTICAL / SAR / BLEND display sources with an adjustable
  optical↔SAR blend, live cursor-derived lat/lon readout, dashed AOI polygon
  with click-to-draw redraw (`Draw AOI`, Enter closes, Esc cancels),
  water / built-up / layover masks, and a disagreement overlay where optical
  and SAR classifications fight, colour-coded by conflict type.
- **One registered grid** — the scene sheet *is* the declared footprint: the
  raster's aspect ratio, fitted inside the viewer, with imagery filled into
  it. Masks, AOI, conflicts and the exported coordinates all come off that
  single mapping, so nothing drifts off the pixels and the optical and SAR
  rasters (different pixel sizes) land on the same ground.
- **A scale bar that cannot lie** — its drawn length and its label are the
  same measurement, computed from the declared footprint and the current zoom.
  Ground sample distance is derived the same way (16.0 m/px for the bundled
  scene) instead of being typed in.
- **Runs on the kit you have** — the full three-panel console on a desktop;
  below 1024 px the imagery rail and query panel become slide-over drawers,
  so the same build stays usable on a phone or tablet. `npm run
  shots:responsive` measures the phone layout and fails if it overflows.
- **Honest georeferencing** — the AOI is named from its own centroid, not a
  hardcoded string: coordinates come from the scene's declared footprint
  (exact) and the place name from an embedded gazetteer, always reported
  with distance, bearing and its ~1 km accuracy class. Drop in a scene with
  no CRS and the console says so instead of reusing the last known
  coordinates — header, viewer readout, sidebar extent, answer geodetic row
  and **every export path** (JSON bundle, Markdown report, GeoJSON footprint,
  map layers) withhold, and the exports record which of the two states
  produced them. A file the browser cannot decode (GeoTIFF, JP2) is reported
  as having no preview rather than leaving the last scene's pixels on screen.
- **Offline-safe typography** — Inter and JetBrains Mono are self-hosted
  woff2 subsets, not a CDN fetch: the instrument panel renders identically on
  conference WiFi or an air-gapped SAC network.
- **Answers with evidence** — every answer carries a consistency ring with a
  hard abstain gate (AVNI declines instead of guessing), an amber
  physics-check callout (NDWI vs σ0 backscatter on a real dB axis), a
  collapsible execution trace with its source files, and a geodetic row that
  downloads the answer footprint as real GeoJSON. The gate, the score, the
  "n of 8 orientations" line and the trace are all derived from one number, so
  the card can never contradict the rule it prints.
- **Cross-modal + bi-temporal work** — attach a second epoch from the query
  panel to unlock CHANGE ΔT mode: a draggable swipe compare plus a causal
  attribution breakdown whose hectares are computed from its own percentages.
- **Export everything** — per-answer "Export result" menu (JSON evidence
  bundle, Markdown analyst report, GeoJSON footprint), a session-level
  Markdown report from the query panel header, and layer export from the app
  header. Follow-ups that read like exports *are* exports.
- **Field texture** — annotations, analyst comments, north arrow, scale bar,
  UTC session clock, toasts.

## What is fixture and what is derived

Being explicit about this is the point of the build:

| Derived from the scene (exact) | Fixture (synthetic, labelled as such) |
| --- | --- |
| Scene extent, GSD, scale bar | Mask/conflict overlay geometry (traced in image space) |
| Cursor lat/lon, AOI centroid | Answer text, consistency scores, physics readings |
| Gazetteer distance/bearing (~1 km class) | Execution-trace step names and values |
| Export geometry (mapped through the extent) | Acquisition dates, sensor labels |

The UI says so in the layers rail, and the layer exports carry the same note.
When a number is a fixture, it is presented as a fixture; when it is derived,
it is derived at render time rather than typed in.

## Keyboard

| key | action |
| --- | --- |
| `/` | focus the query composer |
| `1` `2` `3` `4` | OPTICAL / SAR / BLEND / CHANGE display source |
| `Enter` | send query · close AOI draft |
| `Esc` | cancel AOI draft · close the export menu |
| `+` / `−` | zoom the scene in / out |
| `0` | fit the scene (reset zoom + pan) |

The map is skipped while you are typing and never fires with a modifier held.

## Stack

React 18 + Vite + Tailwind. Inter for UI, JetBrains Mono for data, both
self-hosted. No backend: scene, tiles and model responses are fixture data
wired through a single app store, so the console runs from a static build.

## Verification

The evidence scripts are runnable by anyone now — they use the Chromium that
ships with `@sparticuz/chromium`, take the target from `AVNI_URL` (default
`http://localhost:5173`) and write downloads to a temp directory:

| command | what it proves |
| --- | --- |
| `npm test` | geodetic maths, footprint/raster invariants, gate derivation, intent routing, and the withhold contract for every exporter |
| `npm run lint` | eslint (flat config) — correctness rules only: undefined identifiers, dropped updater side effects, stale hook closures, unsafe optional chaining |
| `npm run verify:console` | 26 end-to-end checks: gate arithmetic, scale-bar truth, draw-mode click isolation, scroll behaviour, export actions (including the exported GeoJSON's ring), toggle toasts, the unlocated upload path, responsive shell |
| `npm run verify:zoom` | the point under the cursor survives zoom and pan; scale bar matches the ground; drawers and phone overflow |
| `npm run verify:location` | place names resolve and recompute; a CRS-less upload withholds everywhere, including the bytes inside the JSON bundle; an undecodable file is refused outright |
| `npm run verify:segment` | segmentation marking: every click on the scene marks a region, the tolerance slider grows the same seed monotonically, shift adds, and Enter turns the outline into the AOI |
| `npm run verify:a11y` | axe-core over the shell, mid-answer, the guide dialog and the phone drawer; every visible control has an accessible name |
| `npm run verify:features` | the four imagery containers end to end (GeoTIFF, COG over HTTP, JPEG2000, Sentinel SAFE), the second-epoch swipe (your file is what is compared) plus the zoom/segmentation promises |
| `npm run verify:robustness` | nine malformed uploads (empty, truncated, renamed, not-a-SAFE zip, a header claiming 2 MB that is not there) refused by name with the scene intact, then a deterministic 120-action random walk over the real controls with the invariant checker armed |
| `npm run verify` | lint first, then the whole chain above, in order |
| `npm run shots` / `npm run shots:responsive` | regenerates `shots/*.jpg` (the committed screenshots) |

CI runs `npm ci && npm test && npm run build` on every push
(`.github/workflows/ci.yml`).
