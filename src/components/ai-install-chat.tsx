import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Loader2,
  Sparkles,
  Crown,
  Clock,
  Zap,
  Check,
  Play,
  RefreshCw,
  Globe,
  Monitor,
  Cpu,
  Download,
} from 'lucide-react';
import { isEnglishLocale } from '@/constants/i18n';
import { useAppStore } from '@/stores/appStore';
import {
  detectEnvAndRegion,
  autoInstallPrerequisite,
  executeInstallStep,
  type EnvDetectionResult,
} from '@/services/ai-orchestrator';
import {
  requestRuntimeGuardActionApproval,
  listenRuntimeGuardApprovals,
  type RuntimeApprovalRequest,
} from '@/services/runtime-guard';
import { detectAiTools, type DetectedTool } from '@/services/scanner';

const tr = (zh: string, en: string) => (isEnglishLocale ? en : zh);

type SetupPhase = 'detecting' | 'detected' | 'installing' | 'done' | 'error';

interface DetectedItem {
  key: string;
  label: string;
  value: string | null;
  ok: boolean;
}

interface InstallStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  message?: string;
}

const STEP_LABELS: Record<string, string> = {
  auto_install_node: tr('安装 Node.js', 'Install Node.js'),
  auto_install_git: tr('安装 Git', 'Install Git'),
  install_openclaw: tr('安装 OpenClaw', 'Install OpenClaw'),
  run_onboard: tr('初始化 OpenClaw', 'Initialize OpenClaw'),
  setup_mcp: tr('配置 MCP', 'Configure MCP'),
  harden_permissions: tr('加固权限', 'Harden Permissions'),
  verify_install: tr('验证安装', 'Verify Installation'),
};

const PAID_STEPS = new Set([
  'install_openclaw',
  'run_onboard',
  'setup_mcp',
  'harden_permissions',
  'configure_channel',
]);

function buildDetectedItems(env: EnvDetectionResult): DetectedItem[] {
  const osLabel = `${env.os} ${env.arch}`;
  const regionLabel =
    env.region === 'cn'
      ? tr('中国 → 将使用国内源', 'China → will use domestic registry')
      : tr('全球', 'Global');

  return [
    { key: 'os', label: tr('系统', 'System'), value: osLabel, ok: true },
    { key: 'region', label: tr('网络', 'Network'), value: regionLabel, ok: true },
    {
      key: 'node',
      label: 'Node.js',
      value: env.node_version ?? tr('未安装', 'Not installed'),
      ok: !!env.node_version,
    },
    {
      key: 'npm',
      label: 'npm',
      value: env.npm_version ?? tr('未安装', 'Not installed'),
      ok: !!env.npm_version,
    },
    {
      key: 'git',
      label: 'Git',
      value: env.git_version ?? tr('未安装', 'Not installed'),
      ok: !!env.git_version,
    },
    {
      key: 'openclaw',
      label: 'OpenClaw',
      value: env.openclaw_version ?? tr('未安装', 'Not installed'),
      ok: !!env.openclaw_version,
    },
  ];
}

function buildInstallSteps(env: EnvDetectionResult): InstallStep[] {
  const steps: InstallStep[] = [];

  // Node.js is now installed via .pkg on macOS — no Homebrew step needed.

  if (!env.node_version) {
    steps.push({
      id: 'auto_install_node',
      label: STEP_LABELS['auto_install_node'],
      status: 'pending',
    });
  }

  if (!env.git_version) {
    steps.push({
      id: 'auto_install_git',
      label: STEP_LABELS['auto_install_git'],
      status: 'pending',
    });
  }

  steps.push(
    { id: 'install_openclaw', label: STEP_LABELS['install_openclaw'], status: 'pending' },
    { id: 'run_onboard', label: STEP_LABELS['run_onboard'], status: 'pending' },
    { id: 'setup_mcp', label: STEP_LABELS['setup_mcp'], status: 'pending' },
    { id: 'harden_permissions', label: STEP_LABELS['harden_permissions'], status: 'pending' },
    { id: 'verify_install', label: STEP_LABELS['verify_install'], status: 'pending' },
  );

  return steps;
}

function DetectionIcon({ itemKey }: { itemKey: string }) {
  switch (itemKey) {
    case 'os':
      return <Monitor className="w-4 h-4 text-white/50" />;
    case 'region':
      return <Globe className="w-4 h-4 text-white/50" />;
    case 'node':
    case 'npm':
    case 'git':
      return <Cpu className="w-4 h-4 text-white/50" />;
    case 'openclaw':
      return <Download className="w-4 h-4 text-white/50" />;
    default:
      return <Cpu className="w-4 h-4 text-white/50" />;
  }
}

/**
 * Wait for a specific approval request to be resolved (approved or denied).
 * Listens for Tauri runtime-guard-approval events and resolves once the
 * matching request ID transitions out of 'pending' status.
 * Times out after 120 seconds.
 */
function waitForApprovalResolution(requestId: string): Promise<'approved' | 'denied' | 'timeout'> {
  return new Promise((resolve) => {
    let settled = false;
    let unlistenFn: (() => void) | undefined;

    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        unlistenFn?.();
        resolve('timeout');
      }
    }, 120_000);

    listenRuntimeGuardApprovals((approval: RuntimeApprovalRequest) => {
      if (settled) return;
      if (approval.id === requestId && approval.status !== 'pending') {
        settled = true;
        window.clearTimeout(timer);
        unlistenFn?.();
        resolve(approval.status === 'approved' ? 'approved' : 'denied');
      }
    }).then((fn) => {
      unlistenFn = fn;
      if (settled) fn();
    });
  });
}

function buildApprovalRequestForStep(
  stepId: string,
  detectedPlatforms: DetectedTool[],
) {
  const base = {
    component_name: 'OpenClaw',
    platform_id: 'agentshield',
    platform_name: 'AgentShield',
    is_destructive: false,
    is_batch: false,
  };

  if (stepId === 'install_openclaw') {
    return {
      ...base,
      request_kind: 'shell_exec',
      trigger_event: 'openclaw_setup_install_request',
      action_kind: 'shell_exec',
      action_source: 'user_requested_setup_install',
      action_targets: ['npm install -g openclaw@latest'],
      action_preview: [
        tr('将通过 npm 在本机真实安装 OpenClaw', 'Will install OpenClaw locally through npm'),
        tr('命令: npm install -g openclaw@latest', 'Command: npm install -g openclaw@latest'),
        tr('放行后会真实执行命令，不是模拟进度', 'Approval will execute a real command, not simulated progress'),
      ],
      sensitive_capabilities: [
        tr('命令执行', 'Shell command execution'),
        tr('读写本地文件', 'Read and write local files'),
        tr('联网下载依赖', 'Download dependencies from network'),
      ],
    };
  }

  if (stepId === 'run_onboard') {
    return {
      ...base,
      request_kind: 'shell_exec',
      trigger_event: 'openclaw_setup_onboard_request',
      action_kind: 'shell_exec',
      action_source: 'user_requested_setup_onboard',
      action_targets: ['openclaw onboard --install-daemon'],
      action_preview: [
        tr('将执行 OpenClaw 初始化命令', 'Will run the OpenClaw onboarding command'),
        tr('命令: openclaw onboard --install-daemon', 'Command: openclaw onboard --install-daemon'),
        tr('放行后会真实执行命令，不是模拟进度', 'Approval will execute a real command, not simulated progress'),
      ],
      sensitive_capabilities: [
        tr('命令执行', 'Shell command execution'),
        tr('读写本地文件', 'Read and write local files'),
      ],
    };
  }

  if (stepId === 'setup_mcp') {
    const platformIds = detectedPlatforms
      .filter((t) => t.install_target_ready)
      .map((t) => t.id);
    const platformNames = detectedPlatforms
      .filter((t) => t.install_target_ready)
      .map((t) => t.name);
    return {
      ...base,
      request_kind: 'file_modify',
      trigger_event: 'openclaw_setup_mcp_request',
      action_kind: 'file_modify',
      action_source: 'user_requested_setup_mcp',
      action_targets: platformIds.map((id) => `platform:${id}`).sort(),
      action_preview: [
        tr('将把 OpenClaw MCP 写入已选宿主配置', 'Will write OpenClaw MCP into selected host configs'),
        tr(`目标宿主: ${platformNames.join(', ')}`, `Target hosts: ${platformNames.join(', ')}`),
        tr('放行后会真实改写配置文件', 'Approval will modify real config files'),
      ],
      sensitive_capabilities: [tr('读写本地文件', 'Read and write local files')],
      is_batch: true,
    };
  }

  if (stepId === 'harden_permissions') {
    return {
      ...base,
      request_kind: 'file_modify',
      trigger_event: 'openclaw_setup_harden_request',
      action_kind: 'file_modify',
      action_source: 'user_requested_setup_permissions',
      action_targets: ['openclaw-config-permissions'],
      action_preview: [
        tr('将收紧 OpenClaw 配置文件权限', 'Will harden OpenClaw config file permissions'),
        tr('仅影响 OpenClaw 配置目录', 'Only affects OpenClaw configuration directories'),
      ],
      sensitive_capabilities: [tr('读写本地文件', 'Read and write local files')],
      is_batch: true,
    };
  }

  if (stepId === 'configure_channel') {
    return {
      ...base,
      request_kind: 'file_modify',
      trigger_event: 'openclaw_setup_channel_request',
      action_kind: 'file_modify',
      action_source: 'user_requested_setup_channel',
      action_targets: ['channel:default'],
      action_preview: [
        tr('将写入通知渠道配置', 'Will write channel configuration'),
        tr('配置仅落地到 OpenClaw 本机目录', 'Configuration will only be written to local OpenClaw directory'),
      ],
      sensitive_capabilities: [tr('读写本地文件', 'Read and write local files')],
    };
  }

  return null;
}

interface AiInstallChatProps {
  onClose: () => void;
  isPro: boolean;
}

function TrialQueueCard({ onClose }: { onClose: () => void }) {
  const setCurrentModule = useAppStore((state) => state.setCurrentModule);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="rounded-2xl border border-white/10 backdrop-blur-xl overflow-hidden"
      style={{
        background:
          'linear-gradient(135deg, rgba(20, 184, 166, 0.08) 0%, rgba(4, 47, 46, 0.3) 100%)',
        boxShadow:
          '0 8px 32px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(20, 184, 166, 0.1)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-teal-500/20 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-teal-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">
              {tr('AI 安装助手', 'AI Install Assistant')}
            </h3>
            <p className="text-[11px] text-white/40">MiniMax M2.7 · Pro</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Queue Card Body */}
      <div className="px-5 py-8 flex flex-col items-center text-center space-y-5">
        {/* Animated queue icon */}
        <motion.div
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="w-16 h-16 rounded-2xl bg-amber-500/15 border border-amber-400/20 flex items-center justify-center"
        >
          <Clock className="w-8 h-8 text-amber-400" />
        </motion.div>

        {/* Queue status */}
        <div className="space-y-2">
          <h4 className="text-base font-semibold text-white">
            {tr('AI 助手 · 繁忙中', 'AI Assistant · High Demand')}
          </h4>
          <p className="text-sm text-white/50 max-w-[280px] leading-relaxed">
            {tr(
              '当前使用人数较多，AI 助手暂时不可用。升级 Pro 会员可免排队，立即使用。',
              'High usage right now. Upgrade to Pro to skip the queue and get instant access.',
            )}
          </p>
        </div>

        {/* Estimated wait */}
        <div className="flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-4 py-2.5">
          <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
          <span className="text-sm text-white/60">
            {tr('当前排队人数较多', 'Queue is currently full')}
          </span>
        </div>

        {/* Upgrade button */}
        <button
          type="button"
          onClick={() => setCurrentModule('upgradePro')}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500/90 to-amber-600/90 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-amber-500/20 hover:shadow-amber-500/30 hover:from-amber-500 hover:to-amber-600 transition-all"
        >
          <Crown className="w-4 h-4" />
          {tr('升级 Pro · 立即使用', 'Upgrade to Pro · Use Now')}
        </button>

        {/* Pro benefits */}
        <div className="flex flex-wrap justify-center gap-3 text-xs text-white/40">
          <span className="flex items-center gap-1">
            <Zap className="w-3 h-3 text-teal-400" />
            {tr('免排队', 'No queue')}
          </span>
          <span className="flex items-center gap-1">
            <Zap className="w-3 h-3 text-teal-400" />
            {tr('无限对话', 'Unlimited chats')}
          </span>
          <span className="flex items-center gap-1">
            <Zap className="w-3 h-3 text-teal-400" />
            {tr('优先模型', 'Priority model')}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

function AutoInstallPanel({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<SetupPhase>('detecting');
  const [env, setEnv] = useState<EnvDetectionResult | null>(null);
  const [detectedItems, setDetectedItems] = useState<DetectedItem[]>([]);
  const [steps, setSteps] = useState<InstallStep[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [detectedPlatforms, setDetectedPlatforms] = useState<DetectedTool[]>([]);
  const [approvalMessage, setApprovalMessage] = useState<string | null>(null);
  const [retryTrigger, setRetryTrigger] = useState(0);

  const detect = useCallback(async () => {
    setPhase('detecting');
    setErrorMsg('');
    try {
      const [result, tools] = await Promise.all([
        detectEnvAndRegion(),
        detectAiTools(),
      ]);
      setEnv(result);
      setDetectedPlatforms(tools);
      setDetectedItems(buildDetectedItems(result));
      setSteps(buildInstallSteps(result));
      setPhase('detected');
    } catch (err) {
      setErrorMsg(tr(
        `操作失败，请重试。详细信息：${String(err)}`,
        `Operation failed, please retry. Details: ${String(err)}`
      ));
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    void detect();
  }, [detect]);

  const hasMissing = detectedItems.some((d) => !d.ok);

  const updateStep = (id: string, patch: Partial<InstallStep>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const obtainApprovalTicket = useCallback(async (
    stepId: string,
    actionLabel: string,
  ): Promise<{ ticket: string } | { cancelled: true; reason: string }> => {
    const approvalInput = buildApprovalRequestForStep(stepId, detectedPlatforms);
    if (!approvalInput) {
      return { cancelled: true, reason: tr('无法构建审批请求', 'Unable to build approval request') };
    }

    const approval = await requestRuntimeGuardActionApproval(approvalInput);

    if (approval.status === 'approved' && approval.approval_ticket) {
      return { ticket: approval.approval_ticket };
    }

    // Approval is pending — wait for user to approve/deny in the modal
    setApprovalMessage(
      tr(
        `请在弹出的审批窗口中确认${actionLabel}操作，等待你点头...`,
        `Please confirm the ${actionLabel} action in the approval dialog. Waiting for your approval...`,
      ),
    );

    const decision = await waitForApprovalResolution(approval.request.id);
    setApprovalMessage(null);

    if (decision !== 'approved') {
      return {
        cancelled: true,
        reason: decision === 'timeout'
          ? tr('审批等待超时，请重新操作。', 'Approval timed out. Please try again.')
          : tr('你已拒绝此操作。', 'You denied this action.'),
      };
    }

    // Grant has been stored — re-request to consume it and get the ticket
    const retry = await requestRuntimeGuardActionApproval(approvalInput);
    if (retry.status === 'approved' && retry.approval_ticket) {
      return { ticket: retry.approval_ticket };
    }

    return { cancelled: true, reason: tr('审批已通过但未能获取执行票据，请重试。', 'Approval succeeded but failed to obtain execution ticket. Please retry.') };
  }, [detectedPlatforms]);

  const runInstall = useCallback(async () => {
    if (!env) return;
    setPhase('installing');
    setErrorMsg('');

    for (const step of steps) {
      if (step.status === 'done') continue;
      updateStep(step.id, { status: 'running' });

      try {
        let result;

        // For paid steps, obtain an approval ticket first
        let approvalTicket: string | undefined;
        if (PAID_STEPS.has(step.id)) {
          const approvalResult = await obtainApprovalTicket(
            step.id,
            STEP_LABELS[step.id] ?? step.id,
          );
          if ('cancelled' in approvalResult) {
            updateStep(step.id, { status: 'failed', message: approvalResult.reason });
            setPhase('error');
            setErrorMsg(approvalResult.reason);
            return;
          }
          approvalTicket = approvalResult.ticket;
        }

        if (step.id === 'auto_install_node') {
          result = await autoInstallPrerequisite('node', env.region);
        } else if (step.id === 'auto_install_git') {
          result = await autoInstallPrerequisite('git', env.region);
        } else if (step.id === 'install_openclaw') {
          result = await executeInstallStep('install_openclaw', {
            registry: env.recommended_registry ?? undefined,
            approvalTicket,
          });
        } else if (step.id === 'setup_mcp') {
          const platformIds = detectedPlatforms
            .filter((t) => t.install_target_ready)
            .map((t) => t.id);
          result = await executeInstallStep('setup_mcp', {
            platformIds: platformIds.length > 0 ? platformIds : undefined,
            approvalTicket,
          });
        } else {
          result = await executeInstallStep(step.id, { approvalTicket });
        }

        if (result.success) {
          updateStep(step.id, { status: 'done', message: result.message });
        } else {
          updateStep(step.id, {
            status: 'failed',
            message: result.error ?? result.message,
          });
          setErrorMsg(result.error ?? result.message);
          setPhase('error');
          return;
        }
      } catch (err) {
        const friendlyMsg = tr(
          `操作失败，请重试。详细信息：${String(err)}`,
          `Operation failed, please retry. Details: ${String(err)}`
        );
        updateStep(step.id, { status: 'failed', message: friendlyMsg });
        setErrorMsg(friendlyMsg);
        setPhase('error');
        return;
      }
    }

    setPhase('done');
  }, [env, steps, obtainApprovalTicket, detectedPlatforms]);

  const retryFromFailed = useCallback(() => {
    setSteps((prev) =>
      prev.map((s) => (s.status === 'failed' ? { ...s, status: 'pending' as const, message: undefined } : s)),
    );
    setRetryTrigger((n) => n + 1);
  }, []);

  // Trigger install after retry state has been flushed
  useEffect(() => {
    if (retryTrigger > 0 && phase === 'error') {
      void runInstall();
    }
  }, [phase, retryTrigger, runInstall]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="rounded-2xl border border-white/10 backdrop-blur-xl overflow-hidden"
      style={{
        background:
          'linear-gradient(135deg, rgba(20, 184, 166, 0.08) 0%, rgba(4, 47, 46, 0.3) 100%)',
        boxShadow:
          '0 8px 32px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(20, 184, 166, 0.1)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-teal-500/20 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-teal-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">
              {tr('AI 安装助手', 'AI Install Assistant')}
            </h3>
            <p className="text-[11px] text-white/40">
              {tr('自动安装模式', 'Auto-install Mode')}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="px-4 py-4 space-y-4 max-h-[480px] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
        {/* Detecting spinner */}
        {phase === 'detecting' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center py-8 gap-3"
          >
            <Loader2 className="w-8 h-8 text-teal-400 animate-spin" />
            <p className="text-sm text-white/60">
              {tr('正在检测环境...', 'Detecting environment...')}
            </p>
          </motion.div>
        )}

        {/* Detection results */}
        {(phase === 'detected' || phase === 'installing' || phase === 'done') && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-white/40 uppercase tracking-wider">
              {tr('环境检测', 'Environment Detection')}
            </h4>
            <div className="space-y-1.5">
              <AnimatePresence>
                {detectedItems.map((item, i) => (
                  <motion.div
                    key={item.key}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="flex items-center gap-3 rounded-lg bg-white/5 border border-white/5 px-3 py-2"
                  >
                    <DetectionIcon itemKey={item.key} />
                    <span className="text-sm text-white/70 w-20 shrink-0">{item.label}</span>
                    <span className="text-sm text-white/90 flex-1 truncate">{item.value}</span>
                    {item.ok ? (
                      <Check className="w-4 h-4 text-teal-400 shrink-0" />
                    ) : (
                      <X className="w-4 h-4 text-red-400 shrink-0" />
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* Action button for detected phase */}
        {phase === 'detected' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pt-2">
            {hasMissing && (
              <p className="text-xs text-amber-400/80 mb-3">
                {tr(
                  '缺少部分依赖，点击下方按钮将自动安装。',
                  'Some dependencies are missing. Click below to auto-install.',
                )}
              </p>
            )}
            <button
              onClick={() => void runInstall()}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-teal-500/20 border border-teal-500/20 px-4 py-3 text-sm font-semibold text-teal-300 hover:bg-teal-500/30 transition-colors"
            >
              <Play className="w-4 h-4" />
              {hasMissing
                ? tr('开始自动安装', 'Start Auto-install')
                : tr('开始配置 OpenClaw', 'Start Configuring OpenClaw')}
            </button>
          </motion.div>
        )}

        {/* Approval waiting banner */}
        {approvalMessage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 flex items-center gap-2"
          >
            <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
            <p className="text-xs text-amber-300">{approvalMessage}</p>
          </motion.div>
        )}

        {/* Installation steps */}
        {(phase === 'installing' || phase === 'done' || phase === 'error') && steps.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-white/40 uppercase tracking-wider">
              {tr('安装步骤', 'Installation Steps')}
            </h4>
            <div className="space-y-1.5">
              {steps.map((step) => (
                <motion.div
                  key={step.id}
                  initial={{ opacity: 0.6 }}
                  animate={{ opacity: 1 }}
                  className="flex items-start gap-3 rounded-lg bg-white/5 border border-white/5 px-3 py-2"
                >
                  <div className="mt-0.5 shrink-0">
                    {step.status === 'pending' && (
                      <div className="w-4 h-4 rounded-full border border-white/20" />
                    )}
                    {step.status === 'running' && (
                      <Loader2 className="w-4 h-4 text-teal-400 animate-spin" />
                    )}
                    {step.status === 'done' && (
                      <Check className="w-4 h-4 text-teal-400" />
                    )}
                    {step.status === 'failed' && (
                      <X className="w-4 h-4 text-red-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-white/90">{step.label}</span>
                    {step.message && (
                      <p className="text-xs text-white/40 mt-0.5 truncate">{step.message}</p>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Done state */}
        {phase === 'done' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center py-4 gap-2"
          >
            <div className="w-12 h-12 rounded-full bg-teal-500/20 flex items-center justify-center">
              <Check className="w-6 h-6 text-teal-400" />
            </div>
            <p className="text-sm font-semibold text-white">
              {tr('安装完成!', 'Installation Complete!')}
            </p>
            <p className="text-xs text-white/50">
              {tr('OpenClaw 已就绪。', 'OpenClaw is ready.')}
            </p>
          </motion.div>
        )}

        {/* Error state */}
        {phase === 'error' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-3"
          >
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
              <p className="text-xs text-red-300 break-words">{errorMsg}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void detect()}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white/70 hover:bg-white/10 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {tr('重新检测', 'Re-detect')}
              </button>
              <button
                onClick={retryFromFailed}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-teal-500/20 border border-teal-500/20 px-4 py-2.5 text-sm text-teal-300 hover:bg-teal-500/30 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {tr('重试', 'Retry')}
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

export function AiInstallChat({ onClose, isPro }: AiInstallChatProps) {
  if (!isPro) {
    return <TrialQueueCard onClose={onClose} />;
  }

  return <AutoInstallPanel onClose={onClose} />;
}
