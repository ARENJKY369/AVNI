import { useEffect, useRef, useState } from 'react';
import { Icon, AvniMark } from './Icons.jsx';
import Answer from './Answer.jsx';
import { useApp } from '../state/AppState.jsx';
import { ABSTAIN_GATE } from '../lib/model.js';
import { SUGGESTIONS } from '../data/mock.js';
import { exportSessionMarkdown } from '../lib/export.js';

function HeaderStatus() {
  const { queries } = useApp();
  const last = queries[queries.length - 1];
  const state = !last ? 'READY' : last.status === 'analyzing' ? 'ANALYZING' : 'ANSWERED';
  return (
    <span
      role="status"
      aria-live="polite"
      className={`data-mono font-semibold tracking-wider ${
        state === 'ANALYZING' ? 'text-warn' : 'text-accent'
      }`}
    >
      {state}
    </span>
  );
}

function FloatingActions() {
  const { layers, toggleLayer, toast } = useApp();
  const [open, setOpen] = useState(null); // 'layers' | 'model' | null
  return (
    <div className="absolute right-2 top-1/2 z-30 flex -translate-y-1/2 flex-col gap-2">
      <div className="relative">
        <button
          className={`float-btn ${open === 'layers' ? '!text-accent !border-accent/50' : ''}`}
          title="quick layers"
          aria-label="quick layers"
          aria-expanded={open === 'layers'}
          onClick={() => setOpen(open === 'layers' ? null : 'layers')}
        >
          <Icon name="layers" size={14} />
        </button>
        {open === 'layers' && (
          <div className="recess absolute right-10 top-0 w-[168px] px-3 py-2.5">
            <div className="lbl mb-2">Quick layers</div>
            {Object.values(layers).map((l) => (
              <button
                key={l.id}
                onClick={() => toggleLayer(l.id)}
                aria-pressed={l.on}
                className="flex w-full items-center gap-2 py-1 text-left text-[11px] text-t2 hover:text-t1"
              >
                <span className={`chk !h-3.5 !w-3.5 ${l.on ? 'chk-on' : ''}`}>
                  {l.on && <Icon name="check" size={9} sw={2.6} />}
                </span>
                {l.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="relative">
        <button
          className={`float-btn ${open === 'model' ? '!text-accent !border-accent/50' : ''}`}
          title="model card"
          aria-label="model card"
          aria-expanded={open === 'model'}
          onClick={() => setOpen(open === 'model' ? null : 'model')}
        >
          <Icon name="model" size={14} />
        </button>
        {open === 'model' && (
          <div className="recess absolute right-10 top-0 w-[190px] px-3 py-2.5">
            <div className="lbl mb-2">Model card</div>
            {[
              ['backbone', 'AVNI-VL 0.9'],
              ['optical head', 'S2 12-band'],
              ['sar head', 'C-band GRD'],
              ['abstain gate', String(ABSTAIN_GATE)],
              ['sweep', '8 orientations'],
              ['temp', '0.2']
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between py-0.5 text-[10.5px]">
                <span className="text-t3">{k}</span>
                <span className="data-mono text-t2">{v}</span>
              </div>
            ))}
            <button
              className="mt-1.5 w-full rounded border border-edge py-1 text-[10px] text-t3 hover:text-t1"
              onClick={() => toast('weights are not part of the frontend build')}
            >
              inspect weights
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AttachDropzone() {
  const { attachSceneB, setAttachOpen } = useApp();
  const [hover, setHover] = useState(false);
  const inputRef = useRef(null);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        e.preventDefault();
        setHover(false);
        const f = e.dataTransfer.files && e.dataTransfer.files[0];
        attachSceneB(f || undefined);
      }}
      className={`mb-2 rounded-lg border border-dashed px-3 py-2.5 text-center transition-colors ${
        hover ? 'border-accent/60 bg-accent/5' : 'border-edge bg-recess'
      }`}
    >
      <div className="text-[11px] text-t2">drop a second scene (SAR or optical epoch)</div>
      <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10.5px]">
        <button className="text-accent hover:opacity-80" onClick={() => inputRef.current?.click()}>
          browse
        </button>
        <span className="text-t3">·</span>
        <button className="text-t2 hover:text-t1" onClick={() => attachSceneB()}>
          use service epoch S2 2024-11-02
        </button>
        <span className="text-t3">·</span>
        <button className="text-t3 hover:text-t1" onClick={() => setAttachOpen(false)}>
          cancel
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        aria-label="attach second scene file"
        onChange={(e) => {
          const f = e.target.files && e.target.files[0];
          attachSceneB(f || undefined);
        }}
      />
    </div>
  );
}

export default function QueryPanel() {
  const { queries, sendQuery, attachOpen, setAttachOpen, sceneB, detachSceneB, toast, drawer, sceneGeo } =
    useApp();
  const [text, setText] = useState('');
  const scrollRef = useRef(null);
  // follow new messages only while the reader is already at the bottom: the
  // old effect yanked them back down on every analysis stage tick
  const pinned = useRef(true);
  const force = useRef(false);
  const total = queries.length;
  const doneCount = queries.filter((q) => q.status === 'done').length;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!pinned.current && !force.current) return;
    force.current = false;
    el.scrollTop = el.scrollHeight;
  }, [total, doneCount]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  const submit = (t, intent) => {
    const q = t ?? text;
    if (!q.trim()) return;
    force.current = true;
    sendQuery(q, { intent });
    setText('');
  };

  return (
    <aside
      className={`fixed bottom-0 right-0 top-14 z-40 flex w-[380px] max-w-[92vw] shrink-0 flex-col border-l hair bg-panel transition-transform duration-200 lg:relative lg:inset-auto lg:z-auto lg:translate-x-0 ${
        drawer === 'query' ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {/* header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b hair px-4">
        <span className="lbl">Query</span>
        <div className="flex items-center gap-1.5">
          {queries.some((q) => q.status === 'done') && (
            <button
              className="icon-btn !h-6 !w-6"
              title="export session report · Markdown"
              aria-label="export session report"
              onClick={() => {
                exportSessionMarkdown(queries, sceneGeo);
                toast('session report exported · Markdown');
              }}
            >
              <Icon name="download" size={13} />
            </button>
          )}
          <HeaderStatus />
        </div>
      </div>

      <FloatingActions />

      {/* conversation */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        aria-live="polite"
        aria-label="answer stream"
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        {queries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <span className="mb-3 text-accent">
              <Icon name="radar" size={30} sw={1.3} />
            </span>
            <div className="text-[13.5px] font-semibold text-t1">Ask about this scene</div>
            <p className="mt-1.5 max-w-[240px] text-[11.5px] leading-[17px] text-t2">
              Every numeric claim will carry its source, confidence, and geodetic evidence.
            </p>
            <div className="mt-4 flex flex-col items-stretch gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => submit(s)} className="chip justify-start text-left !leading-[15px]">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {queries.map((q) => (
              <div key={q.id}>
                <div className="mb-2 flex justify-end">
                  <div className="max-w-[85%] rounded-lg rounded-br-sm border border-edge bg-recess px-3 py-2">
                    <p className="text-[12px] leading-[17px] text-t1">{q.payload.question}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <AvniMark size={16} />
                  <span className="text-[10px] font-semibold tracking-wider text-t3">AVNI</span>
                </div>
                <div className="mt-1.5">
                  <Answer q={q} onFollowup={(label, intent) => submit(label, intent)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* composer */}
      <div className="shrink-0 border-t hair px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        {sceneB && !attachOpen && (
          <div className="mb-2 flex items-center gap-2 rounded-md border border-warn/30 bg-warn/[0.06] px-2.5 py-1.5">
            <Icon name="paperclip" size={11} className="text-warn" />
            <span className="data-mono truncate text-t2">{sceneB.file}</span>
            <span className="data-mono ml-auto text-warn">ΔT epoch</span>
            <button className="icon-btn !h-5 !w-5" title="detach" aria-label="detach second epoch" onClick={detachSceneB}>
              <Icon name="x" size={10} />
            </button>
          </div>
        )}
        {attachOpen && <AttachDropzone />}
        <div className="recess flex items-center gap-2 py-1.5 pl-3.5 pr-1.5">
          <input
            id="composer-input"
            value={text}
            aria-label="ask the scene a question"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask the scene — flood, growth, vegetation…"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-t1 placeholder:text-t3 focus:outline-none"
          />
          <button
            onClick={() => setAttachOpen((o) => !o)}
            className={`icon-btn !h-7 !w-7 ${attachOpen ? 'icon-btn-on' : ''}`}
            title="attach second scene"
            aria-label="attach second scene"
            aria-pressed={attachOpen}
          >
            <Icon name="paperclip" size={14} />
          </button>
          <button
            onClick={() => submit()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-ink transition-opacity hover:opacity-85"
            title="send"
            aria-label="send question"
          >
            <Icon name="send" size={14} sw={2} />
          </button>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-1 text-[10px] text-t3">
          <kbd>↵</kbd> Enter to send
          <span className="mx-0.5">·</span>
          <button
            className="text-t3 underline decoration-dotted underline-offset-2 hover:text-accent"
            onClick={() => setAttachOpen(true)}
          >
            attach a second scene for optical/SAR cross-check
          </button>
          <span
            className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-edge text-t3"
            title={`AVNI-VL 0.9 · abstain gate ${ABSTAIN_GATE}`}
          >
            <Icon name="info" size={9} />
          </span>
        </div>
      </div>
    </aside>
  );
}
