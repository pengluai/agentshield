import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Lock,
  ShieldCheck,
  ShieldX,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { isEnglishLocale } from '@/constants/i18n';
import type { RuntimeApprovalRequest } from '@/services/runtime-guard';
import {
  getRiskCopyPayload,
  getRiskCopyVariant,
  trackRiskCopyAction,
  trackRiskCopyExposure,
} from '@/services/copy-experiments';
import { localizedDynamicText } from '@/lib/locale-text';

interface RuntimeApprovalModalProps {
  request: RuntimeApprovalRequest | null;
  queueSize: number;
  busy: boolean;
  errorMessage?: string | null;
  onApprove: (request: RuntimeApprovalRequest) => void;
  onDeny: (request: RuntimeApprovalRequest) => void;
}

const tr = (zh: string, en: string) => (isEnglishLocale ? en : zh);

function formatHeadline(request: RuntimeApprovalRequest) {
  if (request.request_kind === 'launch') {
    return tr(
      `${request.component_name} 正在尝试运行`,
      `${request.component_name} is trying to start`,
    );
  }
  if (request.requested_host) {
    return tr(
      `${request.component_name} 正在尝试连接 ${request.requested_host}`,
      `${request.component_name} is trying to connect to ${request.requested_host}`,
    );
  }
  return tr(
    `${request.component_name} 正在尝试执行一个高风险操作`,
    `${request.component_name} is attempting a high-risk action`,
  );
}

function actionKindLabel(actionKind: string) {
  switch (actionKind) {
    case 'component_launch':
      return tr('启动扩展组件', 'Start extension component');
    case 'network_access':
      return tr('放行新的联网地址', 'Allow a new network destination');
    case 'component_install':
      return tr('安装扩展组件', 'Install extension component');
    case 'file_delete':
      return tr('删除文件或配置', 'Delete files or configuration');
    case 'bulk_file_modify':
      return tr('批量改动文件', 'Modify files in batch');
    case 'credential_delete':
      return tr('删除密钥', 'Delete credential');
    case 'credential_export':
      return tr('导出或显示密钥', 'Export or reveal credential');
    case 'browser_submit':
      return tr('提交网页表单', 'Submit web form');
    case 'payment_submit':
      return tr('提交支付', 'Submit payment');
    case 'email_send':
      return tr('发送邮件', 'Send email');
    case 'email_delete_or_archive':
      return tr('删除或归档邮件', 'Delete or archive email');
    case 'shell_exec':
      return tr('执行系统命令', 'Execute system command');
    case 'high_risk_operation':
      return tr('执行高危操作', 'Execute high-risk action');
    default:
      return tr('待确认动作', 'Action pending approval');
  }
}

function actionSourceLabel(actionSource: string) {
  switch (actionSource) {
    case 'user_requested_launch':
      return tr('你刚才点了启动', 'You just requested a launch');
    case 'user_requested_install':
      return tr('你刚才发起了一键安装', 'You just requested one-click install');
    case 'user_requested_update':
      return tr('你刚才发起了更新', 'You just requested an update');
    case 'user_requested_uninstall':
      return tr('你刚才发起了卸载', 'You just requested uninstall');
    case 'user_requested_key_export':
      return tr('你刚才发起了密钥导出/复制', 'You just requested key export/copy');
    case 'user_requested_key_delete':
      return tr('你刚才发起了密钥删除', 'You just requested key deletion');
    case 'runtime_network_policy':
      return tr('运行时守卫拦下了新的联网地址', 'Runtime guard blocked a new network destination');
    case 'runtime_guard_policy':
      return tr('系统规则要求先由你确认', 'Policy requires your confirmation first');
    default:
      return tr('AgentShield 正在等待你决定', 'AgentShield is waiting for your decision');
  }
}

export function RuntimeApprovalModal({
  request,
  queueSize,
  busy,
  errorMessage,
  onApprove,
  onDeny,
}: RuntimeApprovalModalProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const copyVariant = getRiskCopyVariant();
  const copy = getRiskCopyPayload('runtime_approval', copyVariant);

  useEffect(() => {
    setDetailsOpen(false);
  }, [request?.id]);

  useEffect(() => {
    if (!request) {
      return;
    }

    trackRiskCopyExposure('runtime_approval', {
      request_id: request.id,
      action_kind: request.action_kind,
      platform_id: request.platform_id,
    });
  }, [request?.id]);

  const actionTargets = request?.action_targets ?? [];
  const actionPreview = request?.action_preview ?? [];
  const modal = (
    <AnimatePresence>
      {request ? (
        <motion.div
          key={request.id}
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 280, damping: 24 }}
          className="pointer-events-none fixed bottom-4 right-4 z-[120] w-[min(440px,calc(100vw-1.5rem))]"
        >
          <div
            role="dialog"
            aria-modal="false"
            aria-labelledby={`runtime-approval-title-${request.id}`}
            className="pointer-events-auto overflow-hidden rounded-3xl border border-white/15 bg-[radial-gradient(circle_at_top,#1e3a8a_0%,#0f172a_58%,#020617_100%)] shadow-[0_24px_70px_rgba(2,6,23,0.7)] backdrop-blur-md"
          >
            <div className="border-b border-white/10 px-4 py-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-400/15 text-amber-300 ring-1 ring-amber-300/25">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-rose-400/15 px-2.5 py-1 text-[10px] font-semibold tracking-[0.12em] text-rose-100">
                      {tr('默认先拦住', 'Blocked by default')}
                    </span>
                    {queueSize > 1 ? (
                      <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] text-white/70">
                        {tr(`还有 ${queueSize - 1} 个待你决定`, `${queueSize - 1} more waiting for your decision`)}
                      </span>
                    ) : null}
                  </div>
                  <h2
                    id={`runtime-approval-title-${request.id}`}
                    className="line-clamp-2 text-lg font-semibold leading-6 text-white"
                  >
                    {localizedDynamicText(request.title, formatHeadline(request))}
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-slate-200">
                    {localizedDynamicText(
                      request.summary,
                      tr(
                        '请确认该高风险操作来源可信，再决定是否放行。',
                        'Confirm this high-risk action is trusted before deciding whether to allow it.'
                      )
                    )}
                  </p>
                  <p className="mt-2 text-xs font-medium text-cyan-100">
                    {formatHeadline(request)}
                  </p>
                </div>
                <div className="rounded-full bg-white/10 px-2 py-1 text-[10px] text-white/70">
                  {request.platform_name}
                </div>
              </div>
            </div>

            <div className="space-y-3 px-4 py-3">
              <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/8 px-3 py-2.5 text-xs leading-5 text-cyan-50">
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-2 py-0.5 font-medium">
                    {actionKindLabel(request.action_kind)}
                  </span>
                  <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-white/80">
                    {actionSourceLabel(request.action_source)}
                  </span>
                </div>
                {localizedDynamicText(
                  request.consequence_lines[0] ?? tr('这次操作可能带来不可逆改动。', 'This action may cause irreversible changes.'),
                  tr('这次操作可能带来不可逆改动。', 'This action may cause irreversible changes.'),
                )}
              </div>

              {request.consequence_lines.length > 1 ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs leading-5 text-slate-200">
                  {localizedDynamicText(
                    request.consequence_lines[1],
                    tr('这次操作仍会保持拦截，直到你确认。', 'This action remains blocked until you approve it.')
                  )}
                </div>
              ) : null}

              <div className="rounded-xl border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-[11px] leading-5 text-amber-100">
                {localizedDynamicText(
                  copy.hookLine,
                  tr(
                    '当前为风险动作审批。请确认来源可信后再放行。',
                    'This is a high-risk approval. Confirm the source is trusted before allowing.'
                  )
                )}
              </div>

              <AnimatePresence initial={false}>
                {detailsOpen ? (
                  <motion.div
                    key="approval-details"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                    className="space-y-3 overflow-hidden"
                  >
                    <div className="grid gap-2 md:grid-cols-2">
                      <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                        <div className="mb-1 text-[11px] text-white/70">{tr('动作类型', 'Action type')}</div>
                        <div className="text-xs leading-5 text-white/90">
                          {actionKindLabel(request.action_kind)}
                        </div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                        <div className="mb-1 text-[11px] text-white/70">{tr('触发来源', 'Triggered by')}</div>
                        <div className="text-xs leading-5 text-white/90">
                          {actionSourceLabel(request.action_source)}
                        </div>
                      </div>
                    </div>

                    {actionTargets.length > 0 ? (
                      <div>
                        <div className="mb-1 text-[11px] text-white/70">{tr('目标', 'Targets')}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {actionTargets.map((target) => (
                            <span
                              key={target}
                              className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1 text-[11px] text-cyan-50"
                            >
                              {localizedDynamicText(target, tr('目标', 'Target'))}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {actionPreview.length > 0 ? (
                      <div>
                        <div className="mb-1 text-[11px] text-white/70">{tr('执行前预览', 'Pre-execution preview')}</div>
                        <div className="space-y-1.5">
                          {actionPreview.map((line) => (
                            <div
                              key={line}
                              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100"
                            >
                              {localizedDynamicText(
                                line,
                                tr('该步骤包含潜在高风险动作。', 'This step includes a potentially high-risk action.')
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {request.sensitive_capabilities.length > 0 ? (
                      <div>
                        <div className="mb-1 flex items-center gap-1.5 text-[11px] text-white/70">
                          <Lock className="h-3.5 w-3.5 text-amber-300" />
                          {tr('可能涉及', 'May involve')}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {request.sensitive_capabilities.map((capability) => (
                            <span
                              key={capability}
                              className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/80"
                            >
                              {localizedDynamicText(capability, tr('敏感能力', 'Sensitive capability'))}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </motion.div>
                ) : null}
              </AnimatePresence>

              {errorMessage ? (
                <div className="rounded-xl border border-rose-300/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                  {errorMessage}
                </div>
              ) : null}
            </div>

            <div className="border-t border-white/10 bg-black/15 px-4 py-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    trackRiskCopyAction(
                      'runtime_approval',
                      detailsOpen ? 'collapse_details' : 'expand_details',
                      request
                        ? {
                            request_id: request.id,
                            action_kind: request.action_kind,
                          }
                        : {}
                    );
                    setDetailsOpen((open) => !open);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-white/75 transition-colors hover:bg-white/10 hover:text-white"
                >
                  {detailsOpen ? (
                    <>
                      {tr('收起详情', 'Hide details')}
                      <ChevronUp className="h-3.5 w-3.5" />
                    </>
                  ) : (
                    <>
                      {tr('查看详情', 'View details')}
                      <ChevronDown className="h-3.5 w-3.5" />
                    </>
                  )}
                </button>
                <div className="text-[11px] text-slate-300">
                  {localizedDynamicText(
                    copy.footerLine ?? tr('不点允许，这次操作就不会被放行', 'If you do not allow it, this action will stay blocked.'),
                    tr('不点允许，这次操作就不会被放行', 'If you do not allow it, this action will stay blocked.'),
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    trackRiskCopyAction('runtime_approval', 'deny', {
                      request_id: request.id,
                      action_kind: request.action_kind,
                      platform_id: request.platform_id,
                    });
                    onDeny(request);
                  }}
                  disabled={busy}
                  className={cn(
                    'inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                    busy
                      ? 'cursor-not-allowed bg-white/10 text-white/35'
                      : 'bg-white/10 text-white/80 hover:bg-white/15'
                  )}
                >
                  <ShieldX className="h-4 w-4" />
                  {localizedDynamicText(request.deny_label, tr('继续拦住', 'Keep blocked'))}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    trackRiskCopyAction('runtime_approval', 'approve', {
                      request_id: request.id,
                      action_kind: request.action_kind,
                      platform_id: request.platform_id,
                    });
                    onApprove(request);
                  }}
                  disabled={busy}
                  className={cn(
                    'inline-flex flex-[1.2] items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                    busy
                      ? 'cursor-not-allowed bg-emerald-400/20 text-emerald-100/40'
                      : 'bg-emerald-400 text-slate-950 hover:bg-emerald-300'
                  )}
                >
                  <ShieldCheck className="h-4 w-4" />
                  {busy
                    ? tr('处理中…', 'Processing…')
                    : localizedDynamicText(
                      request.approval_label,
                      request.request_kind === 'launch'
                        ? tr('允许并受控启动', 'Allow and launch safely')
                        : tr('允许并继续', 'Allow and continue'),
                    )}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  if (typeof document === 'undefined') {
    return modal;
  }

  return createPortal(modal, document.body);
}
