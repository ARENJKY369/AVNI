import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { analyzeStages, BANDS, LAYERS, matchQuery, SCENES } from '../data/mock.js';
import { SCENE_GEO, UNLOCATED_GEO } from '../lib/geo.js';
import { describeScene, readSceneDirectory, readSceneFile, readSceneUrl, sourceFromScene } from '../lib/raster.js';
import { describeSegment, segmentAt, simplifyRing, traceOutlines } from '../lib/segment.js';
import { ensureScenes } from '../lib/scene-cache.js';
import { checkStoreInvariants } from '../lib/invariants.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export const DEFAULT_AOI = [
  { u: 0.33, v: 0.28 },
  { u: 0.68, v: 0.35 },
  { u: 0.73, v: 0.68 },
  { u: 0.39, v: 0.74 }
];

let toastSeq = 0;
let querySeq = 0;

export function AppProvider({ children }) {
  const [mode, setModeRaw] = useState('optical'); // optical | sar | blend | change
  const [blend, setBlend] = useState(0.6);
  const [bands, setBands] = useState(BANDS);
  const [layers, setLayers] = useState(LAYERS);
  const [sceneB, setSceneB] = useState(null);
  const [queries, setQueries] = useState([]);
  const [drawMode, setDrawMode] = useState(false);
  const [draftAoi, setDraftAoi] = useState(null);
  const [aoi, setAoi] = useState(DEFAULT_AOI);
  const [toasts, setToasts] = useState([]);
  const [tools, setTools] = useState({ annotate: false, comments: false, fullscreen: false });
  const [help, setHelp] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [conflictFilter, setConflictFilter] = useState(null);
  const [swipe, setSwipe] = useState(52);
  const [uploadHover, setUploadHover] = useState(false);
  // small screens: which side panel is pulled over the viewer
  const [drawer, setDrawer] = useState(null); // null | 'imagery' | 'query'
  const [opticalFile, setOpticalFile] = useState(SCENES.optical);
  // segmentation is the primary way to mark an AOI: click the region you mean
  const [segmentMode, setSegmentModeRaw] = useState(false);
  const [segTolerance, setSegTolerance] = useState(34);
  const [segment, setSegment] = useState(null); // { ring, mask, stats, seed, work }
  const [segBusy, setSegBusy] = useState(false);
  const [sceneBusy, setSceneBusy] = useState(null); // { stage, name } while decoding
  // the bundled demo scenes, rasterised once so the renderer and the segmenter
  // share one set of pixels
  const [sceneSources, setSceneSources] = useState({});
  // what we actually know about where this scene is — never assume
  const [sceneGeo, setSceneGeo] = useState(SCENE_GEO);

  // every timer and object URL this provider creates is tracked so unmounting
  // (or replacing a scene) does not leave them behind
  const timers = useRef(new Set());
  // nothing in the provider hands out object URLs any more (every reader decodes
  // to pixels), but the ledger stays the single place that would revoke one
  const objectUrls = useRef(new Set());

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current.clear();
      objectUrls.current.forEach((u) => URL.revokeObjectURL(u));
      objectUrls.current.clear();
    },
    []
  );

  const track = (t) => {
    timers.current.add(t);
    return t;
  };
  const untrack = (t) => timers.current.delete(t);

  const toast = useCallback((msg) => {
    const id = ++toastSeq;
    setToasts((t) => [...t.slice(-2), { id, msg }]);
    const timer = track(
      setTimeout(() => {
        setToasts((t) => t.filter((x) => x.id !== id));
        untrack(timer);
      }, 2800)
    );
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const setMode = useCallback(
    (m) => {
      if (m === 'change' && !sceneB) {
        toast('change mode needs a second epoch — attach one from the query panel');
        return;
      }
      setModeRaw(m);
    },
    [sceneB, toast]
  );

  const toggleBand = useCallback(
    (id) => {
      const current = bands.find((x) => x.id === id);
      if (!current) return;
      const next = bands.map((x) => (x.id === id ? { ...x, on: !x.on } : x));
      setBands(next);
      const on = next.filter((x) => x.on).length;
      // the band choice is a real input: it names the pass the next query runs.
      // The toast is fired *here*, not inside the updater: an updater must be
      // pure (StrictMode runs it twice, and a nested setState during render is
      // dropped) — the old in-updater version produced no toast at all.
      toast(`${current.name} ${current.on ? 'removed from' : 'added to'} the next pass · ${on} band${on === 1 ? '' : 's'}`);
    },
    [bands, toast]
  );

  const toggleLayer = useCallback(
    (id) => {
      const current = layers[id];
      if (!current) return;
      const on = !current.on;
      setLayers((l) => ({ ...l, [id]: { ...l[id], on } }));
      if (id === 'disagreement' && on) toast('disagreement layer on — conflicts drawn in-scene');
    },
    [layers, toast]
  );

  const sendQuery = useCallback(
    (text, options = {}) => {
      const q = String(text || '').trim();
      if (!q) return;
      const id = ++querySeq;
      const payload = matchQuery(q, options.intent);
      // the stages are captured at send time: what the pass used, and whether
      // this scene even has a CRS to claim
      const stages = analyzeStages({ geo: sceneGeo, bands, secondEpoch: !!sceneB });
      setQueries((qs) => [...qs, { id, status: 'analyzing', stage: 0, stages, payload }]);

      const step = (s) => {
        const t = track(
          setTimeout(() => {
            untrack(t);
            setQueries((qs) =>
              qs.map((x) => (x.id === id ? (s < 4 ? { ...x, stage: s } : { ...x, status: 'done' }) : x))
            );
            if (s < 4) step(s + 1);
          }, s === 0 ? 350 : 520 + Math.random() * 260)
        );
      };
      step(1);
    },
    [bands, sceneB, sceneGeo]
  );

  const attachSceneB = useCallback(
    async (file) => {
      const isFile = !!file && typeof file === 'object' && typeof file.name === 'string';
      setAttachOpen(false);
      // no file: the analysis-service epoch is the honest default, and the pane
      // keeps naming it as the shipped pair rather than as your acquisition
      if (!isFile) {
        setSceneB({ ...SCENES.opticalB, canvas: null, pixels: null, note: 'shipped change pair — no second acquisition attached' });
        toast(`second epoch registered · ${SCENES.opticalB.file}`);
        return;
      }
      setSceneBusy({ stage: 'reading second epoch', name: file.name });
      try {
        // the epoch is decoded with the same readers as the primary scene, so
        // the swipe compares *your* two acquisitions instead of the demo pair
        const scene = await readSceneFile(file, { onProgress: (p) => setSceneBusy({ ...p, name: file.name }) });
        const source = sourceFromScene(scene);
        const georef = scene.georef || null;
        const georeferenced = georef?.status === 'georeferenced';
        setSceneB({
          ...SCENES.opticalB,
          file: scene.fileName,
          label: scene.formatLabel,
          raster: { width: scene.width, height: scene.height },
          src: null,
          canvas: source?.canvas || null,
          bitmap: source?.bitmap || null,
          pixels: source?.pixels || null,
          georef,
          formatLabel: scene.formatLabel,
          bands: scene.bands || [],
          notes: scene.notes || [],
          origin: 'uploaded',
          uploaded: true,
          // both epochs are drawn into one declared footprint — say so when the
          // second one carries no georeference of its own
          note: georeferenced
            ? null
            : `epoch has no CRS of its own (${scene.formatLabel}) — the change pair assumes it shares the scene footprint`
        });
        toast(`second epoch registered · ${scene.fileName} · ${describeScene(scene)}`);
      } catch (e) {
        // a second epoch that cannot be read must not silently leave the demo
        // pair in place under the new file's name
        const why = e?.sceneError ? e.message : `could not read ${file.name}`;
        toast(`not registered · ${why}`);
      } finally {
        setSceneBusy(null);
      }
    },
    [toast]
  );

  const detachSceneB = useCallback(() => {
    setSceneB(null);
    setModeRaw((m) => (m === 'change' ? 'optical' : m));
    toast('second epoch detached');
  }, [toast]);

  // An uploaded file is read for pixels *and* for georeference: GeoTIFF/COG
  // tags and the SAFE metadata are honoured, and a file that carries no CRS
  // registers as unlocated so the geodesy features switch off honestly.
  const adoptScene = useCallback(
    (scene, { replace = true } = {}) => {
      const source = sourceFromScene(scene);
      if (replace && opticalFile.canvas && opticalFile.uploaded) {
        opticalFile.canvas.width = 0;
        opticalFile.canvas.height = 0;
      }
      if (replace && opticalFile.src && opticalFile.uploaded) URL.revokeObjectURL(opticalFile.src);

      const file = {
        id: replace ? 'upload' : opticalFile.id,
        file: scene.fileName,
        label: scene.formatLabel,
        sensor: scene.sensor,
        acquired: scene.acquired || null,
        raster: { width: scene.width, height: scene.height },
        src: null,
        canvas: source?.canvas || null,
        bitmap: source?.bitmap || null,
        pixels: source?.pixels || null,
        georef: scene.georef || null,
        formatLabel: scene.formatLabel,
        bands: scene.bands || [],
        notes: scene.notes || [],
        origin: 'uploaded',
        uploaded: true
      };
      setOpticalFile(file);
      setSceneGeo(
        scene.georef && scene.georef.status === 'georeferenced'
          ? scene.georef
          : scene.georef?.status === 'unknown'
            ? scene.georef
            : UNLOCATED_GEO
      );
      setSegment(null);
      toast(`scene registered · ${scene.fileName} · ${describeScene(scene)}`);
      return file;
    },
    [opticalFile.canvas, opticalFile.id, opticalFile.src, opticalFile.uploaded, toast]
  );

  const registerUpload = useCallback(
    async (file) => {
      if (!file) return;
      setSceneBusy({ stage: 'reading', name: file.name });
      try {
        const scene = await readSceneFile(file, {
          onProgress: (p) => setSceneBusy({ ...p, name: file.name })
        });
        adoptScene(scene);
      } catch (e) {
        const why = e?.sceneError ? e.message : `could not read ${file.name}`;
        toast(`not registered · ${why}`);
      } finally {
        setSceneBusy(null);
      }
    },
    [adoptScene, toast]
  );

  /** A dropped .SAFE folder (or a webkitdirectory selection). */
  const registerSafeFolder = useCallback(
    async (files) => {
      if (!files || !files.length) return;
      setSceneBusy({ stage: 'reading SAFE folder', name: files[0]?.name || 'SAFE' });
      try {
        const scene = await readSceneDirectory(files, { onProgress: (p) => setSceneBusy(p) });
        adoptScene(scene);
      } catch (e) {
        toast(`not registered · ${e?.message || 'unreadable SAFE folder'}`);
      } finally {
        setSceneBusy(null);
      }
    },
    [adoptScene, toast]
  );

  /** Remote scenes: a COG on a server is read with range requests. */
  const registerUrl = useCallback(
    async (url) => {
      const target = String(url || '').trim();
      if (!target) return;
      setSceneBusy({ stage: 'probing remote scene', name: target });
      try {
        const scene = await readSceneUrl(target, { onProgress: (p) => setSceneBusy(p) });
        adoptScene(scene);
      } catch (e) {
        toast(`not registered · ${e?.message || 'remote scene unreadable'}`);
      } finally {
        setSceneBusy(null);
      }
    },
    [adoptScene, toast]
  );

  // ---------------------------------------------------------------- segmentation
  /** Pixels for the scene the viewer is showing, at segmentation resolution. */
  const pixelSource = useCallback(
    (which = 'optical') => {
      if (which === 'sar') return sceneSources.sar?.pixels || null;
      if (which === 'change') return sceneB?.pixels || sceneSources.opticalB?.pixels || null;
      return opticalFile.pixels || sceneSources.optical?.pixels || null;
    },
    [opticalFile.pixels, sceneB, sceneSources]
  );

  /**
   * Grow a region from a seed and hold it as a draft AOI. A plain click
   * replaces the draft; shift adds to it, alt subtracts — the same
   * add/subtract grammar every segmentation tool uses.
   */
  const markRegion = useCallback(
    async ({ u, v, op = 'replace', tolerance = segTolerance, which = 'optical' } = {}) => {
      const image = pixelSource(which);
      if (!image) {
        toast('segmentation needs pixels — this scene has no readable raster');
        return null;
      }
      setSegBusy(true);
      try {
        const result = segmentAt(image, { u, v }, { tolerance });
        if (!result.ok) {
          toast(result.reason || 'nothing to segment here');
          return null;
        }

        let mask = result.mask;
        let ring = result.ring;
        let parts = 1;
        const previous = segment?.mask;
        if (previous && previous.width === result.work.width && previous.height === result.work.height && op !== 'replace') {
          const merged = new Uint8Array(mask.length);
          for (let i = 0; i < mask.length; i += 1) {
            merged[i] = op === 'add' ? previous.data[i] | mask[i] : previous.data[i] & (mask[i] ? 0 : 1);
          }
          // An AOI is one polygon, so a selection that ends up in several
          // disjoint parts can only follow the largest — but it has to *say*
          // so rather than quietly drop the rest, and the coverage below has to
          // describe the mask that is really kept.
          const traced = traceOutlines(merged, result.work.width, result.work.height);
          parts = traced.length;
          const outline = traced[0]?.ring || [];
          const simplified = simplifyRing(outline, Math.max(1.2, result.work.width / 220));
          ring = simplified.map(([x, y]) => ({ u: x / result.work.width, v: y / result.work.height }));
          mask = merged;
        }

        // the numbers must describe the mask, not the last click
        let keptPixels = 0;
        for (let i = 0; i < mask.length; i += 1) keptPixels += mask[i] ? 1 : 0;
        const next = {
          ring,
          mask: { data: mask, width: result.work.width, height: result.work.height },
          stats: {
            ...result.stats,
            coverage: keptPixels / (result.work.width * result.work.height),
            outlineVertices: ring.length,
            parts
          },
          clipped: result.clipped,
          parts,
          seed: { u, v },
          op,
          tolerance
        };
        setSegment(next);
        toast(describeSegment({ ...result, ok: true, ring, stats: next.stats }));
        return next;
      } finally {
        setSegBusy(false);
      }
    },
    [pixelSource, segTolerance, segment, toast]
  );

  const applySegment = useCallback(() => {
    if (!segment?.ring?.length) return false;
    setAoi(segment.ring);
    setSegment(null);
    setSegmentModeRaw(false);
    toast('AOI set from the segmented region · extent recomputed');
    return true;
  }, [segment, toast]);

  const clearSegment = useCallback(() => {
    setSegment(null);
  }, []);

  const setSegmentMode = useCallback(
    (on) => {
      setSegmentModeRaw(on);
      if (on) {
        setDrawMode(false);
        setDraftAoi(null);
      } else {
        setSegment(null);
      }
    },
    []
  );

  const restoreScene = useCallback(() => {
    setOpticalFile(SCENES.optical);
    setSceneGeo(SCENE_GEO);
    toast('bundled scene restored · declared footprint back in force');
  }, [toast]);

  const markDrawMode = useCallback(
    (on) => {
      setDrawMode(on);
      if (!on) setDraftAoi(null);
    },
    []
  );

  // Undo for the two destructive-feeling actions: redrawing the AOI, and
  // replacing the scene. A tool that can lose your work needs a way back.
  const resetAoi = useCallback(() => {
    setAoi(DEFAULT_AOI);
    setDraftAoi(null);
    setDrawMode(false);
    toast('AOI restored to the scene default');
  }, [toast]);

  useEffect(() => {
    let alive = true;
    ensureScenes()
      .then((map) => {
        if (alive && Object.keys(map).length) setSceneSources(map);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // development-only: the honesty promises are checked after every state change
  useEffect(() => {
    checkStoreInvariants({ sceneGeo, queries, aoi });
  }, [sceneGeo, queries, aoi]);

  const value = useMemo(
    () => ({
      mode,
      setMode,
      blend,
      setBlend,
      bands,
      toggleBand,
      layers,
      toggleLayer,
      sceneB,
      attachSceneB,
      detachSceneB,
      setAttachOpen,
      attachOpen,
      queries,
      sendQuery,
      drawMode,
      setDrawMode: markDrawMode,
      segmentMode,
      setSegmentMode,
      segTolerance,
      setSegTolerance,
      segment,
      segBusy,
      markRegion,
      applySegment,
      clearSegment,
      sceneSources,
      sceneBusy,
      registerSafeFolder,
      registerUrl,
      draftAoi,
      setDraftAoi,
      aoi,
      setAoi,
      toasts,
      toast,
      tools,
      setTools,
      conflictFilter,
      setConflictFilter,
      swipe,
      setSwipe,
      uploadHover,
      setUploadHover,
      registerUpload,
      restoreScene,
      drawer,
      setDrawer,
      opticalFile,
      sceneGeo,
      help,
      setHelp,
      dismissToast,
      resetAoi
    }),
    [
      mode, setMode, blend, bands, toggleBand, layers, toggleLayer, sceneB, attachSceneB, detachSceneB,
      attachOpen, queries, sendQuery, drawMode, markDrawMode, draftAoi, aoi, toasts, toast, tools,
      conflictFilter, swipe, uploadHover, registerUpload, restoreScene, drawer, opticalFile, sceneGeo,
      help, dismissToast, resetAoi, segmentMode, setSegmentMode, segTolerance, segment, segBusy,
      markRegion, applySegment, clearSegment, sceneSources, sceneBusy, registerSafeFolder, registerUrl
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
