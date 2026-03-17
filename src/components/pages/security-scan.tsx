import { useState, useEffect, useRef } from 'react';
import { tauriInvoke as invoke } from '@/services/tauri';
import { motion } from 'framer-motion';
import { Search, ChevronRight, AlertCircle, AlertTriangle, Info, CheckCircle, Loader2, Shield, Cpu, Eye, Lock, FileSearch, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MODULE_THEMES, SEVERITY_COLORS } from '@/constants/colors';
import { isEnglishLocale, t } from '@/constants/i18n';
import { ModuleHeroPage } from '@/components/module-hero-page';
import { ThreeColumnLayout, SortDropdown } from '@/components/three-column-layout';
import { SeverityBadge } from '@/components/safety-badge';
import { PlatformBadge } from '@/components/platform-badge';
import { RoundCTAButton } from '@/components/round-cta-button';
import { listenScanProgress, runFullScan, cancelScan } from '@/services/scanner';
import { sendDesktopNotification } from '@/services/runtime-settings';
import { isTauriEnvironment } from '@/services/tauri';
import type { RustSecurityIssue, SemanticGuardSummary as ScanSemanticGuardSummary } from '@/services/scanner';
import type { SecurityIssue, Severity, Platform } from '@/types/domain';
import { useNotificationStore } from '@/stores/notificationStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAppStore } from '@/stores/appStore';
import { useProGate } from '@/hooks/useProGate';
import { createBufferedPhaseVisualizer } from '@/lib/buffered-phase-visualizer';
import { requestRuntimeGuardActionApproval } from '@/services/runtime-guard';
import { containsCjk, localizedDynamicText } from '@/lib/locale-text';

const tr = (zh: string, en: string) => (isEnglishLocale ? en : zh);

const PLATFORM_KEYWORD_MAPPING: Array<[string[], Platform]> = [
  [['vscode', 'vs code', 'visual studio code', '/code/', '.vscode'], 'vscode'],
  [['kiro', '.kiro'], 'kiro'],
  [['claude desktop', 'claude_desktop'], 'claude_desktop'],
  [['claude code', '.claude', '.claude.json'], 'claude_code'],
  [['windsurf', 'codeium/windsurf'], 'windsurf'],
  [['antigravity'], 'antigravity'],
  [['openclaw', '.openclaw'], 'openclaw'],
  [['codex', '.codex', 'com.openai.atlas', '/codex/'], 'codex'],
  [['qwen code', 'qwen-code', '.qwen', 'qwencode'], 'qwen_code'],
  [['kimi', '.kimi', 'moonshot'], 'kimi_cli'],
  [['codebuddy', '.codebuddy', 'tencent codebuddy'], 'codebuddy'],
  [['gemini', '.gemini'], 'gemini_cli'],
  [['trae', '.trae'], 'trae'],
  [['cursor', '.cursor'], 'cursor'],
  [['zed', '.zed'], 'zed'],
  [['continue', '.continue'], 'continue_dev'],
  [['aider', '.aider'], 'aider'],
  [['copilot'], 'copilot'],
  [['cline', 'roo'], 'cline'],
];

function inferPlatformFromText(input: string): Platform | null {
  const text = input.toLowerCase();
  for (const [keywords, platform] of PLATFORM_KEYWORD_MAPPING) {
    if (keywords.some((keyword) => text.includes(keyword))) {
      return platform;
    }
  }
  return null;
}

/** Extract a Platform from issue title/description/file path. */
function extractPlatform(issue: RustSecurityIssue): Platform {
  const sources = [issue.title, issue.description, issue.file_path ?? ''];
  for (const source of sources) {
    const platform = inferPlatformFromText(source);
    if (platform) {
      return platform;
    }
  }
  return 'unknown_ai_tool';
}

/** Map a RustSecurityIssue to the UI SecurityIssue type. */
export function mapRustIssue(ri: RustSecurityIssue): SecurityIssue {
  const severity: Severity =
    ri.severity === 'critical' || ri.severity === 'warning' || ri.severity === 'info'
      ? ri.severity
      : ri.severity === 'high' ? 'critical'
      : ri.severity === 'medium' ? 'warning'
      : 'info';

  const fallbackTitle =
    severity === 'critical'
      ? 'Critical security issue detected'
      : severity === 'warning'
        ? 'Security warning detected'
        : 'Security finding detected';
  const fallbackDescription =
    severity === 'critical'
      ? 'A high-risk behavior was detected. Please review the file path and suggested fix.'
      : 'A potential risk was detected. Please review the related configuration.';

  return {
    id: ri.id,
    severity,
    title: localizedDynamicText(ri.title, fallbackTitle),
    description: localizedDynamicText(ri.description, fallbackDescription),
    platform: extractPlatform(ri),
    fixable: ri.auto_fixable,
    filePath: ri.file_path ?? undefined,
    semanticReview: ri.semantic_review
      ? {
          verdict: localizedDynamicText(ri.semantic_review.verdict, 'needs_review'),
          confidence: ri.semantic_review.confidence,
          summary: localizedDynamicText(
            ri.semantic_review.summary,
            'Semantic guard flagged this item for additional review.',
          ),
          recommendedAction: localizedDynamicText(
            ri.semantic_review.recommended_action,
            'Review this item and apply the recommended secure configuration.',
          ),
        }
      : undefined,
  };
}

function localizeRuntimeMessage(message: string, englishFallback: string): string {
  return localizedDynamicText(message, englishFallback);
}

function collectFixAllTargets(issues: SecurityIssue[]): string[] {
  return Array.from(
    new Set(
      issues
        .filter(issue => issue.fixable)
        .map(issue => issue.filePath?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

const AI_TOOL_ORDER: Platform[] = [
  'cursor',
  'kiro',
  'vscode',
  'claude_desktop',
  'claude_code',
  'codex',
  'qwen_code',
  'kimi_cli',
  'codebuddy',
  'windsurf',
  'zed',
  'trae',
  'gemini_cli',
  'antigravity',
  'continue_dev',
  'aider',
  'copilot',
  'cline',
  'openclaw',
];

function platformDisplayName(platform: Platform): string {
  const mapping: Record<string, string> = {
    cursor: 'Cursor',
    kiro: 'Kiro',
    vscode: 'VS Code',
    claude_desktop: 'Claude Desktop',
    claude_code: 'Claude Code',
    codex: 'Codex',
    qwen_code: 'Qwen Code',
    kimi_cli: 'Kimi CLI',
    codebuddy: 'CodeBuddy',
    windsurf: 'Windsurf',
    zed: 'Zed',
    trae: 'Trae',
    gemini_cli: 'Gemini CLI',
    antigravity: 'Antigravity',
    continue_dev: 'Continue',
    aider: 'Aider',
    copilot: 'Copilot',
    cline: 'Cline / Roo',
    openclaw: 'OpenClaw',
  };
  if (platform.startsWith('unknown_ai_tool_')) {
    return `Unknown AI Tool (${platform.replace('unknown_ai_tool_', '')})`;
  }
  return mapping[platform] || platform;
}

interface SecurityScanHomeProps {
  onViewDetail?: () => void;
  onStartScan?: () => void;
}

export function SecurityScanHome({ onViewDetail, onStartScan }: SecurityScanHomeProps) {
  const theme = MODULE_THEMES.securityScan;

  return (
    <ModuleHeroPage
      moduleName={t.securityScan}
      description={tr(
        '扫描所有 AI 工具的高危自动化行为，提前拦截密码外传、误删文件与异常扣费风险。',
        'Scan high-risk automation behaviors across AI tools to prevent secret leaks, file loss, and unexpected charges.'
      )}
      ctaText={t.startScan}
      ctaColor={theme.accent}
      gradient={{ from: theme.from, via: theme.via, to: theme.to }}
      onCtaClick={onViewDetail || onStartScan}
      icon={
        <div
          className="w-[200px] h-[200px] rounded-3xl flex items-center justify-center"
          style={{
            background: `linear-gradient(135deg, ${theme.accent}30 0%, ${theme.accent}10 100%)`,
            boxShadow: `0 0 60px ${theme.accent}30`,
          }}
        >
          <Search className="w-24 h-24 text-red-400" />
        </div>
      }
    />
  );
}

interface SecurityScanDetailProps {
  onBack: () => void;
  onFix?: () => void;
  /** Pre-loaded issues from cached scan — skips re-scanning when provided */
  cachedIssues?: SecurityIssue[];
  /** Category-specific title (e.g. "扩展安全检查") */
  categoryTitle?: string;
}

const SCAN_PHASE_TO_STEP: Record<string, number> = {
  detect_tools: 0,
  mcp_security: 1,
  key_security: 2,
  skill_security: 3,
  env_config: 4,
  system_protection: 5,
};

const SCAN_PHASE_ORDER = [
  'detect_tools',
  'mcp_security',
  'key_security',
  'skill_security',
  'env_config',
  'system_protection',
] as const;

function getScanPhaseLabels(): Record<(typeof SCAN_PHASE_ORDER)[number], string> {
  return {
    detect_tools: tr('正在检测你的 AI 工具', 'Detecting your AI tools'),
    mcp_security: tr('检查隐私泄露风险', 'Checking for privacy leaks'),
    key_security: tr('检查密码暴露风险', 'Checking for password exposure'),
    skill_security: tr('检查恶意插件风险', 'Checking for malicious plugins'),
    env_config: tr('检查权限配置风险', 'Checking permission settings'),
    system_protection: tr('检查后台偷跑风险', 'Checking background activity'),
  };
}

function localizeProgressLabel(phaseId: string, label: string): string {
  if (!isEnglishLocale || !containsCjk(label)) {
    return label;
  }
  const labels = getScanPhaseLabels();
  const base = labels[phaseId as (typeof SCAN_PHASE_ORDER)[number]] ?? 'Running security checks';
  const detail = label.split('·').slice(1).join('·').trim();
  return detail ? `${base} · ${detail}` : base;
}

const MIN_SCAN_PHASE_VISIBLE_MS = 900;
const MIN_SCAN_TOTAL_MS = 6500;

function getScanSteps() {
  return [
    { icon: FileSearch, label: tr('正在检测你的 AI 工具', 'Detecting your AI tools') },
    { icon: Cpu, label: tr('检查隐私泄露风险', 'Checking for privacy leaks') },
    { icon: Lock, label: tr('检查密码暴露风险', 'Checking for password exposure') },
    { icon: Eye, label: tr('检查恶意插件风险', 'Checking for malicious plugins') },
    { icon: Search, label: tr('检查权限配置风险', 'Checking permission settings') },
    { icon: Shield, label: tr('检查后台偷跑风险', 'Checking background activity') },
  ];
}

function ScanningAnimation({
  currentStep,
  progress,
  currentLabel,
}: {
  currentStep: number;
  progress: number;
  currentLabel: string;
}) {
  const theme = MODULE_THEMES.securityScan;

  return (
    <div className="h-full flex flex-col items-center justify-center px-8" style={{
      background: `linear-gradient(135deg, ${theme.from} 0%, ${theme.via} 45%, ${theme.to} 100%)`,
    }}>
      {/* Animated radar/shield */}
      <div className="relative w-48 h-48 mb-10">
        {/* Outer pulse rings */}
        {[0, 1, 2].map(i => (
          <motion.div
            key={i}
            className="absolute inset-0 rounded-full border-2"
            style={{ borderColor: `${theme.accent}30` }}
            initial={{ scale: 0.8, opacity: 0.8 }}
            animate={{
              scale: [0.8, 1.6],
              opacity: [0.6, 0],
            }}
            transition={{
              duration: 2,
              delay: i * 0.6,
              repeat: Infinity,
              ease: 'easeOut',
            }}
          />
        ))}

        {/* Rotating scanner line */}
        <motion.div
          className="absolute inset-0"
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
        >
          <div
            className="absolute top-1/2 left-1/2 w-1/2 h-0.5 origin-left"
            style={{
              background: `linear-gradient(90deg, ${theme.accent}, transparent)`,
            }}
          />
        </motion.div>

        {/* Center shield icon */}
        <motion.div
          className="absolute inset-0 flex items-center justify-center"
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        >
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center"
            style={{
              background: `linear-gradient(135deg, ${theme.accent}40, ${theme.accent}20)`,
              boxShadow: `0 0 40px ${theme.accent}30`,
            }}
          >
            <Shield className="w-10 h-10 text-white" />
          </div>
        </motion.div>
      </div>

      {/* Progress bar */}
      <div className="w-80 mb-6">
        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: theme.accent }}
            initial={{ width: '0%' }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
        <div className="flex justify-between mt-2">
          <span className="text-xs text-white/50">{Math.round(progress)}%</span>
          <span className="text-xs text-white/50">{progress >= 100 ? t.done : t.scanStatusScanning}</span>
        </div>
        <p className="mt-3 text-center text-xs text-white/60">{currentLabel}</p>
      </div>

      {/* Step list */}
      <div className="w-80 space-y-3">
        {getScanSteps().map((step, i) => {
          const StepIcon = step.icon;
          const allDone = progress >= 100;
          const isDone = allDone || i < currentStep;
          const isActive = !allDone && i === currentStep;
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -20 }}
              animate={{
                opacity: i <= currentStep ? 1 : 0.3,
                x: 0,
              }}
              transition={{ delay: i * 0.15, duration: 0.3 }}
              className="flex items-center gap-3"
            >
              <div className={cn(
                'w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0',
                isDone ? 'bg-green-500/20' : isActive ? 'bg-white/15' : 'bg-white/5',
              )}>
                {isDone ? (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                ) : isActive ? (
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                    <Loader2 className="w-4 h-4 text-white" />
                  </motion.div>
                ) : (
                  <StepIcon className="w-4 h-4 text-white/40" />
                )}
              </div>
              <span className={cn(
                'text-sm',
                isDone ? 'text-green-400' : isActive ? 'text-white' : 'text-white/40',
              )}>
                {step.label}
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

export function SecurityScanDetail({ onBack, cachedIssues, categoryTitle }: SecurityScanDetailProps) {
  const { isPro, isTrial } = useProGate();
  const batchFixUnlocked = isPro || isTrial;
  const useCached = cachedIssues && cachedIssues.length >= 0;
  const [issues, setIssues] = useState<SecurityIssue[]>(useCached ? cachedIssues : []);
  const [selectedIssue, setSelectedIssue] = useState<SecurityIssue | null>(
    useCached && cachedIssues.length > 0 ? cachedIssues[0] : null
  );
  const [severityFilter, setSeverityFilter] = useState<Severity | 'all'>('all');
  const [platformFilter, setPlatformFilter] = useState<Platform | 'all'>('all');
  const [sortBy, setSortBy] = useState('severity');
  const [scanning, setScanning] = useState(!useCached);
  const [totalLoaded, setTotalLoaded] = useState(useCached ? cachedIssues.length : 0);
  const [scanStep, setScanStep] = useState(0);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanLabel, setScanLabel] = useState(getScanPhaseLabels().detect_tools);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanErrorType, setScanErrorType] = useState<'preview' | 'generic' | null>(null);
  const [scanAttempt, setScanAttempt] = useState(0);
  const [semanticGuard, setSemanticGuard] = useState<ScanSemanticGuardSummary | null>(null);
  const [scanScore, setScanScore] = useState<number | null>(null);
  const pushNotification = useNotificationStore((state) => state.pushNotification);
  const shouldRunScan = !useCached || scanAttempt > 0;
  const previewScanMessage = t.desktopOnlyInBrowserShell.replace('{feature}', t.moduleSecurityScan);

  useEffect(() => {
    if (!shouldRunScan) {
      return;
    }

    let cancelled = false;
    let unlisten: (() => void) | undefined;
    let finalizeTimer: number | null = null;
    const scanStartedAt = Date.now();
    setScanError(null);
    setScanning(true);
    setIssues([]);
    setSelectedIssue(null);
    setTotalLoaded(0);
    setScanStep(0);
    setScanProgress(0);
    setScanLabel(getScanPhaseLabels().detect_tools);
    setSemanticGuard(null);
    setScanScore(null);
    setScanErrorType(null);

    if (!isTauriEnvironment()) {
      setScanning(false);
      setScanError(previewScanMessage);
      setScanErrorType('preview');
      return;
    }

    const bufferedVisualizer = createBufferedPhaseVisualizer({
      phaseOrder: [...SCAN_PHASE_ORDER],
      initialPhaseId: 'detect_tools',
      minPhaseVisibleMs: MIN_SCAN_PHASE_VISIBLE_MS,
      onApply: (event) => {
        setScanLabel(event.label);
        setScanProgress(event.progress);
        const stepIndex = SCAN_PHASE_TO_STEP[event.phaseId];
        if (stepIndex !== undefined) {
          setScanStep(stepIndex);
        }
      },
    });

    // Must await listener registration before starting scan to avoid
    // missing progress events (race condition that caused 5% → 100% jump).
    void listenScanProgress((event) => {
      if (cancelled) return;
      bufferedVisualizer.push({
        phaseId: event.phase_id,
        label: localizeProgressLabel(event.phase_id, event.label),
        progress: event.progress,
        status: event.status,
      });
    }).then((dispose) => {
      unlisten = dispose;
      // Only start the scan after the listener is registered
      return runFullScan();
    }).then(result => {
      if (cancelled) return;
      if (result) {
        const allIssues = result.categories.flatMap(cat => cat.issues).map(mapRustIssue);
        setIssues(allIssues);
        setTotalLoaded(allIssues.length);
        setSemanticGuard(result.semantic_guard);
        setScanScore(result.score);
        if (allIssues.length > 0) setSelectedIssue(allIssues[0]);
        bufferedVisualizer.finalize(() => {
          if (cancelled) return;
          setScanProgress(100);
          setScanStep(getScanSteps().length - 1);
          const elapsed = Date.now() - scanStartedAt;
          const waitMs = Math.max(0, MIN_SCAN_TOTAL_MS - elapsed);
          finalizeTimer = window.setTimeout(() => {
            if (cancelled) return;
            setScanning(false);
          }, waitMs);
        });

        const criticalCount = allIssues.filter((issue) => issue.severity === 'critical').length;
        if (criticalCount > 0 && useSettingsStore.getState().criticalAlerts) {
          void pushNotification({
            type: 'security',
            priority: 'warning',
            title: tr(
              `发现 ${criticalCount} 个高风险安全问题`,
              `${criticalCount} critical security issues detected`
            ),
            body: tr(
              '安全扫描已完成，请立即查看并处理高风险项目。',
              'Security scan completed. Please review and handle critical issues now.'
            ),
          });

          if (useSettingsStore.getState().notificationsEnabled) {
            void sendDesktopNotification(
              tr('AgentShield 高风险告警', 'AgentShield critical risk alert'),
              tr(
                `最新一次扫描发现 ${criticalCount} 个高风险问题`,
                `Latest scan found ${criticalCount} critical issues`
              )
            );
          }
        }
      } else {
        bufferedVisualizer.dispose();
        setScanProgress(0);
        setScanning(false);
        setScanError(
          tr(
            '本次安全扫描未能完成，请检查本地权限、文件访问范围或配置文件内容后重试。',
            'Security scan did not complete. Check local permissions, file access scope, or configuration content and retry.'
          )
        );
        setScanErrorType('generic');
      }
    });

    return () => {
      cancelled = true;
      if (finalizeTimer !== null) {
        window.clearTimeout(finalizeTimer);
      }
      bufferedVisualizer.dispose();
      unlisten?.();
    };
  }, [pushNotification, scanAttempt, shouldRunScan, useCached]);

  const severityScopedIssues = severityFilter === 'all'
    ? issues
    : issues.filter((issue) => issue.severity === severityFilter);

  const orderedPlatforms = [
    ...AI_TOOL_ORDER.filter((platform) => severityScopedIssues.some((issue) => issue.platform === platform)),
    ...[...new Set(severityScopedIssues.map((issue) => issue.platform))]
      .filter((platform) => !AI_TOOL_ORDER.includes(platform))
      .sort(),
  ];

  const platformScopedIssues = platformFilter === 'all'
    ? severityScopedIssues
    : severityScopedIssues.filter((issue) => issue.platform === platformFilter);

  const filteredIssues = [...platformScopedIssues].sort((a, b) => {
    if (sortBy === 'severity') {
      const order = { critical: 0, warning: 1, info: 2 };
      return order[a.severity] - order[b.severity];
    }
    if (sortBy === 'platform') {
      return a.platform.localeCompare(b.platform);
    }
    if (sortBy === 'fixable') {
      return (b.fixable ? 1 : 0) - (a.fixable ? 1 : 0);
    }
    return 0;
  });

  const severityCounts = {
    critical: issues.filter(i => i.severity === 'critical').length,
    warning: issues.filter(i => i.severity === 'warning').length,
    info: issues.filter(i => i.severity === 'info').length,
  };

  useEffect(() => {
    if (platformFilter === 'all') {
      return;
    }
    if (!orderedPlatforms.includes(platformFilter)) {
      setPlatformFilter('all');
    }
  }, [orderedPlatforms, platformFilter]);

  const fixableCount = issues.filter(i => i.fixable).length;
  const subtitle = scanScore !== null
    ? semanticGuard?.reviewed_issues
      ? tr(
        `${t.score}: ${scanScore}/100 · 高级语义研判 ${semanticGuard.reviewed_issues} 项`,
        `${t.score}: ${scanScore}/100 · Semantic review on ${semanticGuard.reviewed_issues} items`,
      )
      : `${t.score}: ${scanScore}/100`
    : semanticGuard?.reviewed_issues
      ? tr(`高级语义研判 ${semanticGuard.reviewed_issues} 项`, `Semantic review on ${semanticGuard.reviewed_issues} items`)
      : tr(`共 ${totalLoaded} 项待确认`, `${totalLoaded} items pending review`);

  const handleFixIssue = (fixedIssue: SecurityIssue) => {
    const fixedPath = fixedIssue.filePath?.trim();
    setIssues((prev) => {
      const nextIssues = prev.filter((issue) => {
        if (issue.id === fixedIssue.id) {
          return false;
        }
        const issuePath = issue.filePath?.trim();
        if (
          fixedIssue.fixable &&
          issue.fixable &&
          fixedPath &&
          issuePath &&
          issuePath === fixedPath
        ) {
          return false;
        }
        return true;
      });
      setSelectedIssue((current) =>
        current?.id === fixedIssue.id ? (nextIssues[0] ?? null) : current
      );
      return nextIssues;
    });
    useAppStore.setState((state) => ({
      lastScanByCategory: Object.fromEntries(
        Object.entries(state.lastScanByCategory).map(([cardId, cardIssues]) => [
          cardId,
          cardIssues.filter((issue) => {
            if (issue.id === fixedIssue.id) {
              return false;
            }
            const issuePath = issue.filePath?.trim();
            if (
              fixedIssue.fixable &&
              issue.fixable &&
              fixedPath &&
              issuePath &&
              issuePath === fixedPath
            ) {
              return false;
            }
            return true;
          }),
        ]),
      ),
    }));
    setFixAllMessage(
      tr(
        '该问题已修好。你可以继续处理其他问题，需要时再手动点击重扫。',
        'Issue fixed. You can keep handling the remaining issues and rescan manually when needed.',
      )
    );
  };

  const [fixAllLoading, setFixAllLoading] = useState(false);
  const [fixAllMessage, setFixAllMessage] = useState<string | null>(null);
  const fixAllInFlightRef = useRef(false);
  const fixAllMessageTimeoutRef = useRef<number | null>(null);
  const handleBack = () => {
    if (scanning) {
      void cancelScan();
    }
    onBack();
  };

  useEffect(() => {
    return () => {
      if (fixAllMessageTimeoutRef.current !== null) {
        window.clearTimeout(fixAllMessageTimeoutRef.current);
      }
    };
  }, []);

  const handleFixAll = async () => {
    if (!batchFixUnlocked) {
      setFixAllMessage(
        tr(
          '此功能需要 Pro。升级后 30 秒修复全部风险。',
          'This requires Pro. Upgrade to fix all risks in 30 seconds.'
        )
      );
      return;
    }

    if (fixAllInFlightRef.current || fixAllLoading) {
      return;
    }

    fixAllInFlightRef.current = true;
    setFixAllLoading(true);
    setFixAllMessage(null);
    try {
      const fixTargets = collectFixAllTargets(issues);
      if (fixTargets.length === 0) {
        setFixAllMessage(t.noAutoFixable);
        return;
      }

      const approval = await requestRuntimeGuardActionApproval({
        component_id: 'agentshield:scan:auto-fix',
        component_name: tr(`${t.moduleSecurityScan}一键修复`, `${t.moduleSecurityScan} Fix All`),
        platform_id: 'agentshield',
        platform_name: 'AgentShield',
        request_kind: 'bulk_file_modify',
        trigger_event: 'user_requested_fix_all',
        action_kind: 'bulk_file_modify',
        action_source: 'user_requested_fix_all',
        action_targets: fixTargets,
        action_preview: fixTargets.slice(0, 6),
        sensitive_capabilities: [tr('读写本地文件', 'Read and write local files')],
        is_destructive: true,
        is_batch: true,
      });

      if (approval.status !== 'approved' || !approval.approval_ticket) {
        setFixAllMessage(
          tr(
            '已弹出批量修复审批。请先确认，再次点击一键修复。',
            'Bulk fix approval is pending. Confirm it first, then click Fix All again.'
          )
        );
        return;
      }

      const count = await invoke<number>('fix_all', {
        actionTargets: fixTargets,
        approvalTicket: approval.approval_ticket,
      });
      if (count > 0) {
        const fixedPathSet = new Set(fixTargets.map((value) => value.trim()));
        setIssues(prev => prev.filter((issue) => {
          const filePath = issue.filePath?.trim();
          return !(issue.fixable && filePath && fixedPathSet.has(filePath));
        }));
        useAppStore.setState((state) => ({
          lastScanByCategory: Object.fromEntries(
            Object.entries(state.lastScanByCategory).map(([cardId, cardIssues]) => [
              cardId,
              cardIssues.filter((issue) => {
                const filePath = issue.filePath?.trim();
                return !(issue.fixable && filePath && fixedPathSet.has(filePath));
              }),
            ]),
          ),
        }));
        setSelectedIssue(null);
        setFixAllMessage(
          tr(
            `${t.fixedCount.replace('{count}', String(count))}，正在重新扫描确认`,
            `${t.fixedCount.replace('{count}', String(count))}, rescanning to verify`
          )
        );
        setScanning(true);
        setScanAttempt((value) => value + 1);
      } else {
        setFixAllMessage(t.noAutoFixable);
      }
    } catch (e: any) {
      console.error('fix_all failed:', e);
      const msg = typeof e === 'string' ? e : e?.message || t.fixFailed;
      setFixAllMessage(
        localizeRuntimeMessage(
          msg,
          'Bulk fix did not complete. Review the message and retry.'
        )
      );
    } finally {
      fixAllInFlightRef.current = false;
      setFixAllLoading(false);
      if (fixAllMessageTimeoutRef.current !== null) {
        window.clearTimeout(fixAllMessageTimeoutRef.current);
      }
      fixAllMessageTimeoutRef.current = window.setTimeout(() => {
        setFixAllMessage(null);
        fixAllMessageTimeoutRef.current = null;
      }, 3000);
    }
  };

  // Show full-screen scanning animation
  if (scanning) {
    return (
      <div className="h-full relative">
        <ScanningAnimation currentStep={scanStep} progress={scanProgress} currentLabel={scanLabel} />
        {/* Back button overlay */}
        <button
          onClick={handleBack}
          className="absolute top-5 left-5 text-white/60 hover:text-white text-sm flex items-center gap-1 transition-colors z-10"
        >
          <ChevronRight className="w-4 h-4 rotate-180" />
          {t.back}
        </button>
      </div>
    );
  }

  if (scanError) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-8 text-center">
        <div className="w-20 h-20 rounded-2xl bg-red-500/10 border border-red-400/20 flex items-center justify-center mb-6">
          <AlertCircle className="w-10 h-10 text-red-400" />
        </div>
        <h2 className="text-2xl font-semibold text-slate-900 mb-3">
          {scanErrorType === 'preview' ? t.previewModeNoticeTitle : t.fixFailed}
        </h2>
        <p className="max-w-xl text-sm text-slate-600 leading-6 mb-8">
          {scanErrorType === 'preview' ? previewScanMessage : scanError}
        </p>
        <div className="flex items-center gap-3">
          <RoundCTAButton
            glowColor={MODULE_THEMES.securityScan.accent}
            size="secondary"
            onClick={handleBack}
          >
            {t.back}
          </RoundCTAButton>
          {!useCached && (
            <RoundCTAButton
              glowColor={MODULE_THEMES.securityScan.accent}
              onClick={() => setScanAttempt((value) => value + 1)}
            >
              {t.retry}
            </RoundCTAButton>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <ThreeColumnLayout
        title={categoryTitle || t.scanResults}
        subtitle={subtitle}
        onBack={handleBack}
        accentColor={MODULE_THEMES.securityScan.accent}
        topBarRight={
        <SortDropdown
          value={sortBy}
          options={[
            { value: 'severity', label: t.severity },
            { value: 'platform', label: t.platform },
            { value: 'fixable', label: t.fixable },
          ]}
          onChange={setSortBy}
          accentColor={MODULE_THEMES.securityScan.accent}
        />
      }
      leftColumn={
        <div className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-slate-600 mb-2">{tr('严重程度', 'Severity')}</h3>
            <FilterItem
              label={t.all}
              count={issues.length}
              active={severityFilter === 'all'}
              onClick={() => setSeverityFilter('all')}
            />
            <FilterItem
              label={SEVERITY_COLORS.critical.label}
              count={severityCounts.critical}
              color={SEVERITY_COLORS.critical.dot}
              active={severityFilter === 'critical'}
              onClick={() => setSeverityFilter('critical')}
            />
            <FilterItem
              label={SEVERITY_COLORS.warning.label}
              count={severityCounts.warning}
              color={SEVERITY_COLORS.warning.dot}
              active={severityFilter === 'warning'}
              onClick={() => setSeverityFilter('warning')}
            />
            <FilterItem
              label={SEVERITY_COLORS.info.label}
              count={severityCounts.info}
              color={SEVERITY_COLORS.info.dot}
              active={severityFilter === 'info'}
              onClick={() => setSeverityFilter('info')}
            />
          </div>

          <div className="pt-4 border-t border-slate-200 space-y-1">
            <h3 className="text-sm font-semibold text-slate-600 mb-2">{tr('AI 工具', 'AI Tools')}</h3>
            <FilterItem
              label={t.all}
              count={severityScopedIssues.length}
              active={platformFilter === 'all'}
              onClick={() => setPlatformFilter('all')}
            />
            {orderedPlatforms.map((platform) => (
              <FilterItem
                key={platform}
                label={platformDisplayName(platform)}
                count={severityScopedIssues.filter((issue) => issue.platform === platform).length}
                active={platformFilter === platform}
                onClick={() => setPlatformFilter(platform)}
              />
            ))}
          </div>

        </div>
      }
      middleColumn={
        <div className="p-4 space-y-2">
          {filteredIssues.length === 0 && issues.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <CheckCircle className="w-12 h-12 mb-3 text-green-400" />
              <p className="text-sm font-medium text-green-600">{t.noIssuesFound}</p>
            </div>
          ) : filteredIssues.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <CheckCircle className="w-12 h-12 mb-3 text-green-400" />
              <p className="text-sm">{t.allIssuesFixed}</p>
            </div>
          ) : (
            filteredIssues.map((issue) => (
              <IssueListItem
                key={issue.id}
                issue={issue}
                selected={selectedIssue?.id === issue.id}
                onClick={() => setSelectedIssue(issue)}
              />
            ))
          )}
        </div>
      }
      rightColumn={
        selectedIssue ? (
          <IssueDetail issue={selectedIssue} onFix={handleFixIssue} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            {issues.length === 0 ? (
              <>
                <CheckCircle className="w-16 h-16 mb-4 text-green-400" />
                <p className="text-lg font-medium text-green-600">{t.allIssuesFixed}</p>
                <p className="text-sm mt-2">{t.allFixedCongrats}</p>
              </>
            ) : (
              <p>{t.selectIssueToView}</p>
            )}
          </div>
        )
      }
      bottomBar={
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600">
              {issues.length === 0
                ? t.allFixedScore
                : t.issuesFound.replace('{count}', String(issues.length)).replace('{fixable}', String(fixableCount))
              }
            </span>
            {semanticGuard?.reviewed_issues ? (
              <span className="text-xs text-sky-700 bg-sky-50 px-2 py-1 rounded-full">
                {localizedDynamicText(
                  semanticGuard.message,
                  tr('已完成高级语义研判', 'Semantic review completed'),
                )}
              </span>
            ) : null}
            {fixAllMessage && (
              <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full">
                {fixAllMessage}
              </span>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setScanAttempt((value) => value + 1)}
                className="px-4 py-2 rounded-lg text-xs text-slate-700 bg-slate-100 hover:bg-slate-200"
              >
                {tr('重新扫描', 'Rescan now')}
              </button>
              {fixableCount > 0 ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setFixAllMessage(
                        tr(
                          '已切换为手动模式：请逐项点击问题并手动处理。',
                          'Switched to manual mode: review and handle issues one by one.'
                        )
                      )
                    }
                    className="px-4 py-2 rounded-lg text-xs text-slate-700 bg-slate-100 hover:bg-slate-200"
                  >
                    {tr('逐个查看并手动处理', 'Review manually one by one')}
                  </button>
                  <button
                    type="button"
                    onClick={handleFixAll}
                    disabled={fixAllLoading}
                    className="px-4 py-2 rounded-lg text-xs font-semibold text-[#2B1B00] bg-gradient-to-r from-amber-300 via-yellow-300 to-amber-400 shadow-[0_0_18px_rgba(251,191,36,0.35)] disabled:opacity-60"
                  >
                    {fixAllLoading ? t.fixing : tr('⚡ 一键无损修复全部 (Pro)', '⚡ One-click Fix All (Pro)')}
                  </button>
                </>
              ) : null}
            </div>
            {fixableCount > 0 ? (
              <span className="text-[11px] text-slate-500">
                {tr(
                  '每多等一秒，数据泄露风险就多一分',
                  'Every second you wait, your data is more exposed'
                )}
              </span>
            ) : null}
          </div>
        </div>
        }
      />
    </>
  );
}

// Filter item in left column
interface FilterItemProps {
  label: string;
  count: number;
  color?: string;
  active: boolean;
  onClick: () => void;
}

function FilterItem({ label, count, color, active, onClick }: FilterItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
        active ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'
      )}
    >
      {color && (
        <span
          className="w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      <span className="flex-1 text-left truncate whitespace-nowrap" title={label}>{label}</span>
      <span className={cn(
        'text-xs px-2 py-0.5 rounded-full',
        active ? 'bg-slate-200' : 'bg-slate-100'
      )}>
        {count}
      </span>
    </button>
  );
}

// Issue list item
interface IssueListItemProps {
  issue: SecurityIssue;
  selected: boolean;
  onClick: () => void;
}

function IssueListItem({ issue, selected, onClick }: IssueListItemProps) {
  const SeverityIcon = {
    critical: AlertCircle,
    warning: AlertTriangle,
    info: Info,
  }[issue.severity];

  return (
    <motion.button
      onClick={onClick}
      whileHover={{ x: 2 }}
      className={cn(
        'w-full text-left p-4 rounded-xl border transition-all',
        selected
          ? 'bg-white border-slate-200 shadow-sm'
          : 'bg-slate-50/50 border-transparent hover:bg-white hover:border-slate-200'
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${SEVERITY_COLORS[issue.severity].dot}15` }}
        >
          <SeverityIcon
            className="w-4 h-4"
            style={{ color: SEVERITY_COLORS[issue.severity].dot }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-900 line-clamp-2">
            {issue.title}
          </p>
          <p className="text-xs text-slate-500 mt-1 line-clamp-1">
            {issue.description}
          </p>
          {issue.semanticReview && issue.semanticReview.verdict !== 'clear' && (
            <p className="text-[11px] text-sky-600 mt-1 line-clamp-1">
              {tr('Semantic review', 'Semantic review')}: {issue.semanticReview.summary}
            </p>
          )}
        </div>
        <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
      </div>
    </motion.button>
  );
}

// Issue detail panel
interface IssueDetailProps {
  issue: SecurityIssue;
  onFix: (issue: SecurityIssue) => void;
}

function IssueDetail({ issue, onFix }: IssueDetailProps) {
  const [fixing, setFixing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFix = async () => {
    setFixing(true);
    setError(null);
    try {
      const success = await invoke<boolean>('fix_issue', {
        issueId: issue.id,
        filePath: issue.filePath ?? null,
      });
      if (success) {
        onFix(issue);
      } else {
        setError(t.fixFailedManual);
      }
    } catch (e: any) {
      const message = typeof e === 'string' ? e : e?.message || t.fixFailed;
      setError(localizeRuntimeMessage(message, t.fixFailedManual));
    } finally {
      setFixing(false);
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-start gap-4 mb-6">
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-slate-900 mb-2">
            {issue.title}
          </h2>
          <div className="flex items-center gap-2">
            <SeverityBadge severity={issue.severity} />
            <PlatformBadge platform={issue.platform} size="small" showName={true} />
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-medium text-slate-500 mb-2">{t.issueDescription}</h3>
          <p className="text-sm text-slate-700 leading-relaxed">
            {issue.description}
          </p>
        </div>

        {issue.filePath && (
          <div>
            <h3 className="text-sm font-medium text-slate-500 mb-2">{t.fileLocation}</h3>
            <div className="flex items-center gap-2 bg-slate-50 px-3 py-2.5 rounded-lg">
              <code className="text-xs text-slate-600 flex-1 break-all font-mono">
                {issue.filePath}
              </code>
              <button
                type="button"
                onClick={() => {
                  invoke('reveal_path_in_finder', { path: issue.filePath })
                    .catch(err => console.error('Failed to reveal path:', err));
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-colors flex-shrink-0"
                style={{ backgroundColor: MODULE_THEMES.securityScan.accent }}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                {t.viewFileLocation}
              </button>
            </div>
          </div>
        )}

        {issue.affectedScope && (
          <div>
            <h3 className="text-sm font-medium text-slate-500 mb-2">{t.affectedScope}</h3>
            <p className="text-sm text-slate-700 bg-slate-50 px-3 py-2 rounded-lg">
              {issue.affectedScope}
            </p>
          </div>
        )}

        {issue.semanticReview && (
          <div className="rounded-xl border border-sky-100 bg-sky-50/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium text-sky-900">{tr('高级语义研判', 'Semantic review')}</h3>
              <span className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-sky-700">
                {tr('Confidence', 'Confidence')} {issue.semanticReview.confidence}%
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-sky-900">{issue.semanticReview.summary}</p>
            <p className="mt-2 text-xs text-sky-800/80">
              {tr('Recommended action:', 'Recommended action:')} {issue.semanticReview.recommendedAction}
            </p>
          </div>
        )}

        <div>
          <h3 className="text-sm font-medium text-slate-500 mb-2">{t.fixSuggestion}</h3>
          <p className="text-sm text-slate-700 leading-relaxed">
            {issue.severity === 'critical'
              ? t.fixSuggestionCritical
              : issue.severity === 'warning'
              ? t.fixSuggestionWarning
              : t.fixSuggestionInfo
            }
          </p>
        </div>

        {issue.fixable ? (
          <button
            type="button"
            onClick={handleFix}
            disabled={fixing}
            className={cn(
              'w-full py-3 rounded-xl font-medium transition-all',
              fixing
                ? 'bg-slate-300 text-slate-600 cursor-wait'
                : 'text-white hover:opacity-90'
            )}
            style={!fixing ? { backgroundColor: MODULE_THEMES.securityScan.accent } : undefined}
          >
            {fixing ? t.fixing : t.fixIssue}
          </button>
        ) : (
          <div className="space-y-2">
            {issue.filePath && (
              <button
                type="button"
                onClick={() => {
                  invoke('reveal_path_in_finder', { path: issue.filePath })
                    .catch(err => console.error('Failed to reveal path:', err));
                }}
                className="w-full py-3 rounded-xl font-medium text-white transition-all hover:opacity-90"
                style={{ backgroundColor: MODULE_THEMES.securityScan.accent }}
              >
                {tr('打开配置文件手动修复', 'Open config file for manual fix')}
              </button>
            )}
            <p className="text-xs text-slate-500 text-center">
              {tr(
                '该问题需要手动处理：检查配置文件中的相关条目，移除或修改不安全的配置项。',
                'This issue requires manual handling: review related config entries and remove or modify insecure settings.'
              )}
            </p>
          </div>
        )}

        {error && (
          <div className="mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-xs text-red-600">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
