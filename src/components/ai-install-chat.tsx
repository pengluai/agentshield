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
  auto_install_brew: tr('安装 Homebrew', 'Install Homebrew'),
  auto_install_node: tr('安装 Node.js', 'Install Node.js'),
  auto_install_git: tr('安装 Git', 'Install Git'),
  install_openclaw: tr('安装 OpenClaw', 'Install OpenClaw'),
  run_onboard: tr('初始化 OpenClaw', 'Initialize OpenClaw'),
  setup_mcp: tr('配置 MCP', 'Configure MCP'),
  harden_permissions: tr('加固权限', 'Harden Permissions'),
  verify_install: tr('验证安装', 'Verify Installation'),
};

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

  // macOS prerequisite: Homebrew
  if (env.os.toLowerCase().includes('mac') && !env.node_version) {
    steps.push({
      id: 'auto_install_brew',
      label: STEP_LABELS['auto_install_brew'],
      status: 'pending',
    });
  }

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
            {tr('AI 助手 · 排队中', 'AI Assistant · Queued')}
          </h4>
          <p className="text-sm text-white/50 max-w-[280px] leading-relaxed">
            {tr(
              '试用期间，AI 助手处于排队模式。升级 Pro 会员可立即使用，享受优先通道。',
              'During trial, AI assistant is in queue mode. Upgrade to Pro for instant priority access.',
            )}
          </p>
        </div>

        {/* Estimated wait */}
        <div className="flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-4 py-2.5">
          <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
          <span className="text-sm text-white/60">
            {tr('预计等待：约 2-3 小时', 'Estimated wait: ~2-3 hours')}
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

  const detect = useCallback(async () => {
    setPhase('detecting');
    setErrorMsg('');
    try {
      const result = await detectEnvAndRegion();
      setEnv(result);
      setDetectedItems(buildDetectedItems(result));
      setSteps(buildInstallSteps(result));
      setPhase('detected');
    } catch (err) {
      setErrorMsg(String(err));
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

  const runInstall = useCallback(async () => {
    if (!env) return;
    setPhase('installing');
    setErrorMsg('');

    for (const step of steps) {
      updateStep(step.id, { status: 'running' });

      try {
        let result;

        if (step.id === 'auto_install_brew') {
          result = await autoInstallPrerequisite('brew', env.region);
        } else if (step.id === 'auto_install_node') {
          result = await autoInstallPrerequisite('node', env.region);
        } else if (step.id === 'auto_install_git') {
          result = await autoInstallPrerequisite('git', env.region);
        } else if (step.id === 'install_openclaw') {
          result = await executeInstallStep('install_openclaw', {
            registry: env.recommended_registry ?? undefined,
          });
        } else if (step.id === 'setup_mcp') {
          result = await executeInstallStep('setup_mcp', { platformIds: [] });
        } else {
          result = await executeInstallStep(step.id);
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
        updateStep(step.id, { status: 'failed', message: String(err) });
        setErrorMsg(String(err));
        setPhase('error');
        return;
      }
    }

    setPhase('done');
  }, [env, steps]);

  const retryFromFailed = useCallback(() => {
    setSteps((prev) =>
      prev.map((s) => (s.status === 'failed' ? { ...s, status: 'pending' as const, message: undefined } : s)),
    );
    void runInstall();
  }, [runInstall]);

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
