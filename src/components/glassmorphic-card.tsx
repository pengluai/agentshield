import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';
import { t } from '@/constants/i18n';
import { localizedDynamicText, translateBackendText } from '@/lib/locale-text';

interface GlassmorphicCardProps {
  children?: ReactNode;
  gradient?: {
    from: string;
    to: string;
  };
  size?: 'small' | 'normal' | 'large';
  className?: string;
  onClick?: () => void;
  selected?: boolean;
  glowColor?: string;
}

const sizeStyles = {
  small: 'p-4',
  normal: 'p-5',
  large: 'p-6',
};

export function GlassmorphicCard({
  children,
  gradient,
  size = 'normal',
  className,
  onClick,
  selected,
  glowColor,
}: GlassmorphicCardProps) {
  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      whileHover={{ scale: 1.02 }}
      onClick={onClick}
      className={cn(
        'relative rounded-2xl overflow-hidden',
        'backdrop-blur-xl',
        'border border-white/10',
        'transition-all duration-300',
        onClick && 'cursor-pointer',
        selected && 'ring-2 ring-offset-2 ring-offset-transparent',
        sizeStyles[size],
        className
      )}
      style={{
        background: gradient
          ? `linear-gradient(135deg, ${gradient.from}90 0%, ${gradient.to}60 100%)`
          : 'rgba(255, 255, 255, 0.05)',
        boxShadow: selected && glowColor
          ? `0 0 30px ${glowColor}40, inset 0 0 30px ${glowColor}10`
          : glowColor
            ? `0 0 20px ${glowColor}20`
            : '0 8px 32px rgba(0, 0, 0, 0.3)',
        '--tw-ring-color': selected ? glowColor : 'transparent',
      } as any}
    >
      {/* Subtle gradient overlay */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.1) 0%, transparent 50%)',
        }}
      />

      {/* Content */}
      <div className="relative z-10">
        {children}
      </div>
    </motion.div>
  );
}

// Variant for scan result cards with checkmark
interface ScanResultCardProps extends GlassmorphicCardProps {
  title: string;
  icon?: ReactNode;
  status?: 'waiting' | 'scanning' | 'completed';
  result?: {
    issueCount: number;
    canFix: boolean;
    message?: string;
    headline?: string;
    detail?: string;
    actionLabel?: string;
  };
  onViewClick?: () => void;
}

export function ScanResultCard({
  title,
  icon,
  status = 'waiting',
  result,
  gradient,
  size = 'normal',
  className,
  onViewClick,
}: ScanResultCardProps) {
  const hasIssues = result && result.issueCount > 0;
  const headlineRaw = result?.headline
    ?? (hasIssues ? `${result.issueCount} ${t.warning}` : t.allPassed);
  const detailRaw = result?.detail
    ?? (hasIssues && result?.canFix ? t.canFix : result?.message ?? '');
  const actionLabelRaw = result?.actionLabel ?? t.view;
  const headline = localizedDynamicText(headlineRaw, translateBackendText(headlineRaw));
  const detail = detailRaw
    ? localizedDynamicText(detailRaw, translateBackendText(detailRaw))
    : '';
  const actionLabel = localizedDynamicText(actionLabelRaw, translateBackendText(actionLabelRaw));

  return (
    <GlassmorphicCard
      gradient={gradient}
      size={size}
      className={className}
    >
      <div className="flex flex-col h-full">
        {/* Header with checkmark */}
        <div className="flex items-center gap-2 mb-3">
          {status === 'completed' && (
            <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center">
              <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
          )}
          <span className="text-sm font-medium text-white/80">{title}</span>
        </div>

        {/* Icon area */}
        <div className="flex-1 flex items-center justify-center py-2">
          {icon || (
            <div className="w-24 h-24 rounded-2xl bg-white/10 flex items-center justify-center">
              {status === 'scanning' && (
                <div className="w-12 h-12 border-2 border-white/30 border-t-white rounded-full animate-rotate" />
              )}
            </div>
          )}
        </div>

        {/* Result or status */}
        <div className="mt-auto">
          {status === 'scanning' && (
            <p className="text-sm text-white/60 text-center">{t.scanning}</p>
          )}
          {status === 'waiting' && (
            <p className="text-sm text-white/60 text-center">{t.waiting}</p>
          )}
          {status === 'completed' && result && (
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[clamp(1.7rem,2.2vw,2.1rem)] font-bold text-white leading-tight break-words">
                  {headline}
                </p>
                {detail && (
                  <p className="mt-1 text-sm text-white/60 line-clamp-1">{detail}</p>
                )}
              </div>
              {onViewClick && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewClick();
                  }}
                  className="inline-flex h-10 min-w-[104px] shrink-0 items-center justify-center rounded-lg bg-white/20 px-4 text-sm font-medium leading-none whitespace-nowrap text-white transition-colors hover:bg-white/30"
                >
                  {actionLabel}
                </button>
              )}
            </div>
          )}
          {status === 'completed' && !result && (
            <p className="text-sm text-white/60 text-center">{t.done}</p>
          )}
        </div>
      </div>
    </GlassmorphicCard>
  );
}
