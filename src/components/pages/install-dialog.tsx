import { useState, useEffect } from 'react';
import { tauriInvoke as invoke } from '@/services/tauri';
import { motion, AnimatePresence } from 'framer-motion';
import { X, FileText, Globe, Zap, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isEnglishLocale, t } from '@/constants/i18n';
import { GlassmorphicCard } from '@/components/glassmorphic-card';
import { ManualModeGateDialog } from '@/components/manual-mode-gate-dialog';
import { SafetyBadge } from '@/components/safety-badge';
import { RoundCTAButton, GhostButton } from '@/components/round-cta-button';
import { PLATFORM_CONFIG } from '@/constants/colors';
import { detectAiTools } from '@/services/scanner';
import { openExternalUrl } from '@/services/runtime-settings';
import {
  listenRuntimeGuardApprovals,
  requestRuntimeGuardActionApproval,
  type RuntimeApprovalRequest,
} from '@/services/runtime-guard';
import type { DetectedTool } from '@/services/scanner';
import type { StoreCatalogItem, Platform, InstallResult } from '@/types/domain';
import { useProGate } from '@/hooks/useProGate';
import { useAppStore } from '@/stores/appStore';

interface InstallDialogProps {
  item: StoreCatalogItem;
  open: boolean;
  onClose: () => void;
  onConfirm: (platforms: Platform[]) => void;
}

const tr = (zh: string, en: string) => (isEnglishLocale ? en : zh);
const joinLocalized = (values: string[]) => values.join(isEnglishLocale ? ', ' : '、');

/** Map scanner tool IDs to Platform type values */
const TOOL_ID_TO_PLATFORM: Record<string, Platform> = {
  cursor: 'cursor',
  kiro: 'kiro',
  vscode: 'vscode',
  claude_desktop: 'claude_desktop',
  windsurf: 'windsurf',
  claude_code: 'claude_code',
  antigravity: 'antigravity',
  codex: 'codex',
  gemini_cli: 'gemini_cli',
  trae: 'trae',
  continue_dev: 'continue_dev',
  zed: 'zed',
  openclaw: 'openclaw',
};

interface InstallTargetPath {
  platform: Platform;
  config_path: string;
  exists: boolean;
}

function waitForApprovalResolution(requestId: string, timeoutMs = 120_000): Promise<'approved' | 'denied' | 'timeout'> {
  return new Promise((resolve) => {
    let settled = false;
    let unlistenFn: (() => void) | undefined;

    const timer = window.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      unlistenFn?.();
      resolve('timeout');
    }, timeoutMs);

    listenRuntimeGuardApprovals((approval: RuntimeApprovalRequest) => {
      if (settled) {
        return;
      }
      if (approval.id !== requestId || approval.status === 'pending') {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      unlistenFn?.();
      resolve(approval.status === 'approved' ? 'approved' : 'denied');
    }).then((fn) => {
      unlistenFn = fn;
      if (settled) {
        fn();
      }
    }).catch(() => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      resolve('timeout');
    });
  });
}

export function InstallDialog({ item, open, onClose, onConfirm }: InstallDialogProps) {
  const { isPro, isTrial } = useProGate();
  const oneClickInstallUnlocked = isPro || isTrial;
  const setCurrentModule = useAppStore((state) => state.setCurrentModule);
  const [detectedPlatforms, setDetectedPlatforms] = useState<Array<{
    platform: Platform;
    installed: boolean;
    statusLabel: string;
  }>>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>([]);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installSummary, setInstallSummary] = useState<string | null>(null);
  const [installTargets, setInstallTargets] = useState<InstallTargetPath[]>([]);
  const [manualGateOpen, setManualGateOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    detectAiTools().then((tools: DetectedTool[]) => {
      if (cancelled) return;
      const mapped = tools
        .filter((tool) => (tool.install_target_ready ?? tool.detected) && TOOL_ID_TO_PLATFORM[tool.id])
        .map((tool) => ({
          platform: TOOL_ID_TO_PLATFORM[tool.id],
          installed: Boolean(tool.host_detected ?? tool.detected),
          statusLabel: tool.host_detected
            ? `(${t.installed})`
            : tool.has_mcp_config
              ? tr('(配置已发现)', '(Config detected)')
              : tr('(可写入)', '(Writable)'),
        }))
        .sort(
          (left, right) =>
            item.compatible_platforms.indexOf(left.platform) - item.compatible_platforms.indexOf(right.platform)
        );
      setDetectedPlatforms(mapped);
      // Pre-select platforms that are both detected and compatible with this item
      const compatible = mapped
        .filter((p) => item.compatible_platforms.includes(p.platform))
        .map((p) => p.platform);
      setSelectedPlatforms(compatible);
    });
    return () => {
      cancelled = true;
    };
  }, [open, item.compatible_platforms]);

  const [isInstalling, setIsInstalling] = useState(false);

  useEffect(() => {
    if (open) {
      setInstallError(null);
      setInstallSummary(null);
      setIsInstalling(false);
      setInstallTargets([]);
    }
  }, [open]);

  useEffect(() => {
    if (!open || selectedPlatforms.length === 0) {
      setInstallTargets([]);
      return;
    }

    let cancelled = false;
    invoke<InstallTargetPath[]>('resolve_install_target_paths', {
      platforms: selectedPlatforms,
    })
      .then((targets) => {
        if (!cancelled) {
          setInstallTargets(Array.isArray(targets) ? targets : []);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to resolve install targets:', error);
          setInstallTargets([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, selectedPlatforms]);

  const handleConfirm = async () => {
    if (!oneClickInstallUnlocked) {
      setManualGateOpen(true);
      return;
    }

    setIsInstalling(true);
    setInstallError(null);
    setInstallSummary(null);

    try {
      const resolvedTargets = installTargets.length > 0
        ? installTargets
        : await invoke<InstallTargetPath[]>('resolve_install_target_paths', {
            platforms: selectedPlatforms,
          });
      const approvalTargets = resolvedTargets.length > 0
        ? resolvedTargets.map((target) => target.config_path)
        : [...selectedPlatforms].sort();
      const approvalInput = {
        component_id: `agentshield:store:${item.id}`,
        component_name: item.name,
        platform_id: selectedPlatforms.join(','),
        platform_name: selectedPlatforms
          .map((platform) => PLATFORM_CONFIG[platform]?.name ?? platform)
          .join(isEnglishLocale ? ', ' : '、'),
        request_kind: 'component_install',
        trigger_event: 'store_item_install_request',
        action_kind: 'component_install',
        action_source: 'user_requested_install',
        action_targets: approvalTargets,
        action_preview: buildInstallPreview(item, resolvedTargets),
        sensitive_capabilities: buildInstallCapabilities(item),
        is_destructive: false,
        is_batch: selectedPlatforms.length > 1,
      };
      let approval = await requestRuntimeGuardActionApproval(approvalInput);

      if (approval.status !== 'approved' || !approval.approval_ticket) {
        setInstallSummary(tr(
          '等待你在安全提示中确认安装…',
          'Waiting for your approval in the security prompt…',
        ));
        const resolution = await waitForApprovalResolution(approval.request.id);
        if (resolution !== 'approved') {
          setIsInstalling(false);
          setInstallSummary(resolution === 'timeout'
            ? tr('审批等待超时，请重试安装。', 'Approval timed out. Please retry installation.')
            : tr('你已拒绝本次安装。', 'You denied this installation request.'));
          return;
        }
        approval = await requestRuntimeGuardActionApproval(approvalInput);
        if (approval.status !== 'approved' || !approval.approval_ticket) {
          setIsInstalling(false);
          setInstallError(tr(
            '审批已通过，但未获取到可执行票据，请重试。',
            'Approval was granted but no execution ticket was issued. Please retry.',
          ));
          return;
        }
      }

      const result = await invoke<InstallResult>('install_store_item', {
        itemId: item.id,
        platforms: selectedPlatforms,
        approvalTicket: approval.approval_ticket,
      });

      if (!result.success) {
        throw new Error(result.errors?.length ? `${result.message}：${result.errors.join('；')}` : result.message);
      }

      setInstallSummary(result.errors?.length
        ? `${result.message}${tr('。成功平台：', '. Succeeded targets: ')}${(result.installed_platforms && result.installed_platforms.length > 0) ? joinLocalized(result.installed_platforms) : tr('无', 'None')}`
        : result.message
      );
      onConfirm(selectedPlatforms);
    } catch (e) {
      setIsInstalling(false);
      setInstallError(`${t.installFailed}: ${String(e)}`);
    }
  };

  const togglePlatform = (platform: Platform) => {
    setSelectedPlatforms(prev =>
      prev.includes(platform)
        ? prev.filter(p => p !== platform)
        : [...prev, platform]
    );
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-3 md:p-6"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />

          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative my-0 w-full max-w-3xl"
          >
            <GlassmorphicCard className="flex max-h-[90vh] flex-col overflow-hidden p-4 pb-3 md:p-5 md:pb-4">
              {/* Close button */}
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-2 rounded-lg hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5 text-white/60" />
              </button>

              {/* Header */}
              <div className="flex items-center gap-4 mb-6">
                <div className="w-14 h-14 rounded-xl bg-white/10 flex items-center justify-center">
                  <span className="text-3xl">{item.featured ? '⭐' : '🔌'}</span>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">{item.name}</h2>
                  <SafetyBadge level={item.safety_level} size="small" />
                  <p className="mt-1 text-xs text-white/55">
                    {t.installTo}: {selectedPlatforms.length > 0
                      ? joinLocalized(selectedPlatforms.map((platform) => PLATFORM_CONFIG[platform]?.name ?? platform))
                      : tr('请选择目标 AI 工具', 'Select target AI tools')}
                  </p>
                </div>
              </div>

              {isInstalling ? (
                // Installing state
                <div className="py-6">
                  <div className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-6 py-10 text-center">
                    <Loader2 className="mb-4 h-10 w-10 animate-spin text-cyan-300" />
                    <p className="text-base font-medium text-white">{t.installing}</p>
                    <p className="mt-2 text-sm leading-6 text-white/60">
                      {tr(
                        '正在执行真实安装并写入宿主配置。未接入分阶段后端事件前，这里不再显示伪进度百分比。',
                        'Performing real installation and writing host configs. Fake percentage progress is hidden until staged backend events are available.'
                      )}
                    </p>
                    <p className="mt-3 text-xs text-white/40">
                      {tr('目标：', 'Targets: ')}{joinLocalized(selectedPlatforms.map((platform) => PLATFORM_CONFIG[platform]?.name ?? platform))}
                    </p>
                  </div>

                  {installSummary && (
                    <p className="mt-4 text-sm text-emerald-300">{installSummary}</p>
                  )}
                  {installError && (
                    <p className="mt-4 text-sm text-rose-300">{installError}</p>
                  )}
                </div>
              ) : (
                // Selection state
                <>
                  <div className="min-h-0 flex-1 overflow-y-auto pb-2 pr-1">
                    {item.install_strategy === 'registry_remote_auth' && (
                      <div className="mb-6 rounded-xl border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-sm leading-6 text-amber-100">
                        {tr(
                          '该条目首次安装会写入凭据占位字段',
                          'This item writes credential placeholders on first install'
                        )}
                        {item.auth_headers?.length
                          ? (isEnglishLocale
                              ? ` (${joinLocalized(item.auth_headers)})`
                              : `（${joinLocalized(item.auth_headers)}）`)
                          : ''}
                        {tr('。', '.')}
                        {tr(
                          '为避免误填密钥，AgentShield 不会自动注入真实凭据，请在宿主配置中手动补全。',
                          'To avoid credential mistakes, AgentShield never auto-injects real secrets. Fill them manually in host config.'
                        )}
                      </div>
                    )}

                    {/* Platform selection */}
                    <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                      <h3 className="mb-2 text-sm font-medium text-white">{tr('安装目标（AI 工具）', 'Install targets (AI tools)')}</h3>
                      <p className="mb-3 text-xs text-white/55">
                        {tr(
                          '只会写入你勾选的真实宿主配置，不会修改系统其它应用。',
                          'Only selected real host configs will be written. No unrelated apps are modified.'
                        )}
                      </p>
                      <div className="space-y-2">
                        {detectedPlatforms
                          .filter((platform) => item.compatible_platforms.includes(platform.platform))
                          .map(({ platform, installed, statusLabel }) => (
                            <PlatformCheckbox
                              key={platform}
                              platform={platform}
                              installed={installed}
                              statusLabel={statusLabel}
                              checked={selectedPlatforms.includes(platform)}
                              onChange={() => togglePlatform(platform)}
                            />
                          ))}
                      </div>
                      {detectedPlatforms.filter((platform) => item.compatible_platforms.includes(platform.platform)).length === 0 && (
                        <p className="mt-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm leading-6 text-white/60">
                          {tr(
                            '未检测到可安装此条目的本机 CLI / IDE。只会展示真实存在且可写入配置的目标。',
                            'No compatible local CLI/IDE detected for this item. Only real writable targets are shown.'
                          )}
                        </p>
                      )}
                      {installError && (
                        <p className="mt-3 text-sm text-rose-300">{installError}</p>
                      )}
                    </div>

                    {/* Permissions */}
                    <div className="mb-5">
                      <h3 className="text-sm font-medium text-white/70 mb-3">{t.permissionExplain}</h3>
                      <div className="flex flex-wrap gap-3">
                        {buildInstallPermissions(item).map((permission) => (
                          <PermissionTag key={permission.label} icon={permission.icon} label={permission.label} />
                        ))}
                      </div>
                    </div>

                    <div className="mb-5">
                      <h3 className="text-sm font-medium text-white/70 mb-3">{tr('安装前预览', 'Pre-install preview')}</h3>
                      <div className="space-y-3">
                        {buildInstallPreview(item, installTargets).map((line) => (
                          <div
                            key={line}
                            className="rounded-xl border border-cyan-400/15 bg-cyan-400/8 px-4 py-3 text-sm leading-6 text-cyan-50"
                          >
                            {line}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mb-2">
                      <h3 className="text-sm font-medium text-white/70 mb-3">{tr('将写入这些宿主配置', 'Host configs to be written')}</h3>
                      <div className="space-y-2">
                        {installTargets.length > 0 ? installTargets.map((target) => (
                          <div
                            key={`${target.platform}:${target.config_path}`}
                            className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70"
                          >
                            <div className="text-white">
                              {PLATFORM_CONFIG[target.platform]?.name ?? target.platform}
                            </div>
                            <div className="mt-1 break-all text-xs text-white/50">{target.config_path}</div>
                            <div className="mt-2 text-xs text-cyan-200/70">
                              {target.exists
                                ? tr('会改写现有 MCP 配置', 'Will update existing MCP config')
                                : tr('会创建新的 MCP 配置文件', 'Will create a new MCP config file')}
                            </div>
                          </div>
                        )) : (
                          <p className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm leading-6 text-white/60">
                            {tr(
                              '将只写入你当前选中的真实 AI 工具宿主配置，不会扫描或修改系统其它程序。',
                              'Only selected real AI host configs are written. No scanning or modification of unrelated programs.'
                            )}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-4 flex shrink-0 items-center justify-end gap-3 border-t border-white/10 pt-4">
                    <GhostButton onClick={onClose}>
                      {t.cancel}
                    </GhostButton>
                    <RoundCTAButton
                      glowColor="#0EA5E9"
                      size="secondary"
                      onClick={handleConfirm}
                      disabled={selectedPlatforms.length === 0 || item.installable === false}
                    >
                      {oneClickInstallUnlocked ? t.install : tr('手动安装指引', 'Manual install guide')}
                    </RoundCTAButton>
                  </div>
                </>
              )}
            </GlassmorphicCard>
            <ManualModeGateDialog
              open={manualGateOpen}
              onOpenChange={setManualGateOpen}
              title={tr('手动安装模式已启用', 'Manual install mode is active')}
              description={tr('14 天试用已结束。免费版不能一键托管安装。', 'Your 14-day trial has ended. One-click managed install is unavailable on free plan.')}
              impacts={[
                tr('你需要自行下载并核对来源，手动写入宿主配置文件。', 'Download manually, verify source, and write host config yourself.'),
                tr('若误装恶意包或填错配置，可能导致密钥泄露、异常联网或宿主崩溃。', 'Installing malicious packages or wrong config may leak secrets, trigger suspicious networking, or crash host apps.'),
                tr('完整版可在你确认后自动安装并验证写入路径。', 'Full edition can auto-install and verify write paths after your approval.')
              ]}
              manualLabel={tr('打开官方来源手动安装', 'Open official source for manual install')}
              onManual={() => {
                const manualUrl = resolveManualSourceUrl(item);
                if (manualUrl) {
                  void openExternalUrl(manualUrl);
                }
              }}
              onUpgrade={() => setCurrentModule('upgradePro')}
              upgradeLabel={tr('⚡ 一键托管安装', '⚡ Managed one-click install')}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface PermissionTagProps {
  icon: React.ReactNode;
  label: string;
}

function PermissionTag({ icon, label }: PermissionTagProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 text-sm text-white/70">
      {icon}
      {label}
    </div>
  );
}

interface PlatformCheckboxProps {
  platform: Platform;
  installed: boolean;
  statusLabel: string;
  checked: boolean;
  onChange: () => void;
}

function PlatformCheckbox({ platform, installed, statusLabel, checked, onChange }: PlatformCheckboxProps) {
  const config = PLATFORM_CONFIG[platform];

  return (
    <button
      type="button"
      onClick={onChange}
      className={cn(
        'flex w-full items-center gap-3 p-3 rounded-xl text-left transition-colors',
        checked ? 'bg-white/10' : 'hover:bg-white/5'
      )}
    >
      <div
        className={cn(
          'w-5 h-5 rounded border-2 flex items-center justify-center transition-colors',
          checked ? 'bg-cyan-500 border-cyan-500' : 'border-white/30'
        )}
      >
        {checked && <Check className="w-3 h-3 text-white" />}
      </div>
      <span className="text-lg">{config.icon}</span>
      <span className="flex-1 text-white">{config.name}</span>
      <span className={cn('text-xs', installed ? 'text-white/40' : 'text-cyan-200/70')}>
        {statusLabel}
      </span>
    </button>
  );
}

function buildInstallPermissions(item: StoreCatalogItem) {
  const permissions = [
    { icon: <FileText className="w-4 h-4" />, label: t.readWriteFiles },
  ];

  if (item.install_strategy === 'builtin_npm' || item.install_strategy === 'registry_npm') {
    permissions.push({ icon: <Globe className="w-4 h-4" />, label: t.accessNetwork });
    permissions.push({ icon: <Zap className="w-4 h-4" />, label: t.executeCommands });
    return permissions;
  }

  if (item.install_strategy === 'registry_remote' || item.install_strategy === 'registry_remote_auth') {
    permissions.push({ icon: <Globe className="w-4 h-4" />, label: tr('连接远端 MCP 服务', 'Connect to remote MCP service') });
    if (item.install_strategy === 'registry_remote_auth') {
      permissions.push({ icon: <Zap className="w-4 h-4" />, label: tr('需要手动补充凭据字段', 'Manual credential fields required') });
    }
  }

  return permissions;
}

function buildInstallCapabilities(item: StoreCatalogItem) {
  const capabilities = [tr('读写本地文件', 'Read/write local files')];
  if (item.install_strategy === 'builtin_npm' || item.install_strategy === 'registry_npm') {
    capabilities.push(tr('联网下载依赖', 'Download dependencies via network'));
    capabilities.push(tr('命令执行', 'Execute commands'));
  } else if (item.install_strategy === 'registry_remote') {
    capabilities.push(tr('联网访问远端服务', 'Access remote service via network'));
  } else if (item.install_strategy === 'registry_remote_auth') {
    capabilities.push(tr('联网访问远端服务', 'Access remote service via network'));
    capabilities.push(tr('需你手动填写认证信息', 'Manual authentication fields required'));
  }
  return capabilities;
}

function buildInstallPreview(item: StoreCatalogItem, targets: InstallTargetPath[]) {
  const lines = [
    item.source_url
      ? tr(`来源: ${item.source_url}`, `Source: ${item.source_url}`)
      : tr(`来源标识: ${item.install_identifier || item.id}`, `Source identifier: ${item.install_identifier || item.id}`),
  ];

  if (item.install_strategy === 'builtin_npm' || item.install_strategy === 'registry_npm') {
    lines.push(tr(
      `安装方式: npm / npx 包 ${item.install_identifier}${item.install_version ? `@${item.install_version}` : '（安装时解析最新版本）'}`,
      `Install method: npm / npx package ${item.install_identifier}${item.install_version ? `@${item.install_version}` : ' (resolve latest at install time)'}`
    ));
  } else if (item.install_strategy === 'registry_remote') {
    lines.push(tr(`安装方式: 远端 MCP 地址 ${item.install_identifier}`, `Install method: remote MCP URL ${item.install_identifier}`));
  } else if (item.install_strategy === 'registry_remote_auth') {
    lines.push(tr(`安装方式: 远端 MCP 地址 ${item.install_identifier}`, `Install method: remote MCP URL ${item.install_identifier}`));
    if (item.auth_headers?.length) {
      lines.push(tr(
        `首次安装会写入凭据占位字段: ${item.auth_headers.join('、')}`,
        `Credential placeholders written on first install: ${joinLocalized(item.auth_headers)}`
      ));
    } else {
      lines.push(tr(
        '首次安装会写入默认凭据占位字段，请在宿主配置中手动补全。',
        'Default credential placeholders are written on first install; complete them manually in host config.'
      ));
    }
  }

  if (targets.length > 0) {
    lines.push(tr(
      `写入目标: ${joinLocalized(targets.map((target) => PLATFORM_CONFIG[target.platform]?.name ?? target.platform))}`,
      `Write targets: ${joinLocalized(targets.map((target) => PLATFORM_CONFIG[target.platform]?.name ?? target.platform))}`
    ));
  }

  lines.push(tr(
    '放行后会真实写入 MCP / Skill 宿主配置，不会修改系统其它无关应用。',
    'After approval, MCP / Skill host configs are really written. No unrelated apps are modified.'
  ));
  return lines;
}

function resolveManualSourceUrl(item: StoreCatalogItem): string | null {
  if (item.source_url) {
    return item.source_url;
  }

  if (item.install_strategy === 'builtin_npm' || item.install_strategy === 'registry_npm') {
    const spec = (item.install_identifier ?? '').trim();
    if (!spec) {
      return null;
    }

    const pkgName = spec.startsWith('@')
      ? (() => {
          const slashIndex = spec.indexOf('/');
          const versionIndex = spec.lastIndexOf('@');
          if (slashIndex >= 0 && versionIndex > slashIndex) {
            return spec.slice(0, versionIndex);
          }
          return spec;
        })()
      : (() => {
          const versionIndex = spec.lastIndexOf('@');
          return versionIndex > 0 ? spec.slice(0, versionIndex) : spec;
        })();

    return pkgName ? `https://www.npmjs.com/package/${encodeURIComponent(pkgName)}` : null;
  }

  if (item.install_strategy === 'registry_remote' || item.install_strategy === 'registry_remote_auth') {
    return item.install_identifier || null;
  }

  return null;
}
