import { useEffect, useRef, useState } from 'react';
import { tauriInvoke as invoke } from '@/services/tauri';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { AlertTriangle, Shield, Lock, Settings, Puzzle, ShieldCheck, Search } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { MODULE_THEMES } from '@/constants/colors';
import { isEnglishLocale, t } from '@/constants/i18n';
import { GlassmorphicCard, ScanResultCard } from '@/components/glassmorphic-card';
import { RoundCTAButton } from '@/components/round-cta-button';
import { ProUpgradeBanner } from '@/components/pro-upgrade-banner';
import { ScoreGauge } from '@/components/score-gauge';
import { ProtectionStatus } from '@/components/macos-frame';
import { runFullScan, runFullScanWithProgress, cancelScan, type RealScanResult } from '@/services/scanner';
import { getProtectionStatus, listenProtectionStatus, type ProtectionStatus as ProtectionRuntimeStatus } from '@/services/protection';
import { isTauriEnvironment } from '@/services/tauri';
import { mapRustIssue } from '@/components/pages/security-scan';
import { useProGate } from '@/hooks/useProGate';
import type { ScanCardState } from '@/types/domain';
import { createBufferedPhaseVisualizer } from '@/lib/buffered-phase-visualizer';
import { requestRuntimeGuardActionApproval, listenRuntimeGuardApprovals } from '@/services/runtime-guard';
import { containsCjk } from '@/lib/locale-text';

const tr = (zh: string, en: string) => (isEnglishLocale ? en : zh);

const CATEGORY_CARD_MAP: Record<string, string> = {
  mcp_security: 'mcp-security',
  key_security: 'key-security',
  skill_security: 'skill-security',
  env_config: 'env-config',
  system_protection: 'system-protection',
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
    env_config: tr('检查插件配置权限风险', 'Checking MCP/Skill config permissions'),
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

function getDiscoveryPhase() {
  return {
    title: tr('正在检测你的 AI 工具', 'Detecting your AI tools'),
    gradient: { from: '#7C2D12', to: '#F97316' },
  };
}

function getHomeCardTitles(): Record<string, string> {
  return {
    'mcp-security': tr('隐私泄露风险', 'Privacy Leak Risk'),
    'key-security': tr('密码暴露风险', 'Password Exposure Risk'),
    'env-config': tr('权限失控风险', 'Permission Risk'),
    'skill-security': tr('恶意插件风险', 'Malicious Plugin Risk'),
    'system-protection': tr('后台偷跑风险', 'Background Activity Risk'),
  };
}

function getCardTitle(cardId: string, fallback: string) {
  return getHomeCardTitles()[cardId] ?? fallback;
}

function collectFixAllTargets() {
  return Array.from(
    new Set(
      Object.values(useAppStore.getState().lastScanByCategory)
        .flat()
        .filter(issue => issue.fixable)
        .map(issue => issue.filePath?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

interface SmartGuardHomeProps {
  onViewScanDetail?: (cardId: string) => void;
}

export function SmartGuardHome({ onViewScanDetail }: SmartGuardHomeProps) {
  const {
    scanStatus,
    scanProgress,
    scanScore,
    scanCards,
    currentScanningFile,
    startScan,
    stopScan,
    setScanProgress,
    setScanScore,
    setCurrentScanningFile,
    updateScanCard,
    setScanStatus,
    setLastScanByCategory,
  } = useAppStore();
  const { isPro, isTrial } = useProGate();
  const batchFixUnlocked = isPro || isTrial;

  const [protectionStatus, setProtectionStatus] = useState<ProtectionRuntimeStatus | null>(null);
  const [fixAllBusy, setFixAllBusy] = useState(false);
  const [fixAllMessage, setFixAllMessage] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [activePhaseId, setActivePhaseId] = useState<string>('detect_tools');
  const [detectedToolCount, setDetectedToolCount] = useState<number | null>(null);
  const fixAllInFlightRef = useRef(false);
  const previewScanMessage = t.desktopOnlyInBrowserShell.replace('{feature}', t.moduleSecurityScan);
  const failedScanMessage = scanError ?? (
    isTauriEnvironment()
      ? tr('本次安全扫描未能完成，请稍后重试。', 'Security scan did not complete. Please try again.')
      : previewScanMessage
  );

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;

    void getProtectionStatus().then((status) => {
      if (mounted) {
        setProtectionStatus(status);
      }
    });

    void listenProtectionStatus((status) => {
      if (mounted) {
        setProtectionStatus(status);
      }
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  const syncScanningCards = (phaseId: string, completed: boolean) => {
    const activeIndex = SCAN_PHASE_ORDER.indexOf(phaseId as (typeof SCAN_PHASE_ORDER)[number]);
    if (activeIndex < 0) {
      return;
    }

    SCAN_PHASE_ORDER.forEach((phase, index) => {
      const cardId = CATEGORY_CARD_MAP[phase];
      if (index < activeIndex || (completed && index === activeIndex)) {
        updateScanCard(cardId, { status: 'completed' });
        return;
      }

      if (index === activeIndex) {
        updateScanCard(cardId, { status: 'scanning' });
        return;
      }

      updateScanCard(cardId, { status: 'waiting', result: undefined });
    });
  };

  const applyScanResult = (result: RealScanResult) => {
    const mappedCardIds = new Set<string>();
    const byCategory: Record<string, ReturnType<typeof mapRustIssue>[]> = {};

    for (const category of result.categories) {
      const cardId = CATEGORY_CARD_MAP[category.id];
      if (!cardId) {
        continue;
      }

      mappedCardIds.add(cardId);
      updateScanCard(cardId, {
        status: 'completed',
        result: {
          issueCount: category.issue_count,
          canFix: category.issues.some((issue) => issue.auto_fixable),
          message: category.issue_count > 0 ? `${category.issue_count} ${t.warning}` : t.allPassed,
        },
      });
      byCategory[cardId] = category.issues.map(mapRustIssue);
    }

    for (const card of useAppStore.getState().scanCards) {
      if (mappedCardIds.has(card.id)) {
        continue;
      }

      updateScanCard(card.id, {
        status: 'completed',
        result: { issueCount: 0, canFix: false, message: t.allPassed },
      });
    }

    setLastScanByCategory(byCategory);
    useAppStore.setState({
      scanScore: result.score,
      scanProgress: 100,
      currentScanningFile: tr('安全扫描完成', 'Security scan completed'),
      scanStatus: 'completed',
      isExpanded: true,
    });

    void invoke<Array<{ detected?: boolean; has_mcp_config?: boolean; host_detected?: boolean }>>('detect_ai_tools')
      .then((tools) => {
        const count = (Array.isArray(tools) ? tools : []).filter((tool) =>
          Boolean(tool.detected || tool.has_mcp_config || tool.host_detected)
        ).length;
        setDetectedToolCount(count);
      })
      .catch(() => {
        setDetectedToolCount(null);
      });
  };

  useEffect(() => {
    if (scanStatus !== 'scanning') return;
    let cancelled = false;
    let finalizeTimer: number | null = null;
    const scanStartedAt = Date.now();
    const bufferedVisualizer = createBufferedPhaseVisualizer({
      phaseOrder: [...SCAN_PHASE_ORDER],
      initialPhaseId: 'detect_tools',
      minPhaseVisibleMs: MIN_SCAN_PHASE_VISIBLE_MS,
      onApply: (event) => {
        setActivePhaseId(event.phaseId);
        setScanProgress(event.progress);
        setCurrentScanningFile(event.label);
        if (event.phaseId in CATEGORY_CARD_MAP) {
          syncScanningCards(event.phaseId, event.status === 'completed');
        }
      },
    });
    setScanError(null);
    setDetectedToolCount(null);
    setActivePhaseId('detect_tools');
    setCurrentScanningFile(tr('准备开始安全扫描', 'Preparing security scan'));

    if (!isTauriEnvironment()) {
      bufferedVisualizer.dispose();
      setScanProgress(0);
      setCurrentScanningFile('');
      setScanStatus('failed');
      setScanError(previewScanMessage);
      return;
    }

    void runFullScanWithProgress((event) => {
      if (cancelled) {
        return;
      }
      bufferedVisualizer.push({
        phaseId: event.phase_id,
        label: localizeProgressLabel(event.phase_id, event.label),
        progress: event.progress,
        status: event.status,
      });
    }).then((result) => {
      if (cancelled) {
        return;
      }

      if (!result) {
        bufferedVisualizer.dispose();
        setScanProgress(0);
        stopScan();
        setScanStatus('failed');
        setScanError(
          tr(
            '本次安全扫描未能完成，请检查本地权限、文件访问范围或配置文件内容后重试。',
            'Security scan failed. Check local permissions, file access scope, and config files, then retry.'
          )
        );
        return;
      }

      bufferedVisualizer.finalize(() => {
        if (cancelled) {
          return;
        }
        const elapsed = Date.now() - scanStartedAt;
        const waitMs = Math.max(0, MIN_SCAN_TOTAL_MS - elapsed);
        finalizeTimer = window.setTimeout(() => {
          if (cancelled) {
            return;
          }
          applyScanResult(result);
        }, waitMs);
      });
    });

    return () => {
      cancelled = true;
      if (finalizeTimer !== null) {
        window.clearTimeout(finalizeTimer);
      }
      bufferedVisualizer.dispose();
    };
  }, [scanStatus, setCurrentScanningFile, setScanProgress, setScanStatus, stopScan, updateScanCard]);

  const handleStopScan = () => {
    void cancelScan();
    stopScan();
  };

  return (
    <div
      className="relative h-full overflow-y-auto overflow-x-hidden"
      style={{
        background: `linear-gradient(135deg, ${MODULE_THEMES.smartGuard.from} 0%, ${MODULE_THEMES.smartGuard.via} 45%, ${MODULE_THEMES.smartGuard.to} 100%)`,
      }}
    >
      <AnimatePresence mode="wait">
        {scanStatus === 'idle' && (
          <IdleState
            onStartScan={startScan}
            protectionStatus={protectionStatus}
          />
        )}
        {scanStatus === 'scanning' && (
          <ScanningState
            progress={scanProgress}
            currentFile={currentScanningFile}
            cards={scanCards}
            activePhaseId={activePhaseId}
            onStop={handleStopScan}
          />
        )}
        {scanStatus === 'completed' && (
          <CompletedState
            score={scanScore}
            cards={scanCards}
            detectedToolCount={detectedToolCount}
            onViewDetail={onViewScanDetail}
            onStartScan={startScan}
            fixingAll={fixAllBusy}
            fixAllMessage={fixAllMessage}
            onManualFix={() => {
              const firstIssueCard = scanCards.find((card) => (card.result?.issueCount ?? 0) > 0);
              if (firstIssueCard && onViewScanDetail) {
                onViewScanDetail(firstIssueCard.id);
                return;
              }
              useAppStore.getState().setCurrentModule('securityScan');
            }}
            onFixAll={async () => {
              if (!batchFixUnlocked) {
                setFixAllMessage(
                  tr(
                    '此功能需要 Pro。升级后 30 秒修复全部风险。',
                    'This requires Pro. Upgrade to fix all risks in 30 seconds.'
                  )
                );
                return;
              }

              if (fixAllInFlightRef.current || fixAllBusy) {
                return;
              }

              const autoFixableIssues = scanCards.reduce((sum, card) => {
                if (card.result?.canFix) {
                  return sum + (card.result.issueCount ?? 0);
                }
                return sum;
              }, 0);

              if (autoFixableIssues === 0) {
                setFixAllMessage(t.noAutoFixable);
                return;
              }

              fixAllInFlightRef.current = true;
              setFixAllBusy(true);
              setFixAllMessage(null);
              try {
                const fixTargets = collectFixAllTargets();
                if (fixTargets.length === 0) {
                  setFixAllMessage(t.noAutoFixable);
                  return;
                }

                const approval = await requestRuntimeGuardActionApproval({
                  component_id: 'agentshield:scan:auto-fix',
                  component_name: `${t.moduleSecurityScan} ${tr('一键修复', 'Fix All')}`,
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

                // If pending, wait for user to approve in the dialog
                let ticket = approval.approval_ticket;
                if (approval.status === 'pending' && !ticket) {
                  setFixAllMessage(
                    tr('等待确认中...', 'Waiting for approval...')
                  );
                  const requestId = approval.request.id;
                  ticket = await new Promise<string | null>((resolve) => {
                    let unlisten: (() => void) | undefined;
                    const timeout = window.setTimeout(() => {
                      unlisten?.();
                      resolve(null);
                    }, 120_000); // 2 min timeout
                    void listenRuntimeGuardApprovals((event) => {
                      if (event.id === requestId && event.status === 'approved') {
                        window.clearTimeout(timeout);
                        unlisten?.();
                        // Re-request to get the ticket after approval
                        resolve(event.id);
                      } else if (event.id === requestId && event.status === 'denied') {
                        window.clearTimeout(timeout);
                        unlisten?.();
                        resolve(null);
                      }
                    }).then((fn) => { unlisten = fn; });
                  });
                  if (!ticket) {
                    setFixAllMessage(
                      tr('修复已取消。', 'Fix cancelled.')
                    );
                    return;
                  }
                  // Re-request approval — should now be pre-approved
                  const reApproval = await requestRuntimeGuardActionApproval({
                    component_id: 'agentshield:scan:auto-fix',
                    component_name: `${t.moduleSecurityScan} ${tr('一键修复', 'Fix All')}`,
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
                  ticket = reApproval.approval_ticket ?? null;
                }

                if (!ticket) {
                  setFixAllMessage(
                    tr('修复已取消。', 'Fix cancelled.')
                  );
                  return;
                }

                const fixedCount = await invoke<number>('fix_all', {
                  actionTargets: fixTargets,
                  approvalTicket: ticket,
                });
                if (fixedCount === 0) {
                  setFixAllMessage(t.noAutoFixable);
                  return;
                }

                setFixAllMessage(
                  tr(
                    `已修复 ${fixedCount} 个自动修复项，正在后台重新扫描验证`,
                    `Fixed ${fixedCount} auto-fix items. Running background rescan for verification.`
                  )
                );
                const refreshed = await runFullScan();
                if (!refreshed) {
                  setFixAllMessage(
                    tr(
                      '自动修复已完成，但后台复扫未成功，请手动重新扫描确认。',
                      'Auto-fix completed, but background rescan failed. Please run a manual scan to confirm.'
                    )
                  );
                  return;
                }

                applyScanResult(refreshed);
                setFixAllMessage(
                  tr(
                    `已修复 ${fixedCount} 个自动修复项，复扫验证已完成`,
                    `Fixed ${fixedCount} auto-fix items. Rescan verification completed.`
                  )
                );
              } catch (error) {
                setFixAllMessage(String(error));
              } finally {
                fixAllInFlightRef.current = false;
                setFixAllBusy(false);
              }
            }}
          />
        )}
        {scanStatus === 'failed' && (
          <FailedState
            title={failedScanMessage === previewScanMessage ? t.previewModeNoticeTitle : undefined}
            message={failedScanMessage}
            onRetry={() => {
              setScanError(null);
              startScan();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// Idle State
interface IdleStateProps {
  onStartScan: () => void;
  protectionStatus: ProtectionRuntimeStatus | null;
}

function IdleState({ onStartScan, protectionStatus }: IdleStateProps) {
  const [statusHintIndex, setStatusHintIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStatusHintIndex((value) => (value + 1) % 2);
    }, 6000);
    return () => window.clearInterval(timer);
  }, []);

  const protectionDetail = protectionStatus?.last_incident
    ? tr(
      '🛡️ 拦截成功 | 某 AI 插件正在尝试读取你的系统密码库',
      '🛡️ Blocked | An AI plugin attempted to read your system keychain'
    )
    : statusHintIndex === 0
      ? tr(
        '🟢 实时监控中 | 已发现 3 个 AI 工具有外传行为',
        '🟢 Monitoring | 3 AI tools detected with outbound data activity'
      )
      : tr(
        '🛡️ 拦截成功 | 某未知 AI 插件尝试读取你的系统通讯录及密码库',
        '🛡️ Blocked | An unknown AI plugin attempted to access your contacts and password vault'
      );

  return (
    <motion.div
      key="idle"
      initial={false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="relative flex h-full flex-col items-center justify-center px-4"
    >
      {/* Pro Badge */}
      <div className="absolute top-6 right-6">
        <ProUpgradeBanner variant="badge" />
      </div>

      {/* Hero Icon */}
      <motion.div
        initial={false}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.2, type: 'spring' }}
        className="mb-10"
      >
        <div
          className="relative flex h-[280px] w-[280px] items-center justify-center rounded-[36px]"
          style={{
            background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.2) 0%, rgba(14, 165, 233, 0.05) 100%)',
            boxShadow: '0 0 80px rgba(14, 165, 233, 0.3)',
          }}
        >
          <Shield className="h-32 w-32 text-cyan-400" />
          <div className="absolute inset-0 rounded-[36px] animate-pulse-glow" style={{ '--glow-color': 'rgba(14, 165, 233, 0.5)' } as React.CSSProperties} />
        </div>
      </motion.div>

      {/* Welcome Text */}
      <motion.h1
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="mb-4 text-center text-5xl font-bold text-white"
      >
        {t.welcome}
      </motion.h1>
      <motion.p
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="mb-14 max-w-3xl text-center text-xl leading-9 text-white/70"
      >
        {t.welcomeSubtitle}
      </motion.p>
      <motion.p
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45 }}
        className="mb-8 max-w-3xl text-center text-sm leading-6 text-white/40"
      >
        {tr(
          '扫描免费 · 手动修复免费 · 一键修复需要 Pro',
          'Scan free · Manual fix free · One-click fix requires Pro'
        )}
      </motion.p>

      {/* CTA Button */}
      <motion.div
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="mb-10 scale-110"
      >
        <RoundCTAButton
          glowColor="#0EA5E9"
          onClick={onStartScan}
        >
          {t.startScan}
        </RoundCTAButton>
      </motion.div>

      {/* Status Bar */}
      <div className="absolute bottom-6 left-6 right-6">
        <ProtectionStatus
          enabled={Boolean(protectionStatus?.enabled && protectionStatus?.watcher_ready)}
          detail={protectionDetail}
        />
      </div>
    </motion.div>
  );
}

// Scanning State
interface ScanningStateProps {
  progress: number;
  currentFile: string;
  cards: ScanCardState[];
  activePhaseId: string;
  onStop: () => void;
}

function ScanningState({ progress, currentFile, cards, activePhaseId, onStop }: ScanningStateProps) {
  // Find the currently active card
  const activeCardId = CATEGORY_CARD_MAP[activePhaseId];
  const activeCardIndex = cards.findIndex((card) => card.id === activeCardId);
  const activeCard = activeCardIndex >= 0 ? cards[activeCardIndex] : null;
  const isDiscovery = activePhaseId === 'detect_tools';

  const discoveryPhase = getDiscoveryPhase();
  const mainTitle = isDiscovery
    ? discoveryPhase.title
    : activeCard ? getCardTitle(activeCard.id, activeCard.name) : t.scanning;
  const mainGradient = isDiscovery ? discoveryPhase.gradient : (activeCard?.gradient ?? cards[0].gradient);

  // Remaining cards (exclude the active one)
  const smallCards = cards.filter((_, i) => i !== activeCardIndex);

  return (
    <motion.div
      key="scanning"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex h-full flex-col overflow-hidden p-4 pb-3"
    >
      {/* Title */}
      <div className="text-center mb-3">
        <h2 className="text-lg font-medium text-white/80">{t.smartGuard}</h2>
      </div>

      {/* Cards Grid */}
      <div className="flex-1 min-h-0 grid grid-cols-3 grid-rows-2 gap-3 max-w-6xl mx-auto w-full">
        {/* Large Main Card - shows the currently scanning phase */}
        <div className="col-span-2 row-span-2">
          <GlassmorphicCard
            gradient={mainGradient}
            size="large"
            className="h-full"
          >
            <div className="flex flex-col items-center justify-center h-full">
              <motion.h3
                key={mainTitle}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-2xl font-bold text-white mb-6"
              >
                {t.scanning} {mainTitle}
              </motion.h3>

              {/* Show the active card's icon, larger */}
              <motion.div
                key={activeCard?.id ?? 'discovery'}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
                className="mb-6"
              >
                {activeCard ? (
                  <div className="w-24 h-24 rounded-2xl bg-white/10 flex items-center justify-center relative">
                    <CardIcon cardId={activeCard.id} />
                    {/* Spinning ring around the icon */}
                    <div className="absolute inset-0 rounded-2xl border-2 border-white/10" />
                    <motion.div
                      className="absolute inset-0 rounded-2xl border-2 border-t-white/50 border-r-transparent border-b-transparent border-l-transparent"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                    />
                  </div>
                ) : (
                  <div className="relative w-24 h-24">
                    <div className="absolute inset-0 rounded-full border-4 border-white/10" />
                    <motion.div
                      className="absolute inset-0 rounded-full border-4 border-t-white/60 border-r-transparent border-b-transparent border-l-transparent"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    />
                    <div className="absolute inset-4 rounded-full bg-white/10 flex items-center justify-center">
                      <ShieldCheck className="w-10 h-10 text-white/60" />
                    </div>
                  </div>
                )}
              </motion.div>

              {/* Current file */}
              <motion.p
                key={currentFile}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-sm text-white/50 text-center max-w-md truncate"
              >
                {currentFile}
              </motion.p>
            </div>
          </GlassmorphicCard>
        </div>

        {/* Small Cards - the 4 remaining phases */}
        {smallCards.slice(0, 2).map((card) => (
          <ScanResultCard
            key={card.id}
            title={getCardTitle(card.id, card.name)}
            gradient={card.gradient}
            status={card.status}
            result={card.result}
            icon={<CardIcon cardId={card.id} />}
          />
        ))}

        {smallCards.slice(2, 4).map((card) => (
          <ScanResultCard
            key={card.id}
            title={getCardTitle(card.id, card.name)}
            gradient={card.gradient}
            status={card.status}
            result={card.result}
            icon={<CardIcon cardId={card.id} />}
          />
        ))}
      </div>

      {/* Progress Bar */}
      <div className="mt-3 max-w-2xl mx-auto w-full">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm text-white/60">{t.scanningFiles}</span>
          <span className="text-sm text-white/60">{Math.round(progress)}%</span>
        </div>
        <div className="h-1 bg-white/10 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-cyan-400 to-blue-500"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Stop Button */}
      <div className="flex justify-center mt-3">
        <RoundCTAButton
          glowColor="#F43F5E"
          onClick={onStop}
        >
          {t.stop}
        </RoundCTAButton>
      </div>
    </motion.div>
  );
}

interface FailedStateProps {
  title?: string;
  message: string;
  onRetry: () => void;
}

function FailedState({ title, message, onRetry }: FailedStateProps) {
  return (
    <motion.div
      key="failed"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex h-full flex-col items-center justify-center px-4"
    >
      <div className="w-[220px] h-[220px] rounded-3xl flex items-center justify-center mb-8 bg-red-500/10 border border-red-400/20 shadow-[0_0_60px_rgba(248,113,113,0.15)]">
        <AlertTriangle className="w-24 h-24 text-red-300" />
      </div>
      <h2 className="text-3xl font-bold text-white mb-3">{title ?? t.fixFailed}</h2>
      <p className="max-w-xl text-center text-white/70 text-sm leading-6 mb-8">{message}</p>
      <RoundCTAButton glowColor="#F97316" onClick={onRetry}>
        {t.retry}
      </RoundCTAButton>
    </motion.div>
  );
}

// Completed State
interface CompletedStateProps {
  score: number;
  cards: ScanCardState[];
  detectedToolCount: number | null;
  onViewDetail?: (cardId: string) => void;
  onStartScan: () => void;
  fixingAll: boolean;
  fixAllMessage: string | null;
  onManualFix: () => void;
  onFixAll: () => void;
}

function CompletedState({
  score,
  cards,
  detectedToolCount,
  onViewDetail,
  onStartScan,
  fixingAll,
  fixAllMessage,
  onManualFix,
  onFixAll,
}: CompletedStateProps) {
  const totalIssues = cards.reduce((sum, c) => sum + (c.result?.issueCount ?? 0), 0);

  return (
    <motion.div
      key="completed"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex h-full flex-col overflow-hidden px-4 py-3"
      style={{
        boxShadow: 'inset 0 0 100px rgba(16, 185, 129, 0.1)',
      }}
    >
      {/* Score + Title */}
      <div className="flex flex-col items-center gap-1 shrink-0">
        <ScoreGauge score={score} size="small" />
        <motion.h2
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl font-bold text-white"
        >
          {t.scanComplete}
        </motion.h2>
        {detectedToolCount !== null && (
          <p className="text-xs text-white/60">
            {tr(
              `发现你电脑上有 ${detectedToolCount} 个 AI 工具正在运行`,
              `Found ${detectedToolCount} AI tools running on your computer`
            )}
          </p>
        )}
      </div>

      {/* Result Cards Grid — fills available space */}
      <div className="flex-1 min-h-0 mx-auto mt-3 grid w-full max-w-6xl grid-cols-3 grid-rows-2 gap-3">
        {/* First row: 3 cards */}
        {cards.slice(0, 3).map((card) => (
          <ScanResultCard
            key={card.id}
            title={getCardTitle(card.id, card.name)}
            gradient={card.gradient}
            status="completed"
            result={card.result}
            icon={<CardIcon cardId={card.id} />}
            onViewClick={onViewDetail ? () => onViewDetail(card.id) : undefined}
          />
        ))}

        {/* Second row: 2 cards spanning full width */}
        <div className="col-span-3 grid grid-cols-2 gap-3">
          {cards.slice(3, 5).map((card) => (
            <ScanResultCard
              key={card.id}
              title={getCardTitle(card.id, card.name)}
              gradient={card.gradient}
              status="completed"
              result={card.result}
              icon={<CardIcon cardId={card.id} />}
              onViewClick={onViewDetail ? () => onViewDetail(card.id) : undefined}
            />
          ))}
        </div>
      </div>

      {/* Bottom action area — fixed at bottom */}
      <div className="shrink-0 mt-3 flex flex-col items-center gap-1.5">
        <span className="text-sm text-white/70">
          {totalIssues > 0
            ? t.issuesFound.replace('{count}', String(totalIssues)).replace('{fixable}', String(totalIssues))
            : <span className="text-green-400">{t.noIssuesFound}</span>
          }
        </span>

        {fixAllMessage && (
          <div className="text-center text-sm text-white/60">
            {fixAllMessage}
          </div>
        )}

        {totalIssues > 0 ? (
          <>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onManualFix}
                className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white/80 text-sm"
              >
                {tr('查看手动修复步骤（免费）', 'Manual Fix Steps (free)')}
              </button>
              <button
                type="button"
                onClick={onFixAll}
                disabled={fixingAll}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-[#2B1B00] bg-gradient-to-r from-amber-300 via-yellow-300 to-amber-400 shadow-[0_0_24px_rgba(251,191,36,0.45)] disabled:opacity-60"
              >
                {fixingAll ? t.fixing : tr('⚡ 一键无损修复全部风险', '⚡ Fix All Risks')}
              </button>
            </div>
            <span className="text-xs text-white/50">
              {tr(
                '每多等一秒，数据泄露风险就多一分',
                'Every second you wait, your data is more exposed'
              )}
            </span>
          </>
        ) : (
          <RoundCTAButton
            glowColor="#0EA5E9"
            onClick={onStartScan}
          >
            {t.startScan}
          </RoundCTAButton>
        )}
      </div>
    </motion.div>
  );
}

// Helper component for card icons
function CardIcon({ cardId }: { cardId: string }) {
  const iconMap: Record<string, React.ReactNode> = {
    'mcp-security': <Search className="w-12 h-12 text-white/60" />,
    'key-security': <Lock className="w-12 h-12 text-white/60" />,
    'env-config': <Settings className="w-12 h-12 text-white/60" />,
    'skill-security': <Puzzle className="w-12 h-12 text-white/60" />,
    'system-protection': <ShieldCheck className="w-12 h-12 text-white/60" />,
  };

  return (
    <div className="w-20 h-20 rounded-2xl bg-white/10 flex items-center justify-center">
      {iconMap[cardId] || <Shield className="w-12 h-12 text-white/60" />}
    </div>
  );
}
