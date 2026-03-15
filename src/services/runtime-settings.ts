import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { open } from '@tauri-apps/plugin-shell';

export type MacPermissionPane = 'fullDiskAccess' | 'accessibility' | 'automation' | 'notifications';

const MAC_PERMISSION_URLS: Record<MacPermissionPane, string[]> = {
  fullDiskAccess: [
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy',
    'x-apple.systempreferences:com.apple.preference.security?Privacy',
    'x-apple.systempreferences:com.apple.preference.security',
  ],
  accessibility: [
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy',
    'x-apple.systempreferences:com.apple.preference.security?Privacy',
    'x-apple.systempreferences:com.apple.preference.security',
  ],
  automation: [
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Automation',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy',
    'x-apple.systempreferences:com.apple.preference.security?Privacy',
    'x-apple.systempreferences:com.apple.preference.security',
  ],
  notifications: [
    'x-apple.systempreferences:com.apple.settings.Notifications',
    'x-apple.systempreferences:com.apple.preference.notifications',
  ],
};

const MAC_PERMISSION_MANUAL_GUIDES: Record<MacPermissionPane, string[]> = {
  fullDiskAccess: [
    '系统设置',
    '隐私与安全性',
    '完全磁盘访问',
    '打开 AgentShield 开关',
  ],
  accessibility: [
    '系统设置',
    '隐私与安全性',
    '辅助功能',
    '打开 AgentShield 开关',
  ],
  automation: [
    '系统设置',
    '隐私与安全性',
    '自动化',
    '在 AgentShield 下勾选目标应用',
  ],
  notifications: [
    '系统设置',
    '通知',
    'AgentShield',
    '允许通知并启用横幅提醒',
  ],
};

const ALLOWED_EXTERNAL_URL_PATTERNS = [
  /^https:\/\/.+/i,
  /^x-apple\.systempreferences:.+/i,
];

export interface InstalledUpdateAuditItem {
  item_id: string;
  platform?: string;
  source_path?: string;
  current_version: string;
  new_version: string;
  has_update: boolean;
  tracked?: boolean;
  reason?: string;
}

export interface InstalledUpdateAuditResult {
  appVersion: string;
  checkedAt: string;
  updates: InstalledUpdateAuditItem[];
  trackedCount: number;
  untrackedCount: number;
}

export interface RuleUpdateStatus {
  active_version: string;
  active_source: string;
  update_available: boolean;
  available_version?: string | null;
  last_applied_at?: string | null;
}

export interface PersistentNotificationInput {
  notificationType: 'security' | 'system' | 'update';
  priority: 'critical' | 'warning' | 'info';
  title: string;
  body: string;
}

function isTauriEnvironment() {
  if (typeof window === 'undefined') {
    return false;
  }

  return typeof (window as typeof window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === 'function';
}

export function isAllowedExternalUrl(url: string) {
  const normalized = url.trim();
  return ALLOWED_EXTERNAL_URL_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function getMacPermissionManualGuide(pane: MacPermissionPane) {
  return MAC_PERMISSION_MANUAL_GUIDES[pane].join(' > ');
}

export async function setAutostartEnabled(enabled: boolean) {
  if (!isTauriEnvironment()) {
    return enabled;
  }

  if (enabled) {
    await enable();
  } else {
    await disable();
  }

  return isEnabled();
}

export async function getAutostartEnabled() {
  if (!isTauriEnvironment()) {
    return null;
  }

  try {
    return await isEnabled();
  } catch {
    return null;
  }
}

export async function openExternalUrl(url: string) {
  const normalized = url.trim();
  if (!isAllowedExternalUrl(normalized)) {
    throw new Error(`Blocked external URL: ${url}`);
  }

  if (isTauriEnvironment()) {
    await open(normalized);
    return;
  }

  if (typeof window !== 'undefined') {
    window.open(normalized, '_blank', 'noopener,noreferrer');
  }
}

export async function getNotificationPermissionGranted() {
  if (!isTauriEnvironment()) {
    return null;
  }

  try {
    return await isPermissionGranted();
  } catch {
    return null;
  }
}

export async function ensureNotificationPermission() {
  if (!isTauriEnvironment()) {
    return false;
  }

  let granted = await isPermissionGranted();
  if (!granted) {
    granted = (await requestPermission()) === 'granted';
  }
  return granted;
}

export async function openMacPermissionSettings(pane: MacPermissionPane) {
  if (isTauriEnvironment()) {
    try {
      const opened = await invoke<boolean>('open_macos_permission_settings', { pane });
      if (opened) {
        return true;
      }
      console.warn(`[AgentShield] backend could not open macOS settings pane: ${pane}`);
    } catch {
      console.warn(`[AgentShield] failed to invoke backend macOS settings opener for pane: ${pane}`);
      // Fall through to frontend URL-based fallback.
    }
  }

  const urls = MAC_PERMISSION_URLS[pane];

  for (const url of urls) {
    try {
      await openExternalUrl(url);
      return true;
    } catch {
      console.warn(`[AgentShield] frontend fallback URL failed: ${url}`);
      // Try the next fallback URL for the same settings area.
    }
  }

  return false;
}

export async function sendDesktopNotification(title: string, body: string) {
  if (!isTauriEnvironment()) {
    return false;
  }

  const granted = await ensureNotificationPermission();
  if (!granted) {
    return false;
  }

  sendNotification({ title, body });
  return true;
}

export async function createPersistentNotification(input: PersistentNotificationInput) {
  await invoke('create_notification', input as unknown as Record<string, unknown>);
}

export async function runInstalledUpdateAudit(): Promise<InstalledUpdateAuditResult> {
  const [appVersion, updates] = await Promise.all([
    getVersion().catch(() => '1.0.0'),
    invoke<InstalledUpdateAuditItem[]>('check_installed_updates').catch(() => []),
  ]);

  return {
    appVersion,
    checkedAt: new Date().toISOString(),
    updates: updates.filter((item) => item.has_update),
    trackedCount: updates.filter((item) => item.tracked !== false).length,
    untrackedCount: updates.filter((item) => item.tracked === false).length,
  };
}

export async function getRuleUpdateStatus(): Promise<RuleUpdateStatus> {
  return invoke<RuleUpdateStatus>('get_rule_update_status');
}

export async function syncSecurityRules(): Promise<RuleUpdateStatus> {
  await invoke('download_and_apply_rules');
  return getRuleUpdateStatus();
}

export async function hideMainWindow() {
  if (!isTauriEnvironment()) {
    return;
  }

  await getCurrentWindow().hide();
}

export async function restoreMainWindow() {
  if (!isTauriEnvironment()) {
    return;
  }

  const window = getCurrentWindow();
  await window.show();
  await window.unminimize();
  await window.setFocus();
}
