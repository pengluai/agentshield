import { invoke } from '@tauri-apps/api/core';

const DEFAULT_INVOKE_TIMEOUT_MS = 30_000;

const COMMAND_TIMEOUT_OVERRIDES: Record<string, number> = {
  scan_full: 120_000,
  fix_all: 120_000,
  install_openclaw_cmd: 180_000,
  update_openclaw_cmd: 180_000,
  uninstall_openclaw_cmd: 120_000,
  execute_install_step: 180_000,
  check_openclaw_latest_version: 60_000,
  download_and_apply_rules: 60_000,
  test_ai_connection: 45_000,
  ai_diagnose_error: 90_000,
  sync_runtime_guard_components: 60_000,
  run_runtime_guard_poll_now: 60_000,
};

export function isTauriEnvironment() {
  if (typeof window === 'undefined') {
    return false;
  }

  return typeof (window as typeof window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === 'function';
}

function timeoutForCommand(cmd: string): number {
  return COMMAND_TIMEOUT_OVERRIDES[cmd] ?? DEFAULT_INVOKE_TIMEOUT_MS;
}

export async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriEnvironment()) {
    throw new Error(`Tauri runtime unavailable for command: ${cmd}`);
  }

  const timeoutMs = timeoutForCommand(cmd);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const invokePromise = args === undefined ? invoke<T>(cmd) : invoke<T>(cmd, args);
  try {
    return await Promise.race([
      invokePromise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Command timed out after ${timeoutMs}ms: ${cmd}`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
