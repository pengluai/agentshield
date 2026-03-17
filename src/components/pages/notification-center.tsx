import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, Check, X, AlertTriangle, Info, CheckCircle, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useNotificationStore, selectUnreadCount } from "@/stores/notificationStore";
import type { Notification, NotificationType, NotificationPriority } from "@/types/domain";
import { t } from '@/constants/i18n';
import { translateBackendText } from '@/lib/locale-text';

// Map domain types to visual config.
// The original component used "success" | "warning" | "error" | "info" locally.
// We now derive the visual style from the domain's type + priority fields.
function getVisualType(notification: Notification): "success" | "warning" | "error" | "info" {
  if (notification.priority === "critical") return "error";
  if (notification.priority === "warning") return "warning";
  if (notification.type === "update") return "info";
  // Informational system events are shown with a success-style badge.
  if (notification.type === "system" && notification.priority === "info") return "success";
  return "info";
}

const typeConfig = {
  success: {
    icon: CheckCircle,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/20",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/20",
  },
  error: {
    icon: X,
    color: "text-rose-400",
    bgColor: "bg-rose-500/10",
    borderColor: "border-rose-500/20",
  },
  info: {
    icon: Info,
    color: "text-sky-400",
    bgColor: "bg-sky-500/10",
    borderColor: "border-sky-500/20",
  },
};

function formatTimeAgo(isoString: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 60) return t.justNow;
  if (seconds < 3600) return t.minutesAgo.replace('{count}', String(Math.floor(seconds / 60)));
  if (seconds < 86400) return t.hoursAgoTime.replace('{count}', String(Math.floor(seconds / 3600)));
  return t.daysAgo.replace('{count}', String(Math.floor(seconds / 86400)));
}

export function NotificationCenter() {
  const notifications = useNotificationStore((s) => s.notifications);
  const loaded = useNotificationStore((s) => s.loaded);
  const loadNotifications = useNotificationStore((s) => s.loadNotifications);
  const markAsRead = useNotificationStore((s) => s.markAsRead);
  const markAllAsRead = useNotificationStore((s) => s.markAllAsRead);
  const removeNotification = useNotificationStore((s) => s.removeNotification);
  const clearAll = useNotificationStore((s) => s.clearAll);
  const unreadCount = useNotificationStore(selectUnreadCount);

  const [filter, setFilter] = useState<"all" | "unread">("all");

  // Load notifications from real backend on mount
  useEffect(() => {
    if (!loaded) {
      loadNotifications();
    }
  }, [loaded, loadNotifications]);

  const filteredNotifications = filter === "all"
    ? notifications
    : notifications.filter(n => !n.read);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-500/20 flex items-center justify-center">
            <Bell className="w-5 h-5 text-rose-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">{t.notifications}</h1>
            <p className="text-sm text-white/60">
              {unreadCount > 0 ? t.unreadNotifications.replace('{count}', String(unreadCount)) : t.noUnreadNotifications}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={markAllAsRead}
            className="text-white/60 hover:text-white hover:bg-white/10"
          >
            <Check className="w-4 h-4 mr-1" />
            {t.markAllRead}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAll}
            className="text-white/60 hover:text-white hover:bg-white/10"
          >
            <Trash2 className="w-4 h-4 mr-1" />
            {t.clearAll}
          </Button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 p-4 border-b border-white/10">
        <button
          onClick={() => setFilter("all")}
          className={cn(
            "px-4 py-2 rounded-lg text-sm font-medium transition-all",
            filter === "all"
              ? "bg-white/10 text-white"
              : "text-white/60 hover:text-white hover:bg-white/5"
          )}
        >
          {t.filterAll}
        </button>
        <button
          onClick={() => setFilter("unread")}
          className={cn(
            "px-4 py-2 rounded-lg text-sm font-medium transition-all",
            filter === "unread"
              ? "bg-white/10 text-white"
              : "text-white/60 hover:text-white hover:bg-white/5"
          )}
        >
          {t.filterUnread} {unreadCount > 0 && `(${unreadCount})`}
        </button>
      </div>

      {/* Notification List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <AnimatePresence mode="popLayout">
          {filteredNotifications.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center h-64 text-white/40"
            >
              <Bell className="w-12 h-12 mb-4 opacity-50" />
              <p>{t.noNotifications}</p>
            </motion.div>
          ) : (
            filteredNotifications.map((notification) => {
              const visualType = getVisualType(notification);
              const config = typeConfig[visualType];
              const Icon = config.icon;

              return (
                <motion.div
                  key={notification.id}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -100 }}
                  className={cn(
                    "relative p-4 rounded-xl border transition-all cursor-pointer",
                    config.bgColor,
                    config.borderColor,
                    !notification.read && "ring-1 ring-white/20"
                  )}
                  onClick={() => markAsRead(notification.id)}
                >
                  <div className="flex gap-3">
                    <div className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                      config.bgColor
                    )}>
                      <Icon className={cn("w-4 h-4", config.color)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className={cn(
                          "font-medium",
                          notification.read ? "text-white/70" : "text-white"
                        )}>
                          {translateBackendText(notification.title)}
                        </h3>
                        <span className="text-xs text-white/40 flex-shrink-0">
                          {formatTimeAgo(notification.timestamp)}
                        </span>
                      </div>
                      <p className={cn(
                        "text-sm mt-1",
                        notification.read ? "text-white/50" : "text-white/70"
                      )}>
                        {translateBackendText(notification.body)}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeNotification(notification.id);
                      }}
                      className="p-1 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  {!notification.read && (
                    <div className="absolute top-4 right-12 w-2 h-2 rounded-full bg-sky-400" />
                  )}
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
