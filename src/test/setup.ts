import '@testing-library/jest-dom';
import { beforeEach, vi } from 'vitest';
import { resetTauriMocks } from './__mocks__/tauri';

const storage = new Map<string, string>();

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
  },
  configurable: true,
});

Object.defineProperty(window, 'matchMedia', {
  value: vi.fn().mockImplementation(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
  configurable: true,
});

Object.defineProperty(window.navigator, 'language', {
  value: 'zh-CN',
  configurable: true,
});

Object.defineProperty(window, '__TAURI_INTERNALS__', {
  value: { invoke: () => undefined },
  configurable: true,
});

beforeEach(() => {
  storage.clear();
  resetTauriMocks();
});
