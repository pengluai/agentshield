import { cn } from '@/lib/utils';
import { Shield, AlertTriangle, XCircle, Ban, HelpCircle } from 'lucide-react';
import { SAFETY_COLORS } from '@/constants/colors';
import { t } from '@/constants/i18n';
import type { SafetyLevel } from '@/types/domain';

interface SafetyBadgeProps {
  level: SafetyLevel;
  size?: 'small' | 'normal';
  showIcon?: boolean;
  className?: string;
}

const ICONS: Record<SafetyLevel, React.ElementType> = {
  safe: Shield,
  caution: AlertTriangle,
  dangerous: XCircle,
  blocked: Ban,
  unverified: HelpCircle,
};

export function SafetyBadge({
  level,
  size = 'normal',
  showIcon = true,
  className,
}: SafetyBadgeProps) {
  const colors = SAFETY_COLORS[level] || SAFETY_COLORS.unverified;
  const Icon = ICONS[level] || HelpCircle;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap',
        size === 'small' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm',
        className
      )}
      style={{
        backgroundColor: `${colors.bg}20`,
        color: colors.bg,
      }}
    >
      {showIcon && (
        <Icon className={size === 'small' ? 'w-3 h-3' : 'w-4 h-4'} />
      )}
      {colors.label}
    </span>
  );
}

// Severity badge for issues
interface SeverityBadgeProps {
  severity: 'critical' | 'warning' | 'info';
  className?: string;
}

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  const config = {
    critical: { color: '#EF4444', label: t.severityCritical },
    warning: { color: '#F59E0B', label: t.severityWarning },
    info: { color: '#3B82F6', label: t.severityInfo },
  };

  const { color, label } = config[severity];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium',
        className
      )}
      style={{
        backgroundColor: `${color}20`,
        color: color,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
