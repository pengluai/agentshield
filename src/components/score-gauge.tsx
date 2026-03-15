import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { t } from '@/constants/i18n';

interface ScoreGaugeProps {
  score: number;
  size?: 'large' | 'small';
  className?: string;
}

const sizeConfig = {
  large: {
    size: 130,
    strokeWidth: 7,
    fontSize: 'text-4xl',
    labelSize: 'text-xs',
  },
  small: {
    size: 80,
    strokeWidth: 6,
    fontSize: 'text-2xl',
    labelSize: 'text-xs',
  },
};

function getScoreColor(score: number): string {
  if (score <= 40) return '#EF4444'; // Red
  if (score <= 70) return '#F59E0B'; // Orange
  return '#10B981'; // Green
}

export function ScoreGauge({ score, size = 'large', className }: ScoreGaugeProps) {
  const config = sizeConfig[size];
  const radius = (config.size - config.strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const color = getScoreColor(score);

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)}>
      <svg
        width={config.size}
        height={config.size}
        viewBox={`0 0 ${config.size} ${config.size}`}
        className="transform -rotate-90"
      >
        {/* Background circle */}
        <circle
          cx={config.size / 2}
          cy={config.size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255, 255, 255, 0.1)"
          strokeWidth={config.strokeWidth}
        />

        {/* Progress circle */}
        <motion.circle
          cx={config.size / 2}
          cy={config.size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={config.strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - progress }}
          transition={{ duration: 1.5, ease: 'easeOut' }}
          style={{
            filter: `drop-shadow(0 0 10px ${color}80)`,
          }}
        />
      </svg>

      {/* Score number */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.5, duration: 0.5 }}
          className={cn('font-bold text-white', config.fontSize)}
          style={{ textShadow: `0 0 20px ${color}60` }}
        >
          {score}
        </motion.span>
        {size === 'large' && (
          <span className={cn('text-white/60 mt-1', config.labelSize)}>
            {t.score}
          </span>
        )}
      </div>
    </div>
  );
}
