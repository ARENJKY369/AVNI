import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { analyzeStages, BANDS, LAYERS, matchQuery, SCENES } from '../data/mock.js';
import { SCENE_GEO, UNLOCATED_GEO } from '../lib/geo.js';
import { canRenderPreview } from '../lib/preview.js';

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
  const [attachOpen, setAttachOpen] = useState(false);
  const [conflictFilter, setConflictFilter] = useState(null);
  const [swipe, setSwipe] = useState(52);
  const [uploadHover, setUploadHover] = useState(false);
  // small screens: which side panel is pulled over the viewer
  const [drawer, setDrawer] = useState(null); // null | 'imagery' | 'query'
  const [opticalFile, setOpticalFile] = useState(SCENES.optical);
  // what we actually know about where this scene is — never assume
  const [sceneGeo, setSceneGeo] = useState(SCENE_GEO);

  // every timer and object URL this provider creates is tracked so unmounting
  // (or replacing a scene) does not leave them behind
  const timers = useRef(new Set());
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
      setBands((b) => {
        const next = b.map((x) => (x.id === id ? { ...x, on: !x.on } : x));
        const on = next.filter((x) => x.on).length;
        const changed = next.find((x) => x.id === id);
        // the band choice is a real input: it names the pass the next query runs
        toast(`${changed.name} ${changed.on ? 'added to' : 'removed from'} the next pass · ${on} band${on === 1 ? '' : 's'}`);
        return next;
      });
    },
    [toast]
  );

  const toggleLayer = useCallback(
    (id) =>
      setLayers((l) => {
        const on = !l[id].on;
        if (id === 'disagreement' && on) toast('disagreement layer on — conflicts drawn in-scene');
        return { ...l, [id]: { ...l[id], on } };
      }),
    [toast]
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

  const newObjectUrl = (file) => {
    const url = URL.createObjectURL(file);
    objectUrls.current.add(url);
    return url;
  };

  const attachSceneB = useCallback(
    async (file) => {
      const isFile = !!file && typeof file === 'object' && typeof file.name === 'string';
      const name = isFile ? file.name : SCENES.opticalB.file;
      const previewable = isFile ? await canRenderPreview(file) : false;
      setSceneB({
        ...SCENES.opticalB,
        file: name,
        src: previewable ? newObjectUrl(file) : SCENES.opticalB.src,
        note: isFile && !previewable ? `no preview for ${name} — analysis-service epoch shown` : null
      });
      setAttachOpen(false);
      toast(`second epoch registered · ${name}`);
    },
    [toast]
  );

  const detachSceneB = useCallback(() => {
    setSceneB(null);
    setModeRaw((m) => (m === 'change' ? 'optical' : m));
    toast('second epoch detached');
  }, [toast]);

  // An uploaded file gives us pixels, not coordinates. If the browser can
  // decode it we show those pixels; if it cannot (GeoTIFF, JP2) we say so
  // instead of leaving the last scene's imagery under the new file's name.
  const registerUpload = useCallback(
    async (file) => {
      // MIME type is not enough: a GeoTIFF passes the image/* test and then
      // fails to decode, which used to leave the previous scene's pixels on
      // screen under the new file's name.
      const previewable = await canRenderPreview(file);
      setOpticalFile({
        id: 'upload',
        file: file.name,
        label: previewable ? 'user upload · preview only' : 'user upload · no preview in this build',
        sensor: 'unidentified raster',
        acquired: null,
        raster: null, // GSD cannot be computed without a georeference
        src: previewable ? newObjectUrl(file) : null,
        origin: 'uploaded',
        uploaded: true
      });
      setSceneGeo(UNLOCATED_GEO);
      toast(
        previewable
          ? `scene registered · ${file.name} · no CRS read — location unverified`
          : `scene registered · ${file.name} · no CRS and no renderable preview`
      );
    },
    [toast]
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
      sceneGeo
    }),
    [
      mode, setMode, blend, bands, toggleBand, layers, toggleLayer, sceneB, attachSceneB, detachSceneB,
      attachOpen, queries, sendQuery, drawMode, markDrawMode, draftAoi, aoi, toasts, toast, tools,
      conflictFilter, swipe, uploadHover, registerUpload, restoreScene, drawer, opticalFile, sceneGeo
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
