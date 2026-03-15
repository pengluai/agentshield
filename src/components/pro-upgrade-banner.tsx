import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Crown } from 'lucide-react';
import { t } from '@/constants/i18n';
import { useAppStore } from '@/stores/appStore';

interface ProUpgradeBannerProps {
  variant?: 'badge' | 'banner' | 'card';
  text?: string;
  tooltip?: string;
  className?: string;
  onClick?: () => void;
}

export function ProUpgradeBanner({
  variant = 'badge',
  text,
  tooltip,
  className,
  onClick,
}: ProUpgradeBannerProps) {
  const handleClick = onClick || (() => useAppStore.getState().setCurrentModule('upgradePro'));

  if (variant === 'badge') {
    return (
      <motion.button
        onClick={handleClick}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className={cn(
          'inline-flex items-center gap-2 px-4 py-2 rounded-full',
          'bg-gradient-to-r from-amber-500 to-yellow-500',
          'text-white text-sm font-semibold',
          'shadow-lg shadow-amber-500/30',
          'hover:shadow-amber-500/50 transition-shadow',
          className
        )}
        title={tooltip}
      >
        <Crown className="w-4 h-4" />
        {text || t.unlockPro}
      </motion.button>
    );
  }

  if (variant === 'banner') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          'flex items-center justify-center gap-2 py-2 px-4',
          'bg-gradient-to-r from-amber-500/20 to-yellow-500/20',
          'border border-amber-500/30 rounded-xl',
          'text-amber-400 text-sm',
          className
        )}
      >
        <Crown className="w-4 h-4" />
        {text || t.upgradeProSubtitle}
      </motion.div>
    );
  }

  // Card variant
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'p-4 rounded-2xl max-w-md mx-auto',
        'bg-gradient-to-r from-amber-500/10 to-yellow-500/10',
        'border border-amber-500/20',
        className
      )}
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-r from-amber-500 to-yellow-500 flex items-center justify-center">
          <Crown className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-white">
            {text || t.proExclusive}
          </p>
          <p className="text-xs text-white/60">{t.freeTrial}</p>
        </div>
        <button
          onClick={handleClick}
          className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-yellow-500 text-white text-sm font-medium hover:opacity-90 transition-opacity"
        >
          {t.upgradePro}
        </button>
      </div>
    </motion.div>
  );
}
