import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Bell,
  CheckCircle2,
  ChevronRight,
  Globe,
  Info,
  Loader2,
  Settings,
  Shield,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { isEnglishLocale, t } from '@/constants/i18n';

const tr = (zh: string, en: string) => (isEnglishLocale ? en : zh);
import { useSettingsStore } from '@/stores/settingsStore';
import { useLicenseStore } from '@/stores/licenseStore';
import { useAppStore } from '@/stores/appStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { useProGate } from '@/hooks/useProGate';
import { playSound } from '@/services/sound';
import { testAiConnection } from '@/services/ai-orchestrator';
import {
  clearProtectionIncidents,
  configureProtection,
  getProtectionStatus,
  listProtectionIncidents,
  listenProtectionIncidents,
  listenProtectionStatus,
  type ProtectionIncident,
  type ProtectionStatus,
} from '@/services/protection';
import {
  ensureNotificationPermission,
  getAutostartEnabled,
  getRuleUpdateStatus,
  runInstalledUpdateAudit,
  sendDesktopNotification,
  setAutostartEnabled,
  syncSecurityRules,
  type InstalledUpdateAuditResult,
  type RuleUpdateStatus,
} from '@/services/runtime-settings';
import {
  clearSemanticGuardKey,
  configureSemanticGuard,
  getSemanticGuardStatus,
  type SemanticGuardStatus,
} from '@/services/semantic-guard';
import {
  clearStartupTimelineEvents,
  listStartupTimelineEvents,
  type StartupTimelineEvent,
} from '@/services/startup-timeline';
import {
  getRiskCopyPayload,
  getRiskCopyVariant,
  trackRiskCopyAction,
  trackRiskCopyExposure,
} from '@/services/copy-experiments';

type SettingSection = 'general' | 'notifications' | 'security' | 'ai' | 'language' | 'about';
type DialogKey = 'privacy' | 'terms' | 'updates' | null;
type FeedbackTone = 'success' | 'error' | 'info';

interface FeedbackState {
  tone: FeedbackTone;
  message: string;
}

function getSettingSections(): { id: SettingSection; label: string; icon: typeof Settings }[] {
  return [
    { id: 'general', label: t.settingsGeneral, icon: Settings },
    { id: 'notifications', label: t.settingsNotifications, icon: Bell },
    { id: 'security', label: t.settingsSecurity, icon: Shield },
    { id: 'ai', label: t.settingsAI, icon: Sparkles },
    { id: 'language', label: t.settingsLanguageRegion, icon: Globe },
    { id: 'about', label: t.about, icon: Info },
  ];
}

const FREE_RULE_MANUAL_SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const FREE_RULE_SYNC_LAST_KEY = 'agentshield-rule-sync-last-free';
const AUTO_RULE_SYNC_LAST_KEY = 'agentshield-rule-sync-last-auto';

function getLegalCopy(): Record<Exclude<DialogKey, 'updates' | null>, { title: string; description: string; body: string[] }> {
  return {
    privacy: {
      title: t.privacyPolicy,
      description: t.privacyPolicyDesc,
      body: [
        tr(
          'AgentShield 默认采用本地优先设计。安全扫描、MCP/Skill 检查和密钥发现优先在本机执行，不会默认上传你的项目文件。',
          'AgentShield uses a local-first design by default. Security scans, MCP/Skill checks, and key discovery run locally and do not upload your project files.'
        ),
        tr(
          '只有在你主动触发网络能力时，例如更新检查、商店刷新、规则同步或 AI 诊断，请求才会访问外部服务。',
          'External services are only contacted when you actively trigger network features, such as update checks, store refresh, rule sync, or AI diagnostics.'
        ),
        tr(
          '通知中心和本地安全记录保存在当前设备的 AgentShield 数据目录中，用于帮助你追溯安全事件和设置变更。',
          'Notification center and local security records are stored in the AgentShield data directory on your device, helping you trace security events and setting changes.'
        ),
      ],
    },
    terms: {
      title: t.termsOfService,
      description: t.termsOfServiceDesc,
      body: [
        tr(
          'AgentShield 提供本地安全扫描、配置修复建议和已安装 MCP/Skill 管理能力，但不替代你对第三方工具来源和权限的最终判断。',
          'AgentShield provides local security scanning, config fix suggestions, and installed MCP/Skill management, but does not replace your final judgment on third-party tool sources and permissions.'
        ),
        tr(
          '当你安装或启用第三方 MCP/Skill 时，仍需自行确认其供应链、权限范围与运行命令是否可信。',
          'When you install or enable third-party MCP/Skills, you still need to verify their supply chain, permission scope, and run commands.'
        ),
        tr(
          '应用内的风险判断基于当前规则库、静态扫描和本地可见配置，不构成对未知恶意行为的绝对保证。',
          'In-app risk assessments are based on current rules, static scanning, and locally visible config, and do not constitute an absolute guarantee against unknown malicious behavior.'
        ),
      ],
    },
  };
}

export function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingSection>('general');
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [dialogKey, setDialogKey] = useState<DialogKey>(null);
  const [updateAudit, setUpdateAudit] = useState<InstalledUpdateAuditResult | null>(null);
  const [ruleUpdateStatus, setRuleUpdateStatus] = useState<RuleUpdateStatus | null>(null);
  const [protectionStatus, setProtectionStatus] = useState<ProtectionStatus | null>(null);
  const [protectionIncidents, setProtectionIncidents] = useState<ProtectionIncident[]>([]);
  const [semanticGuardStatus, setSemanticGuardStatus] = useState<SemanticGuardStatus | null>(null);
  const [semanticDialogOpen, setSemanticDialogOpen] = useState(false);
  const [semanticAccessKey, setSemanticAccessKey] = useState('');
  const [startupTimeline, setStartupTimeline] = useState<StartupTimelineEvent[]>([]);
  const [freeRuleSyncAt, setFreeRuleSyncAt] = useState<number | null>(null);
  const [autoRuleSyncAt, setAutoRuleSyncAt] = useState<number | null>(null);
  const [aiConnectionMessage, setAiConnectionMessage] = useState<string | null>(null);

  const settings = useSettingsStore();
  const license = useLicenseStore();
  const pushNotification = useNotificationStore((state) => state.pushNotification);
  const { canAccess } = useProGate();
  const semanticUnlocked = canAccess('semantic_guard');
  const aiFeatureUnlocked = license.checkFeature('semantic_guard');
  const autoRuleUpdatesUnlocked = license.checkFeature('rule_updates');
  const riskCopyVariant = useMemo(() => getRiskCopyVariant(), []);
  const ruleUpdatesCopy = useMemo(
    () => getRiskCopyPayload('rule_updates', riskCopyVariant),
    [riskCopyVariant]
  );

  useEffect(() => {
    let mounted = true;

    void getAutostartEnabled().then((enabled) => {
      const store = useSettingsStore.getState();
      if (!mounted || enabled === null || enabled === store.autoStart) {
        return;
      }
      store.setAutoStart(enabled);
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const freeSync = Number(localStorage.getItem(FREE_RULE_SYNC_LAST_KEY) ?? '0');
    const autoSync = Number(localStorage.getItem(AUTO_RULE_SYNC_LAST_KEY) ?? '0');
    setFreeRuleSyncAt(freeSync > 0 ? freeSync : null);
    setAutoRuleSyncAt(autoSync > 0 ? autoSync : null);
  }, []);

  useEffect(() => {
    let mounted = true;
    let unlistenStatus: (() => void) | undefined;
    let unlistenIncident: (() => void) | undefined;

    void getProtectionStatus().then((status) => {
      if (mounted) {
        setProtectionStatus(status);
      }
    });
    void listProtectionIncidents().then((incidents) => {
      if (mounted) {
        setProtectionIncidents(incidents);
      }
    });

    void listenProtectionStatus((status) => {
      if (mounted) {
        setProtectionStatus(status);
      }
    }).then((dispose) => {
      unlistenStatus = dispose;
    });

    void listenProtectionIncidents((incident) => {
      if (mounted) {
        setProtectionIncidents((previous) => [incident, ...previous.filter((item) => item.id !== incident.id)].slice(0, 6));
      }
    }).then((dispose) => {
      unlistenIncident = dispose;
    });

    return () => {
      mounted = false;
      unlistenStatus?.();
      unlistenIncident?.();
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    void getSemanticGuardStatus()
      .then((status) => {
        if (mounted) {
          setSemanticGuardStatus(status);
        }
      })
      .catch((error) => {
        if (mounted) {
          setSemanticGuardStatus({
            licensed: semanticUnlocked,
            configured: false,
            active: false,
            message: getErrorMessage(error),
          });
        }
      });

    return () => {
      mounted = false;
    };
  }, [semanticUnlocked]);

  useEffect(() => {
    let mounted = true;

    void getRuleUpdateStatus()
      .then((status) => {
        if (mounted) {
          setRuleUpdateStatus(status);
        }
      })
      .catch(() => {
        if (mounted) {
          setRuleUpdateStatus(null);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (activeSection !== 'security') {
      return;
    }

    setStartupTimeline(listStartupTimelineEvents());
  }, [activeSection, settings.safeMode]);

  useEffect(() => {
    if (activeSection !== 'about' || autoRuleUpdatesUnlocked) {
      return;
    }

    trackRiskCopyExposure('rule_updates', {
      section: 'settings_about',
      plan: license.plan,
    });
  }, [activeSection, autoRuleUpdatesUnlocked, license.plan]);

  const updateSummary = useMemo(() => {
    if (!updateAudit) {
      return {
        title: t.checkForUpdates,
        description: tr('检查已安装 MCP / Skill 的真实更新状态与托管范围', 'Check real update status and managed scope for installed MCP / Skills'),
      };
    }

    if (updateAudit.updates.length === 0) {
      return {
        title: t.upToDate,
        description: tr(
          `已检查托管组件更新，应用版本 ${updateAudit.appVersion}；${updateAudit.untrackedCount} 个外部组件未纳入自动升级`,
          `Managed component updates checked, app version ${updateAudit.appVersion}; ${updateAudit.untrackedCount} external components not included in auto-upgrade`
        ),
      };
    }

    return {
      title: tr(`发现 ${updateAudit.updates.length} 个可用更新`, `${updateAudit.updates.length} updates available`),
      description: tr(`应用版本 ${updateAudit.appVersion}，可前往”已安装管理”处理托管组件升级`, `App version ${updateAudit.appVersion}. Go to Installed Management to handle managed component upgrades.`),
    };
  }, [updateAudit]);

  const ruleSummary = useMemo(() => {
    if (!ruleUpdateStatus) {
      return {
        title: t.syncRules,
        description: t.syncRulesDesc,
      };
    }

    if (ruleUpdateStatus.update_available) {
      return {
        title: t.syncRules,
        description: t.syncRulesAvailable.replace(
          '{version}',
          ruleUpdateStatus.available_version ?? ruleUpdateStatus.active_version
        ),
      };
    }

    return {
      title: t.syncRules,
      description: t.syncRulesUpToDate.replace('{version}', ruleUpdateStatus.active_version),
    };
  }, [ruleUpdateStatus]);

  const rulePlanSummary = useMemo(() => {
    const now = Date.now();
    if (autoRuleUpdatesUnlocked) {
      return {
        title: tr('完整版规则热更新', 'Full version rule hot-update'),
        description: tr('自动高频同步（目标 6 小时内），检测到新规则会自动更新。', 'Auto-sync at high frequency (target within 6 hours). New rules are applied automatically.'),
        detail: autoRuleSyncAt
          ? tr(`最近自动同步：${new Date(autoRuleSyncAt).toLocaleString()}`, `Last auto-sync: ${new Date(autoRuleSyncAt).toLocaleString()}`)
          : tr('尚未记录自动同步时间，应用运行后会自动检查。', 'No auto-sync recorded yet. The app will check automatically after launch.'),
        cta: '',
      };
    }

    const nextManualAt = freeRuleSyncAt ? freeRuleSyncAt + FREE_RULE_MANUAL_SYNC_INTERVAL_MS : null;
    const waitHours = nextManualAt ? Math.max(0, Math.ceil((nextManualAt - now) / (60 * 60 * 1000))) : 0;
    const waitDays = Math.max(0, Math.ceil(waitHours / 24));

    return {
      title: tr('免费版规则更新', 'Free plan rule updates'),
      description: tr(
        `${ruleUpdatesCopy.hookLine} 你仍可手动同步，但规则会明显慢于完整版。`,
        `${ruleUpdatesCopy.hookLine} You can still sync manually, but rules will lag behind the full version.`
      ),
      detail: freeRuleSyncAt
        ? tr(
            `最近手动同步：${new Date(freeRuleSyncAt).toLocaleString()}${waitDays > 0 ? `，还需等待约 ${waitDays} 天` : ''}`,
            `Last manual sync: ${new Date(freeRuleSyncAt).toLocaleString()}${waitDays > 0 ? `, ~${waitDays} day(s) until next sync` : ''}`
          )
        : tr('尚未执行过手动同步。', 'No manual sync has been performed yet.'),
      cta: ruleUpdatesCopy.ctaLine ?? tr('升级完整版可开启自动热更新和更快防御策略下发。', 'Upgrade to full version to enable auto hot-updates and faster defense policy delivery.'),
    };
  }, [autoRuleSyncAt, autoRuleUpdatesUnlocked, freeRuleSyncAt, ruleUpdatesCopy]);

  const aiConnectionSummary = useMemo(() => {
    if (!settings.aiConnectionTested) {
      return tr('未完成连接测试', 'Connection test not completed');
    }
    return aiConnectionMessage ?? tr('连接测试通过，可用于安装失败自动诊断。', 'Connection test passed. Available for auto-diagnosis on install failures.');
  }, [aiConnectionMessage, settings.aiConnectionTested]);

  const protectionScopeSummary = useMemo(() => {
    if (!protectionStatus?.enabled) {
      return tr('实时主动防护已关闭', 'Real-time active protection is disabled');
    }

    if (protectionStatus.watched_paths.length === 0) {
      return tr('当前没有发现需要监听的 AI 工具配置目录，不会监听其它普通工具', 'No AI tool config directories found to monitor. Other apps are not monitored.');
    }

    return tr(`仅监听 ${protectionStatus.watched_paths.length} 条已发现的 AI 工具配置与 Skill 路径`, `Monitoring ${protectionStatus.watched_paths.length} discovered AI tool config and Skill paths only`);
  }, [protectionStatus]);

  const protectionScopePreview = useMemo(
    () => protectionStatus?.watched_paths.slice(0, 5) ?? [],
    [protectionStatus]
  );

  const setFeedbackMessage = (tone: FeedbackTone, message: string) => {
    setFeedback({ tone, message });
  };

  const runSettingAction = async (key: string, action: () => Promise<void> | void) => {
    setBusyKey(key);
    try {
      await action();
    } catch (error) {
      setFeedbackMessage('error', getErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const navigateToUpgrade = (source: string) => {
    trackRiskCopyAction('rule_updates', 'click_upgrade', {
      section: activeSection,
      source,
    });
    useAppStore.getState().setCurrentModule('upgradePro');
  };

  const handleAutoStartToggle = async (checked: boolean) => {
    await runSettingAction('autoStart', async () => {
      try {
        const enabled = await setAutostartEnabled(checked);
        settings.setAutoStart(enabled);
        setFeedbackMessage('success', enabled ? tr('已启用系统开机自启', 'Auto-start at login enabled') : tr('已关闭系统开机自启', 'Auto-start at login disabled'));
      } catch (error) {
        setFeedbackMessage('error', tr(`开机自启设置失败：${getErrorMessage(error)}`, `Auto-start setting failed: ${getErrorMessage(error)}`));
      }
    });
  };

  const handleMinimizeToTrayToggle = async (checked: boolean) => {
    await runSettingAction('minimizeToTray', () => {
      settings.setMinimizeToTray(checked);
      setFeedbackMessage(
        'info',
        checked
          ? tr('关闭窗口时会隐藏到托盘，可通过托盘图标恢复', 'Window will minimize to tray on close. Restore via tray icon.')
          : tr('关闭窗口时将直接退出应用', 'Window will quit the app on close.')
      );
    });
  };

  const handleAutoCheckUpdatesToggle = async (checked: boolean) => {
    await runSettingAction('checkUpdatesAuto', async () => {
      settings.setCheckUpdatesAuto(checked);
      if (!checked) {
        setFeedbackMessage('info', tr('已关闭后台维护检查', 'Background maintenance checks disabled'));
        return;
      }

      const audit = await runInstalledUpdateAudit();
      setUpdateAudit(audit);
      setFeedbackMessage(
        audit.updates.length > 0 ? 'info' : 'success',
        audit.updates.length > 0
          ? tr(`已开启自动检查，目前发现 ${audit.updates.length} 个可用更新`, `Auto-check enabled. ${audit.updates.length} updates available.`)
          : tr('已开启自动检查，当前没有待更新组件', 'Auto-check enabled. No pending component updates.')
      );
    });
  };

  const handleNotificationsToggle = async (checked: boolean) => {
    await runSettingAction('notifications', async () => {
      if (checked) {
        const granted = await ensureNotificationPermission();
        if (!granted) {
          settings.setNotificationsEnabled(false);
          setFeedbackMessage('error', tr('系统通知权限未授予，无法启用桌面通知', 'System notification permission not granted. Cannot enable desktop notifications.'));
          return;
        }

        settings.setNotificationsEnabled(true);
        await sendDesktopNotification(
          tr('AgentShield 通知已启用', 'AgentShield notifications enabled'),
          tr('后续安全提醒会通过系统通知显示', 'Security alerts will be shown via system notifications')
        );
        setFeedbackMessage('success', tr('桌面通知已启用', 'Desktop notifications enabled'));
        return;
      }

      settings.setNotificationsEnabled(false);
      setFeedbackMessage('info', tr('已关闭桌面通知，应用内通知中心仍会保留记录', 'Desktop notifications disabled. In-app notification center will still keep records.'));
    });
  };

  const handleSoundToggle = async (checked: boolean) => {
    await runSettingAction('notificationSound', () => {
      settings.setNotificationSound(checked);
      settings.setSoundEnabled(checked);
      if (checked) {
        playSound('notification');
      }
      setFeedbackMessage('success', checked ? tr('声音提示已开启并完成预览', 'Sound effects enabled and previewed') : tr('声音提示已关闭', 'Sound effects disabled'));
    });
  };

  const handleCriticalAlertsToggle = async (checked: boolean) => {
    await runSettingAction('criticalAlerts', () => {
      settings.setCriticalAlerts(checked);
      setFeedbackMessage(
        'info',
        checked ? tr('高风险扫描结果将触发系统告警', 'High-risk scan results will trigger system alerts') : tr('高风险扫描结果仅保留在应用内通知中心', 'High-risk scan results will only be kept in the in-app notification center')
      );
    });
  };

  const handleRealTimeProtectionToggle = async (checked: boolean) => {
    await runSettingAction('realTimeProtection', async () => {
      const status = await configureProtection(checked, settings.autoQuarantine);
      settings.setRealTimeProtection(checked);
      setProtectionStatus(status);
      setFeedbackMessage(
        checked ? 'success' : 'info',
        checked
          ? status.watched_paths.length > 0
            ? tr(`实时主动防御已启用，当前仅监听 ${status.watched_paths.length} 条已发现的 AI 工具路径`, `Real-time protection enabled. Monitoring ${status.watched_paths.length} discovered AI tool paths.`)
            : tr('实时主动防御已启用，但当前没有发现需要监听的 AI 工具目录，不会监听其它普通工具', 'Real-time protection enabled, but no AI tool directories were found to monitor. Other apps are not monitored.')
          : tr('实时主动防御已关闭', 'Real-time active protection disabled')
      );
    });
  };

  const handleAutoQuarantineToggle = async (checked: boolean) => {
    await runSettingAction('autoQuarantine', async () => {
      const status = await configureProtection(settings.realTimeProtection, checked);
      settings.setAutoQuarantine(checked);
      setProtectionStatus(status);
      setFeedbackMessage(
        checked ? 'success' : 'info',
        checked ? tr('高风险 MCP / Skill 将自动隔离', 'High-risk MCP / Skills will be auto-quarantined') : tr('已关闭自动隔离，仅记录并告警', 'Auto-quarantine disabled. Only logging and alerting.')
      );
    });
  };

  const handleSafeModeToggle = async (checked: boolean) => {
    await runSettingAction('safeMode', () => {
      settings.setSafeMode(checked);
      setFeedbackMessage(
        'info',
        checked
          ? tr('安全模式已启用。本次会暂停主动防护、后台扫描和自动更新检查，适合排查空白页或异常后台行为。', 'Safe mode enabled. Active protection, background scanning, and auto-update checks are paused. Useful for troubleshooting blank screens or abnormal background behavior.')
          : tr('安全模式已关闭。主动防护和后台任务会按你的原有设置恢复。', 'Safe mode disabled. Active protection and background tasks will resume with your previous settings.')
      );
      setStartupTimeline(listStartupTimelineEvents());
    });
  };

  const handleWeeklyReportToggle = async (checked: boolean) => {
    await runSettingAction('weeklyReport', async () => {
      settings.setWeeklyReport(checked);
      if (checked) {
        await pushNotification({
          type: 'system',
          priority: 'info',
          title: tr('每周安全摘要已启用', 'Weekly security summary enabled'),
          body: tr('AgentShield 会在你使用期间按周生成一次本地安全摘要通知。', 'AgentShield will generate a local security summary notification weekly while in use.'),
        });
      }
      setFeedbackMessage('success', checked ? tr('每周报告已启用', 'Weekly report enabled') : tr('每周报告已关闭', 'Weekly report disabled'));
    });
  };

  const handleAutoScanToggle = async (checked: boolean) => {
    await runSettingAction('scanAutoStart', () => {
      settings.setScanAutoStart(checked);
      setFeedbackMessage(
        'info',
        checked ? tr('已启用后台自动扫描，应用启动后会按频率执行', 'Background auto-scan enabled. Will run at the configured frequency after app launch.') : tr('后台自动扫描已关闭', 'Background auto-scan disabled')
      );
    });
  };

  const handleScanFrequencyChange = async (value: 'daily' | 'weekly' | 'manual') => {
    await runSettingAction('scanFrequency', () => {
      settings.setScanFrequency(value);
      const label =
        value === 'daily' ? t.scanFrequencyDaily : value === 'weekly' ? t.scanFrequencyWeekly : t.scanFrequencyManual;
      setFeedbackMessage('success', tr(`自动扫描频率已切换为${label}`, `Auto-scan frequency changed to ${label}`));
    });
  };

  const handleClearProtectionIncidents = async () => {
    await runSettingAction('clearProtectionIncidents', async () => {
      await clearProtectionIncidents();
      setProtectionIncidents([]);
      setProtectionStatus(await getProtectionStatus());
      setFeedbackMessage('success', tr('已清空实时防护拦截记录', 'Real-time protection incident records cleared'));
    });
  };

  const handleClearStartupTimeline = async () => {
    await runSettingAction('clearStartupTimeline', () => {
      clearStartupTimelineEvents();
      setStartupTimeline([]);
      setFeedbackMessage('success', tr('已清空最近启动时间线。', 'Startup timeline cleared.'));
    });
  };

  const handleLanguageChange = async (nextLanguage: 'zh-CN' | 'en-US') => {
    await runSettingAction('language', () => {
      settings.setLanguage(nextLanguage);
    });
  };

  const handleCheckForUpdates = async () => {
    await runSettingAction('checkUpdates', async () => {
      const audit = await runInstalledUpdateAudit();
      setUpdateAudit(audit);
      setDialogKey('updates');
      setFeedbackMessage(
        audit.updates.length > 0 ? 'info' : 'success',
        audit.updates.length > 0
          ? tr(`检查完成，发现 ${audit.updates.length} 个组件更新`, `Check complete. ${audit.updates.length} component updates found.`)
          : tr(
              `检查完成，当前没有可用更新${audit.untrackedCount > 0 ? `，另有 ${audit.untrackedCount} 个外部组件未纳入自动升级` : ''}`,
              `Check complete. No updates available.${audit.untrackedCount > 0 ? ` ${audit.untrackedCount} external components are not included in auto-upgrade.` : ''}`
            )
      );
    });
  };

  const handleSyncRules = async () => {
    await runSettingAction('syncRules', async () => {
      if (!autoRuleUpdatesUnlocked) {
        const now = Date.now();
        const lastSync = Number(localStorage.getItem(FREE_RULE_SYNC_LAST_KEY) ?? '0');
        const nextAvailableAt = lastSync + FREE_RULE_MANUAL_SYNC_INTERVAL_MS;
        if (lastSync > 0 && now < nextAvailableAt) {
          setFeedbackMessage(
            'info',
            tr(
              `免费版规则同步频率为每 7 天一次，请在 ${new Date(nextAvailableAt).toLocaleString()} 后重试。`,
              `Free plan rule sync is limited to once every 7 days. Please try again after ${new Date(nextAvailableAt).toLocaleString()}.`
            )
          );
          return;
        }
      }

      const status = await syncSecurityRules();
      setRuleUpdateStatus(status);
      const now = Date.now();
      if (autoRuleUpdatesUnlocked) {
        localStorage.setItem(AUTO_RULE_SYNC_LAST_KEY, String(now));
        setAutoRuleSyncAt(now);
      } else {
        localStorage.setItem(FREE_RULE_SYNC_LAST_KEY, String(now));
        setFreeRuleSyncAt(now);
      }
      setFeedbackMessage('success', t.syncRulesApplied.replace('{version}', status.active_version));
    });
  };

  const handleTestAiConnection = async () => {
    await runSettingAction('testAiConnection', async () => {
      if (!aiFeatureUnlocked) {
        setFeedbackMessage('info', tr('免费版不包含 AI 自动诊断。升级完整版后可开启。', 'AI auto-diagnosis is not available on the free plan. Upgrade to full version to enable.'));
        return;
      }

      if (settings.aiApiKey.trim().length === 0) {
        setFeedbackMessage('error', tr('请先填写 API 密钥。', 'Please enter your API key first.'));
        return;
      }

      if (settings.aiModel.trim().length === 0) {
        setFeedbackMessage('error', tr('请先填写模型名称。', 'Please enter the model name first.'));
        return;
      }

      if (settings.aiProvider === 'custom' && settings.aiBaseUrl.trim().length === 0) {
        setFeedbackMessage('error', tr('自定义服务商必须填写 API 端点。', 'Custom provider requires an API endpoint.'));
        return;
      }

      const result = await testAiConnection(
        settings.aiProvider,
        settings.aiApiKey.trim(),
        settings.aiModel.trim(),
        settings.aiBaseUrl.trim() || undefined
      );

      settings.setAiConnectionTested(result.success);
      setAiConnectionMessage(result.message);
      setFeedbackMessage(result.success ? 'success' : 'error', result.message);
    });
  };

  const handleSaveSemanticAccessKey = async () => {
    await runSettingAction('semanticGuardSave', async () => {
      const status = await configureSemanticGuard(semanticAccessKey);
      setSemanticGuardStatus(status);
      setSemanticDialogOpen(false);
      setSemanticAccessKey('');
      setFeedbackMessage('success', status.message);
    });
  };

  const handleClearSemanticAccessKey = async () => {
    await runSettingAction('semanticGuardClear', async () => {
      await clearSemanticGuardKey();
      const status = await getSemanticGuardStatus();
      setSemanticGuardStatus(status);
      setFeedbackMessage('info', tr('已清除高级语义研判访问密钥', 'Advanced semantic analysis access key cleared'));
    });
  };

  const renderSettingContent = () => {
    switch (activeSection) {
      case 'general':
        return (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-white">{t.settingsGeneral}</h2>
            <div className="space-y-4">
              <SettingToggle
                label={t.autoStart}
                description={t.autoStartDesc}
                checked={settings.autoStart}
                disabled={busyKey === 'autoStart'}
                onChange={handleAutoStartToggle}
              />
              <SettingToggle
                label={t.minimizeToTray}
                description={t.minimizeToTrayDesc}
                checked={settings.minimizeToTray}
                disabled={busyKey === 'minimizeToTray'}
                onChange={handleMinimizeToTrayToggle}
              />
              <SettingToggle
                label={t.autoCheckUpdates}
                description={t.autoCheckUpdatesDesc}
                checked={settings.checkUpdatesAuto}
                disabled={busyKey === 'checkUpdatesAuto'}
                onChange={handleAutoCheckUpdatesToggle}
              />
            </div>
          </div>
        );

      case 'notifications':
        return (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-white">{t.settingsNotifications}</h2>
            <div className="space-y-4">
              <SettingToggle
                label={t.enableNotifications}
                description={t.enableNotificationsDesc}
                checked={settings.notificationsEnabled}
                disabled={busyKey === 'notifications'}
                onChange={handleNotificationsToggle}
              />
              <SettingToggle
                label={t.soundEffects}
                description={t.soundEffectsDesc}
                checked={settings.notificationSound}
                disabled={busyKey === 'notificationSound'}
                onChange={handleSoundToggle}
              />
              <SettingToggle
                label={t.criticalAlerts}
                description={t.criticalAlertsDesc}
                checked={settings.criticalAlerts}
                disabled={busyKey === 'criticalAlerts'}
                onChange={handleCriticalAlertsToggle}
              />
              <SettingToggle
                label={t.weeklyReport}
                description={t.weeklyReportDesc}
                checked={settings.weeklyReport}
                disabled={busyKey === 'weeklyReport'}
                onChange={handleWeeklyReportToggle}
              />
            </div>
          </div>
        );

      case 'security':
        return (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-white">{t.settingsSecurity}</h2>
            <div className="space-y-4">
              <SettingToggle
                label={t.activeDefense}
                description={t.activeDefenseDesc}
                checked={settings.realTimeProtection}
                disabled={busyKey === 'realTimeProtection'}
                onChange={handleRealTimeProtectionToggle}
              />
              <SettingToggle
                label={t.autoQuarantine}
                description={t.autoQuarantineDesc}
                checked={settings.autoQuarantine}
                disabled={busyKey === 'autoQuarantine' || !settings.realTimeProtection}
                onChange={handleAutoQuarantineToggle}
              />
              <SettingToggle
                label={tr('安全模式启动', 'Safe mode startup')}
                description={tr('只保留界面和启动诊断，暂停主动防护、后台扫描与自动更新检查，适合排查空白页和异常后台行为', 'Only keeps the UI and startup diagnostics. Pauses active protection, background scanning, and auto-update checks. Useful for troubleshooting blank screens and abnormal background behavior.')}
                checked={settings.safeMode}
                disabled={busyKey === 'safeMode'}
                onChange={handleSafeModeToggle}
              />
              <SettingToggle
                label={t.autoScan}
                description={t.autoScanDesc}
                checked={settings.scanAutoStart}
                disabled={busyKey === 'scanAutoStart'}
                onChange={handleAutoScanToggle}
              />
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-sm font-medium text-white">{t.scanFrequency}</p>
                <p className="mt-0.5 text-xs text-white/50">{t.scanFrequencyDesc}</p>
                <select
                  value={settings.scanFrequency}
                  onChange={(event) => handleScanFrequencyChange(event.target.value as 'daily' | 'weekly' | 'manual')}
                  disabled={busyKey === 'scanFrequency' || !settings.scanAutoStart}
                  className="mt-3 w-full rounded-lg border border-white/10 bg-white/10 p-3 text-white"
                >
                  <option value="daily">{t.scanFrequencyDaily}</option>
                  <option value="weekly">{t.scanFrequencyWeekly}</option>
                  <option value="manual">{t.scanFrequencyManual}</option>
                </select>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-white">{tr('高级语义研判', 'Advanced Semantic Analysis')}</p>
                    <p className="mt-1 text-xs text-white/50">
                      {tr('只对高风险 MCP / Skill 命中做深度复核，不上传整个项目或完整源码。', 'Deep review only for high-risk MCP / Skill hits. Does not upload entire projects or full source code.')}
                    </p>
                    <p className="mt-2 text-xs text-white/60">
                      {semanticUnlocked
                        ? semanticGuardStatus?.message ?? tr('检查高级语义研判状态中', 'Checking advanced semantic analysis status')
                        : tr('仅 Pro / 试用版可用，且需要你自行填写访问密钥。启用后只会对最可疑的少量项目做深度判定，以控制成本。', 'Available for Pro / trial only. You need to provide your own access key. When enabled, only the most suspicious items undergo deep analysis to control costs.')}
                    </p>
                  </div>
                  <div
                    className={cn(
                      'rounded-full px-3 py-1 text-xs font-medium',
                      semanticUnlocked && semanticGuardStatus?.active
                        ? 'bg-sky-500/15 text-sky-300'
                        : 'bg-white/10 text-white/60'
                    )}
                  >
                    {semanticUnlocked
                      ? semanticGuardStatus?.active
                        ? tr('已就绪', 'Ready')
                        : semanticGuardStatus?.configured
                          ? tr('待启用', 'Pending')
                          : tr('未配置', 'Not configured')
                      : 'Pro'}
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-3">
                  {semanticUnlocked ? (
                    <>
                      <Button
                        variant="ghost"
                        className="border border-white/10 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white"
                        onClick={() => {
                          setSemanticAccessKey('');
                          setSemanticDialogOpen(true);
                        }}
                      >
                        {semanticGuardStatus?.configured ? tr('更新访问密钥', 'Update access key') : tr('配置访问密钥', 'Configure access key')}
                      </Button>
                      {semanticGuardStatus?.configured && (
                        <Button
                          variant="ghost"
                          className="text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
                          onClick={handleClearSemanticAccessKey}
                          disabled={busyKey === 'semanticGuardClear'}
                        >
                          {tr('清除密钥', 'Clear key')}
                        </Button>
                      )}
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      className="border border-white/10 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white"
                      onClick={() => navigateToUpgrade('semantic_guard_locked')}
                    >
                      {tr('升级 Pro', 'Upgrade to Pro')}
                    </Button>
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-white">{tr('实时防护状态', 'Real-time Protection Status')}</p>
                    <p className="mt-1 text-xs text-white/50">
                      {protectionScopeSummary}
                    </p>
                    {protectionStatus?.last_incident && (
                      <p className="mt-2 text-xs text-rose-300">
                        {t.protectionLastEvent.replace('{time}', protectionStatus.last_incident.title)}
                      </p>
                    )}
                  </div>
                  <div
                    className={cn(
                      'rounded-full px-3 py-1 text-xs font-medium',
                      protectionStatus?.enabled && protectionStatus?.watcher_ready
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-white/10 text-white/60'
                    )}
                  >
                    {protectionStatus?.enabled && protectionStatus?.watcher_ready ? t.enabled : t.disabled}
                  </div>
                </div>
                {protectionScopePreview.length > 0 ? (
                  <div className="mt-4 space-y-2">
                    {protectionScopePreview.map((path) => (
                      <div
                        key={path}
                        className="rounded-lg border border-white/10 bg-black/10 px-3 py-2 font-mono text-[11px] text-white/65 break-all"
                      >
                        {path}
                      </div>
                    ))}
                    {protectionStatus && protectionStatus.watched_paths.length > protectionScopePreview.length ? (
                      <p className="text-[11px] text-white/35">
                        {tr(`其余 ${protectionStatus.watched_paths.length - protectionScopePreview.length} 条路径已省略。`, `${protectionStatus.watched_paths.length - protectionScopePreview.length} more paths omitted.`)}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-white">{tr('最近启动发生了什么', 'What happened at last startup')}</p>
                    <p className="mt-1 text-xs text-white/50">
                      {tr('用来判断这次启动是否启用了主动防护、后台扫描、审批中心和安全模式。', 'Check whether active protection, background scanning, approval center, and safe mode were enabled at this startup.')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'rounded-full px-3 py-1 text-xs font-medium',
                        settings.safeMode
                          ? 'bg-amber-500/15 text-amber-300'
                          : 'bg-emerald-500/15 text-emerald-300'
                      )}
                    >
                      {settings.safeMode ? tr('安全模式', 'Safe mode') : tr('正常模式', 'Normal mode')}
                    </span>
                    <Button
                      variant="ghost"
                      className="text-white/70 hover:bg-white/10 hover:text-white"
                      onClick={handleClearStartupTimeline}
                      disabled={busyKey === 'clearStartupTimeline' || startupTimeline.length === 0}
                    >
                      {tr('清空时间线', 'Clear timeline')}
                    </Button>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {startupTimeline.length === 0 ? (
                    <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/50">
                      {tr('当前没有最近启动记录。', 'No recent startup records.')}
                    </div>
                  ) : (
                    startupTimeline.slice(0, 8).map((event) => (
                      <div key={event.id} className="rounded-lg border border-white/10 bg-white/5 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-white">{event.summary}</p>
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 text-[11px] font-medium uppercase',
                              event.status === 'completed'
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : event.status === 'failed'
                                  ? 'bg-rose-500/15 text-rose-300'
                                  : event.status === 'skipped'
                                    ? 'bg-amber-500/15 text-amber-300'
                                    : 'bg-sky-500/15 text-sky-300'
                            )}
                          >
                            {event.status}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-white/35">
                          {event.step.replace(/_/g, ' ')}
                        </p>
                        <p className="mt-2 text-[11px] text-white/40">
                          {new Date(event.timestamp).toLocaleString()}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-white">{t.protectionRecentIncidents}</p>
                    <p className="mt-1 text-xs text-white/50">
                      {protectionIncidents.length > 0 ? tr(`共 ${protectionIncidents.length} 条最近事件`, `${protectionIncidents.length} recent events`) : t.protectionNoIncidents}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    className="text-white/70 hover:bg-white/10 hover:text-white"
                    onClick={handleClearProtectionIncidents}
                    disabled={busyKey === 'clearProtectionIncidents' || protectionIncidents.length === 0}
                  >
                    {t.protectionClearIncidents}
                  </Button>
                </div>
                <div className="mt-4 space-y-3">
                  {protectionIncidents.length === 0 ? (
                    <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/50">
                      {t.protectionNoIncidents}
                    </div>
                  ) : (
                    protectionIncidents.slice(0, 3).map((incident) => (
                      <div key={incident.id} className="rounded-lg border border-white/10 bg-white/5 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-white">{incident.title}</p>
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 text-[11px] font-medium',
                              incident.severity === 'critical'
                                ? 'bg-rose-500/15 text-rose-300'
                                : 'bg-amber-500/15 text-amber-300'
                            )}
                          >
                            {incident.action.startsWith('quarantined') || incident.action === 'blocked' ? tr('已拦截', 'Blocked') : tr('已记录', 'Logged')}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-white/60">{incident.description}</p>
                        <p className="mt-2 text-[11px] text-white/40">
                          {new Date(incident.timestamp).toLocaleString()}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <SettingLink
                label={t.viewSecurityLog}
                description={t.viewSecurityLogDesc}
                onClick={() => useAppStore.getState().setCurrentModule('notifications')}
              />
            </div>
          </div>
        );

      case 'ai':
        return (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-white">{t.settingsAI}</h2>
            <div className="space-y-4">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-white">{t.settingsAIDesc}</p>
                    <p className="mt-1 text-xs text-white/50">
                      {tr('用于 OpenClaw 一键向导失败时自动诊断原因，不会上传完整项目文件。', 'Used for auto-diagnosing OpenClaw wizard failures. Does not upload entire project files.')}
                    </p>
                    <p className="mt-2 text-xs text-white/60">{aiConnectionSummary}</p>
                  </div>
                  <span
                    className={cn(
                      'rounded-full px-3 py-1 text-xs font-medium',
                      aiFeatureUnlocked ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/10 text-white/60'
                    )}
                  >
                    {aiFeatureUnlocked ? tr('已解锁', 'Unlocked') : tr('完整版', 'Full version')}
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-white">{t.aiProvider}</label>
                  <select
                    value={settings.aiProvider}
                    onChange={(event) => settings.setAiProvider(event.target.value as 'deepseek' | 'gemini' | 'openai' | 'custom')}
                    disabled={!aiFeatureUnlocked}
                    className="w-full rounded-lg border border-white/10 bg-white/10 p-3 text-white disabled:opacity-60"
                  >
                    <option value="deepseek">DeepSeek · {t.aiProviderDeepseek}</option>
                    <option value="gemini">Gemini · {t.aiProviderGemini}</option>
                    <option value="openai">OpenAI · {t.aiProviderOpenai}</option>
                    <option value="minimax">MiniMax · {t.aiProviderMinimax}</option>
                    <option value="custom">{t.aiProviderCustom}</option>
                  </select>
                </div>

                {settings.aiProvider === 'custom' ? (
                  <div>
                    <label className="mb-2 block text-sm font-medium text-white">{t.apiEndpoint}</label>
                    <input
                      value={settings.aiBaseUrl}
                      onChange={(event) => settings.setAiBaseUrl(event.target.value)}
                      disabled={!aiFeatureUnlocked}
                      placeholder="https://api.openai.com"
                      className="w-full rounded-lg border border-white/10 bg-white/10 p-3 text-white outline-none placeholder:text-white/35 focus:border-sky-400/40 disabled:opacity-60"
                    />
                  </div>
                ) : null}

                <div>
                  <label className="mb-2 block text-sm font-medium text-white">{t.model}</label>
                  <input
                    value={settings.aiModel}
                    onChange={(event) => settings.setAiModel(event.target.value)}
                    disabled={!aiFeatureUnlocked}
                    placeholder={settings.aiProvider === 'gemini' ? 'gemini-2.0-flash' : settings.aiProvider === 'openai' ? 'gpt-4o-mini' : settings.aiProvider === 'minimax' ? 'MiniMax-Text-01' : 'deepseek-chat'}
                    className="w-full rounded-lg border border-white/10 bg-white/10 p-3 text-white outline-none placeholder:text-white/35 focus:border-sky-400/40 disabled:opacity-60"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-white">{t.apiKey}</label>
                  <input
                    type="password"
                    value={settings.aiApiKey}
                    onChange={(event) => settings.setAiApiKey(event.target.value)}
                    disabled={!aiFeatureUnlocked}
                    placeholder={t.apiKeyHint}
                    className="w-full rounded-lg border border-white/10 bg-white/10 p-3 text-white outline-none placeholder:text-white/35 focus:border-sky-400/40 disabled:opacity-60"
                  />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <Button
                    className="bg-sky-500 text-white hover:bg-sky-400 disabled:opacity-60"
                    onClick={handleTestAiConnection}
                    disabled={busyKey === 'testAiConnection' || !aiFeatureUnlocked}
                  >
                    {busyKey === 'testAiConnection' ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t.testing}
                      </span>
                    ) : (
                      t.testConnection
                    )}
                  </Button>
                  {!aiFeatureUnlocked ? (
                    <Button
                      variant="ghost"
                      className="border border-white/10 bg-white/5 text-white/75 hover:bg-white/10 hover:text-white"
                      onClick={() => navigateToUpgrade('ai_diagnosis_locked')}
                    >
                      {tr('升级完整版', 'Upgrade to full version')}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        );

      case 'language':
        return (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-white">{t.settingsLanguageRegion}</h2>
            <div className="space-y-4">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="mb-3 text-sm font-medium text-white">{t.language}</p>
                <select
                  value={settings.language}
                  onChange={(event) => handleLanguageChange(event.target.value as 'zh-CN' | 'en-US')}
                  disabled={busyKey === 'language'}
                  className="w-full rounded-lg border border-white/10 bg-white/10 p-3 text-white"
                >
                  <option value="zh-CN">简体中文</option>
                  <option value="en-US">English (US)</option>
                </select>
              </div>
            </div>
          </div>
        );

      case 'about':
        return (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-white">{t.aboutApp}</h2>
            <div className="space-y-4">
              <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-violet-500">
                  <Shield className="h-8 w-8 text-white" />
                </div>
                <h3 className="text-xl font-semibold text-white">{tr('AgentShield 智盾', 'AgentShield')}</h3>
                <p className="mt-1 text-sm text-white/60">
                  {updateAudit ? `Version ${updateAudit.appVersion}` : t.versionInfo}
                </p>
              </div>
              <SettingLink
                label={updateSummary.title}
                description={updateSummary.description}
                loading={busyKey === 'checkUpdates'}
                onClick={handleCheckForUpdates}
              />
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-white">{rulePlanSummary.title}</p>
                    <p className="mt-1 text-xs text-white/55">{rulePlanSummary.description}</p>
                    <p className="mt-2 text-xs text-white/45">{rulePlanSummary.detail}</p>
                    {rulePlanSummary.cta ? (
                      <p className="mt-2 text-xs text-amber-300">{rulePlanSummary.cta}</p>
                    ) : null}
                  </div>
                  {!autoRuleUpdatesUnlocked ? (
                    <Button
                      variant="ghost"
                      className="border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                      onClick={() => navigateToUpgrade('rule_updates_locked')}
                    >
                      {tr('升级', 'Upgrade')}
                    </Button>
                  ) : null}
                </div>
              </div>
              <SettingLink
                label={ruleSummary.title}
                description={ruleSummary.description}
                loading={busyKey === 'syncRules'}
                onClick={handleSyncRules}
              />
              <SettingLink
                label={t.privacyPolicy}
                description={t.privacyPolicyDesc}
                onClick={() => setDialogKey('privacy')}
              />
              <SettingLink
                label={t.termsOfService}
                description={t.termsOfServiceDesc}
                onClick={() => setDialogKey('terms')}
              />
              <div className="pt-4 text-center text-sm text-white/40">
                <p>Made with care by AgentShield Team</p>
                <p className="mt-1">© 2025 AgentShield. All rights reserved.</p>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <>
      <div className="flex h-full">
        <div className="w-64 border-r border-white/10 p-4">
          <div className="mb-6 flex items-center gap-3 px-3">
            <Settings className="h-6 w-6 text-white/60" />
            <h1 className="text-lg font-semibold text-white">{t.settings}</h1>
          </div>
          <nav className="space-y-1">
            {getSettingSections().map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                  activeSection === section.id
                    ? 'bg-white/10 text-white'
                    : 'text-white/60 hover:bg-white/5 hover:text-white'
                )}
              >
                <section.icon className="h-4 w-4" />
                {section.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <motion.div
            key={activeSection}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="max-w-xl space-y-4"
          >
            {feedback && <SettingsFeedback tone={feedback.tone} message={feedback.message} />}
            {renderSettingContent()}
          </motion.div>
        </div>
      </div>

      <SettingsDialog
        dialogKey={dialogKey}
        updateAudit={updateAudit}
        onClose={() => setDialogKey(null)}
      />

      <Dialog open={semanticDialogOpen} onOpenChange={setSemanticDialogOpen}>
        <DialogContent className="max-w-lg border-white/10 bg-slate-900 text-white">
            <DialogHeader>
              <DialogTitle>{tr('配置高级语义研判', 'Configure Advanced Semantic Analysis')}</DialogTitle>
              <DialogDescription className="text-white/60">
              {tr('Pro 用户需要自行填写安全研判访问密钥来启用深度复核。密钥只会保存在系统钥匙串，不写入浏览器存储或本地设置文件。', 'Pro users need to provide their own access key for deep review. The key is stored only in the system keychain, not in browser storage or local settings files.')}
              </DialogDescription>
            </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-white">{tr('访问密钥', 'Access Key')}</label>
              <input
                type="password"
                value={semanticAccessKey}
                onChange={(event) => setSemanticAccessKey(event.target.value)}
                placeholder={tr('输入你的安全研判访问密钥', 'Enter your semantic analysis access key')}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-sky-400/40"
              />
              <p className="mt-2 text-xs leading-5 text-white/50">
                {tr('建议只在 Pro 用户环境中启用。系统会仅对最可疑的少量结果做深度研判，并对相同证据命中本地缓存，避免重复消耗。', 'Recommended for Pro users only. The system only deeply analyzes the most suspicious results and caches identical evidence locally to avoid redundant costs.')}
              </p>
            </div>
            <div className="flex items-center justify-end gap-3">
              <Button
                variant="ghost"
                className="text-white/70 hover:bg-white/10 hover:text-white"
                onClick={() => setSemanticDialogOpen(false)}
              >
                {t.cancel}
              </Button>
              <Button
                className="bg-sky-500 text-white hover:bg-sky-400"
                onClick={handleSaveSemanticAccessKey}
                disabled={busyKey === 'semanticGuardSave' || semanticAccessKey.trim().length === 0}
              >
                {busyKey === 'semanticGuardSave' ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {tr('连接中', 'Connecting')}
                  </span>
                ) : (
                  tr('保存并连接', 'Save and connect')
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SettingsFeedback({ tone, message }: FeedbackState) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'error' ? XCircle : Info;
  const toneClasses = {
    success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
    error: 'border-rose-500/20 bg-rose-500/10 text-rose-300',
    info: 'border-sky-500/20 bg-sky-500/10 text-sky-300',
  };

  return (
    <div className={cn('flex items-center gap-3 rounded-xl border px-4 py-3 text-sm', toneClasses[tone])}>
      <Icon className="h-4 w-4 flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function SettingsDialog({
  dialogKey,
  updateAudit,
  onClose,
}: {
  dialogKey: DialogKey;
  updateAudit: InstalledUpdateAuditResult | null;
  onClose: () => void;
}) {
  const legalCopy = dialogKey && dialogKey !== 'updates' ? getLegalCopy()[dialogKey] : null;

  return (
    <Dialog open={dialogKey !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl border-white/10 bg-slate-900 text-white">
        {dialogKey === 'updates' ? (
          <>
            <DialogHeader>
              <DialogTitle>{tr('更新检查结果', 'Update Check Results')}</DialogTitle>
              <DialogDescription className="text-white/60">
                {updateAudit
                  ? tr(`应用版本 ${updateAudit.appVersion}，检查时间 ${new Date(updateAudit.checkedAt).toLocaleString()}`, `App version ${updateAudit.appVersion}, checked at ${new Date(updateAudit.checkedAt).toLocaleString()}`)
                  : tr('尚未完成检查', 'Check not completed yet')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {!updateAudit || updateAudit.updates.length === 0 ? (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-200">
                  {tr('当前没有已安装 MCP / Skill 组件需要更新。', 'No installed MCP / Skill components need updating.')}
                </div>
              ) : (
                updateAudit.updates.map((item) => (
                  <div
                    key={item.item_id}
                    className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-4 text-sm"
                  >
                    <div>
                      <p className="font-medium text-white">{item.item_id}</p>
                      <p className="mt-1 text-white/60">
                        {item.current_version} → {item.new_version}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      className="text-white/70 hover:bg-white/10 hover:text-white"
                      onClick={() => useAppStore.getState().setCurrentModule('installed')}
                    >
                      {tr('前往更新', 'Go to update')}
                    </Button>
                  </div>
                ))
              )}
            </div>
          </>
        ) : legalCopy ? (
          <>
            <DialogHeader>
              <DialogTitle>{legalCopy.title}</DialogTitle>
              <DialogDescription className="text-white/60">{legalCopy.description}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm leading-6 text-white/80">
              {legalCopy.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SettingToggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void | Promise<void>;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-4">
      <div>
        <p className="text-sm font-medium text-white">{label}</p>
        {description && <p className="mt-0.5 text-xs text-white/50">{description}</p>}
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

function SettingLink({
  label,
  description,
  danger = false,
  loading = false,
  onClick,
}: {
  label: string;
  description?: string;
  danger?: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={cn(
        'flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 p-4 text-left transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70',
        danger && 'border-rose-500/20 hover:bg-rose-500/10'
      )}
    >
      <div>
        <p className={cn('text-sm font-medium', danger ? 'text-rose-400' : 'text-white')}>{label}</p>
        {description && <p className="mt-0.5 text-xs text-white/50">{description}</p>}
      </div>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-white/60" />
      ) : (
        <ChevronRight className={cn('h-4 w-4', danger ? 'text-rose-400/60' : 'text-white/40')} />
      )}
    </button>
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return tr('未知错误', 'Unknown error');
}
