import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Check, X } from 'lucide-react';
import { PLATFORM_CONFIG } from '@/constants/colors';
import type { Platform } from '@/types/domain';

interface PlatformBadgeProps {
  platform: Platform;
  detected?: boolean;
  showName?: boolean;
  size?: 'small' | 'normal';
  className?: string;
}

export function PlatformBadge({
  platform,
  detected = true,
  showName = true,
  size = 'normal',
  className,
}: PlatformBadgeProps) {
  const config = PLATFORM_CONFIG[platform];

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full',
        'bg-white/10 border border-white/10',
        size === 'small' ? 'px-2 py-0.5' : 'px-3 py-1.5',
        !detected && 'opacity-50',
        className
      )}
    >
      {/* Platform icon/emoji */}
      <span className={size === 'small' ? 'text-xs' : 'text-sm'}>
        {config.icon}
      </span>

      {/* Platform name */}
      {showName && (
        <span className={cn(
          'font-medium text-white',
          size === 'small' ? 'text-xs' : 'text-sm'
        )}>
          {config.name}
        </span>
      )}

      {/* Detection status */}
      <span
        className={cn(
          'flex items-center justify-center rounded-full',
          size === 'small' ? 'w-3.5 h-3.5' : 'w-4 h-4',
          detected ? 'bg-green-500/20' : 'bg-white/10'
        )}
      >
        {detected ? (
          <Check className={cn(
            'text-green-400',
            size === 'small' ? 'w-2 h-2' : 'w-2.5 h-2.5'
          )} />
        ) : (
          <X className={cn(
            'text-white/40',
            size === 'small' ? 'w-2 h-2' : 'w-2.5 h-2.5'
          )} />
        )}
      </span>
    </motion.div>
  );
}

// Row of platform badges
interface PlatformBadgeRowProps {
  platforms: { platform: Platform; detected: boolean }[];
  className?: string;
}

export function PlatformBadgeRow({ platforms, className }: PlatformBadgeRowProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {platforms.map(({ platform, detected }) => (
        <PlatformBadge
          key={platform}
          platform={platform}
          detected={detected}
          size="small"
        />
      ))}
    </div>
  );
}

// Small platform icon for store cards
interface PlatformIconProps {
  platform: Platform;
  className?: string;
}

export function PlatformIcon({ platform, className }: PlatformIconProps) {
  const config = PLATFORM_CONFIG[platform];

  return (
    <span
      className={cn('text-sm', className)}
      title={config.name}
    >
      {config.icon}
    </span>
  );
}
