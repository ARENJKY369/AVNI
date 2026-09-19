import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { BANDS, LAYERS, matchQuery, SCENES } from '../data/mock.js';

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
  const timers = useRef([]);

  const toast = useCallback((msg) => {
    const id = ++toastSeq;
    setToasts((t) => [...t.slice(-2), { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
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

  const toggleBand = (id) => setBands((b) => b.map((x) => (x.id === id ? { ...x, on: !x.on } : x)));
  const toggleLayer = (id) =>
    setLayers((l) => {
      const on = !l[id].on;
      if (id === 'disagreement' && on) toast('disagreement layer on — conflicts drawn in-scene');
      return { ...l, [id]: { ...l[id], on } };
    });

  const sendQuery = useCallback((text) => {
    const q = text.trim();
    if (!q) return;
    const id = ++querySeq;
    const payload = matchQuery(q);
    setQueries((qs) => [...qs, { id, status: 'analyzing', stage: 0, payload }]);

    const step = (s) => {
      const t = setTimeout(() => {
        setQueries((qs) =>
          qs.map((x) => (x.id === id ? (s < 4 ? { ...x, stage: s } : { ...x, status: 'done' }) : x))
        );
        if (s < 4) step(s + 1);
      }, s === 0 ? 350 : 520 + Math.random() * 260);
      timers.current.push(t);
    };
    step(1);
  }, []);

  const attachSceneB = (file) => {
    const named = file || SCENES.opticalB.file;
    setSceneB({ ...SCENES.opticalB, file: named });
    setAttachOpen(false);
    toast(`second epoch registered · ${named}`);
  };

  const detachSceneB = () => {
    setSceneB(null);
    setModeRaw((m) => (m === 'change' ? 'optical' : m));
    toast('second epoch detached');
  };

  const registerUpload = (file) => {
    setOpticalFile({ ...SCENES.optical, file });
    toast(`scene registered · ${file}`);
  };

  const value = {
    mode, setMode, blend, setBlend,
    bands, toggleBand,
    layers, toggleLayer,
    sceneB, attachSceneB, detachSceneB, setAttachOpen, attachOpen,
    queries, sendQuery,
    drawMode, setDrawMode, draftAoi, setDraftAoi, aoi, setAoi,
    toasts, toast,
    tools, setTools,
    conflictFilter, setConflictFilter,
    swipe, setSwipe,
    uploadHover, setUploadHover,
    drawer, setDrawer,
    opticalFile
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
