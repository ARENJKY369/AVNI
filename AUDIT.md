# AVNI — code & product audit

**Repo:** `ARENJKY369/AVNI` @ `5b47847` (v0.9.4) · **Scope:** full source read, production build, numeric
verification of the geodetic maths, and execution of the export functions with a stubbed DOM.
**Verification methods are stated next to each finding** — `[code]` = read from source, `[run]` = executed,
`[shot]` = reproduced in the committed screenshots, `[measured]` = arithmetic on the repo's own numbers.

---

## 1. Rating

| Lens | Score | Why |
| --- | --- | --- |
| **As a hackathon front-end / demo build** | **8.5 / 10** | Genuinely beautiful, complete, coherent story, runs offline, works on desktop + phone. Would impress a SIH jury. |
| **As production-ready code** | **5 / 10** | No tests, no CI, no lint, no error boundary, dead controls, and the headline "honest georeferencing" claim is broken by the exports. |
| **Engineering hygiene / reproducibility** | **4 / 10** | The only verification scripts cannot be run by anyone but the author (missing deps, hardcoded `/home/user/AVNI/...`, no npm scripts). 24 MB of PNGs in git. |
| **Weighted overall** | **7.3 → 7.5 / 10** | Excellent craft, average rigour. |

**Category breakdown**

| Category | Score |
| --- | --- |
| Visual design & craft | 9.5 |
| Product thinking / UX narrative | 9.0 |
| Front-end architecture (state, components, i18n-free clarity) | 7.5 |
| Correctness of geospatial maths | 5.0 |
| Integrity of the "honesty" claims (the product's core promise) | 5.0 |
| Accessibility | 4.5 |
| Testing / CI / tooling | 3.0 |
| Documentation | 8.0 (good README, a few claims now drift from the code) |

**One-line verdict:** this is a *stunning instrument panel wrapped around a mock that does not always tell
the truth it advertises*. Everything visible is polished; the bugs live one layer down, in the geodetic
math and in the export paths — which are exactly the parts a SAC/ISRO evaluator would poke at.

---

## 2. What is genuinely good (so the fixes don't break it)

- Consistent design system: `index.css` primitives (`.lbl .pill .recess .chip .icon-btn .data-mono`) used
  everywhere, no stray inline colours. `[code]`
- Self-hosted woff2 subsets, zero network calls at runtime — the air-gap claim is real. `[code]` `[run]`
- Clean pointer-front → scene-sheet transform: zoom is anchored on the cursor, pan is clamped, overlays,
  AOI, masks and conflict polygons all live inside the one transformed sheet, and the readout inverts the
  transform correctly (verified: at 172 % zoom the cursor pill reports 12.9757 °N 77.6026 °E and tracks the
  sheet). `[shot 09-zoom-masks.png]`
- The unlocated-upload state is real honesty machinery: header, viewer readout, sidebar extent and the
  answer geodetic row all flip to "withheld". `[shot 11-unlocated.png]`
- GeoJSON/`Blob` downloads are real, `URL.revokeObjectURL` is cleaned up, no `dangerouslySetInnerHTML`, no
  secrets, no eval, no network egress → no XSS/injection surface. `[code]`
- README is unusually good. `[code]`
- Production build is clean: 65 kB gzip JS + 6 kB gzip CSS; no build warnings. `[run npx vite build]`

---

## 3. Bugs, worst first

### 🔴 P0 — Integrity bugs (the app contradicts its own selling point)

**B1. The JSON evidence bundle leaks the exact coordinates the console says it withholds.**
`src/lib/export.js:31-44`. The file writes `crs: payload.geodetic.crs` on line 37 and then spreads
`...payload` on line 39, which re-adds the full `geodetic` object — `lat`, `lon`, `area_ha`, `crs` — so an
"unlocated" scene still exports real coordinates to disk. The Markdown report and the GeoJSON path *do*
withhold correctly, so the three export paths disagree with each other.

`[run]` — the real functions executed against a stubbed DOM:

```
=== unlocated evidence bundle ===
top-level crs        : "EPSG:4326"
georeference.status  : "unlocated"
top-level geodetic   : {"lat":12.9716,"lon":77.5946,"area_ha":4.7,"crs":"EPSG:4326"}
=> coordinates still written? true
```
**Fix:** delete the payload's `geodetic` (or replace it with the withheld block) when
`!isGeoreferenced(sceneGeo)`; make all three exporters call one shared `withholdIfUnlocated()` helper.

**B2. The layer export emits real coordinates even when the scene is "unlocated".**
`src/lib/geo.js:192-235`. `buildLayerGeoJSON` skips the *place name* when ungeoreferenced but still writes
hardcoded Bengaluru polygons (`boxAround(12.9716, 77.5946, 4.7)` and `boxAround(12.9802, 77.611, 11.2)`,
lines 202 and 212) plus the AOI ring via `toGeo()`. `[run]`:

```
[["water_mask",[77.5936007545937,12.97061938287549]],
 ["built_up",[77.60945742153739,12.978686231180506]],
 ["aoi",[77.56203,13.00509]]]
georeference block: {"status":"unlocated","crs":null,...}
```
So the file says `status: unlocated` *and* contains a footprint to 10 decimal places. Worse, the water and
built-up polygons are hardcoded latitudes, not derived from the AOI or the NDWI mask — they move only if
you edit the source.
**Fix:** when unlocated, export a `FeatureCollection` with `features: []` and the refusal reason.

**B3. The abstain gate is not enforced in the answer bank.**
`src/data/mock.js:135-140` gives the flood answer `consistency_score: 0.42` with `abstained: false`, while
`src/components/Answer.jsx:96` prints **"gate < 0.45"** and the README advertises a *hard* abstain gate.
The reservoir fixture (`0.31` → abstained) shows the rule is meant to be `score < 0.45 ⇒ decline`, so the
single most-used answer in the demo is a fixture that the stated rule would have withheld. `[code]` `[shot 03-answer.png]`
The demo therefore shows "consistency 0.42 · borderline" with a confident answer *and* "gate < 0.45" on the
same card, two clicks apart. This is the first thing a domain judge will notice.
**Fix:** either derive `abstained` from `consistency_score < 0.45` in `matchQuery()`, or move the flood
fixture to ≥ 0.46 / make the gate text data-driven instead of hardcoded.

---

### 🟠 P1 — The geospatial layer is not actually truthful

**B4. The scale bar is ~1.8× wrong (and cannot be right at all).**
`src/components/Viewer.jsx:18` sets `SCENE_WIDTH_KM = 12`; the declared footprint in
`src/lib/geo.js:4-10` is 1.467° lon × 0.1467° lat = **22.03 km × 16.22 km**. `[measured]`
The scale bar is computed from one scalar for both axes (`Viewer.jsx:329-336`), but the scene is 22.0 km
across and 16.2 km tall — and the *meter-per-pixel* differs per axis anyway (see B5), so a single
km-per-pixel is unsound. A "500 m" bar at fit is really ≈ 920 m, i.e. every distance a user measures off
the screen is wrong by nearly 2×.
**Fix:** derive `kmPerPx` per axis from `sceneGeo.extent` + the container size, and use the horizontal one
(scaled by `1/cos(lat)` already being implicit in the extent) for the bar.

**B5. The raster and the declared footprint disagree, so "coordinates exact" is not defensible.**
The scene images are 1376×768 → aspect **1.792**; the declared extent is 22.03×16.22 km → aspect **1.358**.
`[measured]` Two consequences:
1. Pixel↔lat/lon cannot be a similarity transform: if the raster covers the declared extent, the ground
   sample distance is ≈ **16.0 m/px E–W and 21.1 m/px N–S**, not the "10 m/px" printed in the sidebar
   (`src/components/Sidebar.jsx:174`) and in `SCENES.optical.res` (`src/data/mock.js:17`).
2. `src/components/Viewer.jsx:403` draws every image with `object-cover`, which crops the raster whenever
   the viewport aspect ≠ the raster aspect. The masks/AOI (container-normalised, `Overlays` at
   `viewer.jsx:105-197`) are then not registered to the pixels underneath them — the exact drift the README
   promises cannot happen.
**Fix:** declare a footprint whose aspect matches the raster (or `object-fill` + an honest per-axis GSD),
and label the GSD from the extent rather than a constant.

**B6. Answer "centroids" are fixture constants unrelated to the AOI.**
The flood answer's geodetic row (`Answer.jsx:201-235`) prints `geo.lat/lon` from the payload —
12.9716 / 77.5946 in `mock.js:148`, which is *literally the "Bengaluru" gazetteer point* in `geo.js:27`,
while the AOI centroid is 12.9739 / 77.6093 (`[measured]`, ~1.6 km away). The change answer's 12.9802 /
77.6113 (`mock.js:181`) is the same constant used for the hardcoded built-up polygon in `geo.js:212`. So
"every answer carries its geodetic evidence" is decorative: the coordinate, the area (4.7 ha ≈ a 217 m
box) and the exported footprint have no relationship to the drawn AOI, the masks, or the 0.61 NDWI they sit
beside. `[code]` `[shot 05-declined.png]`
**Fix:** compute the displayed/exported centroid from `aoiCentroid(aoi)` and the area from the mask ∩ AOI,
or relabel the row as "declared answer centroid (fixture)".

**B7. The analysis card asserts a CRS the scene does not have.**
`src/data/mock.js:116` — `ANALYZE_STAGES[0] = 'scene registered · EPSG:4326'` — is rendered verbatim by
`Answer.jsx:67` *before* anything about the scene is known, so an unlocated upload still animates
"scene registered · EPSG:4326". Contradicts the entire unlocated flow. `[code]`
**Fix:** build the stage list from `sceneGeo` at send time.

**B8. The "registered layers" are hand-drawn beziers and hardcoded boxes, not detections.**
`WATER_PATHS` (`mock.js:62-65`) is a bezier curve, its SAR twin is a mirrored stroke **drawn independently
of the imagery** (`[shot 01-empty.png]` shows the dashes crossing land on the SAR-aligned path), and
`BUILTIN_POLYS` / `LAYEROVER_POLYS` are literal coordinate strings. The UI meanwhile prints the method as
`NDWI>0.45 ∩ σ0<-14dB` and `VH texture + NDBI` (`geo.js:199, 209`). For a demo that is fine; for the
"honest instrument" framing it is a claim the pixels do not support.
**Fix (cheap):** relabel these as "illustrative overlay (synthetic)" in the legend tooltip, or rasterise any
one real NDWI mask once and ship it as a layer.

---

### 🟡 P2 — Behavioural / UX bugs

**B9. Horizontal overflow on phones — the author's own script asserts it, but no result was ever recorded.**
`scripts/shot-responsive.mjs:33-38` exists purely to measure `scrollWidth` vs `clientWidth` and prints the
pair for laptop and phone; **that console output is not committed anywhere** (no CI, no log, no README
line), so the repo ships a check for a problem it never reports on. `[code]`
What *is* visible in the committed artifacts: the phone drawer shot shows the composer footer's right-hand
affordance clipped at the viewport edge (`shots/responsive/phone-query-drawer.png`), so something is at
least hugging/overrunning the edge. I could not re-run the script here (its `@sparticuz/chromium` binary
needs NSS libraries this sandbox cannot fetch), so treat this as **unverified — measure before fixing.**
Likely causes to check first: the header's `gap-3` cluster plus brand block (`Header.jsx:42`) with no
`min-w-0`/`truncate` on the group, `data-mono` strings that cannot shrink, and `overflow-x` never being set
on the shell or the two `fixed … max-w-[92vw]` drawers (`QueryPanel.jsx:136`, `Sidebar.jsx:75`).
**Fix:** run the script for real and assert `scrollW === clientW`; add `overflow-x-hidden` on the shell,
`min-w-0` + `truncate` inside the header cluster.

**B10. The conversation yanks the user to the bottom on every analysis stage tick.**
`src/components/QueryPanel.jsx:122-125` scrolls to `scrollHeight` whenever `queries` changes, and
`AppState.sendQuery` writes a new `queries` array four times per answer (~0.35 s + 3 × ~0.65 s). Scrolling
up to re-read a previous answer while a new one is composing drags you back down repeatedly, and the
behaviour fires on stage/status changes rather than only on a new message or a new answer.
**Fix:** depend on `queries.length` (and `status === 'done'` transitions), and only auto-scroll when the
user is already pinned to the bottom.

**B11. `Layover mask` cannot be reached at 768–950 px of viewport height.**
`Sidebar.jsx:79` makes the upper region `flex-1 overflow-y-auto` while the AOI block is a fixed
`shrink-0` footer inside the same `top-14 bottom-0` column. At 950 px viewport the scroll region is only
**576 px** tall (`[shot 01-empty.png]`) and the Bands + Layers lists need more, so the last row is clipped
behind the footer; there is no visual scroll affordance saying so. The layer is therefore effectively
unreachable unless you scroll precisely.
**Fix:** cap the footer, or move it into the scroll flow / collapse it on short viewports.

**B12. Uploading a scene silently destroys the registered scene and changes nothing visually.**
`AppState.registerUpload` (`AppState.jsx:74-81`) replaces `opticalFile` with the uploaded filename and
flips `sceneGeo` to unlocated, but `opticalFile.src` stays `sceneOptical` — so the viewer still shows the
bundled Bengaluru raster while the sidebar says `unknown_scene.tif` + "extent unverified" (`[shot 11-unlocated.png]`).
There is no undo, no error path, and the toast claims no CRS was read without attempting to read one.
**Fix:** keep a `previousScene` to restore, show the uploaded name as "pending georeference" instead of
overwriting the identity, and add a "restore bundled scene" affordance.

**B13. In draw mode, clicking the viewer's own UI adds AOI vertices.**
`Viewer.jsx:440` puts `onClick` on the container; the OPTICAL/SAR/BLEND pills (`Viewer.jsx:43-48`) and the
conflict chips live inside it, so switching display source mid-draw drops a vertex at the pill. Also
`onDoubleClick` (`Viewer.jsx:389`) closes the AOI *after* the two `onClick`s have already appended two
duplicate vertices. `[code]`
**Fix:** `stopPropagation` on the in-viewer controls; in `onDblClick`, pop the last two points.

**B14. Follow-up chips named like exports perform a *query* instead.**
`mock.js:157` ships the follow-up "Export the flooded footprint as GeoJSON"; `QueryPanel.jsx:195` routes
every chip through `submit()` → `sendQuery` → `matchQuery`, and `/flood/` matches FLOOD, so clicking
"Export…" re-asks the flood question instead of exporting. `[shot 05-declined.png]` shows the chip sitting
next to two *real* export buttons.
**Fix:** give follow-ups an `action` (`query` | `export`) and wire the export ones to `exportAnswerJSON` /
`buildAnswerGeoJSON`.

**B15. Dead affordances.** `[code]`
- Band toggles (`Sidebar.jsx:107-120`) are never consumed by the viewer — `bands` only changes the "3 bands
  selected" string (`Viewer.jsx:255, 706`). Toggling NDVI off does nothing.
- Every trace row carries a "replay step" button that can only toast "sandbox build ships without the
  runner" (`Answer.jsx:186-192`) — 4 identical dead buttons per answer.
- `FlagsBadge` (`ui.jsx:60-75`) is exported and never used (1 reference = its definition).

**B16. Timers are never cleaned up.** `AppState.jsx:32-36` accumulates animation `setTimeout`s in
`timers.current` and never clears them on unmount; the toast at `AppState.jsx:46-50` has the same issue.
Harmless today (single provider, never unmounted) but it is a leak the moment the provider moves or the
app is embedded. `[code]`

**B17. No error boundary.** A single render throw blanks the entire console (`main.jsx` renders `App`
directly). For a live demo on stage, an `ErrorBoundary` with a "reload scene" button is cheap insurance.
`[code]`

**B18. Global key map is unguarded and collides with browser behaviour.** `App.jsx:26-40` swallows
`1/2/3/4` and `/` (with `preventDefault`) whenever focus is not in an input/textarea — including content
areas, buttons, and the range slider; `Viewer.jsx:316-326` swallows `+/-/0` and `=`. Nothing stops them in
a drawer-closed/mobile state where their target is invisible, and `Esc` is bound three times in three
components. `[code]`

**B19. Mock intent matching has false positives and a keyword ordering trap.** `mock.js:131, 195` —
`/water/` and `/trust/` both route to FLOOD (so "Is the reservoir water level reliable?" gets the flood
answer as well as the reservoir one), `/block/` in CHANGE matches "blocking"/"blocked", and `/act on/`
routes a generic "can I act on this?" to the reservoir. Follow-ups like "Show the attribution breakdown on
the map" (CHANGE) work only by luck of `/attribut/`. `[code]`

**B20. Decorative instrumentation presented as measurement.** `elevAt` (`geo.js:133-137`) is a
sine/cosine of lat/lon rendered as "elev 907 m"; `challenge` — `DbHistogram` (`ui.jsx:38-56`) synthesises
its bars from `Math.round(db*7) % 5`, i.e. a 5-state pattern — inside a card labelled "physics check", and
`ATTRIBUTION` (`mock.js:105-109`) prints "raw Δ +11.2 ha · genuine +2.1 ha" as a static string. `[code]`
Not a crash, but in a product whose pitch is "no number without a source", these are the numbers with the
least source.

---

### ⚪ P3 — Hygiene, accessibility, packaging

**B21. The only tests can't be run by anyone else.** `scripts/*.mjs` need `puppeteer-core` **and**
`@sparticuz/chromium`, neither of which is in `package.json`; there are no npm scripts to invoke them; they
hardcode `http://localhost:5173` and `downloadPath: '/home/user/AVNI/shots/downloads'`
(`scripts/shot.mjs:60`) — an absolute path from the author's machine. So `npm ci && npm run …` cannot
reproduce a single piece of the committed evidence. `[code]` `[measured]`
**Fix:** add the two devDeps, `"shots": "node scripts/shot.mjs"` etc., take the origin from `AVNI_URL` and
the download dir from a `tmpdir()`.

**B22. Zero automated tests.** No `*.test.*`, no vitest/jest config, no CI workflow. The highest-value tests
here are tiny: `haversineKm`/`bearingLabel`/`toGeo` round-trips, `nearestPlace` against known points,
`boxAround` area identity, and the withhold-on-unlocated contract for all three exporters (which would have
caught B1 and B2 immediately).

**B23. Accessibility.** `[measured]`
- `--t3 (#5B6B7A)` on `--panel (#0D131C)` is **3.40 : 1** (3.53 : 1 on `--ink`) — below WCAG AA 4.5 : 1 —
  and `.lbl` (`index.css:107`) uses it for every section eyebrow, plus `text-[10px] text-t3` footnotes.
- No `<label>` for the composer or the blend range input; icon-only buttons rely on `title`.
- No `aria-live` on the answer stream or toasts, so "analysis running" → "answered" and the abstain
  decision are silent to a screen reader.
- The unlocated state is signalled by colour + uppercase only.

**B24. Mobile viewport height.** `html, body, #root { height: 100% }` (`index.css:65-69`) with a bottom
composer and no `dvh`/`safe-area` handling — on iOS Safari the composer sits under the collapsing URL bar.
`Header.jsx:42` also hardcodes `h-14` while the overlay in `App.jsx:59` uses `top-14`.

**B25. 24 MB of PNG evidence committed to git** (`shots/`, 11 × ~2 MB + responsive set); `.gitignore` only
excludes `shots/downloads`. The packfile is 24.56 MiB for a 2.9 kLOC app. Downscale to ~1600 px JPEG or
move to an external asset store. `[measured]`

**B26. Dev-server hardening.** `vite.config.js` sets `allowedHosts: true` **and** `fs: { strict: false }` —
required for the proxied preview, but it also means anyone on the same Wi-Fi can read arbitrary files off
the host through `/@fs/`. Worth a comment/intent note, or drop `fs.strict` before a public demo.

**B27. Small React smells.** 9 × `key={i}` on data lists (fine today, breaks the moment a list is
reorderable); `Viewer` sets `cursor` state on every `pointermove`, re-rendering `Overlays`, `ConflictLegend`
and `AttributionCard` per mouse event (should be a ref + rAF, or memoised subcomponents); no `React.memo`
anywhere; `useMemo` on `topLayer` depends on a whole object identity.

**B28. Docs drift.** README claims the GeoJSON export withholds when unlocated (true) and that "every panel
is wired to behave as if it were live" — but the README also lists "165 KB" fonts (actual 161.6 KB, fine),
promises a scale bar that "re-labels itself as you zoom (500 m → 2 km)" (it does — with the wrong scalar,
B4), and states the declaration "coordinates exact · place name ~1 km" (`geo.js:104`) which B5 undermines.
`SUGGESTIONS[3]` (riparian vegetation) is unreachable because `QueryPanel.jsx:174` slices to 3. `[code]`

---

## 4. If you only fix five things

1. **B1 + B2** — one shared `withholdIfUnlocated()` used by all four export paths. (Data-leak-grade, ~20 min.)
2. **B3** — make `abstained` derive from the gate, or move the flood fixture above 0.45. (Judges see this.)
3. **B4 + B5** — compute the scale bar and the GSD from `sceneGeo.extent` and the raster's real aspect.
4. **B6 + B7** — derive the answer centroid from the AOI, and build the analysis stages from `sceneGeo`.
5. **B9 + B10** — re-run the phone measurement script and fix whatever it reports; stop the auto-scroll yank.

Then: B21/B22 (two devDeps + four unit tests), B13, B14, B15 — cheap, and each one removes a way the demo
can embarrass itself in front of a jury.

---

## 5. What is *not* wrong (checked, no action)

- No XSS/injection surface; no `dangerouslySetInnerHTML`, no `eval`, no remote fetch, no secrets. `[code]`
- `npm run build` succeeds with no warnings; bundle sizes are healthy. `[run]`
- `haversineKm`, `bearingLabel`, `nearestPlace`, `boxAround` maths check out (Bengaluru→MG Road 0.325 km,
  AOI centroid 12.9739/77.6093 — both verified by independent recomputation). `[measured]`
- The zoom/pan inverse transform is correct in both directions (`toUV` and the wheel handler agree).
  `[shot 09]`
- Blob downloads are real, named sensibly, and the object URLs are revoked. `[code]`
- StrictMode double-render does not cause duplicate toasts or queries. `[code]`
