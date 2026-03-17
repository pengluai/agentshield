import { useState } from 'react';
import { Copy, Check, ChevronDown, ChevronUp, Terminal, FileText, Trash2, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isEnglishLocale } from '@/constants/i18n';
import type { ManualFixStep } from '@/services/scanner';

const tr = (zh: string, en: string) => (isEnglishLocale ? en : zh);

const STEP_ICON_MAP: Record<string, React.ReactNode> = {
  permission: <Shield className="w-4 h-4 text-amber-600" />,
  exposed_key: <FileText className="w-4 h-4 text-red-600" />,
  remove_mcp: <FileText className="w-4 h-4 text-rose-600" />,
  remove_skill: <Trash2 className="w-4 h-4 text-rose-600" />,
};

interface ManualFixGuideProps {
  steps: ManualFixStep[];
  loading?: boolean;
  onDismiss?: () => void;
  onMarkFixed?: () => void;
}

export function ManualFixGuide({ steps, loading, onDismiss, onMarkFixed }: ManualFixGuideProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);
  const [copiedIndex, setCopiedIndex] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center gap-2 text-sm text-slate-500 animate-pulse">
          <Terminal className="w-4 h-4" />
          {tr('正在生成手动修复步骤...', 'Generating manual fix steps...')}
        </div>
      </div>
    );
  }

  if (steps.length === 0) {
    return null;
  }

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(key);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      // Clipboard API may fail in some environments
    }
  };

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-amber-200 bg-amber-50">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-amber-700" />
          <span className="text-sm font-medium text-amber-800">
            {tr('手动修复步骤', 'Manual Fix Steps')}
          </span>
          <span className="text-xs text-amber-600 ml-auto">
            {tr(`共 ${steps.length} 步`, `${steps.length} step${steps.length > 1 ? 's' : ''}`)}
          </span>
        </div>
      </div>

      {/* Steps */}
      <div className="divide-y divide-amber-100">
        {steps.map((step, index) => {
          const isExpanded = expandedIndex === index;
          const stepIcon = STEP_ICON_MAP[step.step_type] ?? <Terminal className="w-4 h-4 text-slate-600" />;

          return (
            <div key={`${step.step_type}-${index}`} className="bg-white/60">
              {/* Step header */}
              <button
                type="button"
                onClick={() => setExpandedIndex(isExpanded ? null : index)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-amber-50/50 transition-colors"
              >
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 text-xs font-semibold text-amber-700 shrink-0">
                  {index + 1}
                </span>
                {stepIcon}
                <span className="flex-1 text-sm text-slate-800 font-medium">{step.title}</span>
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </button>

              {/* Expanded content */}
              {isExpanded && (
                <div className="px-4 pb-4 space-y-3">
                  <p className="text-sm text-slate-600 pl-9">{step.description}</p>

                  {step.target_path && (
                    <div className="pl-9">
                      <span className="text-xs text-slate-500">
                        {tr('目标文件: ', 'Target: ')}
                      </span>
                      <span className="text-xs text-slate-700 font-mono break-all">
                        {step.target_path}
                      </span>
                    </div>
                  )}

                  {step.commands.length > 0 && (
                    <div className="pl-9 space-y-2">
                      <span className="text-xs text-slate-500">
                        {tr('在终端运行以下命令:', 'Run these commands in terminal:')}
                      </span>
                      {step.commands.map((cmd, cmdIndex) => {
                        const copyKey = `${index}-${cmdIndex}`;
                        const isCopied = copiedIndex === copyKey;

                        return (
                          <div
                            key={cmdIndex}
                            className="group flex items-start gap-2 rounded-lg bg-slate-900 p-3"
                          >
                            <code className="flex-1 text-xs text-green-400 font-mono whitespace-pre-wrap break-all leading-5">
                              {cmd}
                            </code>
                            <button
                              type="button"
                              onClick={() => handleCopy(cmd, copyKey)}
                              className={cn(
                                'shrink-0 p-1.5 rounded-md transition-colors',
                                isCopied
                                  ? 'bg-green-600/20 text-green-400'
                                  : 'bg-white/5 text-white/40 hover:text-white/80 hover:bg-white/10'
                              )}
                              title={tr('复制命令', 'Copy command')}
                            >
                              {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {step.severity === 'critical' && (
                    <div className="pl-9 text-xs text-red-600 font-medium">
                      {tr('高危风险，请尽快处理', 'Critical risk - please fix as soon as possible')}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer actions */}
      <div className="px-4 py-3 border-t border-amber-200 bg-amber-50 flex items-center gap-3">
        {onMarkFixed && (
          <button
            type="button"
            onClick={onMarkFixed}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-medium hover:bg-emerald-600 transition-colors"
          >
            <Check className="w-3.5 h-3.5" />
            {tr('我已修复', 'I fixed it')}
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="px-3 py-1.5 rounded-lg bg-white text-slate-600 text-xs font-medium hover:bg-slate-100 border border-slate-200 transition-colors"
          >
            {tr('稍后处理', 'Fix later')}
          </button>
        )}
        <span className="text-xs text-amber-600 ml-auto">
          {tr('免费用户可手动修复', 'Free users: manual fix available')}
        </span>
      </div>
    </div>
  );
}
