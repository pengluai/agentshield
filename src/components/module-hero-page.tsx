import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { RoundCTAButton } from './round-cta-button';
import { ProUpgradeBanner } from './pro-upgrade-banner';
import type { ReactNode } from 'react';

interface ModuleHeroPageProps {
  moduleName: string;
  description: string;
  ctaText: string;
  ctaColor: string;
  icon?: ReactNode;
  gradient: {
    from: string;
    via?: string;
    to: string;
  };
  onCtaClick?: () => void;
  children?: ReactNode;
}

export function ModuleHeroPage({
  moduleName,
  description,
  ctaText,
  ctaColor,
  icon,
  gradient,
  onCtaClick,
  children,
}: ModuleHeroPageProps) {
  return (
    <div
      className="h-full min-h-0 flex flex-col items-center justify-center relative overflow-hidden"
      style={{
        background: gradient.via
          ? `linear-gradient(135deg, ${gradient.from} 0%, ${gradient.via} 45%, ${gradient.to} 100%)`
          : `linear-gradient(135deg, ${gradient.from} 0%, ${gradient.to} 100%)`,
      }}
    >
      {/* Pro Badge */}
      <div className="absolute top-6 right-6">
        <ProUpgradeBanner variant="badge" />
      </div>

      {/* Main Content */}
      <motion.div
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="flex flex-col items-center text-center px-4"
      >
        {/* Icon Area */}
        <motion.div
          initial={false}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="mb-8"
        >
          {icon || (
            <div
              className="w-[200px] h-[200px] rounded-3xl border-2 border-dashed border-white/30 flex items-center justify-center"
              style={{
                boxShadow: `0 0 60px ${ctaColor}30`,
              }}
            >
              <span className="text-white/40 text-sm">{""}</span>
            </div>
          )}
        </motion.div>

        {/* Title */}
        <motion.h1
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="text-4xl font-bold text-white mb-4"
        >
          {moduleName}
        </motion.h1>

        {/* Description */}
        <motion.p
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="text-lg text-white/70 max-w-md mb-12 leading-relaxed"
        >
          {description}
        </motion.p>

        {/* Additional content */}
        {children}

        {/* CTA Button */}
        <motion.div
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="mt-12"
        >
          <RoundCTAButton
            glowColor={ctaColor}
            onClick={onCtaClick}
          >
            {ctaText}
          </RoundCTAButton>
        </motion.div>
      </motion.div>
    </div>
  );
}
