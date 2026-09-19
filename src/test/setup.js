// jsdom is missing the browser APIs this console leans on. Each stub is the
// smallest thing that behaves like the real one, so component tests exercise
// the same code paths the browser does.
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: /min-width:\s*1024px/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  });
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (!navigator.clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true
  });
}

if (!URL.createObjectURL) {
  URL.createObjectURL = () => 'blob:test';
  URL.revokeObjectURL = () => {};
}

afterEach(() => cleanup());
