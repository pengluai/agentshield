import { useState, useEffect, useRef, Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { HashRouter } from 'react-router-dom';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AppLayout } from './components/app-layout';
import { MacOSFrame } from './components/macos-frame';
import { RuntimeApprovalModal } from './components/runtime-approval-modal';
import { SmartGuardHome } from './components/pages/smart-guard-home';
import { SecurityScanHome, SecurityScanDetail } from './components/pages/security-scan';
import { SkillStore } from './components/pages/skill-store';
import { InstallDialog } from './components/pages/install-dialog';
import { InstalledManagement } from './components/pages/installed-management';
import { KeyVaultDetail } from './components/pages/key-vault';
import { OpenClawWizard } from './components/pages/openclaw-wizard';
import { NotificationCenter } from './components/pages/notification-center';
import { SettingsPage } from './components/pages/settings-page';
import { UpgradePro } from './components/pages/upgrade-pro';
import { useAppStore } from './stores/appStore';
import { useLicenseStore } from './stores/licenseStore';
import { useNotificationStore } from './stores/notificationStore';
import { useSettingsStore } from './stores/settingsStore';
import { isEnglishLocale, t } from './constants/i18n';
import type { StoreCatalogItem } from './types/domain';
import { configureProtection, listenProtectionIncidents } from './services/protection';
import {
  listRuntimeGuardApprovalRequests,
  listenRuntimeGuardApprovals,
  resolveRuntimeGuardApprovalRequest,
  type RuntimeApprovalRequest,
} from './services/runtime-guard';
import {
  getRuleUpdateStatus,
  runInstalledUpdateAudit,
  sendDesktopNotification,
  syncSecurityRules,
} from './services/runtime-settings';
import { runFullScan } from './services/scanner';
import { beginStartupTimelineSession, recordStartupTimelineEvent } from './services/startup-timeline';
import { isTauriEnvironment, tauriInvoke } from './services/tauri';
import { MODULE_THEMES } from './constants/colors';

const tr = (zh: string, en: string) => (isEnglishLocale ? en : zh);

function getCardTitles(): Record<string, string> {
  return {
    'mcp-security': t.cardMcpSecurity,
    'key-security': t.cardKeySecurity,
    'env-config': t.cardEnvConfig,
    'skill-security': t.cardInstalledRisk,
    'system-protection': t.cardSystemProtection,
  };
}

const UPDATE_AUDIT_INTERVAL_MS = 60 * 60 * 1000;
const AUTO_RULE_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const WEEKLY_REPORT_INTERVAL_MS = 12 * 60 * 60 * 1000;
const TRAY_FORCE_QUIT_ARM_MS = 30 * 1000;
const UPDATE_AUDIT_DIGEST_KEY = 'agentshield-update-audit-digest';
const AUTO_RULE_SYNC_TIMESTAMP_KEY = 'agentshield-rule-sync-last-auto';
const WEEKLY_REPORT_TIMESTAMP_KEY = 'agentshield-weekly-report-ts';
const BACKGROUND_SCAN_TIMESTAMP_KEY = 'agentshield-background-scan-ts';

// Error Boundary to catch runtime crashes and show error info instead of blank screen
class ErrorBoundary extends Component<{ children: ReactNode; onReset?: () => void }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode; onReset?: () => void }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    recordStartupTimelineEvent('ui_crash', 'failed', tr(`界面渲染异常: ${error.message}`, `UI render exception: ${error.message}`));
    console.error('[AgentShield ErrorBoundary]', error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, color: '#fff', fontFamily: 'monospace' }}>
          <h2 style={{ color: '#EF4444' }}>{t.fixFailed}</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#F59E0B', fontSize: 13 }}>
            {this.state.error?.message}
          </pre>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#94A3B8', fontSize: 11, marginTop: 8 }}>
            {this.state.error?.stack}
          </pre>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              this.props.onReset?.();
            }}
            style={{ marginTop: 16, padding: '8px 20px', background: '#3B82F6', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
          >
            {t.backToHome}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const {
    currentModule,
    setCurrentModule,
    lastScanByCategory,
  } = useAppStore();
  const settings = useSettingsStore();
  const autoRuleUpdatesUnlocked = useLicenseStore((state) => state.features.includes('rule_updates'));
  const safeMode = settings.safeMode;

  const [showInstallDialog, setShowInstallDialog] = useState(false);
  const [selectedItem, setSelectedItem] = useState<StoreCatalogItem | null>(null);
  const [showSecurityDetail, setShowSecurityDetail] = useState(false);
  // Which card was clicked — null means fresh scan (no filter)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [approvalQueue, setApprovalQueue] = useState<RuntimeApprovalRequest[]>([]);
  const [approvalBusyId, setApprovalBusyId] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const startupTimelineLoggedRef = useRef<Set<string>>(new Set());
  const startupTimelineFinalizedRef = useRef<Set<string>>(new Set());
  const bypassCloseInterceptRef = useRef(false);
  const trayCloseArmedAtRef = useRef<number | null>(null);
  const prefersNativeCloseOnMac =
    typeof navigator !== 'undefined' && /macintosh|mac os x|darwin/i.test(navigator.userAgent);

  const recordStartupStepOnce = (
    step: string,
    status: 'started' | 'completed' | 'skipped' | 'failed',
    summary: string,
  ) => {
    const eventKey = `${step}:${status}`;
    if (
      startupTimelineLoggedRef.current.has(eventKey) ||
      (status !== 'started' && startupTimelineFinalizedRef.current.has(step))
    ) {
      return;
    }

    startupTimelineLoggedRef.current.add(eventKey);
    if (status !== 'started') {
      startupTimelineFinalizedRef.current.add(step);
    }
    recordStartupTimelineEvent(step, status, summary);
  };

  useEffect(() => {
    beginStartupTimelineSession({ safeMode });
  }, []);

  // Reset detail view state when sidebar navigation changes the module
  useEffect(() => {
    if (currentModule !== 'securityScan') {
      setShowSecurityDetail(false);
      setSelectedCardId(null);
    }
  }, [currentModule]);

  // Load persisted license & notifications from backend on startup
  useEffect(() => {
    if (!isTauriEnvironment()) {
      recordStartupStepOnce('license_status', 'skipped', tr('浏览器预览模式，跳过许可证状态 IPC 初始化。', 'Browser preview mode: skipping license IPC initialization.'));
      void useNotificationStore.getState().loadNotifications();
      return;
    }

    recordStartupStepOnce('license_status', 'started', tr('开始加载许可证状态与通知中心。', 'Loading license status and notification center.'));
    tauriInvoke<{ plan: string; status: string; expires_at: string | null; trial_days_left: number | null }>('check_license_status')
      .then((info) => {
        useLicenseStore.getState().setLicenseInfo({
          plan: info.plan as any,
          status: info.status as any,
          expiresAt: info.expires_at ?? undefined,
          trialDaysLeft: info.trial_days_left ?? undefined,
          features: [],
        });
        recordStartupStepOnce('license_status', 'completed', tr(`许可证状态已加载: ${info.status}`, `License status loaded: ${info.status}`));
      })
      .catch((e) => {
        recordStartupStepOnce('license_status', 'failed', tr(`许可证状态加载失败: ${String(e)}`, `License status loading failed: ${String(e)}`));
        console.error('Failed to load license status:', e);
      });

    void useNotificationStore.getState().loadNotifications();
  }, []);

  useEffect(() => {
    if (safeMode) {
      recordStartupStepOnce('realtime_protection', 'started', tr('安全模式正在暂停实时主动防护。', 'Safe mode is pausing realtime active protection.'));
      void configureProtection(false, false)
        .then(() => {
          recordStartupStepOnce('realtime_protection', 'completed', tr('安全模式已启用，实时主动防护已暂停。', 'Safe mode enabled, realtime active protection is paused.'));
        })
        .catch((error) => {
          recordStartupStepOnce(
            'realtime_protection',
            'failed',
            tr(`安全模式暂停实时主动防护失败: ${String(error)}`, `Failed to pause realtime protection in safe mode: ${String(error)}`)
          );
          console.error('Failed to pause realtime protection in safe mode:', error);
        });
      return;
    }

    recordStartupStepOnce(
      'realtime_protection',
      'started',
      settings.realTimeProtection
        ? tr('开始配置实时主动防护。', 'Configuring realtime active protection.')
        : tr('开始同步关闭实时主动防护。', 'Syncing realtime active protection as disabled.')
    );
    void configureProtection(settings.realTimeProtection, settings.autoQuarantine)
      .then((status) => {
        recordStartupStepOnce(
          'realtime_protection',
          'completed',
          status.enabled
            ? tr('实时主动防护已启用。', 'Realtime active protection is enabled.')
            : tr('实时主动防护当前保持关闭。', 'Realtime active protection remains disabled.')
        );
      })
      .catch((error) => {
        recordStartupStepOnce(
          'realtime_protection',
          'failed',
          tr(`实时主动防护配置失败: ${String(error)}`, `Failed to configure realtime active protection: ${String(error)}`)
        );
        console.error('Failed to configure realtime protection:', error);
      });
  }, [safeMode, settings.autoQuarantine, settings.realTimeProtection]);

  useEffect(() => {
    if (safeMode) {
      recordStartupStepOnce('protection_listener', 'skipped', tr('安全模式已开启，本次不绑定实时防护事件监听。', 'Safe mode enabled: skipping realtime protection listener binding.'));
      return;
    }

    let unlisten: (() => void) | undefined;

    void listenProtectionIncidents(async (incident) => {
      await useNotificationStore.getState().loadNotifications();
      if (useSettingsStore.getState().notificationsEnabled) {
        await sendDesktopNotification(incident.title, incident.description);
      }
    }).then((dispose) => {
      unlisten = dispose;
      recordStartupStepOnce('protection_listener', 'completed', tr('实时防护事件监听已就绪。', 'Realtime protection listener is ready.'));
    }).catch((error) => {
      recordStartupStepOnce('protection_listener', 'failed', tr(`实时防护监听绑定失败: ${String(error)}`, `Failed to bind protection listener: ${String(error)}`));
    });

    return () => {
      unlisten?.();
    };
  }, [safeMode]);

  useEffect(() => {
    if (!isTauriEnvironment()) {
      return;
    }

    let unlisten: (() => void) | undefined;

    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (bypassCloseInterceptRef.current) {
          return;
        }

        // Keep macOS close behavior intuitive: red button should close the window.
        if (prefersNativeCloseOnMac) {
          return;
        }

        if (!useSettingsStore.getState().minimizeToTray) {
          trayCloseArmedAtRef.current = null;
          return;
        }

        const now = Date.now();
        const armedAt = trayCloseArmedAtRef.current;
        const shouldForceQuit = armedAt !== null && now - armedAt <= TRAY_FORCE_QUIT_ARM_MS;
        if (shouldForceQuit) {
          event.preventDefault();
          const appWindow = getCurrentWindow();
          bypassCloseInterceptRef.current = true;
          trayCloseArmedAtRef.current = null;
          try {
            await tauriInvoke<void>('force_quit_app');
          } catch (error) {
            console.error('Failed to force-quit app, fallback to close window:', error);
            await appWindow.close();
          } finally {
            bypassCloseInterceptRef.current = false;
          }
          return;
        }

        trayCloseArmedAtRef.current = now;
        event.preventDefault();
        const appWindow = getCurrentWindow();
        try {
          await appWindow.hide();
        } catch (error) {
          // If hide fails after preventDefault, fall back to real close so the window is not stuck.
          console.error('Failed to hide window on close request, fallback to close:', error);
          bypassCloseInterceptRef.current = true;
          try {
            await appWindow.close();
          } finally {
            bypassCloseInterceptRef.current = false;
          }
        }
      })
      .then((dispose) => {
        unlisten = dispose;
        recordStartupStepOnce('window_lifecycle', 'completed', tr('窗口关闭事件已绑定。', 'Window close lifecycle handler is ready.'));
      })
      .catch((error) => {
        recordStartupStepOnce('window_lifecycle', 'failed', tr(`窗口关闭事件绑定失败: ${String(error)}`, `Failed to bind window close lifecycle handler: ${String(error)}`));
        console.error('Failed to bind close handler:', error);
      });

    return () => {
      unlisten?.();
    };
  }, [prefersNativeCloseOnMac]);

  useEffect(() => {
    if (!isTauriEnvironment()) {
      return;
    }

    let active = true;
    let unlisten: (() => void) | undefined;

    const upsertApproval = async (approval: RuntimeApprovalRequest) => {
      if (!active) {
        return;
      }

      if (approval.status === 'pending') {
        setApprovalError(null);
      }

      setApprovalQueue((previous) => {
        if (approval.status !== 'pending') {
          return previous.filter((item) => item.id !== approval.id);
        }

        const next = [approval, ...previous.filter((item) => item.id !== approval.id)];
        next.sort((left, right) => right.created_at.localeCompare(left.created_at));
        return next;
      });

      if (approval.status !== 'pending') {
        return;
      }

      try {
        const appWindow = getCurrentWindow();
        await appWindow.show();
        await appWindow.unminimize();
        await appWindow.setFocus();
      } catch (error) {
        console.error('Failed to surface approval window:', error);
      }

      if (useSettingsStore.getState().notificationsEnabled) {
        await sendDesktopNotification(tr('AgentShield 需要你点头', 'AgentShield needs your approval'), approval.title);
      }
    };

    void listRuntimeGuardApprovalRequests()
      .then((requests) => {
        if (!active) {
          return;
        }
        const pending = requests
          .filter((request) => request.status === 'pending')
          .sort((left, right) => right.created_at.localeCompare(left.created_at));
        setApprovalQueue(pending);
        setApprovalError(null);
        recordStartupStepOnce(
          'approval_center',
          'completed',
          pending.length > 0
            ? tr(`已恢复 ${pending.length} 个待处理审批。`, `Restored ${pending.length} pending approvals.`)
            : tr('审批中心已就绪，当前没有待处理审批。', 'Approval center is ready with no pending approvals.')
        );
      })
      .catch((error) => {
        recordStartupStepOnce('approval_center', 'failed', tr(`审批中心初始化失败: ${String(error)}`, `Approval center initialization failed: ${String(error)}`));
        console.error('Failed to load runtime approvals:', error);
      });

    void listenRuntimeGuardApprovals((approval) => {
      void upsertApproval(approval);
    }).then((dispose) => {
      unlisten = dispose;
      recordStartupStepOnce('approval_stream', 'completed', tr('审批事件监听已就绪。', 'Approval event stream listener is ready.'));
    }).catch((error) => {
      recordStartupStepOnce('approval_stream', 'failed', tr(`审批事件监听绑定失败: ${String(error)}`, `Failed to bind approval event stream listener: ${String(error)}`));
    });

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (safeMode) {
      recordStartupStepOnce('update_audit', 'skipped', tr('安全模式已开启，本次不执行自动更新检查。', 'Safe mode enabled: skipping automatic update audit.'));
      return;
    }
    if (!settings.checkUpdatesAuto) {
      recordStartupStepOnce('update_audit', 'skipped', tr('你已关闭自动更新检查。', 'Automatic update audit is disabled by settings.'));
      return;
    }

    let cancelled = false;

    const runAudit = async () => {
      const audit = await runInstalledUpdateAudit();
      if (cancelled) {
        return;
      }

      const digest = audit.updates
        .map((item) => `${item.item_id}:${item.new_version}`)
        .sort()
        .join('|');
      const previousDigest = localStorage.getItem(UPDATE_AUDIT_DIGEST_KEY) ?? '';

      localStorage.setItem(UPDATE_AUDIT_DIGEST_KEY, digest);

      if (!digest || digest === previousDigest) {
        return;
      }

      await useNotificationStore.getState().pushNotification({
        type: 'update',
        priority: 'info',
        title: tr(
          `发现 ${audit.updates.length} 个组件更新`,
          `${audit.updates.length} component update(s) available`
        ),
        body: tr(
          '请前往”已安装管理”页面查看并执行升级。',
          'Go to Installed Management to review and apply upgrades.'
        ),
      });

      if (useSettingsStore.getState().notificationsEnabled) {
        await sendDesktopNotification(
          tr('AgentShield 发现组件更新', 'AgentShield found component updates'),
          tr(
            `已有 ${audit.updates.length} 个 MCP / Skill 组件可以升级`,
            `${audit.updates.length} MCP / Skill component(s) can be upgraded`
          )
        );
      }
    };

    void runAudit().then(() => {
      recordStartupStepOnce('update_audit', 'completed', tr('自动更新检查计划已启动。', 'Automatic update audit schedule started.'));
    }).catch((error) => {
      recordStartupStepOnce('update_audit', 'failed', tr(`自动更新检查启动失败: ${String(error)}`, `Failed to start automatic update audit schedule: ${String(error)}`));
    });
    const interval = window.setInterval(() => {
      void runAudit();
    }, UPDATE_AUDIT_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [safeMode, settings.checkUpdatesAuto]);

  useEffect(() => {
    if (safeMode) {
      recordStartupStepOnce('rule_hot_update', 'skipped', tr('安全模式已开启，本次不执行规则热更新。', 'Safe mode enabled: skipping rule hot update.'));
      return;
    }

    if (!autoRuleUpdatesUnlocked) {
      recordStartupStepOnce('rule_hot_update', 'skipped', tr('当前方案为手动规则同步。', 'Current plan uses manual rule sync.'));
      return;
    }

    let cancelled = false;

    const maybeSyncRules = async () => {
      const now = Date.now();
      const lastSyncAt = Number(localStorage.getItem(AUTO_RULE_SYNC_TIMESTAMP_KEY) ?? '0');
      if (lastSyncAt > 0 && now - lastSyncAt < AUTO_RULE_SYNC_INTERVAL_MS) {
        return;
      }

      const status = await getRuleUpdateStatus();
      if (cancelled) {
        return;
      }

      if (!status.update_available) {
        localStorage.setItem(AUTO_RULE_SYNC_TIMESTAMP_KEY, String(now));
        return;
      }

      const applied = await syncSecurityRules();
      if (cancelled) {
        return;
      }

      localStorage.setItem(AUTO_RULE_SYNC_TIMESTAMP_KEY, String(now));
      await useNotificationStore.getState().pushNotification({
        type: 'update',
        priority: 'info',
        title: tr(
          `规则已自动更新到 ${applied.active_version}`,
          `Rules auto-updated to ${applied.active_version}`
        ),
        body: tr(
          '已自动应用最新防护规则，你无需手动点击同步。',
          'Latest protection rules are active. No manual sync needed.'
        ),
      });

      if (settings.notificationsEnabled) {
        await sendDesktopNotification(
          tr('AgentShield 规则热更新完成', 'AgentShield rule update completed'),
          tr(
            `已自动应用规则 ${applied.active_version}`,
            `Rule ${applied.active_version} was applied automatically`
          )
        );
      }
    };

    void maybeSyncRules().then(() => {
      recordStartupStepOnce('rule_hot_update', 'completed', tr('规则热更新任务已启动。', 'Rule hot-update task started.'));
    }).catch((error) => {
      recordStartupStepOnce('rule_hot_update', 'failed', tr(`规则热更新任务启动失败: ${String(error)}`, `Failed to start rule hot-update task: ${String(error)}`));
    });

    const interval = window.setInterval(() => {
      void maybeSyncRules();
    }, 30 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [autoRuleUpdatesUnlocked, safeMode, settings.notificationsEnabled]);

  useEffect(() => {
    if (safeMode) {
      recordStartupStepOnce('weekly_report', 'skipped', tr('安全模式已开启，本次不生成每周摘要。', 'Safe mode enabled: skipping weekly summary.'));
      return;
    }
    if (!settings.weeklyReport) {
      recordStartupStepOnce('weekly_report', 'skipped', tr('你已关闭每周安全摘要。', 'Weekly security summary is disabled by settings.'));
      return;
    }

    let cancelled = false;

    const maybeSendWeeklyReport = async () => {
      const now = Date.now();
      const lastSentAt = Number(localStorage.getItem(WEEKLY_REPORT_TIMESTAMP_KEY) ?? '0');
      if (now - lastSentAt < 7 * 24 * 60 * 60 * 1000) {
        return;
      }

      const scanSummary = Object.values(useAppStore.getState().lastScanByCategory).flat();
      const summaryText =
        scanSummary.length > 0
          ? tr(
            `最近一次扫描仍有 ${scanSummary.length} 个待处理问题，建议尽快复查。`,
            `Your latest scan still has ${scanSummary.length} unresolved issues. Please review soon.`
          )
          : tr(
            '当前没有最近扫描结果，建议运行一次完整安全扫描以生成健康摘要。',
            'No recent scan summary yet. Run a full security scan to generate one.'
          );

      await useNotificationStore.getState().pushNotification({
        type: 'system',
        priority: 'info',
        title: tr('每周安全摘要', 'Weekly Security Summary'),
        body: summaryText,
      });

      if (cancelled) {
        return;
      }

      localStorage.setItem(WEEKLY_REPORT_TIMESTAMP_KEY, String(now));

      if (useSettingsStore.getState().notificationsEnabled) {
        await sendDesktopNotification(
          tr('每周安全摘要', 'Weekly Security Summary'),
          summaryText,
        );
      }
    };

    void maybeSendWeeklyReport().then(() => {
      recordStartupStepOnce('weekly_report', 'completed', tr('每周安全摘要计划已启动。', 'Weekly summary schedule started.'));
    }).catch((error) => {
      recordStartupStepOnce('weekly_report', 'failed', tr(`每周安全摘要计划启动失败: ${String(error)}`, `Failed to start weekly summary schedule: ${String(error)}`));
    });
    const interval = window.setInterval(() => {
      void maybeSendWeeklyReport();
    }, WEEKLY_REPORT_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [safeMode, settings.weeklyReport]);

  useEffect(() => {
    if (safeMode) {
      recordStartupStepOnce('background_scan', 'skipped', tr('安全模式已开启，本次不执行后台自动扫描。', 'Safe mode enabled: skipping background automatic scan.'));
      return;
    }
    if (!settings.scanAutoStart || settings.scanFrequency === 'manual') {
      recordStartupStepOnce('background_scan', 'skipped', tr('后台自动扫描当前未启用。', 'Background automatic scan is currently disabled.'));
      return;
    }

    const intervalMs = settings.scanFrequency === 'weekly'
      ? 7 * 24 * 60 * 60 * 1000
      : 24 * 60 * 60 * 1000;
    let cancelled = false;

    const maybeRunBackgroundScan = async () => {
      const now = Date.now();
      const lastRun = Number(localStorage.getItem(BACKGROUND_SCAN_TIMESTAMP_KEY) ?? '0');
      if (lastRun && now - lastRun < intervalMs) {
        return;
      }

      const result = await runFullScan();
      if (cancelled || !result) {
        return;
      }

      localStorage.setItem(BACKGROUND_SCAN_TIMESTAMP_KEY, String(now));

      if (result.total_issues === 0) {
        return;
      }

      const criticalCount = result.categories
        .flatMap((category) => category.issues)
        .filter((issue) => issue.severity === 'high' || issue.severity === 'critical').length;

      await useNotificationStore.getState().pushNotification({
        type: 'security',
        priority: criticalCount > 0 ? 'critical' : 'warning',
        title: tr('后台自动扫描发现风险', 'Background scan detected risks'),
        body: criticalCount > 0
          ? tr(
            `自动扫描发现 ${criticalCount} 个高风险问题，请立即处理。`,
            `Background scan found ${criticalCount} critical issues. Please handle them now.`
          )
          : tr(
            `自动扫描发现 ${result.total_issues} 个安全问题，请前往安全扫描页面查看。`,
            `Background scan found ${result.total_issues} security issues. Open Security Scan to review.`
          ),
      });

      if (
        criticalCount > 0 &&
        useSettingsStore.getState().criticalAlerts &&
        useSettingsStore.getState().notificationsEnabled
      ) {
        await sendDesktopNotification(
          tr('AgentShield 后台扫描高风险告警', 'AgentShield critical background alert'),
          tr(
            `后台自动扫描发现 ${criticalCount} 个高风险问题`,
            `Background scan found ${criticalCount} critical issues`
          )
        );
      }
    };

    void maybeRunBackgroundScan().then(() => {
      recordStartupStepOnce('background_scan', 'completed', tr('后台自动扫描计划已启动。', 'Background automatic scan schedule started.'));
    }).catch((error) => {
      recordStartupStepOnce('background_scan', 'failed', tr(`后台自动扫描计划启动失败: ${String(error)}`, `Failed to start background automatic scan schedule: ${String(error)}`));
    });
    const interval = window.setInterval(() => {
      void maybeRunBackgroundScan();
    }, 60 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [safeMode, settings.criticalAlerts, settings.notificationsEnabled, settings.scanAutoStart, settings.scanFrequency]);

  const handleInstallSkill = (item: StoreCatalogItem) => {
    setSelectedItem(item);
    setShowInstallDialog(true);
  };

  const goBackFromDetail = () => {
    setShowSecurityDetail(false);
    setSelectedCardId(null);
    setCurrentModule('smartGuard');
  };

  const renderContent = () => {
    if (showInstallDialog && selectedItem) {
      return (
        <InstallDialog
          item={selectedItem}
          open={showInstallDialog}
          onClose={() => {
            setShowInstallDialog(false);
            setSelectedItem(null);
          }}
          onConfirm={(_platforms) => {
            setShowInstallDialog(false);
            setSelectedItem(null);
            setCurrentModule('installed');
          }}
        />
      );
    }

    if (showSecurityDetail && currentModule === 'securityScan') {
      // Determine which issues to show
      const cachedIssues = selectedCardId
        ? (Object.prototype.hasOwnProperty.call(lastScanByCategory, selectedCardId)
            ? lastScanByCategory[selectedCardId]
            : undefined)
        : undefined;
      const title = selectedCardId
        ? getCardTitles()[selectedCardId]
        : undefined;

      return (
        <SecurityScanDetail
          onBack={goBackFromDetail}
          onOpenInstalledManagement={() => {
            setShowSecurityDetail(false);
            setSelectedCardId(null);
            setCurrentModule('installed');
          }}
          cachedIssues={cachedIssues}
          categoryTitle={title}
        />
      );
    }

    switch (currentModule) {
      case 'smartGuard':
        return (
          <SmartGuardHome
            onViewScanDetail={(cardId) => {
              // Each card opens SecurityScanDetail filtered to that category
              setSelectedCardId(cardId);
              setCurrentModule('securityScan');
              setShowSecurityDetail(true);
            }}
          />
        );
      case 'securityScan':
        return (
          <SecurityScanHome
            onViewDetail={() => {
              setSelectedCardId(null); // No filter — show all
              setShowSecurityDetail(true);
            }}
          />
        );
      case 'skillStore':
        return (
          <SkillStore
            onInstall={handleInstallSkill}
            onOpenOpenClaw={() => setCurrentModule('openClaw')}
          />
        );
      case 'installed':
        return <InstalledManagement onBack={() => setCurrentModule('smartGuard')} />;
      case 'keyVault':
        return (
          <KeyVaultDetail
            keyId="all"
            onBack={() => setCurrentModule('smartGuard')}
          />
        );
      case 'openClaw':
        return (
          <OpenClawWizard
            onComplete={() => setCurrentModule('smartGuard')}
            onSkip={() => setCurrentModule('smartGuard')}
          />
        );
      case 'notifications':
        return <NotificationCenter />;
      case 'settings':
        return <SettingsPage />;
      case 'upgradePro':
        return <UpgradePro onBack={() => setCurrentModule('smartGuard')} />;
      default:
        return <SmartGuardHome />;
    }
  };

  const currentApproval = approvalQueue[0] ?? null;
  const shouldLockOuterScroll = currentModule === 'securityScan';
  const frameThemeKey = (
    currentModule === 'upgradePro'
      ? 'upgradePro'
      : currentModule === 'openClaw'
        ? 'openClaw'
        : currentModule === 'securityScan'
          ? 'securityScan'
          : currentModule === 'skillStore'
            ? 'skillStore'
            : currentModule === 'installed'
              ? 'installed'
              : currentModule === 'keyVault'
                ? 'keyVault'
                : currentModule === 'notifications'
                  ? 'notifications'
                  : currentModule === 'settings'
                    ? 'settings'
                    : 'smartGuard'
  ) as keyof typeof MODULE_THEMES;
  const frameTheme = MODULE_THEMES[frameThemeKey];

  const handleApprovalDecision = async (
    request: RuntimeApprovalRequest,
    decision: 'approve' | 'deny',
  ) => {
    setApprovalError(null);
    setApprovalBusyId(request.id);
    try {
      await resolveRuntimeGuardApprovalRequest(request.id, decision);
      setApprovalQueue((previous) => previous.filter((item) => item.id !== request.id));
    } catch (error) {
      console.error('Failed to resolve runtime approval request:', error);
      setApprovalError(
        tr(
          '审批提交失败，请重试一次。若持续失败，请查看控制台日志。',
          'Approval submission failed. Please try again. If it keeps failing, check console logs.'
        )
      );
    } finally {
      setApprovalBusyId(null);
    }
  };

  return (
    <MacOSFrame
      title={t.appTitle}
      className="bg-transparent"
      contentScrollMode={shouldLockOuterScroll ? 'hidden' : 'auto'}
      surfaceGradient={{ from: frameTheme.from, via: frameTheme.via, to: frameTheme.to }}
    >
      <AppLayout>
        {safeMode ? (
          <div className="sticky top-0 z-30 border-b border-amber-300/20 bg-amber-500/10 px-6 py-3 text-sm text-amber-100 backdrop-blur">
            {tr(
              '安全模式已启用。实时主动防护、后台扫描与自动更新检查已暂停。排查完成后请尽快关闭。',
              'Safe mode is enabled. Active protection, background scans, and automatic update checks are paused. Disable safe mode after troubleshooting.'
            )}
          </div>
        ) : null}
        <ErrorBoundary onReset={() => setCurrentModule('smartGuard')}>
          {renderContent()}
        </ErrorBoundary>
      </AppLayout>
      <RuntimeApprovalModal
        request={currentApproval}
        queueSize={approvalQueue.length}
        busy={approvalBusyId === currentApproval?.id}
        errorMessage={approvalError}
        onApprove={(request) => {
          void handleApprovalDecision(request, 'approve');
        }}
        onDeny={(request) => {
          void handleApprovalDecision(request, 'deny');
        }}
      />
    </MacOSFrame>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  );
}
