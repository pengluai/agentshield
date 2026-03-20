import { motion } from 'framer-motion';
import {
  Shield,
  Search,
  Bot,
  Store,
  Package,
  Lock,
  Bell,
  Settings,
  Crown
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MODULE_THEMES, type ModuleThemeKey } from '@/constants/colors';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { ModuleId } from '@/types/domain';

const ICONS: Record<ModuleId, React.ElementType> = {
  smartGuard: Shield,
  securityScan: Search,
  openClaw: Bot,
  skillStore: Store,
  installed: Package,
  keyVault: Lock,
  notifications: Bell,
  settings: Settings,
  upgradePro: Crown,
};

const NAV_ITEM_THEME: Record<ModuleId, ModuleThemeKey> = {
  smartGuard: 'smartGuard',
  securityScan: 'securityScan',
  openClaw: 'openClaw',
  skillStore: 'skillStore',
  installed: 'installed',
  keyVault: 'keyVault',
  notifications: 'notifications',
  upgradePro: 'upgradePro',
  settings: 'settings',
};

function getNavGroups(): Array<{ items: ModuleId[]; dividerAfter?: boolean }> {
  return [
    { items: ['smartGuard', 'securityScan', 'openClaw', 'skillStore', 'installed', 'keyVault'], dividerAfter: true },
    { items: ['notifications', 'upgradePro'], dividerAfter: true },
    { items: ['settings'] },
  ];
}

interface AppSidebarProps {
  className?: string;
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace('#', '').trim();
  const expanded = normalized.length === 3
    ? normalized.split('').map((c) => `${c}${c}`).join('')
    : normalized;
  if (expanded.length !== 6) {
    return `rgba(15, 23, 42, ${alpha})`;
  }
  const value = Number.parseInt(expanded, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function AppSidebar({ className }: AppSidebarProps) {
  const { currentModule, isExpanded, unreadCount, setCurrentModule } = useAppStore();
  const navGroups = getNavGroups();
  const activeTheme = MODULE_THEMES[NAV_ITEM_THEME[currentModule]];
  const sidebarBackground = [
    `linear-gradient(90deg, ${hexToRgba(activeTheme.from, 0.74)} 0%, ${hexToRgba(activeTheme.from, 0.62)} 76%, ${hexToRgba(activeTheme.from, 0.42)} 100%)`,
    `linear-gradient(180deg, ${hexToRgba(activeTheme.to, 0.16)} 0%, ${hexToRgba(activeTheme.to, 0.06)} 100%)`,
  ].join(', ');

  return (
    <motion.aside
      initial={false}
      animate={{ width: isExpanded ? 240 : 72 }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
      className={cn(
        'fixed left-0 top-0 h-full z-50',
        'backdrop-blur-md',
        'flex flex-col',
        className
      )}
      style={{
        background: sidebarBackground,
      }}
    >
      {/* Keep the same visual top breathing room as the previous build, without duplicating traffic lights. */}
      <div className="h-[62px] shrink-0" />

      {/* Navigation Items — distributed vertically like CleanMyMac */}
      <nav className="flex-1 py-4 px-3 overflow-y-auto flex flex-col">
        {/* Primary group — top, generous spacing */}
        <section className="space-y-3">
          {navGroups[0].items.map((moduleId) => {
            const Icon = ICONS[moduleId];
            const theme = MODULE_THEMES[NAV_ITEM_THEME[moduleId]];
            const isActive = currentModule === moduleId;
            const hasNotification = moduleId === 'notifications' && unreadCount > 0;
            return (
              <NavItem
                key={moduleId}
                icon={Icon}
                label={theme.label}
                accent={theme.accent}
                isActive={isActive}
                isExpanded={isExpanded}
                badge={hasNotification ? unreadCount : undefined}
                onClick={() => setCurrentModule(moduleId)}
              />
            );
          })}
        </section>

        {/* Spacer pushes secondary + tertiary groups toward the bottom */}
        <div className="flex-1 min-h-6" />

        {/* Secondary group */}
        <section className="space-y-3">
          {navGroups[1].items.map((moduleId) => {
            const Icon = ICONS[moduleId];
            const theme = MODULE_THEMES[NAV_ITEM_THEME[moduleId]];
            const isActive = currentModule === moduleId;
            const hasNotification = moduleId === 'notifications' && unreadCount > 0;
            return (
              <NavItem
                key={moduleId}
                icon={Icon}
                label={theme.label}
                accent={theme.accent}
                isActive={isActive}
                isExpanded={isExpanded}
                badge={hasNotification ? unreadCount : undefined}
                onClick={() => setCurrentModule(moduleId)}
              />
            );
          })}
        </section>

        {/* Divider between secondary and settings */}
        {isExpanded && <div className="mx-2 my-2 h-px bg-white/12" />}

        {/* Settings — pinned near bottom */}
        <section className="mt-2">
          {navGroups[2].items.map((moduleId) => {
            const Icon = ICONS[moduleId];
            const theme = MODULE_THEMES[NAV_ITEM_THEME[moduleId]];
            const isActive = currentModule === moduleId;
            return (
              <NavItem
                key={moduleId}
                icon={Icon}
                label={theme.label}
                accent={theme.accent}
                isActive={isActive}
                isExpanded={isExpanded}
                onClick={() => setCurrentModule(moduleId)}
              />
            );
          })}
        </section>
      </nav>

      {/* Language Toggle */}
      <div className="px-3 pb-4">
        <LanguageToggle isExpanded={isExpanded} />
      </div>
    </motion.aside>
  );
}

interface NavItemProps {
  icon: React.ElementType;
  label: string;
  accent: string;
  isActive: boolean;
  isExpanded: boolean;
  badge?: number;
  onClick: () => void;
}

function NavItem({
  icon: Icon,
  label,
  accent,
  isActive,
  isExpanded,
  badge,
  onClick
}: NavItemProps) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        'w-full flex items-center gap-3 rounded-xl transition-all duration-200',
        isExpanded ? 'px-3 py-2' : 'px-0 py-2 justify-center',
        isActive
          ? 'bg-white/10'
          : 'hover:bg-white/5'
      )}
    >
      <div className="relative">
        <div
          className={cn(
            'flex items-center justify-center rounded-lg transition-all',
            isExpanded ? 'w-9 h-9' : 'w-10 h-10',
            isActive && !isExpanded && 'ring-2 ring-offset-2 ring-offset-transparent'
          )}
          style={{
            backgroundColor: isActive ? `${accent}20` : 'transparent',
            boxShadow: isActive ? `0 0 20px ${accent}40` : 'none',
            '--tw-ring-color': isActive ? accent : 'transparent',
          } as React.CSSProperties}
        >
          <Icon
            className="w-5 h-5"
            style={{ color: isActive ? accent : 'rgba(255,255,255,0.6)' }}
          />
        </div>
        {badge !== undefined && (
          <span
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-semibold text-white rounded-full px-1"
            style={{ backgroundColor: '#F43F5E' }}
          >
            {badge}
          </span>
        )}
      </div>

      {isExpanded && (
        <motion.span
          initial={false}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          className={cn(
            'text-sm font-medium whitespace-nowrap',
            isActive ? 'text-white' : 'text-white/70'
          )}
        >
          {label}
        </motion.span>
      )}
    </motion.button>
  );
}

interface LanguageToggleProps {
  isExpanded: boolean;
}

function LanguageToggle({ isExpanded }: LanguageToggleProps) {
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const isChinese = language.startsWith('zh');

  return (
    <div
      className={cn(
        'flex items-center rounded-lg bg-white/5 p-0.5',
        isExpanded ? '' : 'flex-col gap-0.5'
      )}
    >
      <button
        onClick={() => setLanguage('zh-CN')}
        className={cn(
          'px-2.5 py-1 rounded-md text-xs font-medium transition-all',
          isChinese
            ? 'bg-white/15 text-white shadow-sm'
            : 'text-white/40 hover:text-white/70'
        )}
      >
        ZH
      </button>
      <button
        onClick={() => setLanguage('en-US')}
        className={cn(
          'px-2.5 py-1 rounded-md text-xs font-medium transition-all',
          !isChinese
            ? 'bg-white/15 text-white shadow-sm'
            : 'text-white/40 hover:text-white/70'
        )}
      >
        EN
      </button>
    </div>
  );
}
