import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { ChevronLeft, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '@/constants/i18n';

interface ThreeColumnLayoutProps {
  title: string;
  subtitle?: string;
  backText?: string;
  onBack?: () => void;
  leftColumn: ReactNode;
  middleColumn: ReactNode;
  rightColumn: ReactNode;
  topBarRight?: ReactNode;
  bottomBar?: ReactNode;
  accentColor?: string;
  className?: string;
  leftColumnClassName?: string;
  middleColumnClassName?: string;
  rightColumnClassName?: string;
}

export function ThreeColumnLayout({
  title,
  subtitle,
  backText = t.back,
  onBack,
  leftColumn,
  middleColumn,
  rightColumn,
  topBarRight,
  bottomBar,
  accentColor = '#F43F5E',
  className,
  leftColumnClassName,
  middleColumnClassName,
  rightColumnClassName,
}: ThreeColumnLayoutProps) {
  return (
    <div className={cn('h-full bg-slate-50 text-slate-900 flex flex-col', className)}>
      {/* Top Bar — fixed */}
      <header className="shrink-0 bg-white border-b border-slate-200 z-40">
        <div className="flex items-center justify-between px-6 py-4">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-sm font-medium hover:opacity-70 transition-opacity"
            style={{ color: accentColor }}
          >
            <ChevronLeft className="w-5 h-5" />
            {backText}
          </button>
          <div className="flex-1 text-center">
            <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
            {subtitle && (
              <p className="text-sm text-slate-500">{subtitle}</p>
            )}
          </div>
          <div className="flex items-center gap-4">
            {topBarRight}
          </div>
        </div>
      </header>

      {/* Main Content — fills remaining height, columns scroll independently */}
      <div className="flex-1 flex min-h-0">
        {/* Left Column */}
        <motion.aside
          initial={false}
          animate={{ opacity: 1, x: 0 }}
          className={cn(
            'w-[20%] min-w-[200px] bg-white border-r border-slate-200 p-4 overflow-y-auto',
            leftColumnClassName,
          )}
        >
          {leftColumn}
        </motion.aside>

        {/* Middle Column */}
        <motion.main
          initial={false}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className={cn(
            'w-[35%] bg-slate-50 border-r border-slate-200 overflow-y-auto',
            middleColumnClassName,
          )}
        >
          {middleColumn}
        </motion.main>

        {/* Right Column */}
        <motion.section
          initial={false}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
          className={cn('flex-1 bg-white overflow-y-auto', rightColumnClassName)}
        >
          {rightColumn}
        </motion.section>
      </div>

      {/* Bottom Bar — fixed */}
      {bottomBar && (
        <footer className="shrink-0 bg-white border-t border-slate-200 px-6 py-4">
          {bottomBar}
        </footer>
      )}
    </div>
  );
}

// Search input for the layout
interface SearchInputProps {
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function SearchInput({ placeholder, value, onChange, className }: SearchInputProps) {
  return (
    <div className={cn('relative', className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
      <input
        type="text"
        placeholder={placeholder || t.search + '...'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full pl-10 pr-4 py-2 rounded-lg bg-slate-100 border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/50"
      />
    </div>
  );
}

// Sort dropdown
interface SortDropdownProps {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  accentColor?: string;
}

export function SortDropdown({ value, options, onChange, accentColor = '#F43F5E' }: SortDropdownProps) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-slate-500">{t.sortBy + ':'}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent font-medium focus:outline-none cursor-pointer"
        style={{ color: accentColor }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
