import { useEffect } from 'react';
import { AppProvider, useApp } from './state/AppState.jsx';
import Header from './components/Header.jsx';
import Sidebar from './components/Sidebar.jsx';
import Viewer from './components/Viewer.jsx';
import QueryPanel from './components/QueryPanel.jsx';
import HelpDialog from './components/HelpDialog.jsx';
import { Dot } from './components/ui.jsx';
import { Icon } from './components/Icons.jsx';
import { useEscape } from './lib/hooks.js';

function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print pointer-events-none fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-1.5"
    >
      {toasts.map((t) => (
        <div key={t.id} className="recess toast-in pointer-events-auto flex items-center gap-2 py-1.5 pl-3 pr-1.5">
          <Dot tone="accent" />
          <span className="text-[11px] text-t2">{t.msg}</span>
          <button
            onClick={() => dismissToast(t.id)}
            className="icon-btn !h-5 !w-5 text-t3"
            aria-label="dismiss notification"
            title="dismiss"
          >
            <Icon name="x" size={10} />
          </button>
        </div>
      ))}
    </div>
  );
}

const isTypingTarget = (el) =>
  !!el &&
  (el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable);

const inDialog = (el) => !!el?.closest?.('[role="dialog"]');

function Shell() {
  const { tools, setMode, drawer, setDrawer, help, setHelp } = useApp();

  useEscape(() => setDrawer(null), !!drawer);

  // console-grade keyboard map: / talks to the scene, 1–4 flip display
  // sources, ? opens the guide. Skipped while typing, inside a dialog, and
  // never with a modifier held — the map must not swallow browser shortcuts.
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target) || inDialog(e.target)) return;
      if (e.key === '/') {
        e.preventDefault();
        document.getElementById('composer-input')?.focus();
      } else if (e.key === '?') {
        e.preventDefault();
        setHelp(true);
      } else if (e.key === '1') setMode('optical');
      else if (e.key === '2') setMode('sar');
      else if (e.key === '3') setMode('blend');
      else if (e.key === '4') setMode('change');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setMode, setHelp]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <a
        href="#scene-region"
        className="skip-link recess px-3 py-1.5 text-[11.5px] font-semibold text-accent"
      >
        Skip to the scene
      </a>
      <Header onHelp={() => setHelp(true)} />
      <div className="flex min-h-0 flex-1">
        {!tools.fullscreen && <Sidebar />}
        <Viewer />
        {!tools.fullscreen && <QueryPanel />}
      </div>
      {drawer && !tools.fullscreen && (
        <div
          aria-hidden="true"
          className="fixed inset-x-0 bottom-0 top-14 z-30 bg-ink/70 backdrop-blur-[2px] lg:hidden"
          onClick={() => setDrawer(null)}
        />
      )}
      <Toasts />
      <HelpDialog open={help} onClose={() => setHelp(false)} />
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
