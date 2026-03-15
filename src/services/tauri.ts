import { invoke } from '@tauri-apps/api/core';

export function isTauriEnvironment() {
  if (typeof window === 'undefined') {
    return false;
  }

  return typeof (window as typeof window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === 'function';
}

export async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriEnvironment()) {
    throw new Error(`Tauri runtime unavailable for command: ${cmd}`);
  }
  return invoke<T>(cmd, args);
}
