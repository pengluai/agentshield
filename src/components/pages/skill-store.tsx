import { useState, useEffect } from 'react';
import { tauriInvoke as invoke } from '@/services/tauri';
import { motion } from 'framer-motion';
import { Search, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MODULE_THEMES } from '@/constants/colors';
import { isEnglishLocale, t } from '@/constants/i18n';
import { GlassmorphicCard } from '@/components/glassmorphic-card';
import { TabBar } from '@/components/tab-bar';
import { SafetyBadge } from '@/components/safety-badge';
import { PlatformIcon } from '@/components/platform-badge';
import { ManualModeGateDialog } from '@/components/manual-mode-gate-dialog';
import { openExternalUrl } from '@/services/runtime-settings';
import { isTauriEnvironment } from '@/services/tauri';
import { translateBackendText } from '@/lib/locale-text';
import type { StoreCatalogItem, Platform } from '@/types/domain';
import { useProGate } from '@/hooks/useProGate';
import { useAppStore } from '@/stores/appStore';

const tr = (zh: string, en: string) => (isEnglishLocale ? en : zh);

function getCategoryTabs() {
  return [
    { id: 'all', label: t.storeTabAll },
    { id: 'openclaw', label: t.storeTabOpenClaw },
    { id: 'dev-tools', label: t.storeTabDevTools },
    { id: 'database', label: t.storeTabDatabase },
    { id: 'ai-ml', label: t.storeTabAI },
    { id: 'search', label: t.storeTabSearch },
    { id: 'cloud', label: t.storeTabCloud },
    { id: 'communication', label: t.storeTabComm },
    { id: 'security', label: t.storeTabSecurity },
    { id: 'web-apis', label: t.storeTabWeb },
    { id: 'file-management', label: t.storeTabFile },
    { id: 'business', label: t.storeTabBiz },
    { id: 'social', label: t.storeTabSocial },
    { id: 'design', label: t.storeTabDesign },
    { id: 'utility', label: t.storeTabUtil },
    { id: 'skill', label: t.storeTabSkill },
  ];
}

interface SkillStoreProps {
  onInstall: (item: StoreCatalogItem) => void;
  onOpenOpenClaw?: () => void;
}

export function SkillStore({ onInstall, onOpenOpenClaw }: SkillStoreProps) {
  const { isPro, isTrial } = useProGate();
  const oneClickInstallUnlocked = isPro || isTrial;
  const goUpgrade = useAppStore((state) => state.setCurrentModule);
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [catalogItems, setCatalogItems] = useState<StoreCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const browserShell = !isTauriEnvironment();
  const previewMessage = t.desktopOnlyInBrowserShell.replace('{feature}', t.moduleSkillStore);

  const loadCatalog = (forceRefresh = false) => {
    if (browserShell) {
      setCatalogItems([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const cmd = forceRefresh ? 'refresh_catalog' : 'get_store_catalog';
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);
    invoke<StoreCatalogItem[]>(cmd)
      .then(items => {
        setCatalogItems(items);
      })
      .catch((e) => {
        console.error('Failed to load catalog:', e);
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(() => {
    loadCatalog();
  }, []);

  useEffect(() => {
    if (!searchQuery.trim()) {
      loadCatalog();
      return;
    }

    if (browserShell) {
      setCatalogItems([]);
      setLoading(false);
      return;
    }

    const timer = setTimeout(() => {
      invoke<StoreCatalogItem[]>('search_store', { query: searchQuery })
        .then(items => setCatalogItems(items))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const theme = MODULE_THEMES.skillStore;
  const managedInstallableCount = catalogItems.filter((item) => item.installable).length;
  const manualOnlyCount = catalogItems.filter((item) => !item.installable).length;
  const managedCoverage =
    catalogItems.length > 0 ? Math.round((managedInstallableCount / catalogItems.length) * 100) : 0;

  const filteredItems = catalogItems.filter(item => {
    const matchesSearch = !searchQuery.trim() ||
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase());

    if (activeTab === 'all') return matchesSearch;
    if (activeTab === 'openclaw') return matchesSearch && item.openclaw_ready;
    if (activeTab === 'skill') return matchesSearch && item.item_type === 'skill';
    return matchesSearch && item.category === activeTab;
  });

  return (
    <div
      className="h-full overflow-y-auto"
      style={{
        background: `linear-gradient(135deg, ${theme.from} 0%, ${theme.via} 45%, ${theme.to}80 100%)`,
      }}
    >
      {/* Header */}
      <div className="px-6 pt-6 pb-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-white">{t.skillStore}</h1>
            <p className="text-sm text-white/50 mt-1">
              {catalogItems.length} {t.storeItemCount}
            </p>
            <p className="text-sm text-white/60 mt-2 max-w-3xl leading-6">
              {t.skillStoreScopeHint}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/60">
              <span className="rounded bg-white/10 px-2 py-1">
                {tr('托管安装', 'Managed install')} {managedInstallableCount}/{catalogItems.length} ({managedCoverage}%)
              </span>
              <span className="rounded bg-white/10 px-2 py-1">
                {tr('手动安装', 'Manual only')} {manualOnlyCount} {tr('项', 'items')}
              </span>
            </div>
          </div>
          <button
            onClick={() => loadCatalog(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 text-white/70 text-sm hover:bg-white/20 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
            {refreshing ? t.refreshing : t.refreshCatalog}
          </button>
        </div>

        {/* Search */}
        <div className="relative max-w-xl mb-4">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
          <input
            type="text"
            placeholder={t.searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-3 rounded-xl bg-white/10 border border-white/10 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
          />
        </div>

        {browserShell && (
          <p className="mb-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
            {previewMessage}
          </p>
        )}

        {/* Category Tabs - scrollable */}
        <div className="overflow-x-auto pb-2 -mx-6 px-6">
          <TabBar
            tabs={getCategoryTabs()}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            accentColor={theme.accent}
            className="w-max min-w-full"
          />
        </div>
      </div>

      {/* OpenClaw Featured Banner */}
      {activeTab === 'openclaw' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-6 mb-6"
        >
          <GlassmorphicCard
            gradient={{ from: MODULE_THEMES.openClaw.from, to: MODULE_THEMES.openClaw.to }}
            className="p-6"
          >
            <h3 className="text-xl font-bold text-white mb-2">{t.openClawFeatured}</h3>
            <p className="text-white/70">{t.openClawFeaturedDesc}</p>
          </GlassmorphicCard>
        </motion.div>
      )}

      {/* Store Grid */}
      <div className="px-6 pb-6">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-white/40">
            <Loader2 className="w-8 h-8 animate-spin mr-3" />
            <span>{t.loadingStore}</span>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-white/50">{t.noResults}</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-white/40 mb-4">
              {t.showingItems} {filteredItems.length} {t.storeItemUnit}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredItems.map((item, index) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index * 0.03, 0.5) }}
                >
                  <StoreItemCard
                    item={item}
                    oneClickInstallUnlocked={oneClickInstallUnlocked}
                    onInstall={() => onInstall(item)}
                    onOpenOpenClaw={onOpenOpenClaw}
                    onUpgradeRequested={() => goUpgrade('upgradePro')}
                  />
                </motion.div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface StoreItemCardProps {
  item: StoreCatalogItem;
  oneClickInstallUnlocked: boolean;
  onInstall: () => void;
  onOpenOpenClaw?: () => void;
  onUpgradeRequested: () => void;
}

function StoreItemCard({ item, oneClickInstallUnlocked, onInstall, onOpenOpenClaw, onUpgradeRequested }: StoreItemCardProps) {
  const [manualGateOpen, setManualGateOpen] = useState(false);
  const manualSourceUrl = resolveManualSourceUrl(item);
  const metaPillClass = 'inline-flex h-5 items-center rounded px-1.5 text-[10px] font-medium leading-none';

  const handleAction = async () => {
    if (item.installable && oneClickInstallUnlocked) {
      onInstall();
      return;
    }

    if (item.installable && !oneClickInstallUnlocked) {
      setManualGateOpen(true);
      return;
    }

    if (manualSourceUrl) {
      await openExternalUrl(manualSourceUrl);
    }
  };

  const actionLabel = item.installable
    ? oneClickInstallUnlocked
      ? tr('安装预览', 'Install preview')
      : tr('手动安装', 'Manual Install')
    : manualSourceUrl
      ? t.view
      : t.disabled;
  const sourceLabel = resolveSourceLabel(item);
  const strategyLabel = resolveInstallStrategyLabel(item);

  return (
    <GlassmorphicCard className="h-full">
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-start gap-3 mb-3">
          <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
            <span className="text-2xl">
              {item.item_type === 'skill' ? '🧩' : item.featured ? '⭐' : '🔌'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-white truncate">{item.name}</h3>
              {item.item_type === 'skill' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/30 text-purple-200 font-medium">
                  Skill
                </span>
              )}
            </div>
            <p className="text-sm text-white/60 line-clamp-2">{item.description}</p>
            {item.review_notes && (
              <p className="mt-1 text-xs text-white/40 line-clamp-2">{translateBackendText(item.review_notes)}</p>
            )}
            <p className="mt-1 text-[11px] text-cyan-100/70 truncate">{sourceLabel}</p>
          </div>
        </div>

        {/* Safety & Platforms */}
        <div className="mb-3 space-y-2">
          <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap pb-0.5">
            <SafetyBadge level={item.safety_level} size="small" className="h-5 shrink-0 px-2" />
            {item.review_status && (
              <span className={cn(
                `${metaPillClass} shrink-0`,
                item.review_status === 'reviewed'
                  ? 'bg-emerald-500/20 text-emerald-200'
                  : item.review_status === 'unreviewed'
                    ? 'bg-amber-500/20 text-amber-200'
                    : 'bg-white/10 text-white/60'
              )}>
                {item.review_status === 'reviewed'
                  ? tr('已复核', 'Reviewed')
                  : item.review_status === 'unreviewed'
                    ? tr('待复核', 'Pending Review')
                    : tr('目录条目', 'Catalog Entry')}
              </span>
            )}
            {item.category && (
              <span className={cn(`${metaPillClass} shrink-0`, 'bg-white/10 text-white/50')}>
                {item.category}
              </span>
            )}
            {strategyLabel && (
              <span className={cn(`${metaPillClass} shrink-0`, 'bg-cyan-500/15 text-cyan-100/80')}>
                {strategyLabel}
              </span>
            )}
          </div>
          <div className="flex items-center justify-end gap-1">
            {item.compatible_platforms.slice(0, 4).map((platform) => (
              <PlatformIcon key={platform} platform={platform} />
            ))}
            {item.compatible_platforms.length > 4 && (
              <span className="text-xs text-white/40">
                +{item.compatible_platforms.length - 4}
              </span>
            )}
          </div>
        </div>

        {/* Install Metadata & Action */}
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-white/10 pt-3">
          <div className="min-w-0 text-xs text-white/50">
            {resolveInstallabilityReason(item)}
          </div>
          <button
            onClick={() => void handleAction()}
            disabled={!item.installable && !manualSourceUrl}
            className={cn(
              'inline-flex h-10 min-w-[96px] shrink-0 items-center justify-center whitespace-nowrap rounded-lg px-4 text-sm font-medium transition-colors',
              !item.installable && !manualSourceUrl
                ? 'bg-white/5 text-white/30 cursor-not-allowed'
                : 'bg-white/10 text-white hover:bg-white/20'
            )}
          >
            {actionLabel}
          </button>
        </div>
      </div>
      <ManualModeGateDialog
        open={manualGateOpen}
        onOpenChange={setManualGateOpen}
        title={tr('手动安装模式已启用', 'Manual install mode enabled')}
        description={tr('14 天试用已结束。免费版不再支持一键安装。', 'The 14-day trial has ended. One-click install is no longer available on free plan.')}
        impacts={[
          tr(
            '系统会打开官方来源页面，你需要自己下载、核对版本并写入宿主配置。',
            'AgentShield will open the official source page. You need to download, verify version, and write host config manually.'
          ),
          tr(
            '如果安装源选错或被钓鱼链接替换，可能导致密钥泄露或恶意代码执行。',
            'Choosing a wrong source or phishing link may cause secret leakage or malicious code execution.'
          ),
          tr(
            '完整版可在放行后直接完成托管安装并验证落地路径。',
            'Full version can complete managed install and verify target paths after approval.'
          ),
        ]}
        manualLabel={tr('打开官方来源手动安装', 'Open official source for manual install')}
        onManual={() => {
          if (manualSourceUrl) {
            void openExternalUrl(manualSourceUrl);
          }
        }}
        onUpgrade={onUpgradeRequested}
        upgradeLabel={tr('⚡ 一键托管安装', '⚡ One-click managed install')}
      />
    </GlassmorphicCard>
  );
}

function resolveSourceLabel(item: StoreCatalogItem) {
  if (item.source_url) {
    try {
      const parsed = new URL(item.source_url);
      return tr(`来源: ${parsed.hostname}`, `Source: ${parsed.hostname}`);
    } catch {
      return tr(`来源: ${item.source_url}`, `Source: ${item.source_url}`);
    }
  }

  if (item.install_identifier) {
    return tr(`来源标识: ${item.install_identifier}`, `Source ID: ${item.install_identifier}`);
  }

  return tr('来源: 待补充', 'Source: pending');
}

function resolveInstallStrategyLabel(item: StoreCatalogItem) {
  switch (item.install_strategy) {
    case 'builtin_npm':
      return tr('内置托管', 'Built-in managed');
    case 'registry_npm':
      return tr('注册表托管', 'Registry managed');
    case 'registry_remote':
      return tr('远端托管', 'Remote managed');
    case 'registry_remote_auth':
      return tr('凭据托管', 'Credential managed');
    case 'unsupported_skill':
      return tr('手动安装', 'Manual install');
    case 'unsupported_registry':
      return tr('来源跳转', 'Source jump');
    default:
      return '';
  }
}

function resolveInstallabilityReason(item: StoreCatalogItem) {
  if (item.installable) {
    if (item.installable && !item.source_url) {
      const manualUrl = resolveManualSourceUrl(item);
      if (manualUrl) {
        return tr(
          '试用结束后将切换为手动安装模式（打开官方来源）',
          'After trial ends, this switches to manual mode (open official source).'
        );
      }
    }
    if (item.install_strategy === 'registry_remote_auth') {
      if (item.auth_headers?.length) {
        return tr(
          `可托管安装，首次需补充凭据字段：${item.auth_headers.join('、')}`,
          `Managed install supported. First run requires credentials: ${item.auth_headers.join(', ')}`
        );
      }
      return tr('可托管安装，首次需补充凭据字段', 'Managed install supported. First run requires credential fields.');
    }
    return tr('支持 AgentShield 托管安装', 'Supports AgentShield managed install');
  }

  if (item.item_type === 'skill') {
    return tr('当前仅支持来源审查与手动安装', 'Currently supports source review and manual install only');
  }

  if (item.source_url) {
    return tr(
      '未提供可验证托管脚本，已保留官方来源供你手动安装',
      'No verifiable managed script provided. Official source is kept for manual install.'
    );
  }

  return tr('当前不支持一键托管安装', 'One-click managed install is not supported currently');
}

function resolveManualSourceUrl(item: StoreCatalogItem): string | null {
  if (item.source_url) {
    return item.source_url;
  }

  if (
    item.install_strategy === 'builtin_npm'
    || item.install_strategy === 'registry_npm'
  ) {
    const pkg = stripNpmVersion(item.install_identifier ?? '');
    if (pkg) {
      return `https://www.npmjs.com/package/${encodeURIComponent(pkg)}`;
    }
  }

  if (
    item.install_strategy === 'registry_remote'
    || item.install_strategy === 'registry_remote_auth'
  ) {
    return item.install_identifier || null;
  }

  return null;
}

function stripNpmVersion(spec: string) {
  const trimmed = spec.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith('@')) {
    const slashIndex = trimmed.indexOf('/');
    const versionIndex = trimmed.lastIndexOf('@');
    if (slashIndex >= 0 && versionIndex > slashIndex) {
      return trimmed.slice(0, versionIndex);
    }
    return trimmed;
  }

  const versionIndex = trimmed.lastIndexOf('@');
  return versionIndex > 0 ? trimmed.slice(0, versionIndex) : trimmed;
}
