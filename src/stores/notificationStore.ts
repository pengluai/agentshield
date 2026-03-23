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
  // Runtime guard — network
  ['已拦下未允许的联网地址', 'Blocked unauthorized network address'],
  ['发现未允许的联网地址，但未能自动暂停', 'Unauthorized network address detected, but auto-suspend failed'],
  ['已拦下一个联网请求', 'Blocked a network request'],
  ['已拦下一个数据库外联请求', 'Blocked a database exfiltration request'],
  // Runtime guard — approval titles
  ['这次启动需要你点头', 'Approve this launch'],
  ['这次安装操作需要你点头', 'Approve this installation'],
  ['这次删除操作需要你点头', 'Approve this deletion'],
  ['这次批量改动需要你点头', 'Approve this bulk modification'],
  ['这次删除密钥需要你点头', 'Approve this credential deletion'],
  ['这次导出密钥需要你点头', 'Approve this credential export'],
  ['这次网页提交需要你点头', 'Approve this web submission'],
  ['这次支付提交需要你点头', 'Approve this payment submission'],
  ['这次发送邮件需要你点头', 'Approve this email'],
  ['这次删改邮件需要你点头', 'Approve this email modification'],
  ['这次执行命令需要你点头', 'Approve this command execution'],
  ['这次数据库外联/外传需要你点头', 'Approve this database exfiltration'],
  ['这次高危操作需要你点头', 'Approve this high-risk action'],
  ['发现一个需要你决定的敏感操作', 'A sensitive action needs your approval'],
  // Runtime guard — blocked actions
  ['已拦下可疑删除动作', 'Blocked suspicious delete action'],
  ['已拦下可疑命令执行', 'Blocked suspicious command execution'],
  ['已拦下可疑批量文件操作', 'Blocked suspicious bulk file operation'],
  ['已拦下可疑邮件发送', 'Blocked suspicious email send'],
  ['已拦下可疑支付操作', 'Blocked suspicious payment action'],
  ['已拦下可疑浏览器提交', 'Blocked suspicious browser submission'],
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

  // Dynamic approval titles with host
  const hostBlock = text.match(/已拦下连接 (.+) 的请求/);
  if (hostBlock) return `Blocked connection to ${hostBlock[1]}`;
  const dbHostBlock = text.match(/已拦下数据库外联到 (.+) 的请求/);
  if (dbHostBlock) return `Blocked database exfiltration to ${dbHostBlock[1]}`;

  // Dynamic approval summaries (component name + action description)
  const SUMMARY_PATTERNS: Array<[RegExp, string]> = [
    [/(.+) 想启动。第一次运行前，AgentShield 需要先确认你是否愿意放行。/, '$1 wants to launch. AgentShield needs your approval before first run.'],
    [/(.+) 想连接 (.+)。在你点头前，这个地址不会被加入允许名单。/, '$1 wants to connect to $2. This address will not be allowed until you approve.'],
    [/(.+) 想发起一次联网操作，正在等你决定。/, '$1 wants to make a network request. Waiting for your approval.'],
    [/(.+) 想把数据库流量或数据发往 (.+)，正在等你决定。/, '$1 wants to send database traffic to $2. Waiting for your approval.'],
    [/(.+) 想发起一次数据库外联或外传操作，正在等你决定。/, '$1 wants to initiate a database exfiltration. Waiting for your approval.'],
    [/(.+) 想把新的扩展能力写入 (.+)。在你点头前，这次安装不会被放行。/, '$1 wants to install extensions to $2. Installation blocked until you approve.'],
    [/(.+) 想删除 (.+)。在你点头前，这次删除不会被放行。/, '$1 wants to delete $2. Deletion blocked until you approve.'],
    [/(.+) 想批量改动 (.+)。在你点头前，AgentShield 会继续拦住。/, '$1 wants to bulk modify $2. Blocked until you approve.'],
    [/(.+) 想删除密钥 (.+)。在你点头前，这次删除不会被放行。/, '$1 wants to delete credential $2. Deletion blocked until you approve.'],
    [/(.+) 想显示或导出密钥 (.+)。在你点头前，明文不会被取出。/, '$1 wants to export credential $2. Plaintext will not be revealed until you approve.'],
    [/(.+) 想把内容提交到网页。AgentShield 正在等你确认目标与内容。/, '$1 wants to submit content to a web page. Waiting for your approval.'],
    [/(.+) 想提交支付请求。AgentShield 正在等你确认金额与目标。/, '$1 wants to submit a payment. Waiting for your approval.'],
    [/(.+) 想发送邮件。AgentShield 正在等你确认收件人与正文。/, '$1 wants to send an email. Waiting for your approval.'],
    [/(.+) 想删除或归档邮件。AgentShield 正在等你确认范围。/, '$1 wants to delete or archive emails. Waiting for your approval.'],
    [/(.+) 想执行命令。AgentShield 正在等你确认命令内容。/, '$1 wants to execute a command. Waiting for your approval.'],
    [/(.+) 想把数据库内容或数据库连接流量发往外部目标。AgentShield 正在等你确认目标与范围。/, '$1 wants to send database content to an external target. Waiting for your approval.'],
    [/(.+) 触发了一个需要你确认的敏感操作。/, '$1 triggered a sensitive action that needs your approval.'],
  ];
  for (const [pattern, template] of SUMMARY_PATTERNS) {
    const m = text.match(pattern);
    if (m) {
      let result = template;
      for (let i = 1; i < m.length; i++) {
        result = result.replace(`$${i}`, m[i]);
      }
      return result;
    }
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
