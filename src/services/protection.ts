import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface ProtectionIncident {
  id: string;
  timestamp: string;
  category: 'mcp' | 'skill' | 'config' | string;
  severity: 'critical' | 'warning' | string;
  title: string;
  description: string;
  file_path: string;
  action: string;
}

export interface ProtectionStatus {
  enabled: boolean;
  watcher_ready: boolean;
  auto_quarantine: boolean;
  watched_paths: string[];
  incident_count: number;
  last_event_at: string | null;
  quarantine_dir: string;
  last_incident: ProtectionIncident | null;
}

const DEFAULT_STATUS: ProtectionStatus = {
  enabled: false,
  watcher_ready: false,
  auto_quarantine: false,
  watched_paths: [],
  incident_count: 0,
  last_event_at: null,
  quarantine_dir: '',
  last_incident: null,
};

function isTauriEnvironment() {
  if (typeof window === 'undefined') {
    return false;
  }

  return typeof (window as typeof window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === 'function';
}

export async function getProtectionStatus(): Promise<ProtectionStatus> {
  if (!isTauriEnvironment()) {
    return DEFAULT_STATUS;
  }

  try {
    return await invoke<ProtectionStatus>('get_protection_status');
  } catch (error) {
    console.error('Failed to get protection status:', error);
    return DEFAULT_STATUS;
  }
}

export async function configureProtection(enabled: boolean, autoQuarantine: boolean): Promise<ProtectionStatus> {
  if (!isTauriEnvironment()) {
    return {
      ...DEFAULT_STATUS,
      enabled,
      auto_quarantine: autoQuarantine,
    };
  }

  return invoke<ProtectionStatus>('configure_protection', {
    enabled,
    autoQuarantine,
  });
}

export async function listProtectionIncidents(): Promise<ProtectionIncident[]> {
  if (!isTauriEnvironment()) {
    return [];
  }

  try {
    return await invoke<ProtectionIncident[]>('list_protection_incidents');
  } catch (error) {
    console.error('Failed to list protection incidents:', error);
    return [];
  }
}

export async function clearProtectionIncidents() {
  if (!isTauriEnvironment()) {
    return false;
  }

  try {
    return await invoke<boolean>('clear_protection_incidents');
  } catch (error) {
    console.error('Failed to clear protection incidents:', error);
    return false;
  }
}

export async function listenProtectionStatus(
  handler: (status: ProtectionStatus) => void
): Promise<UnlistenFn> {
  if (!isTauriEnvironment()) {
    return () => {};
  }

  return listen<ProtectionStatus>('protection-status-changed', (event) => {
    handler(event.payload);
  });
}

export async function listenProtectionIncidents(
  handler: (incident: ProtectionIncident) => void
): Promise<UnlistenFn> {
  if (!isTauriEnvironment()) {
    return () => {};
  }

  return listen<ProtectionIncident>('protection-incident', (event) => {
    handler(event.payload);
  });
}
