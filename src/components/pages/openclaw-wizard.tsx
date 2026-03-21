import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertCircle,
  Bot,
  Check,
  Download,
  ExternalLink,
  FolderOpen,
  Loader2,
  Package,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MODULE_THEMES } from '@/constants/colors';
import { isEnglishLocale, t } from '@/constants/i18n';
import { GlassmorphicCard } from '@/components/glassmorphic-card';
import { AiInstallChat } from '@/components/ai-install-chat';
import { ManualModeGateDialog } from '@/components/manual-mode-gate-dialog';
import { requestRuntimeGuardActionApproval, listenRuntimeGuardApprovals, type RuntimeApprovalRequest } from '@/services/runtime-guard';
import { detectAiTools, type DetectedTool } from '@/services/scanner';
import { openExternalUrl } from '@/services/runtime-settings';
import { isTauriEnvironment, tauriInvoke as invoke } from '@/services/tauri';
import { useLicenseStore } from '@/stores/licenseStore';
import { useSettingsStore } from '@/stores/settingsStore';

import { useProGate } from '@/hooks/useProGate';
import { useAppStore } from '@/stores/appStore';
import { localizedDynamicText, translateBackendText } from '@/lib/locale-text';

interface OpenClawStatus {
  installed: boolean;
  version: string | null;
  config_dir: string | null;
  node_installed: boolean;
  npm_installed: boolean;
  skills_count: number;
  mcps_count: number;
}

interface SkillInfo {
  name: string;
  path: string;
  has_skill_md: boolean;
  file_count: number;
}

interface McpInfo {
  name: string;
  command: string;
  args: string[];
}

type OneClickLockedReason = 'free' | 'trial_expired' | 'pro_expired';

interface ChannelOption {
  id: 'telegram' | 'feishu' | 'wework' | 'dingtalk' | 'slack' | 'discord' | 'ntfy' | 'webhook' | 'email';
  name: string;
  tokenLabel: string;
  tokenPlaceholder: string;
  setupGuide: string[];
  docsUrl: string;
}

const tr = (zh: string, en: string) => (isEnglishLocale ? en : zh);

function localizeOpenClawBackendText(value: string, fallback: string): string {
  return localizedDynamicText(value, translateBackendText(fallback));
}

function getChannelOptions(): ChannelOption[] {
  return [
    {
      id: 'telegram',
      name: 'Telegram',
      tokenLabel: 'Bot Token',
      tokenPlaceholder: tr('123456789:AA...（BotFather 提供）', '123456789:AA... (provided by BotFather)'),
      setupGuide: [
        tr('在 Telegram 联系 BotFather 创建机器人', 'Create a bot with BotFather in Telegram'),
        tr('复制 Bot Token 到下方输入框', 'Paste the Bot Token into the input below'),
        tr('点击"开始一键配置"自动落地配置', 'Click "Start one-click setup" to apply configuration'),
      ],
      docsUrl: 'https://core.telegram.org/bots/tutorial',
    },
    {
      id: 'feishu',
      name: tr('飞书', 'Feishu'),
      tokenLabel: tr('Webhook Token 或密钥', 'Webhook token or secret'),
      tokenPlaceholder: tr('open-apis/bot/v2/hook/ 后面的 token', 'Token after open-apis/bot/v2/hook/'),
      setupGuide: [
        tr('在飞书群添加自定义机器人', 'Add a custom bot in Feishu group'),
        tr('复制 webhook token 或签名密钥', 'Copy webhook token or signing secret'),
        tr('点击"开始一键配置"自动写入本机', 'Click "Start one-click setup" to write local config'),
      ],
      docsUrl: 'https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot',
    },
    {
      id: 'wework',
      name: tr('企业微信', 'WeCom'),
      tokenLabel: tr('机器人 Key', 'Bot key'),
      tokenPlaceholder: tr('https://qyapi.weixin.qq.com/...key= 后面的 key', 'Key after ...?key= in webhook URL'),
      setupGuide: [
        tr('在企业微信群添加机器人', 'Add a bot in a WeCom group'),
        tr('复制 webhook key', 'Copy webhook key'),
        tr('点击"开始一键配置"自动写入本机', 'Click "Start one-click setup" to write local config'),
      ],
      docsUrl: 'https://developer.work.weixin.qq.com/document/path/91770',
    },
    {
      id: 'dingtalk',
      name: tr('钉钉', 'DingTalk'),
      tokenLabel: 'Webhook Access Token',
      tokenPlaceholder: 'https://oapi.dingtalk.com/robot/send?access_token=...',
      setupGuide: [
        tr('在钉钉群添加自定义机器人', 'Add a custom bot in a DingTalk group'),
        tr('复制 access_token（和可选签名密钥）', 'Copy access_token (and optional signing secret)'),
        tr('点击"开始一键配置"自动写入本机', 'Click "Start one-click setup" to write local config'),
      ],
      docsUrl: 'https://open.dingtalk.com/document/robots/custom-robot-access',
    },
    {
      id: 'slack',
      name: 'Slack',
      tokenLabel: 'Bot Token',
      tokenPlaceholder: 'xoxb-...',
      setupGuide: [
        tr('在 Slack 创建 App 并启用 Bot Token', 'Create a Slack app and enable Bot Token'),
        tr('复制 xoxb token 到输入框', 'Copy xoxb token into the input'),
        tr('点击"开始一键配置"自动写入本机', 'Click "Start one-click setup" to write local config'),
      ],
      docsUrl: 'https://api.slack.com/authentication/token-types',
    },
    {
      id: 'discord',
      name: 'Discord',
      tokenLabel: 'Bot Token',
      tokenPlaceholder: tr('MT...（Discord Developer Portal）', 'MT... (Discord Developer Portal)'),
      setupGuide: [
        tr('在 Discord Developer Portal 创建机器人', 'Create a bot in Discord Developer Portal'),
        tr('复制 Bot Token 到输入框', 'Copy Bot Token into the input'),
        tr('点击"开始一键配置"自动写入本机', 'Click "Start one-click setup" to write local config'),
      ],
      docsUrl: 'https://discord.com/developers/docs/topics/oauth2',
    },
    {
      id: 'ntfy',
      name: 'ntfy',
      tokenLabel: tr('主题 / 令牌', 'Topic / token'),
      tokenPlaceholder: tr('例如: myalerts 或 token@topic', 'Example: myalerts or token@topic'),
      setupGuide: [
        tr('准备 ntfy 主题（可选访问令牌）', 'Prepare an ntfy topic (optional access token)'),
        tr('将主题或 token@topic 填入输入框', 'Enter topic or token@topic in the input'),
        tr('点击"开始一键配置"自动写入本机', 'Click "Start one-click setup" to write local config'),
      ],
      docsUrl: 'https://docs.ntfy.sh',
    },
    {
      id: 'webhook',
      name: 'Webhook',
      tokenLabel: tr('Webhook URL 或令牌', 'Webhook URL or token'),
      tokenPlaceholder: tr('https://example.com/hook 或 Bearer token', 'https://example.com/hook or Bearer token'),
      setupGuide: [
        tr('准备可接收 JSON 的 webhook 端点', 'Prepare a webhook endpoint that accepts JSON'),
        tr('粘贴 URL 或鉴权令牌到输入框', 'Paste URL or auth token in the input'),
        tr('点击"开始一键配置"自动写入本机', 'Click "Start one-click setup" to write local config'),
      ],
      docsUrl: 'https://docs.openclaw.ai/automation/webhook',
    },
    {
      id: 'email',
      name: 'Email',
      tokenLabel: tr('SMTP 凭据', 'SMTP credential'),
      tokenPlaceholder: tr('smtp://user:pass@mail.example.com:587', 'smtp://user:pass@mail.example.com:587'),
      setupGuide: [
        tr('准备 SMTP 帐号与发件配置', 'Prepare SMTP account and sender configuration'),
        tr('将 SMTP 凭据填入输入框', 'Enter SMTP credential in the input'),
        tr('点击"开始一键配置"自动写入本机', 'Click "Start one-click setup" to write local config'),
      ],
      docsUrl: 'https://docs.openclaw.ai/channels',
    },
  ];
}

function isNewerVersion(current: string, latest: string): boolean {
  // Strip hash/build metadata like "(3caab92)" before comparing
  const clean = (v: string) => v.replace(/^v/, '').replace(/\s*\(.*\)/, '').trim();
  const a = clean(current).split('.').map(Number);
  const b = clean(latest).split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (Number.isNaN(av) || Number.isNaN(bv)) continue;
    if (bv > av) return true;
    if (bv < av) return false;
  }
  return false;
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

interface OpenClawWizardProps {
  onComplete: () => void;
  onSkip: () => void;
}

export function OpenClawWizard({ onComplete }: OpenClawWizardProps) {
  const theme = MODULE_THEMES.openClaw;
  const browserShell = !isTauriEnvironment();
  const previewMessage = t.desktopOnlyInBrowserShell.replace('{feature}', t.moduleOpenClaw);
  const { isPro, isTrial } = useProGate();
  const licensePlan = useLicenseStore((state) => state.plan);
  const licenseStatus = useLicenseStore((state) => state.status);
  const trialDaysLeft = useLicenseStore((state) => state.trialDaysLeft);
  const setCurrentModule = useAppStore((state) => state.setCurrentModule);
  const currentLanguage = useSettingsStore((state) => state.language);
  const oneClickOpsUnlocked = isPro || isTrial;

  const [status, setStatus] = useState<OpenClawStatus | null>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [mcps, setMcps] = useState<McpInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);

  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showUninstallConfirm, setShowUninstallConfirm] = useState(false);

  const [detectedTools, setDetectedTools] = useState<DetectedTool[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<ChannelOption['id']>('telegram');
  const [channelToken, setChannelToken] = useState('');

  const workflowBusy = actionInProgress !== null;
  const [showAiChat, setShowAiChat] = useState(false);
  const aiChatAutoExpandedRef = useRef(false);
  const [manualGateState, setManualGateState] = useState<{
    open: boolean;
    action: 'install' | 'update' | 'uninstall';
  }>({ open: false, action: 'install' });
  const loadDataInFlightRef = useRef(false);
  const initialLoadDoneRef = useRef(false);
  const focusRefreshTimerRef = useRef<number | null>(null);

  const selectedChannel = useMemo(
    () => {
      const options = getChannelOptions();
      return options.find((channel) => channel.id === selectedChannelId) ?? options[0];
    },
    [selectedChannelId, currentLanguage]
  );

  const oneClickLockedReason: OneClickLockedReason | null = useMemo(() => {
    if (oneClickOpsUnlocked) {
      return null;
    }
    if (licensePlan === 'trial' && licenseStatus !== 'active') {
      return 'trial_expired';
    }
    if ((licensePlan === 'pro' || licensePlan === 'enterprise') && licenseStatus !== 'active') {
      return 'pro_expired';
    }
    return 'free';
  }, [licensePlan, licenseStatus, oneClickOpsUnlocked]);

  const showTrialEndingHint = useMemo(() => (
    isTrial
      && typeof trialDaysLeft === 'number'
      && trialDaysLeft > 0
      && trialDaysLeft <= 3
  ), [isTrial, trialDaysLeft]);

  const oneClickLockedHeadline = (
    oneClickLockedReason === 'trial_expired'
      ? tr('14 天试用已到期，当前为手动模式', 'Your 14-day trial has ended. Manual mode is now active.')
      : oneClickLockedReason === 'pro_expired'
        ? tr('Pro 已到期，当前为手动模式', 'Your Pro subscription has expired. Manual mode is now active.')
        : tr('当前为免费版手动模式', 'Free plan manual mode is active.')
  );

  const oneClickLockedDetail = (
    oneClickLockedReason === 'trial_expired'
      ? tr(
        '开通 Pro 可立即恢复：审批放行后一键安装、一键更新、一键卸载与一键配置。',
        'Upgrade to Pro to instantly restore approval-based one-click install, update, uninstall, and setup.'
      )
      : oneClickLockedReason === 'pro_expired'
        ? tr(
          '续费 Pro 可立即恢复：审批放行后一键安装、一键更新、一键卸载与一键配置。',
          'Renew Pro to instantly restore approval-based one-click install, update, uninstall, and setup.'
        )
        : tr(
          '开通 Pro 可解锁：审批放行后一键安装、一键更新、一键卸载与一键配置。',
          'Upgrade to Pro to unlock approval-based one-click install, update, uninstall, and setup.'
        )
  );

  const manualGateDescription = (
    oneClickLockedReason === 'trial_expired'
      ? tr(
        '14 天试用已结束。当前为免费版手动模式；开通 Pro 后即可恢复一键处理。',
        'Your 14-day trial has ended. You are now on the free manual mode. Upgrade to Pro to restore one-click handling.'
      )
      : oneClickLockedReason === 'pro_expired'
        ? tr(
          'Pro 已到期。续费前需按官方步骤手动处理 OpenClaw；续费后恢复一键处理。',
          'Your Pro subscription has expired. Until renewal, OpenClaw must be handled manually with official steps. Renew to restore one-click handling.'
        )
        : tr(
          '当前为免费版手动模式，需要按官方步骤手动处理 OpenClaw。',
          'You are on the free manual mode. OpenClaw must be handled manually with official steps.'
        )
  );

  const loadData = useCallback(async () => {
    if (loadDataInFlightRef.current) {
      return;
    }
    loadDataInFlightRef.current = true;
    if (!initialLoadDoneRef.current) {
      setLoading(true);
    }

    try {
      if (browserShell) {
        setStatus({
          installed: false,
          version: null,
          config_dir: null,
          node_installed: false,
          npm_installed: false,
          skills_count: 0,
          mcps_count: 0,
        });
        setSkills([]);
        setMcps([]);
        setLatestVersion(null);
        setDetectedTools([]);
        return;
      }

      const fallbackStatus: OpenClawStatus = {
        installed: false,
        version: null,
        config_dir: null,
        node_installed: false,
        npm_installed: false,
        skills_count: 0,
        mcps_count: 0,
      };
      const [statusResult, skillsResult, mcpsResult, toolsResult] = await Promise.allSettled([
        invoke<OpenClawStatus>('get_openclaw_status'),
        invoke<SkillInfo[]>('get_openclaw_skills'),
        invoke<McpInfo[]>('get_openclaw_mcps'),
        detectAiTools(),
      ]);

      const resolvedStatus = statusResult.status === 'fulfilled' ? statusResult.value : fallbackStatus;
      const resolvedSkills = skillsResult.status === 'fulfilled' ? skillsResult.value : [];
      const resolvedMcps = mcpsResult.status === 'fulfilled' ? mcpsResult.value : [];
      const resolvedTools = toolsResult.status === 'fulfilled' ? toolsResult.value : [];

      setStatus(resolvedStatus);
      setSkills(resolvedSkills);
      setMcps(resolvedMcps);

      const visibleTools = resolvedTools.filter((tool) => (
        Boolean(tool.detected || tool.host_detected || tool.has_mcp_config || tool.install_target_ready)
      ));
      setDetectedTools(visibleTools);

      if (
        statusResult.status === 'rejected' ||
        skillsResult.status === 'rejected' ||
        mcpsResult.status === 'rejected' ||
        toolsResult.status === 'rejected'
      ) {
        const failureSummary = [
          statusResult.status === 'rejected' ? `status: ${String(statusResult.reason)}` : null,
          skillsResult.status === 'rejected' ? `skills: ${String(skillsResult.reason)}` : null,
          mcpsResult.status === 'rejected' ? `mcps: ${String(mcpsResult.reason)}` : null,
          toolsResult.status === 'rejected' ? `tools: ${String(toolsResult.reason)}` : null,
        ]
          .filter(Boolean)
          .join(' | ');
        setActionError(tr(`部分检测失败，已回退可用数据：${failureSummary}`, `Partial refresh failed; fallback data loaded: ${failureSummary}`));
      }

      try {
        const latest = await invoke<string>('check_openclaw_latest_version');
        setLatestVersion(latest);
      } catch {
        setLatestVersion(resolvedStatus.version ?? null);
      }
    } catch (error) {
      console.error('Failed to load OpenClaw data:', error);
      setActionError(tr(`加载 OpenClaw 数据失败：${String(error)}`, `Failed to load OpenClaw data: ${String(error)}`));
      setStatus({
        installed: false,
        version: null,
        config_dir: null,
        node_installed: false,
        npm_installed: false,
        skills_count: 0,
        mcps_count: 0,
      });
      setDetectedTools([]);
    } finally {
      loadDataInFlightRef.current = false;
      initialLoadDoneRef.current = true;
      setLoading(false);
    }
  }, [browserShell]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Auto-expand AI panel when OpenClaw is not installed (once data loads)
  useEffect(() => {
    if (!aiChatAutoExpandedRef.current && status !== null && !status.installed) {
      aiChatAutoExpandedRef.current = true;
      setShowAiChat(true);
    }
  }, [status]);

  useEffect(() => {
    if (browserShell) {
      return;
    }

    const scheduleRefresh = () => {
      if (focusRefreshTimerRef.current !== null) {
        window.clearTimeout(focusRefreshTimerRef.current);
      }
      focusRefreshTimerRef.current = window.setTimeout(() => {
        focusRefreshTimerRef.current = null;
        void loadData();
      }, 900);
    };

    const handleWindowFocus = () => {
      scheduleRefresh();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        scheduleRefresh();
      }
    };
    const pollId = window.setInterval(() => {
      void loadData();
    }, 60000);

    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(pollId);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (focusRefreshTimerRef.current !== null) {
        window.clearTimeout(focusRefreshTimerRef.current);
        focusRefreshTimerRef.current = null;
      }
    };
  }, [browserShell, loadData]);

  /**
   * Obtain an approved ticket for a runtime guard action.
   * If the first request returns 'pending', waits for the user to approve in the
   * modal, then re-requests to consume the grant and obtain the execution ticket.
   */
  const obtainApprovalTicket = async (
    input: Parameters<typeof requestRuntimeGuardActionApproval>[0],
    actionLabel: string,
  ): Promise<{ ticket: string } | { cancelled: true; reason: string }> => {
    const approval = await requestRuntimeGuardActionApproval(input);

    if (approval.status === 'approved' && approval.approval_ticket) {
      return { ticket: approval.approval_ticket };
    }

    // Approval is pending — wait for user to approve/deny in the modal
    setActionMessage(
      tr(
        `请在弹出的审批窗口中确认${actionLabel}操作，等待你点头...`,
        `Please confirm the ${actionLabel} action in the approval dialog. Waiting for your approval...`,
      ),
    );

    const decision = await waitForApprovalResolution(approval.request.id);
    setActionMessage(null);

    if (decision !== 'approved') {
      return {
        cancelled: true,
        reason: decision === 'timeout'
          ? tr('审批等待超时，请重新操作。', 'Approval timed out. Please try again.')
          : tr('你已拒绝此操作。', 'You denied this action.'),
      };
    }

    // Grant has been stored — re-request to consume it and get the ticket
    const retry = await requestRuntimeGuardActionApproval(input);
    if (retry.status === 'approved' && retry.approval_ticket) {
      return { ticket: retry.approval_ticket };
    }

    return { cancelled: true, reason: tr('审批已通过但未能获取执行票据，请重试。', 'Approval succeeded but failed to obtain execution ticket. Please retry.') };
  };

  const handleAction = async (action: 'install' | 'uninstall' | 'update') => {
    if (!oneClickOpsUnlocked) {
      setManualGateState({ open: true, action });
      return;
    }
    if (workflowBusy) {
      setActionError(tr(
        '当前已有任务在执行，请等待后再进行安装/更新/卸载。',
        'A task is already running. Wait for it to finish before install/update/uninstall.',
      ));
      return;
    }

    if (action === 'uninstall' && !showUninstallConfirm) {
      setShowUninstallConfirm(true);
      return;
    }
    setShowUninstallConfirm(false);
    setActionInProgress(action);
    setActionMessage(null);
    setActionError(null);

    if (browserShell) {
      setActionInProgress(null);
      setActionError(previewMessage);
      return;
    }

    const actionLabels: Record<string, string> = {
      install: tr('安装', 'install'),
      uninstall: tr('卸载', 'uninstall'),
      update: tr('更新', 'update'),
    };

    try {
      // Build the approval input based on action type
      const approvalInput = action === 'uninstall'
        ? {
            component_id: 'agentshield:openclaw',
            component_name: 'OpenClaw',
            platform_id: 'openclaw',
            platform_name: 'OpenClaw',
            request_kind: 'file_delete' as const,
            trigger_event: 'openclaw_uninstall_request',
            action_kind: 'file_delete',
            action_source: 'user_requested_uninstall',
            action_targets: ['OpenClaw local installation'],
            action_preview: [
              tr('将卸载 OpenClaw 本地程序', 'Will uninstall local OpenClaw program'),
              status?.config_dir
                ? tr(`配置目录: ${status.config_dir}`, `Config directory: ${status.config_dir}`)
                : tr('会移除 OpenClaw 相关本地配置', 'Will remove local OpenClaw-related config'),
              tr('放行后会执行真实卸载命令', 'Approval will execute a real uninstall command'),
            ],
            sensitive_capabilities: [tr('读写本地文件', 'Read and write local files')],
            is_destructive: true,
            is_batch: true,
          }
        : {
            component_id: 'agentshield:openclaw',
            component_name: 'OpenClaw',
            platform_id: 'openclaw',
            platform_name: 'OpenClaw',
            request_kind: 'shell_exec' as const,
            trigger_event: action === 'install' ? 'openclaw_install_request' : 'openclaw_update_request',
            action_kind: 'shell_exec',
            action_source: action === 'install' ? 'user_requested_install' : 'user_requested_update',
            action_targets: ['npm install -g openclaw@latest'],
            action_preview: [
              action === 'install'
                ? tr('将通过 npm 在本机真实安装 OpenClaw', 'Will install OpenClaw locally through npm')
                : tr('将通过 npm 在本机真实更新 OpenClaw', 'Will update OpenClaw locally through npm'),
              tr('命令: npm install -g openclaw@latest', 'Command: npm install -g openclaw@latest'),
              tr('放行后会真实执行命令，不是模拟进度', 'Approval will execute a real command, not simulated progress'),
            ],
            sensitive_capabilities: [
              tr('命令执行', 'Shell command execution'),
              tr('读写本地文件', 'Read and write local files'),
              tr('联网下载依赖', 'Download dependencies from network'),
            ],
            is_destructive: false,
            is_batch: false,
          };

      // Obtain approval ticket — waits for user to approve if pending
      const ticketResult = await obtainApprovalTicket(approvalInput, actionLabels[action]);
      if ('cancelled' in ticketResult) {
        setActionError(ticketResult.reason);
        setActionInProgress(null);
        return;
      }

      // Execute the actual command with the approval ticket
      const tauriCmd = action === 'uninstall'
        ? 'uninstall_openclaw_cmd'
        : action === 'install'
          ? 'install_openclaw_cmd'
          : 'update_openclaw_cmd';

      const result = await invoke<string>(tauriCmd, {
        approvalTicket: ticketResult.ticket,
      });

      setActionMessage(
        localizeOpenClawBackendText(
          result,
          action === 'uninstall'
            ? tr('卸载已完成', 'Uninstall completed')
            : action === 'install'
              ? tr('安装已完成', 'Install completed')
              : tr('更新已完成', 'Update completed'),
        ),
      );
      await loadData();
    } catch (error) {
      const errorStr = String(error);
      const isLicenseError = errorStr.includes('试用已结束')
        || errorStr.includes('免费版')
        || errorStr.includes('许可证')
        || errorStr.includes('激活码')
        || errorStr.includes('license')
        || errorStr.includes('trial');

      setActionError(
        localizeOpenClawBackendText(
          errorStr,
          tr('操作失败，请稍后重试。', 'Operation failed. Please try again.'),
        ),
      );

      // Resync frontend license state when backend reports a license issue
      if (isLicenseError) {
        try {
          const freshInfo = await invoke<{
            plan: string;
            status: string;
            expires_at: string | null;
            trial_days_left: number | null;
          }>('check_license_status');
          useLicenseStore.getState().setLicenseInfo({
            plan: freshInfo.plan as any,
            status: freshInfo.status as any,
            expiresAt: freshInfo.expires_at ?? undefined,
            trialDaysLeft: freshInfo.trial_days_left ?? undefined,
            features: [],
          });
        } catch {
          // Ignore — license resync is best-effort
        }
      }
    }

    setActionInProgress(null);
  };

  const handleRevealPath = (path: string) => {
    if (browserShell) {
      setActionError(previewMessage);
      return;
    }

    invoke('reveal_path_in_finder', { path }).catch((error) => {
      setActionError(tr(`打开配置目录失败：${String(error)}`, `Failed to open config directory: ${String(error)}`));
    });
  };

  if (loading) {
    return (
      <div
        className="h-full flex items-center justify-center"
        style={{ background: `linear-gradient(135deg, ${theme.from} 0%, ${theme.via} 45%, ${theme.to} 100%)` }}
      >
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-12 h-12 text-white/60 animate-spin" />
          <p className="text-white/60 text-sm">{t.openClawDetecting}</p>
        </div>
      </div>
    );
  }

  const openclawHostDetected = detectedTools.some((tool) => (
    tool.id === 'openclaw' && Boolean(tool.detected || tool.host_detected || tool.has_mcp_config)
  ));
  // The backend `get_openclaw_status` checks whether the OpenClaw binary
  // actually exists. `openclawHostDetected` only indicates residual MCP
  // config entries, which can linger after uninstall. Prefer the
  // authoritative backend status; fall back to host detection only when the
  // backend hasn't responded yet (status is null).
  const isInstalled = status ? status.installed : openclawHostDetected;
  const currentVersion = status?.version ?? null;
  const hasUpdate = currentVersion && latestVersion ? isNewerVersion(currentVersion, latestVersion) : false;

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      style={{ background: `linear-gradient(135deg, ${theme.from} 0%, ${theme.via} 45%, ${theme.to} 100%)` }}
    >
      <div className="px-5 pt-4 pb-1.5">
        <div className="mb-1 flex items-center gap-3">
          <Package className="w-7 h-7 text-teal-400" />
          <h1 className="text-2xl font-bold text-white">{t.openClawManagement}</h1>
        </div>
        <p className="text-white/50 text-sm ml-10">{t.openClawSubtitle}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        <div className="mx-auto flex w-full max-w-[1320px] min-h-0 flex-col gap-3.5">
        {/* ── Top: Compact version info line ── */}
        <GlassmorphicCard className="!p-0 order-1 relative z-20">
          <div className="px-4 py-2.5 md:px-5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Package className={cn('w-5 h-5', isInstalled ? 'text-teal-400' : 'text-white/40')} />
              {isInstalled ? (
                <span className="text-sm text-white/70">
                  OpenClaw{' '}
                  <span className="text-teal-400 font-mono">{currentVersion}</span>
                  {latestVersion && (
                    <span className="text-white/40 ml-2">
                      {tr('最新', 'Latest')}:{' '}
                      <span className={cn('font-mono', hasUpdate ? 'text-amber-400' : 'text-teal-400/70')}>
                        {latestVersion}
                      </span>
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-sm text-white/50">
                  OpenClaw {t.openClawNotInstalled}
                  {!browserShell && (
                    <span className="ml-2 text-xs text-white/35">
                      {openclawHostDetected
                        ? tr('(检测到入口)', '(entry detected)')
                        : status?.node_installed
                          ? tr('(环境就绪)', '(env ready)')
                          : tr('(需要 Node.js)', '(needs Node.js)')}
                    </span>
                  )}
                </span>
              )}
            </div>
            <div className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs',
              isInstalled ? 'bg-teal-500/15 text-teal-400' : 'bg-white/10 text-white/50'
            )}>
              <span className={cn('w-1.5 h-1.5 rounded-full', isInstalled ? 'bg-teal-400' : 'bg-white/30')} />
              {isInstalled ? t.installedStatus : t.notInstalledStatus}
              {hasUpdate ? (
                <span className="ml-1 rounded-full bg-amber-500/20 text-amber-400 px-1.5 py-0.5 text-[10px]">
                  {t.updateAvailable}
                </span>
              ) : null}
            </div>
          </div>
        </GlassmorphicCard>

        {/* ── Hero: AI one-click install — the core feature ── */}
        <GlassmorphicCard className="!p-0 order-2 relative z-20">
          <div className="p-4 md:p-5">
            {/* Upgrade / trial banners */}
            {!oneClickOpsUnlocked && !browserShell ? (
              <div className="mb-3.5 rounded-xl border border-amber-300/30 bg-amber-500/10 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-amber-100">{oneClickLockedHeadline}</p>
                    <p className="mt-1 text-xs text-amber-100/85">{oneClickLockedDetail}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCurrentModule('upgradePro')}
                    className="rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-300"
                  >
                    {tr('⚡ 升级 Pro 解锁一键', '⚡ Upgrade to Pro for one-click')}
                  </button>
                </div>
              </div>
            ) : null}
            {showTrialEndingHint && !browserShell ? (
              <div className="mb-3.5 rounded-xl border border-sky-300/30 bg-sky-500/10 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-sky-100">
                    {tr(
                      `试用还剩 ${trialDaysLeft} 天。建议提前开通 Pro，避免自动切回手动模式。`,
                      `${trialDaysLeft} trial day(s) left. Upgrade early to avoid fallback to manual mode.`
                    )}
                  </p>
                  <button
                    type="button"
                    onClick={() => setCurrentModule('upgradePro')}
                    className="rounded-lg border border-sky-200/40 bg-white/10 px-3 py-1.5 text-xs font-medium text-sky-100 hover:bg-white/20"
                  >
                    {tr('开通 Pro', 'Upgrade to Pro')}
                  </button>
                </div>
              </div>
            ) : null}

            {/* Hero AI button (always visible — gated inside AiInstallChat for free users) */}
            {!showAiChat ? (
              <button
                type="button"
                onClick={() => setShowAiChat(true)}
                className="group w-full rounded-2xl border-2 border-amber-400/40 bg-gradient-to-br from-amber-500/20 via-amber-500/10 to-yellow-500/15 px-6 py-5 text-left transition-all hover:border-amber-400/60 hover:from-amber-500/30 hover:via-amber-500/20 hover:to-yellow-500/25"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/25">
                    <Bot className="h-6 w-6 text-amber-300" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold text-amber-100">
                        {tr('AI 一键安装', 'AI Auto-Install')}
                      </span>
                      {isPro && (
                        <span className="rounded bg-amber-500/30 px-2 py-0.5 text-[10px] font-bold text-amber-300">Pro</span>
                      )}
                      {isTrial && (
                        <span className="rounded bg-sky-500/30 px-2 py-0.5 text-[10px] font-bold text-sky-300">Trial</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-amber-200/60">
                      {tr(
                        '自动检测环境 · 自动安装 · 一键完成',
                        'Auto-detect · Auto-install · One click',
                      )}
                    </p>
                  </div>
                  <span className="text-amber-300/50 group-hover:text-amber-300/80 transition-colors text-xl">→</span>
                </div>
              </button>
            ) : (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bot className="h-5 w-5 text-amber-300" />
                    <span className="text-sm font-semibold text-amber-100">
                      {tr('AI 一键安装', 'AI Auto-Install')}
                    </span>
                    {isPro && (
                      <span className="rounded bg-amber-500/30 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">Pro</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAiChat(false)}
                    className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-white/50 hover:bg-white/10 transition-colors"
                  >
                    {tr('收起', 'Collapse')}
                  </button>
                </div>
                <AnimatePresence>
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <AiInstallChat onClose={() => setShowAiChat(false)} isPro={isPro} isTrial={isTrial} />
                  </motion.div>
                </AnimatePresence>
              </div>
            )}
          </div>
        </GlassmorphicCard>

        {/* ── Secondary: tool buttons row + stats ── */}
        <GlassmorphicCard className="!p-0 order-3 relative z-10">
          <div className="p-3 md:p-4">
            {/* Small secondary action buttons */}
            <div className="flex flex-wrap items-center gap-1.5">
              <SmallActionButton
                icon={Download}
                label={
                  !isInstalled
                    ? (oneClickOpsUnlocked ? tr('安装', 'Install') : tr('手动安装', 'Manual install'))
                    : (oneClickOpsUnlocked ? tr('重装', 'Reinstall') : tr('手动重装', 'Manual reinstall'))
                }
                loading={actionInProgress === 'install'}
                disabled={browserShell || (oneClickOpsUnlocked && !status?.node_installed) || !!actionInProgress}
                onClick={() => { void handleAction('install'); }}
              />
              <SmallActionButton
                icon={RefreshCw}
                label={
                  oneClickOpsUnlocked
                    ? (hasUpdate ? tr('更新', 'Update') : tr('更新', 'Update'))
                    : tr('手动更新', 'Manual update')
                }
                loading={actionInProgress === 'update'}
                disabled={!!actionInProgress || !isInstalled}
                onClick={() => { void handleAction('update'); }}
              />
              <SmallActionButton
                icon={Trash2}
                label={oneClickOpsUnlocked ? tr('卸载', 'Uninstall') : tr('手动卸载', 'Manual uninstall')}
                destructive
                loading={actionInProgress === 'uninstall'}
                disabled={!!actionInProgress || !isInstalled}
                onClick={() => { void handleAction('uninstall'); }}
              />
              {status?.config_dir ? (
                <SmallActionButton
                  icon={FolderOpen}
                  label={tr('配置目录', 'Config dir')}
                  onClick={() => handleRevealPath(status.config_dir!)}
                />
              ) : null}
            </div>

            {isInstalled ? (
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-white/5 p-2 text-center">
                  <p className="text-lg font-bold text-teal-400">{skills.length}</p>
                  <p className="text-[10px] text-white/50">{t.installedSkills}</p>
                </div>
                <div className="rounded-lg bg-white/5 p-2 text-center">
                  <p className="text-lg font-bold text-teal-400">{mcps.length}</p>
                  <p className="text-[10px] text-white/50">{t.mcpServers}</p>
                </div>
                <div className="rounded-lg bg-white/5 p-2 text-center">
                  <p className="text-lg font-bold text-teal-400">{status?.config_dir ? '✓' : '—'}</p>
                  <p className="text-[10px] text-white/50">{t.configDirectory}</p>
                </div>
              </div>
            ) : null}

            {showUninstallConfirm ? (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20"
              >
                <p className="text-sm font-medium text-rose-400 mb-2">{t.confirmUninstallTitle}</p>
                <p className="text-xs text-white/50 mb-3">{t.confirmUninstallDesc}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { void handleAction('uninstall'); }}
                    className="px-3 py-1.5 rounded-lg bg-rose-500 text-white text-xs font-medium hover:bg-rose-600 transition-colors"
                  >
                    {t.confirmUninstallBtn}
                  </button>
                  <button
                    onClick={() => setShowUninstallConfirm(false)}
                    className="px-3 py-1.5 rounded-lg bg-white/10 text-white/60 text-xs hover:bg-white/15 transition-colors"
                  >
                    {t.cancel}
                  </button>
                </div>
              </motion.div>
            ) : null}

            {actionMessage ? (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  'mt-3 p-3 rounded-lg',
                  actionInProgress
                    ? 'bg-sky-500/10 border border-sky-500/20'
                    : 'bg-teal-500/10 border border-teal-500/20',
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  {actionInProgress ? (
                    <Loader2 className="w-3.5 h-3.5 text-sky-400 flex-shrink-0 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5 text-teal-400 flex-shrink-0" />
                  )}
                  <p className={cn('text-xs font-medium', actionInProgress ? 'text-sky-400' : 'text-teal-400')}>
                    {actionInProgress ? tr('等待审批中...', 'Waiting for approval...') : t.operationComplete}
                  </p>
                </div>
                <p className="text-xs text-white/65">{actionMessage}</p>
              </motion.div>
            ) : null}
            {actionError ? (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-start gap-2"
              >
                <AlertCircle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-rose-400">{actionError}</p>
              </motion.div>
            ) : null}
          </div>
        </GlassmorphicCard>

        {/* ── Skills & MCP details (when installed) ── */}
        {isInstalled ? (
          <GlassmorphicCard className="!p-0 order-4 relative z-10">
            <div className="p-4 md:p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-white">{tr('OpenClaw Skills', 'OpenClaw Skills')}</p>
                <span className="rounded-full border border-white/15 bg-black/20 px-2 py-0.5 text-[11px] text-white/65">
                  {skills.length}
                </span>
              </div>
              <p className="mt-1 text-xs text-white/50">
                {tr(
                  '仅显示 OpenClaw 配置目录下的 skill 条目，不包含其它宿主工具的 skill。',
                  'Only skills under OpenClaw config roots are shown. Skills from other hosts are excluded.',
                )}
              </p>

              {skills.length > 0 ? (
                <div className="mt-3 space-y-2.5">
                  {skills.map((skill) => (
                    <div
                      key={`${skill.name}:${skill.path}`}
                      className="rounded-lg border border-white/10 bg-black/20 px-3 py-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-white">{skill.name}</p>
                          <p className="mt-1 truncate text-[11px] text-white/45">{skill.path}</p>
                        </div>
                        <button
                          type="button"
                          className="shrink-0 rounded-md border border-white/15 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10"
                          onClick={() => handleRevealPath(skill.path)}
                        >
                          {tr('打开目录', 'Open folder')}
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="rounded-full border border-white/15 bg-black/20 px-2 py-0.5 text-white/70">
                          {tr(`${skill.file_count} 个文件`, `${skill.file_count} files`)}
                        </span>
                        <span className={cn(
                          'rounded-full border px-2 py-0.5',
                          skill.has_skill_md
                            ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
                            : 'border-amber-400/40 bg-amber-500/10 text-amber-200',
                        )}
                        >
                          {skill.has_skill_md ? 'SKILL.md' : tr('缺少 SKILL.md', 'Missing SKILL.md')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-dashed border-white/15 bg-black/20 px-3 py-3 text-xs text-white/55">
                  {tr(
                    '未发现 OpenClaw skill。请确认已安装到 OpenClaw 的 skills 目录后，点击"刷新"或重新进入本页。',
                    'No OpenClaw skills found. Install skills into OpenClaw skills directory, then refresh or re-open this page.',
                  )}
                </div>
              )}
            </div>
          </GlassmorphicCard>
        ) : null}

        {/* ── Notification channel configuration ── */}
        <GlassmorphicCard className="!p-0 order-5 relative z-10">
          <div className="p-4 md:p-5">
            <div className="grid gap-2.5 lg:grid-cols-1">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-sm font-medium text-white">{tr('通知渠道', 'Notification channels')}</p>
                <p className="mt-1 text-xs text-white/45">
                  {tr('填入 token 后会自动写入 OpenClaw 渠道配置目录。', 'After filling the token, configuration will be written to OpenClaw channel directory.')}
                </p>
                <div className="mt-2.5 space-y-2">
                  {([
                    { label: tr('国际', 'International'), ids: ['telegram', 'slack', 'discord'] as const },
                    { label: tr('国内', 'China'), ids: ['feishu', 'wework', 'dingtalk'] as const },
                    { label: tr('通用', 'Universal'), ids: ['email', 'webhook', 'ntfy'] as const },
                  ] as const).map((group) => {
                    const channels = getChannelOptions().filter((c) => (group.ids as readonly string[]).includes(c.id));
                    if (channels.length === 0) return null;
                    return (
                      <div key={group.label}>
                        <p className="text-[10px] uppercase tracking-wider text-white/35 mb-1">{group.label}</p>
                        <div className="grid gap-1.5 sm:grid-cols-3">
                          {channels.map((channel) => (
                            <button
                              key={channel.id}
                              type="button"
                              onClick={() => setSelectedChannelId(channel.id)}
                              className={cn(
                                'rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                                selectedChannelId === channel.id
                                  ? 'border-teal-300/40 bg-teal-400/15 text-teal-100'
                                  : 'border-white/15 bg-white/5 text-white/70 hover:bg-white/10'
                              )}
                            >
                              {channel.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2.5 space-y-2">
                  <label className="block text-xs text-white/60">{selectedChannel.tokenLabel}</label>
                  <input
                    value={channelToken}
                    onChange={(event) => setChannelToken(event.target.value)}
                    placeholder={selectedChannel.tokenPlaceholder}
                    className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-teal-300/45"
                  />
                  <ol className="list-decimal space-y-0.5 pl-5 text-[11px] text-white/55">
                    {selectedChannel.setupGuide.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ol>
                  <button
                    type="button"
                    onClick={() => {
                      void openExternalUrl(selectedChannel.docsUrl);
                    }}
                    className="inline-flex items-center gap-1 text-xs text-sky-300 hover:text-sky-200"
                  >
                    {tr('查看官方教程', 'Open official guide')}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </GlassmorphicCard>

        </div>

      </div>
      <ManualModeGateDialog
        open={manualGateState.open}
        onOpenChange={(open) => setManualGateState((previous) => ({ ...previous, open }))}
        title={
          manualGateState.action === 'install'
            ? tr('手动安装模式已启用', 'Manual install mode enabled')
            : manualGateState.action === 'update'
              ? tr('手动更新模式已启用', 'Manual update mode enabled')
              : tr('手动卸载模式已启用', 'Manual uninstall mode enabled')
        }
        description={manualGateDescription}
        impacts={[
          tr(
            '系统会为你打开 OpenClaw 官方文档与下载页面，你需要自己执行每一步。',
            'AgentShield will open official OpenClaw docs/download pages and you need to execute every step manually.'
          ),
          tr(
            '如果安装包或版本选择错误，可能导致 OpenClaw、Skill 或 MCP 配置不可用。',
            'Wrong package or version selection may break OpenClaw, Skill, or MCP configurations.'
          ),
          tr(
            '完整版支持放行后一键安装、更新、卸载和配置校验。',
            'Full version supports approved one-click install, update, uninstall, and config verification.'
          ),
        ]}
        manualLabel={tr('打开官方手动教程', 'Open official manual guide')}
        onManual={() => {
          const url =
            manualGateState.action === 'uninstall'
              ? 'https://docs.openclaw.dev/uninstall'
              : manualGateState.action === 'update'
                ? 'https://docs.openclaw.dev/upgrade'
                : 'https://docs.openclaw.dev';
          void openExternalUrl(url);
          setActionMessage(tr('已打开官方文档，请按步骤手动处理。', 'Official docs opened. Please follow the manual steps.'));
        }}
        onUpgrade={() => setCurrentModule('upgradePro')}
        upgradeLabel={
          manualGateState.action === 'install'
            ? tr('⚡ 一键安装', '⚡ One-click install')
            : manualGateState.action === 'update'
              ? tr('⚡ 一键更新', '⚡ One-click update')
              : tr('⚡ 一键卸载', '⚡ One-click uninstall')
        }
      />
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  color,
  variant = 'solid',
  loading = false,
  disabled = false,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  color: string;
  variant?: 'solid' | 'outline';
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        variant === 'solid'
          ? 'text-white hover:opacity-90'
          : 'bg-transparent border hover:bg-white/5',
      )}
      style={
        variant === 'solid'
          ? { backgroundColor: color }
          : { borderColor: `${color}40`, color }
      }
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Icon className="w-4 h-4" />
      )}
      {label}
    </button>
  );
}

function SmallActionButton({
  icon: Icon,
  label,
  destructive = false,
  loading = false,
  disabled = false,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  destructive?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all',
        'disabled:opacity-35 disabled:cursor-not-allowed',
        destructive
          ? 'border-rose-400/30 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25'
          : 'border-teal-400/25 bg-teal-500/10 text-teal-300 hover:bg-teal-500/20',
      )}
    >
      {loading ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : (
        <Icon className="w-3 h-3" />
      )}
      {label}
    </button>
  );
}
