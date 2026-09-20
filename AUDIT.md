# AVNI — bug audit & rating

**Repo:** `ARENJKY369/AVNI` @ `ca58244` (v0.9.4) · **Scope:** full source read (2.9 kLOC), production
build, numeric re-computation of the geodetic maths, an executed export probe, and **real browser
measurement** of the interaction bugs (headless Chromium, 1366×768 / 1680×950 / 390×844).

**This file describes the repository as found.** The branch that carries it also carries the
fixes — the fix log in §7 names the proof for each one. Ratings below are for the code as audited,
not as fixed.

**How each finding was verified** — `[code]` read from source · `[run]` executed in Node ·
`[browser]` measured in a real Chromium session · `[measured]` arithmetic on the repo's own numbers ·
`[shot]` visible in the committed screenshots.

> This supersedes the earlier audit pass committed at `ca58244`. Three of its findings did not survive
> re-measurement and are corrected in §6 — the rest were re-verified independently and are listed here
> with the evidence that held up.

---

## 1. Rating

| Lens | Score | Why |
| --- | --- | --- |
| **Hackathon demo front-end** | **8.5 / 10** | Genuinely beautiful, complete, offline-safe, works on desktop and phone. Would impress a SIH jury — *if* nobody measures the scale bar. |
| **Production-ready software** | **4.5 / 10** | No tests, no CI, no lint config, no error boundary, dead controls, and the export paths contradict the app's headline honesty claim. |
| **Engineering hygiene / reproducibility** | **3.5 / 10** | `scripts/*.mjs` cannot run for anyone but the author (missing deps, hardcoded `/home/user/AVNI` paths, no npm script). 24.6 MiB of PNGs in git for a 2.9 kLOC app. Zero tests. |
| **Weighted overall** | **7.0 / 10** | A-grade craft, C-grade rigour. The gap between what it *claims* and what it *verifies* is the whole story. |

**Category breakdown**

| Category | Score |
| --- | --- |
| Visual design & craft | 9.5 |
| Product narrative / UX thinking | 9.0 |
| Front-end architecture | 7.5 |
| Geospatial correctness | 4.5 |
| Integrity of the "honesty" claims (the core promise) | 4.5 |
| Accessibility | 4.5 |
| Testing / CI / tooling | 2.5 |
| Documentation (README is good, but drifts from the code) | 8.0 |

**As fixed (this branch):** hackathon demo **9.0** · production **6.0** · hygiene **7.0** →
**weighted ≈ 7.3 / 10**. The brief is still a frontend mock with no backend, and a11y/linting are only
partially addressed — but the console no longer states anything it cannot back up, every claim in the
README is covered by a test or a measurement, and anyone can re-run the evidence from `npm ci`.

**One-line verdict:** a stunning instrument panel wrapped around a mock that does not always tell the
truth it advertises — and the lies live exactly where a SAC/ISRO evaluator would poke: the geodetic
maths and the export paths.

---

## 2. What is genuinely good (and must not be broken by the fixes)

- Consistent design system (`index.css` primitives), self-hosted woff2, **zero network egress at
  runtime** — the air-gap claim is real. `[code]` `[measured: no fetch/XHR anywhere]`
- Clean build: 206 kB raw / **65.5 kB gzip JS**, 6.3 kB gzip CSS, no warnings. `[run npx vite build]`
- The zoom/pan inverse transform is correct: the scene point under the pointer stays put across
  zoom (verified in-browser), and overlays/AOI/masks live in the one transformed sheet. `[browser]`
- The unlocated-upload flow is real honesty machinery: header, viewer readout, sidebar extent,
  geodetic row and the GeoJSON path all flip to "withheld". `[code]` `[shot 11-unlocated.jpg]`
- No XSS/injection surface: no `dangerouslySetInnerHTML`, no `eval`, no secrets. `[code]`
- The place name really is resolved from the AOI centroid through the embedded gazetteer, not
  hardcoded. `[run]`

---

## 3. Bugs, worst first

### 🔴 P0 — integrity bugs (the app contradicts its own selling point)

| # | Finding | Evidence |
| --- | --- | --- |
| **B1** | **The JSON evidence bundle leaks the coordinates the console says it withholds.** `exportAnswerJSON` writes `crs: payload.geodetic.crs` and then spreads `...payload`, re-adding the whole `geodetic` object — so an "unlocated" scene still exports real lat/lon to disk. The Markdown and GeoJSON paths *do* withhold, so the three exporters disagree with each other. | `[code] lib/export.js:31-44` `[run]` probe |
| **B2** | **The layer export writes hardcoded Bengaluru polygons even when the scene is unlocated.** `buildLayerGeoJSON` skips the *place name* but still emits `boxAround(12.9716, 77.5946, 4.7)` and `boxAround(12.9802, 77.611, 11.2)` plus the AOI ring — a file whose header says `status: unlocated` and whose body contains a footprint to 10 decimal places. The water/built-up polygons are also **not derived from the on-screen overlays**: they only move if you edit the source. | `[code] geo.js:192-235` `[run]` probe |
| **B3** | **The abstain gate is not enforced in the answer bank.** The flood fixture ships `consistency_score: 0.42, abstained: false`, while the answer card prints **"gate < 0.45"** and the reservoir fixture at 0.31 *is* declined. The demo's most-used answer is a fixture the stated rule would have withheld. The "n of 8 orientations" strings disagree with the scores too (0.42 ⇒ "6 of 8"). | `[code] data/mock.js:129-159` `[shot 03-answer.jpg]` |

### 🟠 P1 — the geospatial layer is not truthful

| # | Finding | Evidence |
| --- | --- | --- |
| **B4** | **The scale bar is 1.83× wrong.** `SCENE_WIDTH_KM = 12` is a scalar the code invented; the declared footprint is 22.03 km wide. Measured in-browser: an 84 px bar labelled **"1 km"** spans **1.83 km** of ground. Every distance a user measures off the screen is wrong by nearly 2×. | `[browser]` `[measured]` |
| **B5** | **The raster and the declared footprint disagree.** Rasters are 1376×768 (optical), 1408×768 (SAR) and 1408×768 (epoch B) → aspects 1.79 / 1.83; the declared extent is 22.03 × 16.22 km → aspect **1.358**. Three consequences: (a) if the raster covers the extent the GSD is ≈ 16.0 m/px E–W and 21.1 m/px N–S, not the "10 m/px" printed in the sidebar; (b) every image is drawn `object-cover`, so the masks/AOI (container-normalised) are **not registered to the pixels** they sit on; (c) optical and SAR have *different* aspects, so `object-cover` crops them differently — the two "co-registered" rasters are misregistered against each other by up to ~0.5 km at the edges. | `[measured]` `[code] Viewer.jsx:403` |
| **B6** | **Answer "centroids" are fixture constants unrelated to the AOI.** The flood answer prints 12.9716 / 77.5946 — the "Bengaluru" gazetteer point — while the AOI centroid is 12.9739 / 77.6093 (~1.6 km away). The change answer's 12.9802 / 77.6113 is the same constant used for the hardcoded built-up polygon. The area (4.7 ha ≈ a 217 m box) has no relationship to the drawn AOI either. | `[measured]` `[code]` |
| **B7** | **The analysis card asserts a CRS the scene may not have.** `ANALYZE_STAGES[0] = 'scene registered · EPSG:4326'` is rendered verbatim before anything about the scene is known — so an unlocated upload still animates "scene registered · EPSG:4326". | `[code] mock.js:116` |
| **B8** | **The "registered layers" are hand-drawn beziers and literal polygon strings, not detections**, while the UI prints the method as `NDWI>0.45 ∩ σ0<-14 dB` and `VH texture + NDBI`. In the committed screenshot the synthetic river overlay crosses the city on land, nowhere near the actual water in the pixels. For a demo that is fine; for the "honest instrument" framing it is a claim the pixels do not support. | `[shot 01-empty.jpg]` `[code]` |

### 🟡 P2 — behavioural / UX bugs

| # | Finding | Evidence |
| --- | --- | --- |
| **B9** | **The conversation yanks the user to the bottom on every analysis stage tick.** Measured: after scrolling to the top, sending one question moved `scrollTop` 0 → 1530 → 1550 → 1591 → 2048 across four re-renders. You cannot re-read an earlier answer while a new one composes. | `[browser]` `[code] QueryPanel.jsx:122-125` |
| **B10** | **At short viewport heights the last layer row sits below the fold with no scroll affordance.** Measured at 768 px: the "Layover mask" button's bottom is 674 px while the scroll region ends at 607 px (83 px of hidden content, no hint). At ≥900 px it fits. | `[browser]` `[code] Sidebar.jsx:79` |
| **B11** | **Uploading a scene silently keeps the old pixels.** `registerUpload` swaps the filename and flips the scene to unlocated, but `opticalFile.src` still points at the bundled Bengaluru raster — and the sidebar keeps the "S2 L2A · tile 43REP" label for a file that is not Sentinel-2. There is no undo and no "restore bundled scene". | `[code] AppState.jsx:74-81` |
| **B12** | **In draw mode, clicking the viewer's own UI adds AOI vertices.** Measured: 2 scene clicks → 2 vertices; then clicking the SAR pill mid-draw → **3 vertices**. Also `onDoubleClick` closes the AOI after the two clicks have already appended two duplicate points. | `[browser]` `[code] Viewer.jsx:440` |
| **B13** | **A follow-up that reads like an export performs a query instead.** "Export the flooded footprint as GeoJSON" is routed through `submit()` → `matchQuery`, and `/flood/` matches FLOOD — so it re-asks the question. It sits next to two *real* export buttons. | `[code] mock.js:157, QueryPanel.jsx:195` |
| **B14** | **Dead affordances.** (a) The band toggles are never consumed by the viewer — `bands` only changes the "3 bands selected" string. (b) Every trace row carries a "replay step" button that can only toast "sandbox build ships without the runner" (4 dead buttons per answer). (c) `FlagsBadge` is exported and never used. | `[code]` |
| **B15** | **Timers are never cleaned up.** `AppState` accumulates animation `setTimeout`s in a ref and never clears them on unmount; the toast timer has the same issue. | `[code] AppState.jsx:32-50` |
| **B16** | **No error boundary.** One render throw blanks the entire console — a live-demo risk with a trivial fix. | `[code] main.jsx` |
| **B17** | **The global key map is unguarded.** `1/2/3/4`, `/`, `+/-/0` are swallowed wherever focus is not an input/textarea — including buttons, the range slider and the AOI canvas — and they fire even when the drawer they act on is off-screen. `Esc` is bound three times in three components. | `[code] App.jsx:26-40, Viewer.jsx:316-326` |
| **B18** | **Mock intent matching has false positives.** `/water/` and `/trust/` both route to FLOOD (so "Is the reservoir water level reliable?" gets the flood answer), `/block/` matches "blocking", `/act on/` routes a generic "can I act on this?" to the reservoir. | `[code] mock.js:131,195` |
| **B19** | **Decorative instrumentation presented as measurement.** `elevAt` is a sine/cosine rendered as "elev 907 m"; `DbHistogram` synthesises its bars from `Math.round(db*7) % 5` inside a card labelled "physics check"; `ATTRIBUTION` is a static string. In a product whose pitch is "no number without a source", these are the numbers with the least source. | `[code]` |

### ⚪ P3 — hygiene, accessibility, packaging

| # | Finding | Evidence |
| --- | --- | --- |
| **B20** | **The only tests cannot be run by anyone else.** `scripts/*.mjs` need `puppeteer-core` and `@sparticuz/chromium`, neither of which is in `package.json` or the lockfile; there are no npm scripts to invoke them; they hardcode `http://localhost:5173` and `downloadPath: '/home/user/AVNI/shots/downloads'`. | `[code]` `[measured]` |
| **B21** | **Zero automated tests, no CI.** No `*.test.*`, no runner config, no workflow. The highest-value tests are tiny: `haversineKm`/`bearingLabel`/`toGeo` round-trips, `nearestPlace`, `boxAround` area identity, and the withhold-on-unlocated contract for all three exporters — which would have caught B1 and B2 immediately. | `[code]` |
| **B22** | **Accessibility.** `--t3 (#5B6B7A)` on `--panel` is **3.40 : 1** — below AA — and it is used for every section eyebrow and footnote. No `<label>` on the composer or blend slider, no `aria-live` on the answer stream or toasts (so "analyzing" → "answered" and the abstain decision are silent to a screen reader), and icon-only buttons rely on `title`. | `[measured]` `[code]` |
| **B23** | **Mobile viewport height.** `html, body, #root { height: 100% }` with a bottom composer and no `dvh`/safe-area handling — on iOS Safari the composer can sit under the collapsing URL bar. | `[code]` |
| **B24** | **24.6 MiB of PNG evidence committed for a 2.9 kLOC app** (`.gitignore` only excludes `shots/downloads`). Downscale to ~1600 px JPEG or move to an external asset store. | `[measured]` |
| **B25** | **Dev-server hardening.** `vite.config.js` sets `allowedHosts: true` **and** `fs: { strict: false }`: the first is required for the proxied preview, the second means anyone on the same Wi-Fi can read files outside the project through `/@fs/`. | `[code]` |
| **B26** | **Small React smells.** 9 × `key={i}`; `Viewer` sets `cursor` state on every `pointermove`, re-rendering `Overlays`, `ConflictLegend` and `AttributionCard` per mouse event; the context value object is rebuilt on every render so nothing can be memoised. | `[code]` |
| **B27** | **Docs drift.** README promises a scale bar that re-labels itself (it does — with the wrong scalar, B4), a "10 m/px" product (16.0 / 21.1, B5) and `SUGGESTIONS[3]` is unreachable because the panel slices to 3. | `[code]` |

---

## 4. If you only fix five things

1. **B1 + B2** — one shared `withholdIfUnlocated()` used by every export path. (Data-integrity grade.)
2. **B3** — derive `abstained` from the gate so the number and the rule can never disagree.
3. **B4 + B5** — derive the scale bar and GSD from `sceneGeo.extent`, and stop `object-cover` from
   cropping the rasters away from their own overlays.
4. **B6 + B7** — take the answer centroid from the AOI, and build the analysis stages from `sceneGeo`.
5. **B9 + B12** — stop the auto-scroll yank, and stop the viewer's UI from dropping AOI vertices.

Then: B20/B21 (two devDeps + four unit tests), B13, B14 — cheap, and each removes a way the demo can
embarrass itself in front of a jury.

---

## 5. What is *not* wrong (checked, no action)

- `haversineKm`, `bearingLabel`, `nearestPlace`, `boxAround` maths check out; **AOI centroid
  12.9739 / 77.6093** independently recomputed. `[measured]`
- The zoom/pan inverse transform is correct in both directions, and the pointer-anchored wheel zoom
  keeps the scene point under the cursor. `[browser]`
- Blob downloads are real, named sensibly, and object URLs are revoked. `[code]`
- StrictMode double-render does not duplicate toasts or queries. `[code]`
- No page-level horizontal overflow at 390 × 844 (measured `scrollWidth === clientWidth`), and no
  overflow inside the opened query drawer — corrected from the previous pass, see §6. `[browser]`

---

## 6. Corrections to the previous audit pass (`ca58244`)

Three claims did not survive re-measurement and should not be fixed as if they were real:

| Previous claim | What the measurement actually shows |
| --- | --- |
| "Horizontal overflow on phones — the composer footer is clipped" (previous B9) | **Not reproduced.** At 390 × 844: `documentElement.scrollWidth === clientWidth === 390`; the opened drawer measures 358 px of content in 358 px, no overflowing descendant. The phone layout is fine. |
| "Layover mask cannot be reached at 768–950 px" (previous B11) | **Overstated.** At 768 px the row is below the fold (674 px vs a 607 px viewport) but the region *does* scroll the 83 px needed; at ≥900 px it is fully visible. The real defect is the missing scroll affordance, not unreachability. |
| "The flood fixture's gate text is the first thing a judge will notice" | True, but the same mismatch also exists in the "n of 8 orientations" strings (0.42 ⇒ "6 of 8", 0.31 ⇒ "3 of 8"), i.e. it is a **systemic** fixture problem, not one number. Fixed as one derived value. |

Also corrected: the rasters are not all 1376×768 — the SAR and epoch-B rasters are 1408×768, which
makes B5(c) (cross-sensor misregistration) worse than the previous pass reported.

---

## 7. Fix log

Every finding above is fixed on this branch except where noted. Fixes are grouped the way the
commits are; each row names the test or measurement that proves it. Numbers refer to §3.

| Batch | Items | Proof |
| --- | --- | --- |
| **Integrity** | B1, B2, B3, B6, B7 | `npm test` — 43 tests, including the withhold contract for all three exporters, the gate derivation for the whole answer bank, and the AOI-centroid geometry. `npm run verify:location` reads the 2 271 bytes of the exported JSON bundle and asserts it contains no coordinates. |
| **Geospatial truth** | B4, B5 | `npm run verify:zoom` measures the on-screen bar: 46 px labelled "1 km" covers **1.003 km** (it used to be 1.83 km). The extent is now derived from the raster aspect, so the sidebar prints a real **16 m/px** and `geo.test.js` asserts square GSD + extent/raster aspect equality. |
| **Behaviour** | B9, B10, B11, B12, B13, B14 | In-browser: the reader stays where they scrolled (0 px of yank across four stage ticks); the Layover row is reachable at 768 px with the AOI block still pinned; clicking a viewer control mid-draw adds **no** vertex (3 → 3); a .tif upload shows "no renderable preview" instead of the old imagery; an "export" follow-up exports (query count unchanged, toast `footprint exported · GeoJSON`); band toggles now name the pass the next query runs; `npm run shots:responsive` asserts zero horizontal overflow at 390 × 844. |
| **Robustness** | B15, B16, B17, B18, B19, B22, B23 | ErrorBoundary wraps the shell; timers and object URLs are released on unmount; the key map ignores modifiers and typing targets; `t3` is lifted to `#728293` (**4.7:1** on panel, was 3.40:1); `fs.strict` dropped from `vite.config.js`; intent routing is pattern-based (`/blocks?\b/` no longer matches "blocking"). |
| **Tooling** | B20, B21, B24, B25, B26, B27 | `scripts/browser.mjs` resolves the bundled Chromium and wires up its NSS libs, so all five scripts run from `npm ci` with `AVNI_URL`/temp-dir overrides and real exit codes; vitest + GitHub Actions CI; `shots/` re-encoded to JPEG, **24.6 MiB → 4.4 MiB**; README rewritten to match the code (`npm test`, `npm run verify:*`, CI). |

**Still true, deliberately:** the overlays and answer text are fixtures (B8) — that is what a
frontend-only build can honestly ship, and the UI and the exports now say so. Wiring the masks to a
real NDWI/σ0 pass is a backend change, not a bug fix.

**Deferred, on purpose:** the committed screenshots are ~250 KB JPEGs each (4.4 MiB total — fine for
GitHub, and they are the visual evidence for every UI finding, so they stay in the repo); §3 keeps the
original severity ranking even where a fix landed, so the "worst first" order still reads as the
original risk assessment.

---

## 8. Second pass — the three reported issues

Three issues were raised against the console after the first pass: mark an AOI by segmentation rather
than tracing it vertex by vertex, stop the pixels tearing apart when you zoom in, and read real
imagery containers instead of fixtures. All three are implemented and verified on this branch
(`npm run verify` — console 21, zoom, segment, location, a11y and features 18, plus `npm test`).

This pass then went after the *implementation* rather than the feature list, because a feature that
only works on a lucky click is not the feature that was asked for. What the adversarial checks found
and what changed:

| Finding (measured) | Evidence | Fix |
| --- | --- | --- |
| Seeded region growing stopped at the **first** over-tolerance pixel it popped, so on the bundled SAR scene a click was refused **9 times out of 12** ("nothing to segment here") | 12-point click grid, in-browser | Region growing is now a thresholded flood fill: the region is the connected set of pixels within `tolerance` of the seed. Growth visits the whole frontier before giving up |
| The edge barrier was computed on raw speckle: **47.6 %** of the working grid cleared `edgeStop`, so nearly every pixel read as an edge and growth was walled into a handful of pixels | `edgeMagnitude` over the bundled scene | Blur before differencing + non-maximum suppression: **16.5 %** over threshold, an edge is now a thin ridge |
| Edge pixels were a hard wall — the region lost the feature's own rim | blob fixture 1 200 px → 936 px | An edge pixel is included in the mask but never expanded from: the rim is part of the AOI, the flood still cannot cross into the next field |
| The tolerance slider barely did anything (34 → 65 moved coverage **0.3 % → 0.7 %**), then jumped to 45 % | coverage-vs-tolerance table over 8 seeds | With thresholded growth the control is monotone: 20 → 1.7 %, 45 → 6.2 %, 75 → 48.6 % on the same seed. `scripts/verify-segment.mjs` asserts monotonicity |
| A click that lands on speckle was refused instead of adapted to | in-browser | `segmentAt` widens the tolerance (×1.6, ×2.6) and retries when the first pass is under the minimum, and `stopNote` says "widened the tolerance to N" when it did |
| Shift-click **dropped the earlier region from the AOI**: the ring is traced from the topmost contour only, so a two-part selection exported one part | shift-click on the bundled scene: mask held both, ring held one | `traceOutlines` returns every part; the ring follows the largest and the rail and toast report "N separate areas — the AOI follows the largest" instead of silently discarding the rest |
| After add/subtract the rail reported the **last click's** coverage, not the selection's (3.0 % + 0.3 % shown as 0.3 %) | shift then alt-click | Coverage is counted from the mask that is kept |
| A real but small selection read as "0.0 % of the scene" | 4-vertex region on the grid | Below 1 % the share is quoted to two decimals (0.02 %, 0.44 %) |
| The committed tree's own `npm run verify` **died at the first step**: `verify:a11y` pointed at a script that was not in the repo, and `verify:console`/`verify:location` still asserted the old "unlocated upload" behaviour for a file that is now refused outright | `npm run verify` on the committed tree | `scripts/a11y.mjs` written (axe over shell, answer, dialog, phone drawer); the two scripts updated to the current, stricter contract — a CRS-less **PNG** is the unlocated case, an undecodable GeoTIFF is refused |
| Two moderate axe findings: no `main` landmark, no `h1`, and the guide dialog titled with an `h3` | axe-core | `<main>` + a screen-reader `h1` in `App.jsx`, dialog title is an `h2`; axe is now clean in all four states |

**Known limitation, stated rather than hidden:** an AOI is one polygon, so a selection that ends up in
several disjoint parts can only become the largest of them. The UI now names the count and which part
the outline follows; a multi-polygon AOI would have to reach the area maths and the exporters, which
is a larger change than this pass.
