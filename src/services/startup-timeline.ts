import { isEnglishLocale } from '@/constants/i18n';

const tr = (zh: string, en: string) => (isEnglishLocale ? en : zh);

export type StartupTimelineStatus = 'started' | 'completed' | 'skipped' | 'failed';

export interface StartupTimelineEvent {
  id: string;
  timestamp: string;
  step: string;
  status: StartupTimelineStatus;
  summary: string;
}

const STARTUP_TIMELINE_KEY = 'agentshield-startup-timeline';
const MAX_STARTUP_EVENTS = 40;

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readEvents(): StartupTimelineEvent[] {
  if (!isBrowser()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STARTUP_TIMELINE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeEvents(events: StartupTimelineEvent[]) {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(STARTUP_TIMELINE_KEY, JSON.stringify(events.slice(0, MAX_STARTUP_EVENTS)));
}

export function clearStartupTimelineEvents() {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.removeItem(STARTUP_TIMELINE_KEY);
}

export function listStartupTimelineEvents(): StartupTimelineEvent[] {
  return readEvents().sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

export function recordStartupTimelineEvent(
  step: string,
  status: StartupTimelineStatus,
  summary: string,
) {
  const nextEvent: StartupTimelineEvent = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    step,
    status,
    summary,
  };

  writeEvents([nextEvent, ...readEvents()]);
  return nextEvent;
}

export function beginStartupTimelineSession(options: { safeMode: boolean }) {
  clearStartupTimelineEvents();
  return recordStartupTimelineEvent(
    'app_boot',
    'started',
    options.safeMode
      ? tr('应用以安全模式启动，本次会跳过后台扫描、自动更新检查和主动防护。', 'App started in safe mode. Background scans, auto-update checks, and active protection are skipped.')
      : tr('应用正常启动，开始初始化本地防护与审批能力。', 'App started normally. Initializing local protection and approval capabilities.')
  );
}
