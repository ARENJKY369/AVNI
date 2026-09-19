import { useEffect } from 'react';
import { AppProvider, useApp } from './state/AppState.jsx';
import Header from './components/Header.jsx';
import Sidebar from './components/Sidebar.jsx';
import Viewer from './components/Viewer.jsx';
import QueryPanel from './components/QueryPanel.jsx';
import { Dot } from './components/ui.jsx';

function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-1.5">
      {toasts.map((t) => (
        <div key={t.id} className="recess toast-in flex items-center gap-2 px-3 py-1.5">
          <Dot tone="accent" />
          <span className="text-[11px] text-t2">{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

function Shell() {
  const { tools, setMode, drawer, setDrawer } = useApp();

  // console-grade keyboard map: / talks to the scene, 1–4 flip display
  // sources. Skipped while typing in a field.
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === '/') {
        e.preventDefault();
        document.getElementById('composer-input')?.focus();
      } else if (e.key === '1') setMode('optical');
      else if (e.key === '2') setMode('sar');
      else if (e.key === '3') setMode('blend');
      else if (e.key === '4') setMode('change');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setMode]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Header />
      <div className="flex min-h-0 flex-1">
        {!tools.fullscreen && <Sidebar />}
        <Viewer />
        {!tools.fullscreen && <QueryPanel />}
      </div>
      {drawer && !tools.fullscreen && (
        <div
          className="fixed inset-x-0 bottom-0 top-14 z-30 bg-ink/70 backdrop-blur-[2px] lg:hidden"
          onClick={() => setDrawer(null)}
        />
      )}
      <Toasts />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
