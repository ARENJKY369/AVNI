// Shared UI behaviour hooks. Kept out of components so the focus and motion
// rules are implemented once and can be reasoned about (and tested) alone.
import { useEffect, useRef, useState } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab inside an open dialog and returns focus to whatever was focused
 * before it opened — the two things that make a modal usable with a keyboard.
 */
export function useFocusTrap(ref, active) {
  useEffect(() => {
    if (!active || !ref.current) return undefined;
    const node = ref.current;
    const previous = typeof document !== 'undefined' ? document.activeElement : null;
    const items = () => Array.from(node.querySelectorAll(FOCUSABLE));
    const first = items()[0];
    (first || node).focus?.({ preventScroll: true });

    const onKeyDown = (event) => {
      if (event.key !== 'Tab') return;
      const list = items();
      if (!list.length) return;
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };

    node.addEventListener('keydown', onKeyDown);
    return () => {
      node.removeEventListener('keydown', onKeyDown);
      if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
    };
  }, [ref, active]);
}

/** Calls the handler when Escape is pressed while `active`. */
export function useEscape(handler, active = true) {
  const saved = useRef(handler);
  saved.current = handler;
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') saved.current?.(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}

/** True when the OS asks for reduced motion. Recomputed when that changes. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (e) => setReduced(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

/** Subscribes to a CSS media query — used for the responsive drawer semantics. */
export function useMedia(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return true;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const onChange = (e) => setMatches(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [query]);
  return matches;
}

/** One rAF-throttled callback — for pointer readouts that must not re-render per event. */
export function useRafThrottle(fn) {
  const frame = useRef(0);
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return (arg) => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      latest.current(arg);
    });
  };
}
