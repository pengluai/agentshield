import { create } from 'zustand';
import { tauriInvoke as invoke } from '@/services/tauri';
import type { Notification } from '@/types/domain';
import { isEnglishLocale } from '@/constants/i18n';
import { useAppStore } from './appStore';
import { playSound } from '@/services/sound';
import { isTauriEnvironment } from '@/services/tauri';
import { containsCjk } from '@/lib/locale-text';

interface NotificationState {
  notifications: Notification[];
  loaded: boolean;

  // Actions
  loadNotifications: () => Promise<void>;
  addNotification: (notification: Notification) => void;
  pushNotification: (input: {
    type: Notification['type'];
    priority: Notification['priority'];
    title: string;
    body: string;
  }) => Promise<void>;
  removeNotification: (id: string) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => void;
}

const NOTIFICATION_SOUND_COOLDOWN_MS = 4000;
let lastNotificationCueAt = 0;

/**
 * Bidirectional notification translation table.
 * Each entry is [Chinese, English]. The function picks the right direction based on locale.
 * Entries with `{n}` are dynamic-number patterns handled separately below.
 */
const NOTIFICATION_BILINGUAL: Array<[string, string]> = [
  // Scan results
  ['安全扫描已完成，请立即查看并处理高风险项目。', 'Security scan completed. Please review and handle critical issues now.'],
  ['建议运行首次安全扫描', 'Run your first security scan'],
  ['请前往安全扫描页面，运行首次 MCP 安全检查。', 'Go to Security Scan to run your first MCP security check.'],
  // Runtime guard
  ['已拦下未允许的联网地址', 'Blocked unauthorized network address'],
  ['发现未允许的联网地址，但未能自动暂停', 'Unauthorized network address detected, but auto-suspend failed'],
  // Generic
  ['安全通知', 'Security notification'],
  ['发现安全事件，请查看详情。', 'A security event was detected. Please review details.'],
  ['发现高风险安全事件，请立即查看。', 'A critical security event requires your review.'],
];

function localizeNotificationText(text: string, fallback: string): string {
  // --- Chinese locale: translate English → Chinese ---
  if (!isEnglishLocale) {
    // Dynamic pattern: "N critical security issues detected"
    const critMatch = text.match(/^(\d+) critical security issues? detected$/);
    if (critMatch) {
      return `发现 ${critMatch[1]} 个高风险安全问题`;
    }
    // Static bilingual lookup (EN→CN)
    for (const [cn, en] of NOTIFICATION_BILINGUAL) {
      if (text === en) return cn;
    }
    // If text is already Chinese, return as-is
    if (containsCjk(text)) return text;
    // English text with no mapping — return fallback
    return fallback;
  }

  // --- English locale: translate Chinese → English ---
  if (!containsCjk(text)) {
    return text;
  }

  // Dynamic pattern: "发现 N 个高风险安全问题"
  const critMatchCn = text.match(/发现 (\d+) 个高风险安全问题/);
  if (critMatchCn) {
    return `${critMatchCn[1]} critical security issues detected`;
  }
  // Static bilingual lookup (CN→EN)
  for (const [cn, en] of NOTIFICATION_BILINGUAL) {
    if (text === cn || text.includes(cn)) return en;
  }
  // Legacy patterns
  if (text.includes('免费版规则同步频率为每 7 天一次')) {
    return text.replace(
      /免费版规则同步频率为每 7 天一次，请在 (.+) 后重试。?/,
      'Free plan can sync rules once every 7 days. Try again after $1.',
    );
  }
  if (text.includes('当前使用规则版本')) {
    return text.replace(
      /当前使用规则版本 (.+)（(.+)）。后续扫描会立即采用这套规则。/,
      'Using rule version $1 ($2). Subsequent scans will use this ruleset immediately.',
    );
  }

  return fallback;
}

function localizeNotification(notification: Notification): Notification {
  const titleFallback = isEnglishLocale ? 'Security notification' : '安全通知';
  const bodyFallback = isEnglishLocale
    ? (notification.priority === 'critical'
        ? 'A critical security event requires your review.'
        : 'A security event was detected. Please review details.')
    : (notification.priority === 'critical'
        ? '发现高风险安全事件，请立即查看。'
        : '发现安全事件，请查看详情。');

  return {
    ...notification,
    title: localizeNotificationText(notification.title, titleFallback),
    body: localizeNotificationText(notification.body, bodyFallback),
  };
}

function syncUnreadCount(notifications: Notification[]) {
  const unreadCount = notifications.filter((n) => !n.read).length;
  useAppStore.getState().setUnreadCount(unreadCount);
}

function getUnreadNotificationIds(notifications: Notification[]) {
  return new Set(
    notifications
      .filter((item) => !item.read)
      .map((item) => item.id)
  );
}

function hasNewUnreadNotifications(previous: Notification[], next: Notification[]) {
  const previousUnreadIds = getUnreadNotificationIds(previous);
  return next.some((item) => !item.read && !previousUnreadIds.has(item.id));
}

function playCueForNewUnread(previous: Notification[], next: Notification[]) {
  if (!hasNewUnreadNotifications(previous, next)) {
    return;
  }

  const now = Date.now();
  if (now - lastNotificationCueAt < NOTIFICATION_SOUND_COOLDOWN_MS) {
    return;
  }

  lastNotificationCueAt = now;
  playSound('notification');
}

export function resetNotificationCueState() {
  lastNotificationCueAt = 0;
}

function createBrowserShellNotification(input: {
  type: Notification['type'];
  priority: Notification['priority'];
  title: string;
  body: string;
}): Notification {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `browser-shell-${Date.now()}`,
    type: input.type,
    priority: input.priority,
    title: localizeNotificationText(input.title, 'Security notification'),
    body: localizeNotificationText(input.body, 'A security event was detected.'),
    timestamp: new Date().toISOString(),
    read: false,
  };
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  loaded: false,

  loadNotifications: async () => {
    if (!isTauriEnvironment()) {
      const { notifications } = get();
      set({ loaded: true });
      syncUnreadCount(notifications);
      return;
    }

    try {
      const records = (await invoke<Notification[]>('get_notifications')).map(localizeNotification);
      const { notifications, loaded } = get();
      if (loaded) {
        playCueForNewUnread(notifications, records);
      }
      set({ notifications: records, loaded: true });
      syncUnreadCount(records);
    } catch (e) {
      console.error('Failed to load notifications:', e);
      set({ loaded: true });
    }
  },

  addNotification: (notification) => {
    set((state) => {
      const next = [notification, ...state.notifications];
      playCueForNewUnread(state.notifications, next);
      syncUnreadCount(next);
      return { notifications: next };
    });
  },

  pushNotification: async (input) => {
    if (!isTauriEnvironment()) {
      get().addNotification(createBrowserShellNotification(input));
      return;
    }

    try {
      await invoke('create_notification', {
        notificationType: input.type,
        priority: input.priority,
        title: input.title,
        body: input.body,
      });
      await get().loadNotifications();
    } catch (e) {
      console.error('Failed to create notification:', e);
    }
  },

  removeNotification: (id) => {
    set((state) => {
      const next = state.notifications.filter((n) => n.id !== id);
      syncUnreadCount(next);
      return { notifications: next };
    });

    if (!isTauriEnvironment()) {
      return;
    }

    invoke('delete_notification', { id }).catch((e) =>
      console.error('Failed to delete notification:', e)
    );
  },

  markAsRead: (id) => {
    // Optimistic update in Zustand
    set((state) => {
      const next = state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      );
      syncUnreadCount(next);
      return { notifications: next };
    });

    if (!isTauriEnvironment()) {
      return;
    }

    // Persist to backend
    invoke('mark_notification_read', { id }).catch((e) =>
      console.error('Failed to mark notification as read:', e)
    );
  },

  markAllAsRead: () => {
    const { notifications } = get();
    set({
      notifications: notifications.map((n) => ({ ...n, read: true })),
    });
    useAppStore.getState().setUnreadCount(0);

    if (!isTauriEnvironment()) {
      return;
    }

    // Persist each unread notification
    for (const n of notifications) {
      if (!n.read) {
        invoke('mark_notification_read', { id: n.id }).catch((e) =>
          console.error('Failed to mark notification as read:', e)
        );
      }
    }
  },

  clearAll: () => {
    set({ notifications: [] });
    useAppStore.getState().setUnreadCount(0);

    if (!isTauriEnvironment()) {
      return;
    }

    invoke('clear_notifications').catch((e) =>
      console.error('Failed to clear notifications:', e)
    );
  },
}));

// Selector helpers
export const selectUnreadCount = (state: NotificationState) =>
  state.notifications.filter((n) => !n.read).length;
