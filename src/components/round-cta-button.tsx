import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface RoundCTAButtonProps {
  children: ReactNode;
  glowColor?: string;
  size?: 'primary' | 'secondary';
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

const sizeConfig = {
  primary: {
    size: 'w-20 h-20',
    text: 'text-base font-semibold',
  },
  secondary: {
    size: 'w-16 h-16',
    text: 'text-sm font-medium',
  },
};

export function RoundCTAButton({
  children,
  glowColor = '#0EA5E9',
  size = 'primary',
  onClick,
  disabled,
  className,
}: RoundCTAButtonProps) {
  const config = sizeConfig[size];

  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      animate={{
        boxShadow: [
          `0 0 20px ${glowColor}50`,
          `0 0 40px ${glowColor}70`,
          `0 0 20px ${glowColor}50`,
        ],
      }}
      transition={{
        boxShadow: {
          duration: 2,
          repeat: Infinity,
          ease: 'easeInOut',
        },
      }}
      className={cn(
        'rounded-full flex items-center justify-center',
        'text-white',
        'transition-all duration-300',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        config.size,
        config.text,
        className
      )}
      style={{
        background: `linear-gradient(135deg, ${glowColor} 0%, ${adjustColor(glowColor, -30)} 100%)`,
        boxShadow: `0 0 30px ${glowColor}50`,
      }}
    >
      {children}
    </motion.button>
  );
}

// Helper to darken color
function adjustColor(color: string, amount: number): string {
  const hex = color.replace('#', '');
  const num = parseInt(hex, 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amount));
  const b = Math.max(0, Math.min(255, (num & 0x0000FF) + amount));
  return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
}

// Ghost variant for secondary actions
interface GhostButtonProps {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}

export function GhostButton({ children, onClick, className }: GhostButtonProps) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        'px-6 py-2.5 rounded-xl',
        'text-sm font-medium text-white/70',
        'bg-white/5 hover:bg-white/10',
        'border border-white/10',
        'transition-all duration-200',
        className
      )}
    >
      {children}
    </motion.button>
  );
}
