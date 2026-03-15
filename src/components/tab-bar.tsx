import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface Tab {
  id: string;
  label: string;
  count?: number;
}

interface TabBarProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  accentColor?: string;
  variant?: 'underline' | 'pill';
  className?: string;
}

export function TabBar({
  tabs,
  activeTab,
  onTabChange,
  accentColor = '#0EA5E9',
  variant = 'underline',
  className,
}: TabBarProps) {
  if (variant === 'pill') {
    return (
      <div className={cn('flex items-center gap-2 p-1 rounded-xl bg-white/5', className)}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'relative px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              activeTab === tab.id
                ? 'text-white'
                : 'text-white/60 hover:text-white/80'
            )}
          >
            {activeTab === tab.id && (
              <motion.div
                layoutId="activeTab"
                className="absolute inset-0 rounded-lg"
                style={{ backgroundColor: `${accentColor}30` }}
                transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
              />
            )}
            <span className="relative z-10">
              {tab.label}
              {tab.count !== undefined && (
                <span className="ml-1.5 text-white/50">({tab.count})</span>
              )}
            </span>
          </button>
        ))}
      </div>
    );
  }

  // Underline variant
  return (
    <div className={cn('relative w-max min-w-full', className)}>
      <div className="flex items-center gap-6 border-b border-white/10">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'relative shrink-0 whitespace-nowrap pb-3 text-sm font-medium transition-colors',
              activeTab === tab.id
                ? 'text-white'
                : 'text-white/60 hover:text-white/80'
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="ml-1.5 text-white/50">({tab.count})</span>
            )}

            {activeTab === tab.id && (
              <motion.div
                layoutId="underline"
                className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                style={{ backgroundColor: accentColor }}
                transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
              />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
