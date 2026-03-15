import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { motion } from 'framer-motion';
import {
  ChevronRight, CheckCircle, XCircle, Loader2,
  Monitor, Cpu, Terminal, Package, GitBranch, Container,
  Settings, FolderOpen, FileJson, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MODULE_THEMES } from '@/constants/colors';
import { isEnglishLocale, t } from '@/constants/i18n';
import { PlatformBadge } from '@/components/platform-badge';
import type { Platform } from '@/types/domain';

const tr = (zh: string, en: string) => (isEnglishLocale ? en : zh);

// Matches Rust SystemReport
interface SystemReport {
  os: string;
  arch: string;
  node_installed: boolean;
  node_version: string | null;
  npm_installed: boolean;
  docker_installed: boolean;
  openclaw_installed: boolean;
  openclaw_version: string | null;
  git_installed: boolean;
  detected_ai_tools: DetectedToolInfo[];
}

interface DetectedToolInfo {
  id: string;
  name: string;
  icon: string;
  detected: boolean;
  host_detected?: boolean;
  install_target_ready?: boolean;
  detection_sources?: string[];
  path: string | null;
  version: string | null;
  has_mcp_config: boolean;
  mcp_config_path: string | null;
  mcp_config_paths: string[];
  host_confidence?: 'high' | 'medium' | 'low';
  risk_surface?: {
    has_mcp: boolean;
    has_skill: boolean;
    has_exec_signal: boolean;
    has_secret_signal: boolean;
    evidence_count: number;
  };
  management_capability?: 'detect_only' | 'manual' | 'one_click';
  source_tier?: 'a' | 'b' | 'c';
  evidence_items?: Array<{
    evidence_type: string;
    path: string;
    detail?: string | null;
  }>;
}

interface InventoryItem {
  id: string;
  name: string;
  platform_id: string;
  platform_name: string;
  command: string;
  args: string[];
  config_path: string;
  safety_level: string;
}

interface ToolInventorySummary {
  mcps: InventoryItem[];
  skills: InventoryItem[];
}

interface EnvConfigDetailProps {
  onBack: () => void;
}

export function EnvConfigDetail({ onBack }: EnvConfigDetailProps) {
  const [loading, setLoading] = useState(true);
  const [system, setSystem] = useState<SystemReport | null>(null);
  const [selectedTool, setSelectedTool] = useState<DetectedToolInfo | null>(null);
  const [inventoryByTool, setInventoryByTool] = useState<Record<string, ToolInventorySummary>>({});
  const theme = MODULE_THEMES.securityScan;

  useEffect(() => {
    Promise.all([
      invoke<SystemReport>('detect_system'),
      invoke<InventoryItem[]>('scan_installed_mcps').catch(() => []),
    ])
      .then(([result, inventory]) => {
        setSystem(result);
        setInventoryByTool(groupInventoryByTool(inventory));
        // Prefer a real installed host, then fall back to config remnants.
        const firstDetected = result.detected_ai_tools.find(t => t.host_detected ?? t.detected)
          ?? result.detected_ai_tools.find(t => t.detected);
        if (firstDetected) setSelectedTool(firstDetected);
      })
      .catch((err) => console.error('detect_system failed:', err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center" style={{
        background: `linear-gradient(135deg, #1E3A8A 0%, #3B82F6 100%)`,
      }}>
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-12 h-12 text-white animate-spin" />
          <p className="text-white/70 text-sm">{t.detectingEnv}</p>
        </div>
      </div>
    );
  }

  if (!system) {
    return (
      <div className="h-full flex items-center justify-center" style={{
        background: `linear-gradient(135deg, #1E3A8A 0%, #3B82F6 100%)`,
      }}>
        <div className="text-center">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <p className="text-white/70">{t.envDetectFailed}</p>
          <button onClick={onBack} className="mt-4 text-sm text-blue-300 hover:text-blue-200">{t.back}</button>
        </div>
      </div>
    );
  }

  const installedTools = system.detected_ai_tools.filter(t => t.host_detected);
  const configOnlyTools = system.detected_ai_tools.filter(t => t.detected && !t.host_detected);
  const notDetectedTools = system.detected_ai_tools.filter(t => !t.detected);
  const totalMcpCount = Object.values(inventoryByTool).reduce((sum, entry) => sum + entry.mcps.length, 0);
  const totalSkillCount = Object.values(inventoryByTool).reduce((sum, entry) => sum + entry.skills.length, 0);

  const systemTools = [
    { name: 'Node.js', installed: system.node_installed, version: system.node_version, icon: Terminal },
    { name: 'npm', installed: system.npm_installed, version: null, icon: Package },
    { name: 'Git', installed: system.git_installed, version: null, icon: GitBranch },
    { name: 'Docker', installed: system.docker_installed, version: null, icon: Container },
    { name: 'OpenClaw', installed: system.openclaw_installed, version: system.openclaw_version, icon: Settings },
  ];

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="text-slate-500 hover:text-slate-700 flex items-center gap-1 text-sm transition-colors"
            >
              <ChevronRight className="w-4 h-4 rotate-180" />
              {t.back}
            </button>
            <div>
              <h1 className="text-lg font-bold text-slate-900">{t.envConfig}</h1>
              <p className="text-xs text-slate-500">
                {tr(
                  `${system.os} · ${system.arch} · 已检测到 ${installedTools.length} 个可用工具，${totalMcpCount} 个插件，${totalSkillCount} 个脚本`,
                  `${system.os} · ${system.arch} · ${installedTools.length} usable tools, ${totalMcpCount} plugins, ${totalSkillCount} scripts`,
                )}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: System & Tools List */}
        <div className="w-80 border-r border-slate-200 bg-white overflow-y-auto p-4">
          {/* System Info */}
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{t.systemEnv}</h3>
          <div className="space-y-1.5 mb-6">
            {/* OS Info */}
            <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-50">
              <Monitor className="w-4 h-4 text-slate-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-700 truncate">{system.os}</p>
                <p className="text-xs text-slate-400">{system.arch}</p>
              </div>
            </div>

            {systemTools.map((tool) => (
              <div key={tool.name} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-50">
                <tool.icon className="w-4 h-4 text-slate-500 flex-shrink-0" />
                <span className="text-sm text-slate-700 flex-1">{tool.name}</span>
                {tool.installed ? (
                  <div className="flex items-center gap-1.5">
                    {tool.version && (
                      <span className="text-xs text-slate-400 font-mono">{tool.version}</span>
                    )}
                    <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                  </div>
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
                )}
              </div>
            ))}
          </div>

          {/* Detected AI Tools */}
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            {tr(`可用工具 (${installedTools.length})`, `Available tools (${installedTools.length})`)}
          </h3>
          <div className="space-y-1">
            {installedTools.map((tool) => (
              <button
                key={tool.id}
                onClick={() => setSelectedTool(tool)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
                  selectedTool?.id === tool.id
                    ? 'bg-blue-50 border border-blue-200'
                    : 'hover:bg-slate-50'
                )}
              >
                <PlatformBadge platform={tool.id as Platform} size="small" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900">{tool.name}</p>
                  <p className="text-xs text-slate-400">
                    {inventorySummaryText(inventoryByTool[tool.id], tool.version)}
                  </p>
                </div>
                {tool.has_mcp_config ? (
                  <span title={t.mcpConfigured} aria-label={t.mcpConfigured}>
                    <FileJson className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                  </span>
                ) : (
                  <span className="text-xs text-slate-300 whitespace-nowrap">{t.noMcp}</span>
                )}
              </button>
            ))}
          </div>

          {configOnlyTools.length > 0 && (
            <>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 mt-6">
                {tr(`仅检测到配置痕迹 (${configOnlyTools.length})`, `Config traces only (${configOnlyTools.length})`)}
              </h3>
              <div className="space-y-1">
                {configOnlyTools.map((tool) => (
                  <button
                    key={tool.id}
                    onClick={() => setSelectedTool(tool)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
                      selectedTool?.id === tool.id
                        ? 'bg-amber-50 border border-amber-200'
                        : 'hover:bg-slate-50'
                    )}
                  >
                    <PlatformBadge platform={tool.id as Platform} size="small" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900">{tool.name}</p>
                      <p className="text-xs text-amber-600">
                        {tr('仅发现配置目录或配置文件，未确认程序存在', 'Only config files/folders found, app executable not confirmed')}
                        {inventorySummaryText(inventoryByTool[tool.id]) ? ` · ${inventorySummaryText(inventoryByTool[tool.id])}` : ''}
                      </p>
                    </div>
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Not Detected */}
          {notDetectedTools.length > 0 && (
            <>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 mt-6">
                {t.notDetected} ({notDetectedTools.length})
              </h3>
              <div className="space-y-1">
                {notDetectedTools.map((tool) => (
                  <div
                    key={tool.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg opacity-50"
                  >
                    <PlatformBadge platform={tool.id as Platform} size="small" />
                    <span className="text-sm text-slate-500 flex-1">{tool.name}</span>
                    <XCircle className="w-3.5 h-3.5 text-slate-300" />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Right: Tool Detail */}
        <div className="flex-1 overflow-y-auto p-6">
          {selectedTool ? (
            <ToolDetail tool={selectedTool} inventory={inventoryByTool[selectedTool.id] ?? emptyInventorySummary()} />
          ) : (
            <div className="h-full flex items-center justify-center text-slate-400">
              <p>{t.selectPluginDetails}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolDetail({ tool, inventory }: { tool: DetectedToolInfo; inventory: ToolInventorySummary }) {
  const statusTone = tool.host_detected
    ? 'installed'
    : tool.detected
      ? 'config-only'
      : 'missing';
  const statusLabel = tool.host_detected
    ? t.installedStatus
    : tool.detected
      ? tr('仅检测到配置痕迹', 'Config traces only')
      : t.notInstalledStatus;
  const pathLabel = tool.host_detected ? t.installPath : tr('发现路径', 'Detected path');
  const detectionBasis = tool.detection_sources && tool.detection_sources.length > 0
    ? tool.detection_sources.map(formatDetectionSource).join(' / ')
    : t.unknown;
  const inventoryItems = [...inventory.mcps, ...inventory.skills];

  return (
    <motion.div
      key={tool.id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-6"
    >
      {/* Tool Header */}
      <div className="flex items-center gap-4">
        <PlatformBadge platform={tool.id as Platform} size="normal" showName />
        <div>
          <h2 className="text-xl font-bold text-slate-900">{tool.name}</h2>
          <div className="flex items-center gap-3 mt-1">
            <span className={cn(
              'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full',
              statusTone === 'installed'
                ? 'bg-green-100 text-green-700'
                : statusTone === 'config-only'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-slate-100 text-slate-500'
            )}>
              {statusTone === 'installed'
                ? <CheckCircle className="w-3 h-3" />
                : statusTone === 'config-only'
                  ? <AlertTriangle className="w-3 h-3" />
                  : <XCircle className="w-3 h-3" />}
              {statusLabel}
            </span>
            {tool.has_mcp_config && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                <FileJson className="w-3 h-3" />
                {t.mcpConfigured}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Info Grid */}
      <div className="grid grid-cols-2 gap-4">
        <InfoCard label={t.version} value={tool.version || t.unknown} />
        <InfoCard label={pathLabel} value={tool.path || t.unknown} mono />
        <InfoCard
          label={t.mcpConfig}
          value={tool.has_mcp_config ? t.configured : t.notConfigured}
          status={tool.has_mcp_config ? 'good' : 'neutral'}
        />
        <InfoCard
          label={t.configFileCount}
          value={`${tool.mcp_config_paths?.length ?? (tool.mcp_config_path ? 1 : 0)}${t.unit ? ` ${t.unit}` : ''}`}
        />
        <InfoCard label={tr('已发现插件', 'Plugins found')} value={String(inventory.mcps.length)} />
        <InfoCard label={tr('已发现脚本', 'Scripts found')} value={String(inventory.skills.length)} />
        <InfoCard label={tr('检测依据', 'Detection basis')} value={detectionBasis} />
      </div>

      <div className="rounded-2xl border border-sky-200 bg-sky-50/80 px-4 py-3 text-sm text-sky-900">
        {tr(
          '这里只展示当前工具配置里发现的插件和脚本。AgentShield 不会顺带扫描其他普通程序。',
          'This page only shows plugins and scripts found in this tool’s real config. AgentShield does not scan unrelated apps.',
        )}
      </div>

      {/* Config Paths */}
      {tool.mcp_config_paths && tool.mcp_config_paths.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3">{t.mcpConfigPaths}</h3>
          <div className="space-y-2">
            {tool.mcp_config_paths.map((p, i) => (
              <div
                key={i}
                className="flex items-center gap-2 bg-slate-100 px-4 py-3 rounded-xl"
              >
                <FileJson className="w-4 h-4 text-blue-400 flex-shrink-0" />
                <code className="text-xs text-slate-600 flex-1 break-all font-mono">{p}</code>
                <button
                  onClick={() => {
                    invoke('reveal_path_in_finder', { path: p })
                      .catch(err => console.error('Failed to reveal path:', err));
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 transition-colors flex-shrink-0"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  {t.open}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Single config path fallback */}
      {(!tool.mcp_config_paths || tool.mcp_config_paths.length === 0) && tool.mcp_config_path && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3">{t.mcpConfigPaths}</h3>
          <div className="flex items-center gap-2 bg-slate-100 px-4 py-3 rounded-xl">
            <FileJson className="w-4 h-4 text-blue-400 flex-shrink-0" />
            <code className="text-xs text-slate-600 flex-1 break-all font-mono">{tool.mcp_config_path}</code>
            <button
              onClick={() => {
                invoke('reveal_path_in_finder', { path: tool.mcp_config_path })
                  .catch(err => console.error('Failed to reveal path:', err));
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 transition-colors flex-shrink-0"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              {t.open}
            </button>
          </div>
        </div>
      )}

      {/* Installation Path */}
      {tool.path && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3">{pathLabel}</h3>
          <div className="flex items-center gap-2 bg-slate-100 px-4 py-3 rounded-xl">
            <Terminal className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <code className="text-xs text-slate-600 flex-1 break-all font-mono">{tool.path}</code>
            <button
              onClick={() => {
                invoke('reveal_path_in_finder', { path: tool.path })
                  .catch(err => console.error('Failed to reveal path:', err));
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 transition-colors flex-shrink-0"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              {t.open}
            </button>
          </div>
        </div>
      )}

      {inventory.mcps.length > 0 && (
        <InventorySection
          title={tr(`已发现的插件服务 (${inventory.mcps.length})`, `Detected plugin services (${inventory.mcps.length})`)}
          items={inventory.mcps}
          emptyLabel={t.noConfiguredMcps}
        />
      )}

      {inventory.skills.length > 0 && (
        <InventorySection
          title={tr(`已发现的脚本 (${inventory.skills.length})`, `Detected scripts (${inventory.skills.length})`)}
          items={inventory.skills}
          emptyLabel={t.noInstalledSkills}
        />
      )}

      {inventoryItems.length === 0 && (
        <div className="flex items-start gap-3 bg-slate-50 border border-slate-200 px-4 py-3 rounded-xl">
          <AlertTriangle className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-slate-700">{tr('当前还没有发现插件或脚本', 'No plugins or scripts found yet')}</p>
            <p className="text-xs text-slate-500 mt-1">
              {tr(
                '这个工具已识别到，但在标准配置路径里还没有发现可管理项目。',
                'This tool is detected, but no manageable items were found in standard config paths.',
              )}
            </p>
          </div>
        </div>
      )}

      {/* Warning if no MCP config */}
      {!tool.has_mcp_config && tool.host_detected && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 px-4 py-3 rounded-xl">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">{t.noMcpConfig}</p>
            <p className="text-xs text-amber-600 mt-1">
              {t.noMcpConfigDesc}
            </p>
          </div>
        </div>
      )}

      {tool.detected && !tool.host_detected && (
        <div className="flex items-start gap-3 bg-sky-50 border border-sky-200 px-4 py-3 rounded-xl">
          <AlertTriangle className="w-5 h-5 text-sky-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-sky-800">{tr('当前仅发现配置痕迹', 'Config traces detected')}</p>
            <p className="text-xs text-sky-700 mt-1">
              {tr(
                '已找到配置目录或配置文件，但没有找到对应程序，可用于排查，不会当作“已安装工具”。',
                'Config folders/files are present, but the executable is missing. Useful for investigation, but not treated as an installed tool.',
              )}
            </p>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function InventorySection({
  title,
  items,
  emptyLabel,
}: {
  title: string;
  items: InventoryItem[];
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-700 mb-3">{title}</h3>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <div className="flex items-start gap-3">
              <div className={cn(
                'mt-0.5 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
                isSkillInventoryItem(item) ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700',
              )}>
                {isSkillInventoryItem(item) ? tr('脚本', 'Script') : tr('插件', 'Plugin')}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 break-all">
                  {formatInventoryDisplayName(item)}
                </p>
                <p className="text-xs text-slate-500 mt-1 break-all">
                  {inventoryItemSubtitle(item)}
                </p>
                <code className="mt-2 block text-[11px] text-slate-500 break-all font-mono">
                  {item.config_path}
                </code>
              </div>
              <button
                onClick={() => {
                  invoke('reveal_path_in_finder', { path: item.config_path })
                    .catch((err) => console.error('Failed to reveal path:', err));
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 transition-colors flex-shrink-0"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                {t.open}
              </button>
            </div>
          </div>
        ))}
      </div>
      {items.length === 0 && (
        <p className="text-xs text-slate-500">{emptyLabel}</p>
      )}
    </div>
  );
}

function InfoCard({
  label,
  value,
  mono,
  status,
}: {
  label: string;
  value: string;
  mono?: boolean;
  status?: 'good' | 'bad' | 'neutral';
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className={cn(
        'text-sm font-medium truncate',
        mono && 'font-mono text-xs',
        status === 'good' ? 'text-green-600' : status === 'bad' ? 'text-red-600' : 'text-slate-900',
      )}>
        {value}
      </p>
    </div>
  );
}

function groupInventoryByTool(items: InventoryItem[]): Record<string, ToolInventorySummary> {
  return items.reduce<Record<string, ToolInventorySummary>>((acc, item) => {
    const current = acc[item.platform_id] ?? emptyInventorySummary();
    if (isSkillInventoryItem(item)) {
      current.skills.push(item);
    } else {
      current.mcps.push(item);
    }
    acc[item.platform_id] = current;
    return acc;
  }, {});
}

function isSkillInventoryItem(item: InventoryItem) {
  return item.command === 'skill' || item.id.includes(':skill:');
}

function formatInventoryDisplayName(item: InventoryItem) {
  return isSkillInventoryItem(item)
    ? item.name.replace(/\s*\(skill\)$/i, '')
    : item.name;
}

function inventoryItemSubtitle(item: InventoryItem) {
  if (isSkillInventoryItem(item)) {
    return tr('脚本目录', 'Script directory');
  }

  const commandLine = [item.command, ...(item.args || [])]
    .filter(Boolean)
    .join(' ')
    .trim();
  return commandLine || tr('未解析到启动命令', 'Startup command unavailable');
}

function formatDetectionSource(value: string): string {
  switch (value) {
    case 'detection_source':
      return tr('发现方式', 'How it was found');
    case 'mcp_config':
      return tr('风险相关配置文件', 'Risk-related config file');
    case 'skill_root':
      return tr('扩展脚本目录', 'Skill directory');
    case 'exec_signal':
      return tr('可执行操作线索', 'Command execution signal');
    case 'secret_signal':
      return tr('密码或密钥线索', 'Password/key indicator');
    case 'app':
    case 'app_bundle_discovery':
      return tr('应用程序', 'Application');
    case 'cli':
      return tr('命令行工具', 'CLI tool');
    case 'config_dir':
      return tr('配置目录', 'Config directory');
    case 'config_file':
      return tr('配置文件', 'Config file');
    case 'deep_discovery_config':
      return tr('配置文件扫描', 'Config file scan');
    case 'deep_discovery_skill':
      return tr('扩展脚本目录扫描', 'Skill folder scan');
    case 'mcp_key':
      return tr('检测到插件配置字段', 'MCP fields detected');
    case 'mcp_server_entry':
      return tr('检测到插件服务条目', 'MCP server entries found');
    case 'skill_manifest':
      return tr('扩展脚本说明文件', 'Skill manifest');
    case 'path_hint':
      return tr('路径线索', 'Path hint');
    default: {
      const normalized = value.trim().replace(/[_-]+/g, ' ');
      if (!normalized) return t.unknown;
      if (isEnglishLocale) {
        return normalized
          .split(' ')
          .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
          .join(' ');
      }
      return normalized;
    }
  }
}

function inventorySummaryText(summary?: ToolInventorySummary, version?: string | null) {
  const parts: string[] = [];

  if (version) {
    parts.push(version);
  }

  if (summary) {
    if (summary.mcps.length > 0) {
      parts.push(tr(`${summary.mcps.length} 个插件`, `${summary.mcps.length} plugins`));
    }
    if (summary.skills.length > 0) {
      parts.push(tr(`${summary.skills.length} 个脚本`, `${summary.skills.length} scripts`));
    }
  }

  return parts.join(' · ');
}

function emptyInventorySummary(): ToolInventorySummary {
  return { mcps: [], skills: [] };
}
