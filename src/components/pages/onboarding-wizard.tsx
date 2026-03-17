import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  Sparkles,
  Lock,
  Zap,
  ArrowRight,
  Check,
  ChevronLeft,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { currentLang, t } from '@/constants/i18n';
import {
  ensureNotificationPermission,
  getNotificationPermissionGranted,
  getMacPermissionManualGuide,
  type MacPermissionPane,
  openExternalUrl,
  openMacPermissionSettings,
} from '@/services/runtime-settings';
import { useSettingsStore } from '@/stores/settingsStore';

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  icon: typeof Shield;
  color: string;
  content: React.ReactNode;
}

export function OnboardingWizard({ onComplete }: { onComplete?: () => void }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [notificationGranted, setNotificationGranted] = useState(false);
  const [notificationChecking, setNotificationChecking] = useState(true);
  const [permissionFeedback, setPermissionFeedback] = useState<string | null>(null);
  const [activePermissionAction, setActivePermissionAction] = useState<string | null>(null);
  const setNotificationsEnabled = useSettingsStore((state) => state.setNotificationsEnabled);
  const isEnglish = currentLang === 'en-US';
  const tr = (zh: string, en: string) => (isEnglish ? en : zh);
  const [isMacPlatform] = useState(
    () => typeof navigator !== 'undefined' && /macintosh|mac os x|darwin/i.test(navigator.userAgent),
  );

  const copy = isEnglish
    ? {
        openSettings: 'Open System Settings',
        manualStatus: 'Manual confirmation required',
        grantedStatus: 'Granted',
        missingStatus: 'Not granted',
        checkingStatus: 'Checking',
        requestNotifications: 'Grant notifications',
        refreshStatus: 'Refresh status',
        manualPermissionHint: 'AgentShield cannot auto-grant this macOS permission.',
        openedSettings: 'System Settings opened. Complete the permission there, then return here.',
        openSettingsFailed: 'Unable to open System Settings automatically. Please open macOS System Settings manually.',
        notificationsGranted: 'Desktop notifications are now enabled.',
        notificationsDenied: 'Notification permission is still not granted.',
      }
    : {
        openSettings: '打开系统设置',
        manualStatus: '需手动确认',
        grantedStatus: '已授权',
        missingStatus: '未授权',
        checkingStatus: '检测中',
        requestNotifications: '授权通知',
        refreshStatus: '重新检查',
        manualPermissionHint: '该系统权限无法由 AgentShield 自动授予，需要你在 macOS 系统设置中完成确认。',
        openedSettings: '已打开系统设置，请在系统中完成授权后再回到这里检查状态。',
        openSettingsFailed: '无法自动打开系统设置，请手动前往 macOS 系统设置完成授权。',
        notificationsGranted: '桌面通知权限已启用。',
        notificationsDenied: '通知权限仍未授予。',
      };

  useEffect(() => {
    let mounted = true;

    void getNotificationPermissionGranted()
      .then((granted) => {
        if (!mounted) {
          return;
        }
        const enabled = Boolean(granted);
        setNotificationGranted(enabled);
        if (enabled) {
          setNotificationsEnabled(true);
        }
      })
      .finally(() => {
        if (mounted) {
          setNotificationChecking(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [setNotificationsEnabled]);

  const refreshNotificationStatus = async () => {
    setActivePermissionAction('notifications-refresh');
    setPermissionFeedback(null);
    try {
      const granted = await getNotificationPermissionGranted();
      const enabled = Boolean(granted);
      setNotificationGranted(enabled);
      if (enabled) {
        setNotificationsEnabled(true);
      }
      setPermissionFeedback(enabled ? copy.notificationsGranted : copy.notificationsDenied);
    } finally {
      setNotificationChecking(false);
      setActivePermissionAction(null);
    }
  };

  const handleNotificationPermission = async () => {
    setActivePermissionAction('notifications');
    setPermissionFeedback(null);
    try {
      const granted = await ensureNotificationPermission();
      setNotificationGranted(granted);
      setNotificationsEnabled(granted);
      setPermissionFeedback(granted ? copy.notificationsGranted : copy.notificationsDenied);
    } finally {
      setNotificationChecking(false);
      setActivePermissionAction(null);
    }
  };

  const handleOpenPermissionSettings = async (pane: MacPermissionPane) => {
    setActivePermissionAction(pane);
    setPermissionFeedback(null);
    try {
      const opened = await openMacPermissionSettings(pane);
      if (opened) {
        setPermissionFeedback(copy.openedSettings);
        return;
      }
      const manualPath = getMacPermissionManualGuide(pane);
      setPermissionFeedback(`${copy.openSettingsFailed} ${manualPath}`);
    } finally {
      setActivePermissionAction(null);
    }
  };

  const steps: OnboardingStep[] = [
    {
      id: "welcome",
      title: t.onboardingWelcome,
      description: t.onboardingSubtitle,
      icon: Shield,
      color: "from-sky-500 to-violet-500",
      content: (
        <div className="text-center">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="w-32 h-32 mx-auto mb-8 rounded-3xl bg-gradient-to-br from-sky-500 to-violet-500 flex items-center justify-center shadow-2xl shadow-sky-500/30"
          >
            <Shield className="w-16 h-16 text-white" />
          </motion.div>
          <motion.h1
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-3xl font-bold text-white mb-4"
          >
            {t.onboardingWelcome}
          </motion.h1>
          <motion.p
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-white/60 max-w-md mx-auto"
          >
            {t.onboardingDesc}
          </motion.p>
        </div>
      ),
    },
    {
      id: "permissions",
      title: t.permissionTitle,
      description: t.permissionSubtitle,
      icon: Lock,
      color: "from-amber-500 to-orange-500",
      content: (
        <div className="space-y-4">
          {isMacPlatform ? (
            <>
              <PermissionCard
                title={t.permFullDisk}
                description={t.permFullDiskDesc}
                required
                statusLabel={copy.manualStatus}
                helperText={copy.manualPermissionHint}
                actionLabel={copy.openSettings}
                actionBusy={activePermissionAction === 'fullDiskAccess'}
                onAction={() => handleOpenPermissionSettings('fullDiskAccess')}
                tone="manual"
              />
              <PermissionCard
                title={t.permAccessibility}
                description={t.permAccessibilityDesc}
                required
                statusLabel={copy.manualStatus}
                helperText={copy.manualPermissionHint}
                actionLabel={copy.openSettings}
                actionBusy={activePermissionAction === 'accessibility'}
                onAction={() => handleOpenPermissionSettings('accessibility')}
                tone="manual"
              />
              <PermissionCard
                title={t.permAutomation}
                description={t.permAutomationDesc}
                statusLabel={copy.manualStatus}
                helperText={copy.manualPermissionHint}
                actionLabel={copy.openSettings}
                actionBusy={activePermissionAction === 'automation'}
                onAction={() => handleOpenPermissionSettings('automation')}
                tone="manual"
              />
            </>
          ) : (
            <PermissionCard
              title={tr('Windows 安全中心配置', 'Windows Security setup')}
              description={tr(
                'Windows 不需要 macOS 的完全磁盘访问/辅助功能/自动化权限。建议在 Windows 安全中心将 AgentShield 加入允许名单。',
                'Windows does not require macOS Full Disk Access / Accessibility / Automation permissions. Add AgentShield to Windows Security allowlist.'
              )}
              statusLabel={tr('按需配置', 'Recommended')}
              helperText={tr(
                '点击按钮可直接打开 Windows Defender 设置页。',
                'Click to open Windows Defender settings directly.'
              )}
              actionLabel={tr('打开 Windows 安全中心', 'Open Windows Security')}
              actionBusy={activePermissionAction === 'windows-defender'}
              onAction={async () => {
                setActivePermissionAction('windows-defender');
                try {
                  await openExternalUrl('ms-settings:windowsdefender');
                } finally {
                  setActivePermissionAction(null);
                }
              }}
              tone="manual"
            />
          )}
          <PermissionCard
            title={t.permNotification}
            description={t.permNotificationDesc}
            statusLabel={
              notificationChecking
                ? copy.checkingStatus
                : notificationGranted
                  ? copy.grantedStatus
                  : copy.missingStatus
            }
            helperText={
              notificationGranted
                ? undefined
                : isEnglish
                  ? 'AgentShield uses real system notifications for security alerts.'
                  : 'AgentShield 会把高风险告警通过真实系统通知发给你。'
            }
            actionLabel={notificationGranted ? copy.refreshStatus : copy.requestNotifications}
            actionBusy={
              activePermissionAction === 'notifications'
              || activePermissionAction === 'notifications-refresh'
            }
            onAction={notificationGranted ? refreshNotificationStatus : handleNotificationPermission}
            tone={notificationGranted ? "granted" : "pending"}
          />
          {permissionFeedback && (
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/75">
              {permissionFeedback}
            </div>
          )}
        </div>
      ),
    },
    {
      id: "features",
      title: t.featureTitle,
      description: t.featureSubtitle,
      icon: Sparkles,
      color: "from-emerald-500 to-teal-500",
      content: (
        <div className="grid grid-cols-2 gap-4">
          <FeatureCard
            icon={<div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
              <span className="text-2xl">🧹</span>
            </div>}
            title={t.featureSmartClean}
            description={t.featureSmartCleanDesc}
          />
          <FeatureCard
            icon={<div className="w-10 h-10 rounded-xl bg-rose-500/20 flex items-center justify-center">
              <span className="text-2xl">🛡️</span>
            </div>}
            title={t.featureSecurity}
            description={t.featureSecurityDesc}
          />
          <FeatureCard
            icon={<div className="w-10 h-10 rounded-xl bg-sky-500/20 flex items-center justify-center">
              <span className="text-2xl">⚡</span>
            </div>}
            title={t.featurePerformance}
            description={t.featurePerformanceDesc}
          />
          <FeatureCard
            icon={<div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center">
              <span className="text-2xl">🔑</span>
            </div>}
            title={t.featureKeyVault}
            description={t.featureKeyVaultDesc}
          />
        </div>
      ),
    },
    {
      id: "ready",
      title: t.readyTitle,
      description: t.readyDesc,
      icon: Zap,
      color: "from-violet-500 to-fuchsia-500",
      content: (
        <div className="text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.2 }}
            className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-2xl shadow-emerald-500/30"
          >
            <Check className="w-12 h-12 text-white" />
          </motion.div>
          <motion.h2
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-2xl font-bold text-white mb-4"
          >
            {t.allReady}
          </motion.h2>
          <motion.p
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="text-white/60 max-w-sm mx-auto"
          >
            {t.readyProtectionDesc}
          </motion.p>
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="mt-8 flex flex-col items-center gap-4"
          >
            <Button
              size="lg"
              className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white px-8 py-6 text-lg rounded-2xl shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50 transition-all"
              onClick={onComplete}
            >
              <Zap className="w-5 h-5 mr-2" />
              {t.startFirstScan}
            </Button>
            <button
              onClick={onComplete}
              className="text-sm text-white/40 hover:text-white/60 transition-colors"
            >
              {t.maybeLater}
            </button>
          </motion.div>
        </div>
      ),
    },
  ];

  const currentStepData = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;
  const isFirstStep = currentStep === 0;

  const handleNext = () => {
    if (isLastStep) {
      onComplete?.();
    } else {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handleBack = () => {
    if (!isFirstStep) {
      setCurrentStep(prev => prev - 1);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#0A0F1A] flex flex-col">
      {/* Progress Bar */}
      <div className="h-1 bg-white/10">
        <motion.div
          className="h-full bg-gradient-to-r from-sky-500 to-violet-500"
          initial={{ width: 0 }}
          animate={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>

      {/* Step Indicators */}
      <div className="flex justify-center gap-2 py-6">
        {steps.map((step, index) => (
          <button
            key={step.id}
            onClick={() => index < currentStep && setCurrentStep(index)}
            className={cn(
              "w-2.5 h-2.5 rounded-full transition-all",
              index === currentStep
                ? "bg-white w-8"
                : index < currentStep
                  ? "bg-white/60"
                  : "bg-white/20"
            )}
          />
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center p-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            transition={{ duration: 0.3 }}
            className="w-full max-w-xl"
          >
            {currentStepData.content}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <div className="p-6 flex justify-between items-center">
        <Button
          variant="ghost"
          onClick={handleBack}
          disabled={isFirstStep}
          className={cn(
            "text-white/60 hover:text-white",
            isFirstStep && "invisible"
          )}
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          {t.prevStep}
        </Button>

        {!isLastStep && (
          <Button
            onClick={handleNext}
            className="bg-white text-[#0A0F1A] hover:bg-white/90 px-6"
          >
            {t.continueBtn}
            <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        )}
      </div>
    </div>
  );
}

function PermissionCard({
  title,
  description,
  required,
  statusLabel,
  helperText,
  actionLabel,
  actionBusy,
  onAction,
  tone,
}: {
  title: string;
  description: string;
  required?: boolean;
  statusLabel: string;
  helperText?: string;
  actionLabel: string;
  actionBusy?: boolean;
  onAction: () => void;
  tone: 'granted' | 'pending' | 'manual';
}) {
  const isGranted = tone === 'granted';

  return (
    <motion.div
      whileHover={{ scale: 1.01 }}
      className={cn(
        "w-full p-4 rounded-xl border text-left transition-all",
        isGranted
          ? "bg-emerald-500/10 border-emerald-500/30"
          : "bg-white/5 border-white/10 hover:bg-white/10"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center",
            isGranted ? "bg-emerald-500" : "bg-white/10"
          )}>
            {isGranted ? (
              <Check className="w-4 h-4 text-white" />
            ) : (
              <Lock className="w-4 h-4 text-white/40" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={cn("font-medium", isGranted ? "text-emerald-400" : "text-white")}>
                {title}
              </span>
              {required && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">
                  {t.required}
                </span>
              )}
              <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/60">
                {statusLabel}
              </span>
            </div>
            <p className="text-sm text-white/50 mt-0.5">{description}</p>
            {helperText && (
              <p className="text-xs text-white/35 mt-2 max-w-md">{helperText}</p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onAction}
          disabled={actionBusy}
          className={cn(
            "flex min-w-[110px] items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
            actionBusy
              ? "bg-white/10 text-white/40"
              : isGranted
                ? "bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30"
                : "bg-white/10 text-white hover:bg-white/15"
          )}
        >
          {actionBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {actionLabel}
        </button>
      </div>
    </motion.div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      className="p-4 rounded-xl bg-white/5 border border-white/10"
    >
      {icon}
      <h3 className="font-medium text-white mt-3">{title}</h3>
      <p className="text-sm text-white/50 mt-1">{description}</p>
    </motion.div>
  );
}
