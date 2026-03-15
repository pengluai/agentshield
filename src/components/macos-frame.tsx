import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { RotateCcw } from 'lucide-react';
import { t } from '@/constants/i18n';
import type { ReactNode } from 'react';

interface MacOSFrameProps {
  children: ReactNode;
  title?: string;
  showRestart?: boolean;
  onRestart?: () => void;
  glowColor?: string;
  surfaceGradient?: {
    from: string;
    via?: string;
    to: string;
  };
  className?: string;
  contentScrollMode?: 'auto' | 'hidden';
}

export function MacOSFrame({
  children,
  title,
  showRestart,
  onRestart,
  glowColor,
  surfaceGradient,
  className,
  contentScrollMode = 'auto',
}: MacOSFrameProps) {
  const isMac =
    typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent);

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className={cn(
        'relative w-full h-screen overflow-hidden',
        '',
        className
      )}
      style={{
        background: surfaceGradient
          ? surfaceGradient.via
            ? `linear-gradient(135deg, ${surfaceGradient.from} 0%, ${surfaceGradient.via} 45%, ${surfaceGradient.to} 100%)`
            : `linear-gradient(135deg, ${surfaceGradient.from} 0%, ${surfaceGradient.to} 100%)`
          : undefined,
        boxShadow: glowColor
          ? `0 0 60px ${glowColor}30, inset 0 0 0 1px rgba(255,255,255,0.1)`
          : 'inset 0 0 0 1px rgba(255,255,255,0.1)',
      }}
    >
      {/* On macOS, reserve native traffic-light hit area to avoid close-button dead zones. */}
      {!isMac ? (
        <div className="absolute inset-x-0 top-0 z-50 h-10 pointer-events-none" data-tauri-drag-region />
      ) : (
        <div className="absolute right-0 top-0 z-50 h-10 w-[calc(100%-96px)] pointer-events-none" data-tauri-drag-region />
      )}
      {showRestart ? (
        <div className="absolute left-20 top-2 z-50 pointer-events-auto">
          <button
            onClick={onRestart}
            className="flex items-center gap-1.5 rounded-md bg-black/15 px-2 py-1 text-sm text-white/70 transition-colors hover:text-white"
          >
            <RotateCcw className="w-4 h-4" />
            {t.restart}
          </button>
        </div>
      ) : null}

      {/* Content */}
      <div
        className={cn(
          'absolute inset-0 overflow-x-hidden',
          contentScrollMode === 'auto' ? 'overflow-y-auto' : 'overflow-y-hidden',
        )}
      >
        {children}
      </div>
    </motion.div>
  );
}

// Status bar at the bottom
interface StatusBarProps {
  leftContent?: ReactNode;
  rightContent?: ReactNode;
  className?: string;
}

export function StatusBar({ leftContent, rightContent, className }: StatusBarProps) {
  return (
    <div className={cn(
      'flex items-center justify-between px-6 py-3',
      'bg-black/20 backdrop-blur-sm',
      'border-t border-white/10',
      className
    )}>
      <div className="flex items-center gap-4 text-sm text-white/70">
        {leftContent}
      </div>
      <div className="flex items-center gap-4 text-sm text-white/60">
        {rightContent}
      </div>
    </div>
  );
}

// Real-time protection indicator
interface ProtectionStatusProps {
  enabled: boolean;
  detail?: string;
}

export function ProtectionStatus({ enabled, detail }: ProtectionStatusProps) {
  return (
    <div className="flex items-center gap-6">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'w-2 h-2 rounded-full',
            enabled ? 'bg-green-500' : 'bg-red-500'
          )}
        />
        <span className="text-sm text-white/70">
          {enabled ? t.realTimeProtection : t.protectionDisabled}
        </span>
      </div>
      {detail && (
        <span className="text-sm text-white/50">
          {detail}
        </span>
      )}
    </div>
  );
}
