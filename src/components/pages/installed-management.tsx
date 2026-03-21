import { useState, useCallback, useEffect, useMemo } from 'react';
import { tauriInvoke as invoke } from '@/services/tauri';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, RefreshCw, Trash2, ExternalLink, CheckCircle, Play, ShieldAlert, ShieldCheck, ShieldBan, Activity, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MODULE_THEMES, PLATFORM_CONFIG } from '@/constants/colors';
import { isEnglishLocale, t } from '@/constants/i18n';
import { ThreeColumnLayout } from '@/components/three-column-layout';
import { SafetyBadge } from '@/components/safety-badge';
import { localizedDynamicText } from '@/lib/locale-text';
import { ManualFixGuide } from '@/components/manual-fix-guide';
import { getManualFixGuide, type ManualFixStep } from '@/services/scanner';

import { openExternalUrl } from '@/services/runtime-settings';
import {
  clearRuntimeGuardEvents,
  getRuntimeGuardPolicy,
  getRuntimeGuardStatus,
  launchRuntimeGuardComponent,
  listRuntimeGuardEvents,
  listRuntimeGuardSessions,
  requestRuntimeGuardActionApproval,
  runRuntimeGuardPollNow,
  syncRuntimeGuardComponents,
  terminateRuntimeGuardSession,
  updateComponentNetworkPolicy,
  updateComponentTrustState,
  type RuntimeGuardComponent,
  type RuntimeGuardEvent,
  type RuntimeGuardPolicy,
  type RuntimeGuardSession,
  type RuntimeGuardStatus,
} from '@/services/runtime-guard';
import type { InstalledMCP, Platform } from '@/types/domain';
import { useProGate } from '@/hooks/useProGate';

interface ManagedInstalledItem {
  id: string;
  name: string;
  version: string;
  platform: string;
  installed_at: string;
  source_url: string;
}

interface UpdateAuditItem {
  item_id: string;
  platform?: string;
  source_path?: string;
  current_version: string;
  new_version: string;
  has_update: boolean;
  tracked: boolean;
  reason: string;
}

interface GlobalCleanupDependencyTask {
  manager: 'npm_global' | 'pip_package' | 'winget_package' | 'choco_package' | string;
  identifier: string;
  command_preview: string;
}

interface GlobalCleanupComponentPlan {
  item_id: string;
  platform: string;
  platform_name: string;
  component_type: 'mcp' | 'skill' | string;
  config_path: string;
  command: string;
  args: string[];
  management_capability: HostCapability;
  auto_cleanup_supported: boolean;
  dependency_tasks: GlobalCleanupDependencyTask[];
}

interface GlobalCleanupPreview {
  plan_id: string;
  generated_at: string;
  scope_platforms: string[];
  include_dependency_cleanup: boolean;
  include_openclaw_deep_cleanup: boolean;
  action_targets: string[];
  component_count: number;
  auto_cleanup_component_count: number;
  manual_only_component_count: number;
  dependency_task_count: number;
  components: GlobalCleanupComponentPlan[];
  dependency_tasks: GlobalCleanupDependencyTask[];
}

interface GlobalCleanupActionResult {
  action_type: string;
  target: string;
  status: 'success' | 'failed' | 'skipped' | string;
  message: string;
}

interface GlobalCleanupReport {
  run_id: string;
  plan_id: string;
  started_at: string;
  completed_at: string;
  backup_dir?: string | null;
  backup_count?: number;
  total_actions: number;
  success_actions: number;
  failed_actions: number;
  skipped_actions: number;
  remaining_components: string[];
  results: GlobalCleanupActionResult[];
}

type HostConfidence = 'high' | 'medium' | 'low';
type HostCapability = 'detect_only' | 'manual' | 'one_click';
type SourceTier = 'a' | 'b' | 'c';

interface HostRiskSurface {
  has_mcp: boolean;
  has_skill: boolean;
  has_exec_signal: boolean;
  has_secret_signal: boolean;
  evidence_count: number;
}

interface DetectedToolEntry {
  id: string;
  name?: string;
  path?: string | null;
  detected: boolean;
  has_mcp_config?: boolean;
  host_detected?: boolean;
  install_target_ready?: boolean;
  host_confidence?: HostConfidence;
  risk_surface?: HostRiskSurface;
  management_capability?: HostCapability;
  source_tier?: SourceTier;
  evidence_items?: Array<{
    evidence_type: string;
    path: string;
    detail?: string | null;
  }>;
}

interface HostOverviewEntry {
  id: Platform;
  name: string;
  icon: string;
  color: string;
  detected: boolean;
  hostDetected: boolean;
  installTargetReady: boolean;
  hostConfidence: HostConfidence;
  riskSurface: HostRiskSurface;
  managementCapability: HostCapability;
  sourceTier: SourceTier;
  evidenceItems: Array<{
    evidence_type: string;
    path: string;
    detail?: string | null;
  }>;
  componentCount: number;
  mcpCount: number;
  skillCount: number;
}

interface InstalledManagementProps {
  onBack: () => void;
}

interface GuardedInstalledMcp extends InstalledMCP {
  componentType: 'mcp' | 'skill';
  runtimeComponentId?: string;
  runtimeTrustState?: string;
  runtimeSourceKind?: string;
  runtimeRiskSummary?: string;
  runtimeNetworkMode?: string;
  runtimeAllowedDomains?: string[];
  runtimeSensitiveCapabilities?: string[];
  runtimeRequiresExplicitApproval?: boolean;
}

const tr = (zh: string, en: string) => (isEnglishLocale ? en : zh);

const SAFETY_PRIORITY: Record<InstalledMCP['safety_level'], number> = {
  dangerous: 0,
  blocked: 1,
  caution: 2,
  unverified: 3,
  safe: 4,
};

function safeScrollIntoView(target: Element | null) {
  if (!target) {
    return;
  }
  const maybeHTMLElement = target as HTMLElement & {
    scrollIntoView?: (options?: ScrollIntoViewOptions) => void;
  };
  if (typeof maybeHTMLElement.scrollIntoView === 'function') {
    maybeHTMLElement.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'smooth',
    });
  }
}

const IDE_AI_TOOL_ORDER: Platform[] = [
  'cursor',
  'kiro',
  'vscode',
  'claude_desktop',
  'claude_code',
  'codex',
  'qwen_code',
  'kimi_cli',
  'codebuddy',
  'windsurf',
  'zed',
  'trae',
  'gemini_cli',
  'antigravity',
  'continue_dev',
  'aider',
  'copilot',
  'cline',
  'openclaw',
];

const PLATFORM_PATH_HINTS: Array<[string, Platform]> = [
  ['cursor', 'cursor'],
  ['kiro', 'kiro'],
  ['visual studio code', 'vscode'],
  ['/code/', 'vscode'],
  ['.vscode', 'vscode'],
  ['claude_desktop', 'claude_desktop'],
  ['library/application support/claude', 'claude_desktop'],
  ['.claude', 'claude_code'],
  ['.claude/claude.json', 'claude_code'],
  ['codex', 'codex'],
  ['.codex', 'codex'],
  ['library/application support/codex', 'codex'],
  ['com.openai.atlas', 'codex'],
  ['.qwen', 'qwen_code'],
  ['qwen code', 'qwen_code'],
  ['qwen-code', 'qwen_code'],
  ['.kimi', 'kimi_cli'],
  ['kimi-cli', 'kimi_cli'],
  ['moonshot', 'kimi_cli'],
  ['.codebuddy', 'codebuddy'],
  ['codebuddy', 'codebuddy'],
  ['tencent codebuddy', 'codebuddy'],
  ['windsurf', 'windsurf'],
  ['codeium/windsurf', 'windsurf'],
  ['trae', 'trae'],
  ['gemini', 'gemini_cli'],
  ['.gemini', 'gemini_cli'],
  ['antigravity', 'antigravity'],
  ['continue', 'continue_dev'],
  ['aider', 'aider'],
  ['copilot', 'copilot'],
  ['zed', 'zed'],
  ['cline', 'cline'],
  ['roo', 'cline'],
  ['openclaw', 'openclaw'],
  ['.agents/skills', 'claude_code'],
];

function isUnknownAiToolId(platformId: string): boolean {
  return platformId.startsWith('unknown_ai_tool');
}

/** Check if the suffix looks like a hex hash (no meaningful name). */
function isHashSuffix(suffix: string): boolean {
  return /^[0-9a-f]{6,}$/i.test(suffix.replace(/_/g, ''));
}

function formatUnknownAiToolLabel(platformId: string): string {
  if (platformId === 'unknown_ai_tool') {
    return tr('未知工具', 'Unknown tool');
  }

  const suffix = platformId.replace(/^unknown_ai_tool_/, '');
  if (!suffix) {
    return tr('未知工具', 'Unknown tool');
  }

  // Hash-based IDs: show short hash only (e.g., "发现的工具 #a3f2")
  if (isHashSuffix(suffix)) {
    const shortId = suffix.slice(0, 4);
    return tr(`发现的工具 #${shortId}`, `Discovered #${shortId}`);
  }

  const pretty = suffix
    .split('_')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

  return pretty
    ? tr(`未知工具 · ${pretty}`, `Unknown tool · ${pretty}`)
    : tr('未知工具', 'Unknown tool');
}

function normalizePlatformId(rawPlatform: string | undefined, configPath: string, componentName: string): Platform {
  const candidate = String(rawPlatform || '').trim().toLowerCase();
  if (candidate && isUnknownAiToolId(candidate)) {
    return candidate;
  }

  const knownPlatforms = new Set<string>(IDE_AI_TOOL_ORDER);
  if (candidate && (knownPlatforms.has(candidate) || PLATFORM_CONFIG[candidate as keyof typeof PLATFORM_CONFIG])) {
    return candidate;
  }

  const source = `${configPath} ${componentName}`.toLowerCase();
  for (const [marker, platform] of PLATFORM_PATH_HINTS) {
    if (source.includes(marker)) {
      return platform;
    }
  }

  return 'unknown_ai_tool';
}

function getPlatformVisual(platformId: string): { name: string; color: string; icon: string } {
  if (isUnknownAiToolId(platformId)) {
    const unknownBase = PLATFORM_CONFIG.unknown_ai_tool || {
      name: tr('未知工具', 'Unknown tool'),
      color: '#6B7280',
      icon: '🧩',
    };
    return {
      ...unknownBase,
      name: formatUnknownAiToolLabel(platformId),
    };
  }

  return PLATFORM_CONFIG[platformId] || { name: platformId, color: '#6B7280', icon: '🔌' };
}

function normalizeHostCapability(
  platformId: string,
  rawCapability: HostCapability | undefined,
  installTargetReady: boolean,
): HostCapability {
  if (isUnknownAiToolId(platformId)) {
    return rawCapability === 'detect_only' ? 'detect_only' : 'manual';
  }
  if (rawCapability) {
    return rawCapability;
  }
  return installTargetReady ? 'one_click' : 'manual';
}

function hasRiskSurface(entry: HostOverviewEntry): boolean {
  return (
    entry.componentCount > 0
    || entry.riskSurface.has_mcp
    || entry.riskSurface.has_skill
    || entry.riskSurface.has_exec_signal
    || entry.riskSurface.has_secret_signal
  );
}

function formatHostCapability(value: HostCapability): string {
  switch (value) {
    case 'one_click':
      return tr('可一键处理', 'One-click ready');
    case 'manual':
      return tr('需要手动处理', 'Manual steps');
    case 'detect_only':
      return tr('需要留意', 'Needs review');
    default:
      return value;
  }
}

function formatHostCapabilityShort(value: HostCapability): string {
  switch (value) {
    case 'one_click':
      return tr('一键', 'Auto');
    case 'manual':
      return tr('手动', 'Manual');
    case 'detect_only':
      return tr('留意', 'Review');
    default:
      return value;
  }
}

function hostCapabilityClassName(value: HostCapability): string {
  switch (value) {
    case 'one_click':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'manual':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'detect_only':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    default:
      return 'bg-slate-50 text-slate-700 border-slate-200';
  }
}

function formatHostConfidence(value: HostConfidence): string {
  switch (value) {
    case 'high':
      return tr('正在运行', 'Running now');
    case 'medium':
      return tr('疑似在运行', 'Likely running');
    case 'low':
      return tr('可能存在', 'Possibly present');
    default:
      return value;
  }
}

function formatSourceTier(value: SourceTier): string {
  switch (value) {
    case 'a':
      return tr('来源可信', 'Trusted source');
    case 'b':
      return tr('来源待确认', 'Source not verified');
    case 'c':
      return tr('来源不明', 'Unknown source');
    default:
      return value;
  }
}

function formatEvidenceType(value: string): string {
  switch (value) {
    case 'mcp_config':
      return tr('插件配置文件', 'Plugin config file');
    case 'skill_root':
      return tr('扩展脚本目录', 'Skill folder');
    case 'exec_signal':
      return tr('可执行操作线索', 'Command execution signal');
    case 'secret_signal':
      return tr('可能接触账号密钥', 'May access passwords or keys');
    case 'skill_manifest':
      return tr('扩展脚本说明文件', 'Skill manifest');
    case 'mcp_server_entry':
      return tr('检测到插件服务条目', 'MCP server entries found');
    case 'mcp_key':
      return tr('检测到插件配置字段', 'MCP fields detected');
    case 'path_hint':
      return tr('路径线索', 'Path hint');
    case 'detection_source':
      return tr('发现方式', 'How it was found');
    default:
      return value;
  }
}

function formatDetectionSourceValue(value: string): string {
  switch (value) {
    case 'app':
    case 'app_bundle_discovery':
      return tr('应用程序', 'Application');
    case 'cli':
      return tr('命令行工具', 'CLI tool');
    case 'config_dir':
      return tr('配置目录', 'Config folder');
    case 'config_file':
    case 'deep_discovery_config':
      return tr('配置文件扫描', 'Config file scan');
    case 'deep_discovery_skill':
      return tr('扩展脚本目录扫描', 'Skill folder scan');
    default: {
      const normalized = value.trim().replace(/[_-]+/g, ' ');
      if (!normalized) {
        return t.unknown;
      }
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

function formatSensitiveCapability(value: string): string {
  switch (value) {
    case '命令执行':
      return tr('命令执行', 'Command execution');
    case '读写本地文件':
      return tr('读写本地文件', 'Read/write local files');
    case '删改本地文件':
      return tr('删改本地文件', 'Modify/delete local files');
    case '发送邮件':
      return tr('发送邮件', 'Send emails');
    case '删改邮件':
      return tr('删改邮件', 'Delete/archive emails');
    case '自动网页提交':
      return tr('自动网页提交', 'Automated web submission');
    case '支付或转账':
      return tr('支付或转账', 'Payments/transfers');
    case '敏感信息外发':
      return tr('敏感信息外发', 'Sensitive data exfiltration');
    case '凭据读取':
      return tr('凭据读取', 'Credential access');
    case '修改扩展配置':
      return tr('修改扩展配置', 'Modify extension config');
    case '删除扩展配置':
      return tr('删除扩展配置', 'Delete extension config');
    default:
      return localizedDynamicText(value, tr('敏感能力', 'Sensitive capability'));
  }
}

export function InstalledManagement({ onBack }: InstalledManagementProps) {
  const { isPro, isTrial } = useProGate();
  const oneClickOpsUnlocked = isPro || isTrial;
  const [items, setItems] = useState<GuardedInstalledMcp[]>([]);
  const [detectedTools, setDetectedTools] = useState<DetectedToolEntry[]>([]);
  const [detectedPlatformIds, setDetectedPlatformIds] = useState<Platform[]>([]);
  const [selectedItem, setSelectedItem] = useState<GuardedInstalledMcp | null>(null);
  const [selectedHostId, setSelectedHostId] = useState<Platform | null>(null);
  const [showRiskOnlyHosts, setShowRiskOnlyHosts] = useState(true);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updatingItem, setUpdatingItem] = useState(false);
  const [syncingGuard, setSyncingGuard] = useState(false);
  const [launchingGuardedItem, setLaunchingGuardedItem] = useState(false);
  const [globalCleanupRunning, setGlobalCleanupRunning] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<UpdateAuditItem | null>(null);
  const [runtimeSessions, setRuntimeSessions] = useState<RuntimeGuardSession[]>([]);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeGuardStatus | null>(null);
  const [runtimeEvents, setRuntimeEvents] = useState<RuntimeGuardEvent[]>([]);
  const [runtimePolicy, setRuntimePolicy] = useState<RuntimeGuardPolicy | null>(null);

  const loadInstalledData = useCallback(async () => {
    const [mcps, managedItems, runtimeComponents, sessions, guardStatus, events, policy, detectedToolEntries] = await Promise.all([
      invoke<any[]>('scan_installed_mcps').catch(() => []),
      invoke<ManagedInstalledItem[]>('list_installed_items').catch(() => []),
      syncRuntimeGuardComponents().catch(() => []),
      listRuntimeGuardSessions().catch(() => []),
      getRuntimeGuardStatus().catch(() => null),
      listRuntimeGuardEvents().catch(() => []),
      getRuntimeGuardPolicy().catch(() => null),
      invoke<DetectedToolEntry[]>('detect_ai_tools').catch(() => []),
    ]);

    const managedMap = new Map(
      managedItems.map((item) => [`${item.id}:${item.platform}`, item])
    );
    const runtimeMap = new Map(
      (runtimeComponents as RuntimeGuardComponent[]).map((component) => [
        `${component.platform_id}:${component.name}:${component.config_path}`,
        component,
      ])
    );

    const installed: GuardedInstalledMcp[] = mcps.map((mcp: any) => {
      const managed = managedMap.get(`${mcp.name}:${mcp.platform_id}`);
      const inferredVersion = inferVersionFromArgs(mcp.command, mcp.args || []);
      const runtimeComponent = runtimeMap.get(`${mcp.platform_id}:${mcp.name}:${mcp.config_path}`);
      const normalizedPlatformId = normalizePlatformId(mcp.platform_id, mcp.config_path, mcp.name);

      return {
        item_id: mcp.name,
        name: mcp.name,
        description: `${mcp.command} ${(mcp.args || []).join(' ')}`.trim(),
        version: managed?.version || inferredVersion || 'unknown',
        icon: getPlatformVisual(normalizedPlatformId).icon,
        platform_id: normalizedPlatformId,
        safety_level: (mcp.safety_level || 'unverified') as any,
        permissions: [],
        componentType: mcp.command === 'skill' ? 'skill' : 'mcp',
        installDate: managed?.installed_at || new Date().toISOString(),
        sourceUrl: managed?.source_url || mcp.config_path,
        managedByAgentShield: Boolean(managed),
        runtimeComponentId: runtimeComponent?.component_id,
        runtimeTrustState: runtimeComponent?.trust_state,
        runtimeSourceKind: runtimeComponent?.source_kind,
        runtimeRiskSummary: runtimeComponent?.risk_summary,
        runtimeNetworkMode: runtimeComponent?.network_mode,
        runtimeAllowedDomains: runtimeComponent?.allowed_domains,
        runtimeSensitiveCapabilities: runtimeComponent?.sensitive_capabilities,
        runtimeRequiresExplicitApproval: runtimeComponent?.requires_explicit_approval,
      };
    });
    const normalizedDetectedTools = (Array.isArray(detectedToolEntries) ? detectedToolEntries : [])
      .filter((tool) => Boolean(tool.detected || tool.has_mcp_config || tool.host_detected || tool.install_target_ready))
      .map((tool) => ({
        ...tool,
        id: normalizePlatformId(tool.id, tool.path || '', tool.name || ''),
      }));
    const detectedIds = normalizedDetectedTools.map((tool) => tool.id as Platform);
    setItems(installed);
    setDetectedTools(normalizedDetectedTools);
    setDetectedPlatformIds(detectedIds);
    setRuntimeSessions(sessions);
    setRuntimeStatus(guardStatus);
    setRuntimeEvents(events);
    setRuntimePolicy(policy);
    setSelectedItem((previous) => {
      if (!previous) {
        return previous;
      }
      return installed.find((item) => getInstalledItemKey(item) === getInstalledItemKey(previous)) ?? null;
    });
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        await loadInstalledData();
      } catch {
        if (active) {
          setItems([]);
          setDetectedTools([]);
          setDetectedPlatformIds([]);
          setRuntimeSessions([]);
          setRuntimeStatus(null);
          setRuntimeEvents([]);
          setRuntimePolicy(null);
        }
      }
    };

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [loadInstalledData]);

  const theme = MODULE_THEMES.installed;

  // Keep AI tools/IDE list stable and human-readable: known tools first, then fallback ids.
  const observedPlatforms = new Set<Platform>([
    ...items.map((item) => item.platform_id),
    ...detectedPlatformIds,
  ]);
  const knownOrderedPlatforms = IDE_AI_TOOL_ORDER.filter((platformId) =>
    observedPlatforms.has(platformId)
  );
  const extraPlatforms = [...observedPlatforms]
    .filter((platformId) => !IDE_AI_TOOL_ORDER.includes(platformId))
    .sort();
  const orderedPlatforms = [...knownOrderedPlatforms, ...extraPlatforms];

  const detectedToolMap = new Map(
    detectedTools.map((tool) => [tool.id as Platform, tool])
  );

  const hostEntries: HostOverviewEntry[] = orderedPlatforms.map((platformId) => {
    const tool = detectedToolMap.get(platformId);
    const visual = getPlatformVisual(platformId);
    const componentItems = items.filter((item) => item.platform_id === platformId);
    const mcpCount = componentItems.filter((item) => item.componentType === 'mcp').length;
    const skillCount = componentItems.filter((item) => item.componentType === 'skill').length;
    const componentCount = componentItems.length;
    const evidenceItems = tool?.evidence_items || [];

    const riskSurface: HostRiskSurface = {
      has_mcp: Boolean(tool?.risk_surface?.has_mcp || mcpCount > 0),
      has_skill: Boolean(tool?.risk_surface?.has_skill || skillCount > 0),
      has_exec_signal: Boolean(tool?.risk_surface?.has_exec_signal),
      has_secret_signal: Boolean(tool?.risk_surface?.has_secret_signal),
      evidence_count: Math.max(tool?.risk_surface?.evidence_count || 0, evidenceItems.length),
    };

    const hostConfidence: HostConfidence = tool?.host_confidence
      || ((tool?.detected || tool?.host_detected) ? 'high' : componentCount > 0 ? 'medium' : 'low');
    const sourceTier: SourceTier = tool?.source_tier
      || (isUnknownAiToolId(platformId) ? 'c' : IDE_AI_TOOL_ORDER.includes(platformId) ? 'a' : 'b');
    const installTargetReady = Boolean(tool?.install_target_ready || componentCount > 0);
    const managementCapability = normalizeHostCapability(
      platformId,
      tool?.management_capability,
      installTargetReady,
    );

    return {
      id: platformId,
      name: visual.name,
      icon: visual.icon,
      color: visual.color,
      detected: Boolean(tool?.detected || componentCount > 0),
      hostDetected: Boolean(tool?.host_detected || tool?.detected || componentCount > 0),
      installTargetReady,
      hostConfidence,
      riskSurface,
      managementCapability,
      sourceTier,
      evidenceItems,
      componentCount,
      mcpCount,
      skillCount,
    };
  });

  // Filter out hash-based unknown tools that have zero components and no real risk signals.
  // These are noise from the dynamic scanner (random config dirs mistaken as AI tools).
  const meaningfulHostEntries = hostEntries.filter((entry) => {
    // Always keep known tools
    if (!isUnknownAiToolId(entry.id)) return true;
    // Keep unknown tools that have real components
    if (entry.componentCount > 0) return true;
    // Keep unknown tools that have real risk signals
    if (entry.riskSurface.has_secret_signal || entry.riskSurface.has_exec_signal) return true;
    // Keep unknown tools with meaningful evidence (MCP/Skill)
    if (entry.riskSurface.has_mcp || entry.riskSurface.has_skill) return true;
    // Drop the rest — likely noise
    return false;
  });

  const riskyHostEntries = meaningfulHostEntries.filter((entry) => hasRiskSurface(entry));
  const visibleHostEntries = showRiskOnlyHosts ? riskyHostEntries : meaningfulHostEntries;
  const selectedHost = visibleHostEntries.find((entry) => entry.id === selectedHostId)
    || meaningfulHostEntries.find((entry) => entry.id === selectedHostId)
    || visibleHostEntries[0]
    || null;

  const subtitle = tr(
    `发现 ${meaningfulHostEntries.length} 个工具，其中 ${riskyHostEntries.length} 个需要处理`,
    `${meaningfulHostEntries.length} tools found, ${riskyHostEntries.length} need attention`,
  );

  useEffect(() => {
    if (visibleHostEntries.length === 0) {
      if (selectedHostId !== null) {
        setSelectedHostId(null);
      }
      return;
    }

    if (!selectedHostId || !visibleHostEntries.some((entry) => entry.id === selectedHostId)) {
      setSelectedHostId(visibleHostEntries[0].id);
    }
  }, [selectedHostId, visibleHostEntries]);

  const openManualPathForItem = useCallback(async (item: GuardedInstalledMcp | null) => {
    if (!item?.sourceUrl) {
      setUpdateStatus(tr('找不到来源地址，请按官方说明手动处理。', 'Source not found. Follow the official guide to handle it manually.'));
      return;
    }

    if (/^https?:\/\//.test(item.sourceUrl)) {
      await openExternalUrl(item.sourceUrl);
      setUpdateStatus(tr('已打开官方页面，请按页面提示手动处理。', 'Official page opened. Follow the instructions there.'));
      return;
    }

    await invoke('reveal_path_in_finder', { path: item.sourceUrl });
    setUpdateStatus(tr('已打开文件所在目录，请手动处理。', 'Folder opened. Please handle it manually.'));
  }, []);

  const openHostEvidencePath = useCallback(async (host: HostOverviewEntry | null) => {
    if (!host) {
      return;
    }

    const firstEvidencePath = host.evidenceItems
      .map((item) => item.path)
      .find((path) => Boolean(path && path.trim().length > 0));

    if (!firstEvidencePath) {
      setUpdateStatus(tr('找不到相关文件位置，请参考官方说明。', 'Related file path not found. Check the official guide.'));
      return;
    }

    if (/^https?:\/\//.test(firstEvidencePath)) {
      await openExternalUrl(firstEvidencePath);
      setUpdateStatus(tr('已打开相关页面，请按页面提示操作。', 'Related page opened. Follow the instructions there.'));
      return;
    }

    await invoke('reveal_path_in_finder', { path: firstEvidencePath });
    setUpdateStatus(tr('已打开文件所在目录，你可以在这里手动处理。', 'Folder opened. You can handle it manually here.'));
  }, []);

  const handleUninstall = useCallback(async (itemId: string, platformId: Platform) => {
    try {
      const currentItem = selectedItem && selectedItem.item_id === itemId && selectedItem.platform_id === platformId
        ? selectedItem
        : items.find((item) => item.item_id === itemId && item.platform_id === platformId) || null;
      const approval = await requestRuntimeGuardActionApproval({
        component_id: `agentshield:installed:${platformId}:${itemId}`,
        component_name: currentItem?.name ?? itemId,
        platform_id: platformId,
        platform_name: getPlatformVisual(platformId).name,
        request_kind: 'file_delete',
        trigger_event: 'installed_item_uninstall_request',
        action_kind: 'file_delete',
        action_source: 'user_requested_uninstall',
        action_targets: [
          currentItem?.sourceUrl || `${platformId}:${itemId}`,
        ].filter((value): value is string => Boolean(value)),
        action_preview: [
          tr(`目标组件: ${currentItem?.name ?? itemId}`, `Target: ${currentItem?.name ?? itemId}`),
          tr(`所在工具: ${getPlatformVisual(platformId).name}`, `Tool: ${getPlatformVisual(platformId).name}`),
          currentItem?.sourceUrl
            ? tr(`来源: ${currentItem.sourceUrl}`, `Source: ${currentItem.sourceUrl}`)
            : tr('将从真实配置中移除该扩展组件', 'Will remove this extension from real config files'),
        ],
        sensitive_capabilities: [tr('读写本地文件', 'Read and write local files')],
        is_destructive: true,
        is_batch: false,
      });
      if (approval.status !== 'approved' || !approval.approval_ticket) {
        setUpdateStatus(tr('请先确认弹出的安全提示，然后再次点击卸载。', 'Please approve the security prompt, then click uninstall again.'));
        return;
      }
      const removed = await invoke<boolean>('uninstall_item', {
        itemId,
        platform: platformId,
        sourcePath: currentItem?.sourceUrl ?? null,
        approvalTicket: approval.approval_ticket,
      });
      if (!removed) {
        setUpdateStatus(t.checkUpdatesFailed);
        return;
      }
      const currentKey = currentItem ? getInstalledItemKey(currentItem) : `${platformId}:${itemId}:`;
      setItems(prev => prev.filter(i => getInstalledItemKey(i) !== currentKey));
      if (selectedItem && getInstalledItemKey(selectedItem) === currentKey) {
        setSelectedItem(null);
      }
      setPendingUpdate(null);
      setUpdateStatus(tr('已成功卸载。', 'Uninstalled successfully.'));
      await loadInstalledData();
    } catch (error) {
      setUpdateStatus(getErrorMessage(error));
    }
  }, [items, loadInstalledData, selectedItem]);

  const handleCheckUpdates = useCallback(async () => {
    setCheckingUpdates(true);
    setUpdateStatus(null);
    setPendingUpdate(null);
    try {
      const results = await invoke<UpdateAuditItem[]>('check_installed_updates');
      if (selectedItem) {
        const selectedResult = results.find((result) =>
          result.item_id === selectedItem.item_id
          && (result.platform || selectedItem.platform_id) === selectedItem.platform_id
          && (result.source_path || selectedItem.sourceUrl || '') === (selectedItem.sourceUrl || '')
        );
        if (selectedResult && !selectedResult.tracked) {
          setUpdateStatus(selectedResult.reason);
          return;
        }
        if (!selectedResult && !selectedItem.managedByAgentShield) {
          setUpdateStatus(tr('这个扩展不是通过 AgentShield 安装的，暂时无法自动更新。', 'This extension was not installed by AgentShield, so auto-update is unavailable.'));
          return;
        }
        if (selectedResult?.has_update) {
          setPendingUpdate(selectedResult);
          setUpdateStatus(tr(`发现可更新版本 ${selectedResult.new_version}`, `Update available: ${selectedResult.new_version}`));
          return;
        }
      }
      const updatable = results.filter(r => r.has_update);
      if (updatable.length > 0) {
        setUpdateStatus(t.foundUpdates.replace('{count}', String(updatable.length)));
      } else {
        setUpdateStatus(t.allUpToDate);
      }
    } catch {
      setUpdateStatus(t.checkUpdatesFailed);
    } finally {
      setCheckingUpdates(false);
    }
  }, [selectedItem]);

  const handleApplyUpdate = useCallback(async () => {
    if (!selectedItem) {
      return;
    }

    setUpdatingItem(true);
    try {
      const approval = await requestRuntimeGuardActionApproval({
        component_id: `agentshield:update:${selectedItem.platform_id}:${selectedItem.item_id}`,
        component_name: selectedItem.name,
        platform_id: selectedItem.platform_id,
        platform_name: getPlatformVisual(selectedItem.platform_id).name,
        request_kind: 'component_update',
        trigger_event: 'installed_item_update_request',
        action_kind: 'component_update',
        action_source: 'user_requested_update',
        action_targets: [
          selectedItem.sourceUrl || `${selectedItem.platform_id}:${selectedItem.item_id}`,
        ].filter((value): value is string => Boolean(value)),
        action_preview: [
          tr(`目标组件: ${selectedItem.name}`, `Target: ${selectedItem.name}`),
          tr(`所在工具: ${getPlatformVisual(selectedItem.platform_id).name}`, `Tool: ${getPlatformVisual(selectedItem.platform_id).name}`),
          tr(`当前版本: ${selectedItem.version}`, `Current version: ${selectedItem.version}`),
          pendingUpdate?.new_version
            ? tr(`准备升级到: ${pendingUpdate.new_version}`, `Will update to: ${pendingUpdate.new_version}`)
            : tr('将写回真实扩展配置', 'Will write changes to real extension config'),
        ],
        sensitive_capabilities: [tr('修改扩展配置', 'Modify extension config')],
        is_destructive: false,
        is_batch: false,
      });
      if (approval.status !== 'approved' || !approval.approval_ticket) {
        setUpdateStatus(tr('请先确认弹出的安全提示，然后再次点击更新。', 'Please approve the security prompt, then click update again.'));
        return;
      }

      const updated = await invoke<boolean>('update_installed_item', {
        itemId: selectedItem.item_id,
        platform: selectedItem.platform_id,
        sourcePath: selectedItem.sourceUrl ?? null,
        approvalTicket: approval.approval_ticket,
      });

      if (!updated) {
        setPendingUpdate(null);
        setUpdateStatus(t.allUpToDate);
        return;
      }

      const nextVersion = pendingUpdate?.new_version || selectedItem.version;
      setItems((previous) =>
        previous.map((item) =>
          getInstalledItemKey(item) === getInstalledItemKey(selectedItem)
            ? { ...item, version: nextVersion }
            : item
        )
      );
      setSelectedItem((previous) =>
        previous && getInstalledItemKey(previous) === getInstalledItemKey(selectedItem)
          ? { ...previous, version: nextVersion }
          : previous
      );
      setPendingUpdate(null);
      setUpdateStatus(tr(`已升级到 ${nextVersion}`, `Updated to ${nextVersion}`));
      await loadInstalledData();
    } catch (error) {
      setUpdateStatus(getErrorMessage(error));
    } finally {
      setUpdatingItem(false);
    }
  }, [loadInstalledData, pendingUpdate, selectedItem]);

  const handleSyncGuard = useCallback(async () => {
    setSyncingGuard(true);
    try {
      await runRuntimeGuardPollNow();
      await loadInstalledData();
      setUpdateStatus(tr('已刷新安全状态。', 'Security status refreshed.'));
    } catch (error) {
      setUpdateStatus(getErrorMessage(error));
    } finally {
      setSyncingGuard(false);
    }
  }, [loadInstalledData]);

  const handleTrustChange = useCallback(async (item: GuardedInstalledMcp, trustState: string) => {
    if (!item.runtimeComponentId) {
      return;
    }
    try {
      const approval = await requestRuntimeGuardActionApproval({
        component_id: item.runtimeComponentId,
        component_name: item.name,
        platform_id: item.platform_id,
        platform_name: getPlatformVisual(item.platform_id).name,
        request_kind: 'runtime_guard_policy',
        trigger_event: 'runtime_guard_trust_change_request',
        action_kind: 'component_trust_update',
        action_source: 'user_requested_component_trust_change',
        action_targets: [trustState],
        action_preview: [
          tr(`将把 ${item.name} 信任级别调整为 ${formatRuntimeTrustStateShort(trustState)}`, `Will set ${item.name} trust to ${formatRuntimeTrustStateShort(trustState)}`),
          tr('此操作会影响实时守卫放行/拦截策略。', 'This operation changes runtime guard allow/block policy.'),
        ],
        sensitive_capabilities: [tr('修改运行时信任策略', 'Modify runtime trust policy')],
        is_destructive: trustState === 'blocked' || trustState === 'quarantined',
        is_batch: false,
      });
      if (approval.status !== 'approved' || !approval.approval_ticket) {
        setUpdateStatus(tr(
          '请先确认弹出的安全提示，然后再次修改信任级别。',
          'Please approve the security prompt, then retry changing trust state.',
        ));
        return;
      }

      await updateComponentTrustState(item.runtimeComponentId, trustState, undefined, approval.approval_ticket);
      await loadInstalledData();
      setUpdateStatus(
        tr(
          `已把 ${item.name} 调整为“${formatRuntimeTrustStateShort(trustState)}”`,
          `${item.name} is now "${formatRuntimeTrustStateShort(trustState)}"`,
        )
      );
    } catch (error) {
      setUpdateStatus(getErrorMessage(error));
    }
  }, [loadInstalledData]);

  const handleNetworkPolicySave = useCallback(async (item: GuardedInstalledMcp, allowedDomains: string[], networkMode?: string) => {
    if (!item.runtimeComponentId) {
      return;
    }
    try {
      const normalizedDomains = Array.from(
        new Set(
          allowedDomains
            .map((domain) => domain.trim())
            .filter((domain) => domain.length > 0)
        )
      ).sort();
      const normalizedMode = (networkMode ?? '').trim();
      const actionTargets = [
        normalizedMode ? `mode:${normalizedMode}` : 'mode:unchanged',
        ...normalizedDomains,
      ];
      const approval = await requestRuntimeGuardActionApproval({
        component_id: item.runtimeComponentId,
        component_name: item.name,
        platform_id: item.platform_id,
        platform_name: getPlatformVisual(item.platform_id).name,
        request_kind: 'runtime_guard_policy',
        trigger_event: 'runtime_guard_network_policy_update_request',
        action_kind: 'component_network_policy_update',
        action_source: 'user_requested_component_network_policy_update',
        action_targets: actionTargets,
        action_preview: [
          tr(`将更新 ${item.name} 的联网策略`, `Will update network policy for ${item.name}`),
          normalizedMode
            ? tr(`模式: ${normalizedMode}`, `Mode: ${normalizedMode}`)
            : tr('模式保持不变', 'Mode unchanged'),
          normalizedDomains.length > 0
            ? tr(`白名单域名: ${normalizedDomains.join(', ')}`, `Allowlist domains: ${normalizedDomains.join(', ')}`)
            : tr('白名单为空（仅按模式控制）', 'No allowlist domains (mode-only control)'),
        ],
        sensitive_capabilities: [tr('修改联网白名单', 'Modify network allowlist')],
        is_destructive: normalizedMode === 'blocked',
        is_batch: false,
      });
      if (approval.status !== 'approved' || !approval.approval_ticket) {
        setUpdateStatus(tr(
          '请先确认弹出的安全提示，然后再次保存联网策略。',
          'Please approve the security prompt, then retry saving network policy.',
        ));
        return;
      }

      await updateComponentNetworkPolicy(
        item.runtimeComponentId,
        normalizedDomains,
        networkMode ?? (normalizedDomains.length > 0 ? 'allowlist' : 'observe_only'),
        approval.approval_ticket,
      );
      await loadInstalledData();
      setUpdateStatus(tr('已保存联网地址白名单。', 'Allowed network domains saved.'));
    } catch (error) {
      setUpdateStatus(getErrorMessage(error));
    }
  }, [loadInstalledData]);

  const handleGuardedLaunch = useCallback(async (item: GuardedInstalledMcp) => {
    if (!item.runtimeComponentId) {
      return;
    }
    setLaunchingGuardedItem(true);
    try {
      await launchRuntimeGuardComponent(item.runtimeComponentId);
      await loadInstalledData();
      setUpdateStatus(tr(`已安全启动 ${item.name}`, `Started ${item.name} with protection.`));
    } catch (error) {
      setUpdateStatus(getErrorMessage(error));
    } finally {
      setLaunchingGuardedItem(false);
    }
  }, [loadInstalledData]);

  const handleTerminateSession = useCallback(async (sessionId: string) => {
    try {
      await terminateRuntimeGuardSession(sessionId);
      await loadInstalledData();
      setUpdateStatus(tr('已停止运行。', 'Stopped successfully.'));
    } catch (error) {
      setUpdateStatus(getErrorMessage(error));
    }
  }, [loadInstalledData]);

  const handleClearEvents = useCallback(async () => {
    try {
      await clearRuntimeGuardEvents();
      await loadInstalledData();
      setUpdateStatus(tr('已清除安全记录。', 'Security records cleared.'));
    } catch (error) {
      setUpdateStatus(getErrorMessage(error));
    }
  }, [loadInstalledData]);

  const requestCleanupPreview = useCallback(async (scopePlatforms?: Platform[] | null) => {
    const normalizedScope = Array.from(
      new Set((scopePlatforms || []).map((platform) => String(platform || '').trim()).filter(Boolean))
    );
    const preview = await invoke<GlobalCleanupPreview>('preview_global_cleanup', {
      scopePlatforms: normalizedScope,
      includeDependencyCleanup: true,
    });
    return preview;
  }, []);

  const [cleanupPreviewData, setCleanupPreviewData] = useState<GlobalCleanupPreview | null>(null);

  const handlePreviewGlobalCleanup = useCallback(async (scopePlatforms?: Platform[] | null) => {
    try {
      const preview = await requestCleanupPreview(scopePlatforms);
      if (preview.component_count === 0 && !preview.include_openclaw_deep_cleanup) {
        setUpdateStatus(tr('当前没有可清理的 AI 组件。', 'No AI components are currently available for cleanup.'));
        setCleanupPreviewData(null);
        return;
      }
      setCleanupPreviewData(preview);
      const scopeLabel = preview.scope_platforms.length === 0
        ? tr('全部工具', 'all tools')
        : preview.scope_platforms.join(', ');
      setUpdateStatus(
        tr(
          `已生成清理预览（${scopeLabel}）：${preview.component_count} 个组件，${preview.auto_cleanup_component_count} 个可自动处理，${preview.manual_only_component_count} 个需手动处理，依赖清理 ${preview.dependency_task_count} 项。`,
          `Cleanup preview ready (${scopeLabel}): ${preview.component_count} components, ${preview.auto_cleanup_component_count} auto-cleanable, ${preview.manual_only_component_count} manual-only, ${preview.dependency_task_count} dependency tasks.`
        )
      );
    } catch (error) {
      setUpdateStatus(getErrorMessage(error));
      setCleanupPreviewData(null);
    }
  }, [requestCleanupPreview]);

  const handleExecuteGlobalCleanup = useCallback(async (scopePlatforms?: Platform[] | null) => {
    if (!oneClickOpsUnlocked) {
      setUpdateStatus(t.upgradeToPro);
      return;
    }

    setGlobalCleanupRunning(true);
    setUpdateStatus(null);
    try {
      const preview = await requestCleanupPreview(scopePlatforms);
      const hasAutoWork =
        preview.auto_cleanup_component_count > 0 || preview.include_openclaw_deep_cleanup;
      if (!hasAutoWork) {
        setUpdateStatus(
          tr(
            '已识别到组件，但当前都需要手动治理。请点进组件详情按指引处理。',
            'Components were detected, but all require manual handling. Open each component for guided steps.'
          )
        );
        return;
      }

      const approval = await requestRuntimeGuardActionApproval({
        component_id: 'agentshield:installed:global_cleanup',
        component_name: tr('全局卸载与依赖清理', 'Global uninstall and cleanup'),
        platform_id: preview.scope_platforms.length === 1 ? preview.scope_platforms[0] : 'agentshield',
        platform_name:
          preview.scope_platforms.length === 1
            ? getPlatformVisual(preview.scope_platforms[0]).name
            : 'AgentShield',
        request_kind: 'bulk_file_modify',
        trigger_event: 'global_cleanup_execute_request',
        action_kind: 'bulk_file_modify',
        action_source: 'user_requested_global_cleanup',
        action_targets: preview.action_targets,
        action_preview: [
          tr(
            `准备清理 ${preview.auto_cleanup_component_count} 个组件与 ${preview.dependency_task_count} 项依赖`,
            `Will clean ${preview.auto_cleanup_component_count} components and ${preview.dependency_task_count} dependency tasks`
          ),
          tr('先执行预演，再执行真实清理。', 'Preview is completed. Real cleanup will run next.'),
        ],
        sensitive_capabilities: [tr('读写本地文件', 'Read and write local files')],
        is_destructive: true,
        is_batch: true,
      });

      if (approval.status !== 'approved' || !approval.approval_ticket) {
        setUpdateStatus(
          tr(
            '已发起全局清理审批，请在弹窗确认后再点击一次执行。',
            'Global cleanup approval was requested. Confirm it first, then click again.'
          )
        );
        return;
      }

      const report = await invoke<GlobalCleanupReport>('execute_global_cleanup', {
        planId: preview.plan_id,
        approvalTicket: approval.approval_ticket,
      });
      await loadInstalledData();

      const unresolved = report.remaining_components.length;
      const head = tr(
        `全局清理完成：成功 ${report.success_actions}，失败 ${report.failed_actions}，跳过 ${report.skipped_actions}。`,
        `Global cleanup finished: ${report.success_actions} succeeded, ${report.failed_actions} failed, ${report.skipped_actions} skipped.`
      );
      const backupTail = (report.backup_count ?? 0) > 0
        ? tr(`已创建 ${report.backup_count} 份配置备份。`, `Created ${report.backup_count} config backups.`)
        : '';
      setUpdateStatus(
        unresolved > 0
          ? `${head} ${tr(`仍有 ${unresolved} 项未清理，请查看详情并手动处理。`, `${unresolved} items remain. Review details and handle manually.`)} ${backupTail}`.trim()
          : `${head} ${tr('已清理完成，主列表仅显示剩余风险。', 'Cleanup complete. The main list now shows only remaining risks.')} ${backupTail}`.trim()
      );
    } catch (error) {
      setUpdateStatus(getErrorMessage(error));
    } finally {
      setGlobalCleanupRunning(false);
    }
  }, [loadInstalledData, oneClickOpsUnlocked, requestCleanupPreview]);

  const selectedItemKey = selectedItem ? getInstalledItemKey(selectedItem) : null;
  const selectedHostComponents = useMemo(() => {
    if (!selectedHost) {
      return [] as GuardedInstalledMcp[];
    }
    return items.filter((item) => item.platform_id === selectedHost.id);
  }, [items, selectedHost?.id]);
  const sortedSelectedHostComponents = useMemo(() => (
    [...selectedHostComponents].sort((a, b) => {
      const bySafety = SAFETY_PRIORITY[a.safety_level] - SAFETY_PRIORITY[b.safety_level];
      if (bySafety !== 0) {
        return bySafety;
      }
      return a.name.localeCompare(b.name, isEnglishLocale ? 'en' : 'zh-Hans');
    })
  ), [selectedHostComponents]);
  const selectedRuntimeSessions = selectedItem?.runtimeComponentId
    ? runtimeSessions.filter((session) => session.component_id === selectedItem.runtimeComponentId)
    : [];
  const selectedRuntimeEvents = selectedItem?.runtimeComponentId
    ? runtimeEvents.filter((event) => event.component_id === selectedItem.runtimeComponentId)
    : [];

  useEffect(() => {
    if (!selectedHostId) {
      return;
    }
    const escapedHostId =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(selectedHostId)
        : selectedHostId.replace(/"/g, '\\"');
    const activeHostElement = document.querySelector<HTMLElement>(`[data-host-id="${escapedHostId}"]`);
    safeScrollIntoView(activeHostElement);
  }, [selectedHostId]);

  useEffect(() => {
    if (!selectedItemKey) {
      return;
    }
    const escapedItemKey =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(selectedItemKey)
        : selectedItemKey.replace(/"/g, '\\"');
    const activeItemElement = document.querySelector<HTMLElement>(`[data-item-key="${escapedItemKey}"]`);
    safeScrollIntoView(activeItemElement);
  }, [selectedItemKey]);

  return (
    <>
      <ThreeColumnLayout
      title={t.installedManagement}
      subtitle={subtitle}
      onBack={onBack}
      accentColor={theme.accent}
      leftColumnClassName="w-[28%] min-w-[280px]"
      middleColumnClassName="w-[30%]"
      leftColumn={
        <div className="space-y-2">
          <div className="px-1 pb-1">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{tr('第 1 步', 'Step 1')}</p>
            <h3 className="text-sm font-semibold text-slate-800">{tr('选择工具', 'Select tool')}</h3>
          </div>
          <button
            onClick={() => setShowRiskOnlyHosts((current) => !current)}
            className={cn(
              'w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs border transition-colors',
              showRiskOnlyHosts
                ? 'bg-amber-50 border-amber-200 text-amber-700'
                : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
            )}
          >
            <span>{tr('只看需要处理的工具', 'Show only tools that need attention')}</span>
            <span>{showRiskOnlyHosts ? t.enabled : t.disabled}</span>
          </button>

          <div className="space-y-1 pr-1">
            {visibleHostEntries.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
                {tr('没有发现工具。', 'No tools found.')}
              </div>
            ) : (
              visibleHostEntries.map((host) => (
                <div key={host.id} data-host-id={host.id}>
                  <HostFilterItem
                    host={host}
                    active={selectedHost?.id === host.id}
                    onClick={() => {
                      setSelectedHostId(host.id);
                      setSelectedItem(null);
                    }}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      }
      middleColumn={
        <div className="p-4 h-full flex flex-col">
          <div className="px-1 pb-2">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{tr('第 2 步', 'Step 2')}</p>
            <h3 className="text-sm font-semibold text-slate-800">{tr('选择组件', 'Select component')}</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {selectedHost
                ? tr(`${selectedHost.name} 下的组件`, `Components in ${selectedHost.name}`)
                : tr('先在左侧选择工具', 'Select a tool on the left first')}
            </p>
          </div>
          <div className="space-y-1 pr-1 overflow-y-auto">
            {!selectedHost ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-8 text-center text-sm text-slate-500">
                {tr('先完成第 1 步：选择工具', 'Complete Step 1 first: choose a tool')}
              </div>
            ) : sortedSelectedHostComponents.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-8 text-center text-sm text-slate-500">
                {tr('该工具下暂无已安装组件', 'No installed components under this tool')}
              </div>
            ) : (
              <AnimatePresence>
                {sortedSelectedHostComponents.map((item) => (
                  <motion.div
                    key={getInstalledItemKey(item)}
                    layout
                    exit={{ opacity: 0, x: -20 }}
                    data-item-key={getInstalledItemKey(item)}
                  >
                    <InstalledItemRow
                      item={item}
                      selected={selectedItemKey === getInstalledItemKey(item)}
                      onClick={() => setSelectedItem(item)}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>
        </div>
      }
      rightColumn={
        <div className="h-full flex flex-col">
          <div className="px-5 pt-4 pb-3 border-b border-slate-100">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{tr('第 3 步', 'Step 3')}</p>
            <h3 className="text-sm font-semibold text-slate-800">{tr('查看详情并处理', 'Review details and act')}</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {selectedItem
                ? tr(`当前组件：${selectedItem.name}`, `Current component: ${selectedItem.name}`)
                : selectedHost
                  ? tr('先在中栏选择组件，再在右侧执行修复、更新或卸载', 'Select a component in the middle, then fix, update, or uninstall here')
                  : tr('先完成第 1 步与第 2 步', 'Complete Step 1 and Step 2 first')}
            </p>
          </div>
          <div className="flex-1 min-h-0">
            {selectedItem ? (
              <InstalledItemDetail
                item={selectedItem}
                oneClickOpsUnlocked={oneClickOpsUnlocked}
                onUninstall={() => {
                  void handleUninstall(selectedItem.item_id, selectedItem.platform_id);
                }}
                onCheckUpdate={handleCheckUpdates}
                onApplyUpdate={() => {
                  if (!oneClickOpsUnlocked) {
                    void openManualPathForItem(selectedItem);
                    return;
                  }
                  void handleApplyUpdate();
                }}
                checkingUpdate={checkingUpdates}
                applyingUpdate={updatingItem}
                updateStatus={updateStatus}
                pendingUpdate={pendingUpdate}
                runtimeSessions={selectedRuntimeSessions}
                runtimeEvents={selectedRuntimeEvents}
                runtimePolicy={runtimePolicy}
                runtimeStatus={runtimeStatus}
                onTrustChange={(trustState) => handleTrustChange(selectedItem, trustState)}
                onNetworkPolicySave={(allowedDomains, networkMode) => handleNetworkPolicySave(selectedItem, allowedDomains, networkMode)}
                onGuardedLaunch={() => handleGuardedLaunch(selectedItem)}
                onTerminateSession={handleTerminateSession}
                onClearEvents={handleClearEvents}
                launchingGuardedItem={launchingGuardedItem}
                onBackToHost={() => setSelectedItem(null)}
              />
            ) : selectedHost ? (
              <HostOverviewDetail
                host={selectedHost}
                oneClickUnlocked={oneClickOpsUnlocked}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-slate-400">
                {tr('选择左侧工具查看详情', 'Select a tool on the left to view details')}
              </div>
            )}
          </div>
        </div>
      }
      bottomBar={
        <div className="space-y-2">
          {/* Cleanup preview for free users */}
          {cleanupPreviewData && !oneClickOpsUnlocked && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 max-h-40 overflow-y-auto">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-amber-800">
                  {tr('手动清理命令（复制到终端执行）', 'Manual cleanup commands (copy to terminal)')}
                </h4>
                <button
                  type="button"
                  onClick={() => setCleanupPreviewData(null)}
                  className="text-xs text-amber-600 hover:text-amber-800"
                >
                  {tr('收起', 'Close')}
                </button>
              </div>
              <div className="space-y-1.5">
                {cleanupPreviewData.components
                  .filter((comp) => !comp.auto_cleanup_supported)
                  .map((comp, idx) => (
                    <div key={`comp-${idx}`} className="flex items-start gap-2">
                      <code className="flex-1 text-xs bg-slate-900 text-green-400 rounded px-2 py-1 font-mono break-all">
                        {comp.command} {comp.args.join(' ')}
                      </code>
                      <button
                        type="button"
                        onClick={() => void navigator.clipboard.writeText(`${comp.command} ${comp.args.join(' ')}`)}
                        className="shrink-0 text-[10px] text-amber-700 hover:text-amber-900 px-1.5 py-0.5 rounded bg-amber-100"
                      >
                        {tr('复制', 'Copy')}
                      </button>
                    </div>
                  ))}
                {cleanupPreviewData.dependency_tasks.map((task, idx) => (
                  <div key={`dep-${idx}`} className="flex items-start gap-2">
                    <code className="flex-1 text-xs bg-slate-900 text-green-400 rounded px-2 py-1 font-mono break-all">
                      {task.command_preview}
                    </code>
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard.writeText(task.command_preview)}
                      className="shrink-0 text-[10px] text-amber-700 hover:text-amber-900 px-1.5 py-0.5 rounded bg-amber-100"
                    >
                      {tr('复制', 'Copy')}
                    </button>
                  </div>
                ))}
                {cleanupPreviewData.components.filter((c) => !c.auto_cleanup_supported).length === 0 &&
                  cleanupPreviewData.dependency_tasks.length === 0 && (
                  <p className="text-xs text-amber-700">
                    {tr('所有组件均支持自动清理（需要 Pro）', 'All components support auto-cleanup (requires Pro)')}
                  </p>
                )}
              </div>
            </div>
          )}
          <div className="flex items-center gap-3">
          {/* Status message */}
          <div className="flex-1 min-w-0">
            {updateStatus ? (
              <div className="flex items-center gap-2 text-sm text-green-600 truncate">
                <CheckCircle className="w-4 h-4 shrink-0" />
                <span className="truncate">{updateStatus}</span>
              </div>
            ) : runtimeStatus ? (
              <div className="text-xs text-slate-500 truncate">
                {tr(
                  `运行中 ${runtimeStatus.active_sessions} · 待确认 ${runtimeStatus.pending_approvals ?? 0} · 已拦截 ${runtimeStatus.blocked_actions}`,
                  `Running ${runtimeStatus.active_sessions} · Pending ${runtimeStatus.pending_approvals ?? 0} · Blocked ${runtimeStatus.blocked_actions}`,
                )}
              </div>
            ) : null}
          </div>

          {/* Action buttons */}
          {selectedHost && selectedHost.componentCount > 0 && !selectedItem && (
            <>
              <button
                onClick={async () => {
                  if (!oneClickOpsUnlocked) {
                    setUpdateStatus(t.upgradeToPro);
                    return;
                  }
                  if (!selectedHost) return;
                  setUpdateStatus(null);
                  const hostManagedIds = Array.from(
                    new Set(
                      items
                        .filter((item) => item.platform_id === selectedHost.id && item.managedByAgentShield)
                        .map((item) => item.item_id)
                    )
                  );
                  if (hostManagedIds.length === 0) {
                    setUpdateStatus(tr('该工具下没有可自动修复的已托管扩展。', 'No managed extensions under this tool can be auto-fixed.'));
                    return;
                  }
                  try {
                    const approval = await requestRuntimeGuardActionApproval({
                      component_id: 'agentshield:update:batch',
                      component_name: tr(`${selectedHost.name} 批量修复`, `${selectedHost.name} batch fix`),
                      platform_id: selectedHost.id,
                      platform_name: selectedHost.name,
                      request_kind: 'component_update',
                      trigger_event: 'host_batch_update_request',
                      action_kind: 'component_update',
                      action_source: 'user_requested_batch_update',
                      action_targets: hostManagedIds.map((itemId) => `managed:${itemId}`),
                      action_preview: [
                        tr(
                          `批量修复 ${selectedHost.name} 的 ${hostManagedIds.length} 个扩展`,
                          `Batch fix ${hostManagedIds.length} extensions in ${selectedHost.name}`,
                        ),
                        tr('将尝试升级可升级版本并同步真实配置', 'Will update available versions and sync real config files'),
                      ],
                      sensitive_capabilities: [tr('修改扩展配置', 'Modify extension config')],
                      is_destructive: false,
                      is_batch: true,
                    });
                    if (approval.status === 'approved' && approval.approval_ticket) {
                      setUpdateStatus(tr(`正在修复 ${selectedHost.name}...`, `Fixing ${selectedHost.name}...`));
                      const updatedCount = await invoke<number>('batch_update_items', {
                        itemIds: hostManagedIds,
                        approvalTicket: approval.approval_ticket,
                      });
                      await loadInstalledData();
                      setUpdateStatus(
                        updatedCount > 0
                          ? tr(`${selectedHost.name} 已完成 ${updatedCount} 项修复`, `${selectedHost.name}: ${updatedCount} fixes completed`)
                          : tr(`${selectedHost.name} 当前没有可修复项`, `${selectedHost.name}: no fixable items right now`)
                      );
                    } else {
                      setUpdateStatus(tr('请在弹出的对话框中确认操作。', 'Please approve the action in the popup dialog.'));
                    }
                  } catch (error) {
                    setUpdateStatus(getErrorMessage(error));
                  }
                }}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors shrink-0',
                  oneClickOpsUnlocked
                    ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                    : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                )}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                {tr('一键修复', 'Fix all')}
              </button>

              <button
                onClick={async () => {
                  if (!selectedHost) return;
                  setCheckingUpdates(true);
                  setUpdateStatus(null);
                  try {
                    const results = await invoke<UpdateAuditItem[]>('check_installed_updates');
                    const hostItems = items.filter((item) => item.platform_id === selectedHost.id);
                    const hostItemIds = new Set(hostItems.map((item) => item.item_id));
                    const hostUpdates = results.filter((r) => r.has_update && hostItemIds.has(r.item_id));
                    if (hostUpdates.length > 0) {
                      setUpdateStatus(
                        tr(
                          `${selectedHost.name} 发现 ${hostUpdates.length} 个可更新扩展`,
                          `${selectedHost.name}: ${hostUpdates.length} updates available`,
                        )
                      );
                    } else {
                      setUpdateStatus(tr(`${selectedHost.name} 的所有扩展已是最新版本`, `${selectedHost.name}: everything is up to date`));
                    }
                  } catch {
                    setUpdateStatus(tr('检查更新失败，请稍后再试。', 'Update check failed. Please try again later.'));
                  } finally {
                    setCheckingUpdates(false);
                  }
                }}
                disabled={checkingUpdates}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-blue-500 text-white hover:bg-blue-600 transition-colors shrink-0 disabled:opacity-50"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', checkingUpdates && 'animate-spin')} />
                {checkingUpdates ? t.checking : t.checkUpdate}
              </button>

              <button
                onClick={async () => {
                  if (!selectedHost) return;
                  await handleExecuteGlobalCleanup([selectedHost.id]);
                }}
                disabled={globalCleanupRunning}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors shrink-0 disabled:opacity-60',
                  oneClickOpsUnlocked
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : 'bg-red-100 text-red-700 hover:bg-red-200'
                )}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {globalCleanupRunning ? tr('清理中…', 'Cleaning…') : tr('一键卸载并清理', 'Uninstall and clean')}
              </button>
            </>
          )}

          {!selectedItem && meaningfulHostEntries.length > 0 && (
            <>
              <button
                onClick={() => {
                  void handlePreviewGlobalCleanup(null);
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {tr('预览全局清理', 'Preview global cleanup')}
              </button>
              <button
                onClick={() => {
                  void handleExecuteGlobalCleanup(null);
                }}
                disabled={globalCleanupRunning}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors shrink-0 disabled:opacity-60',
                  oneClickOpsUnlocked
                    ? 'bg-rose-500 text-white hover:bg-rose-600'
                    : 'bg-rose-100 text-rose-700 hover:bg-rose-200',
                )}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {globalCleanupRunning
                  ? tr('全局清理中…', 'Running global cleanup…')
                  : tr('一键全局卸载与清理', 'One-click global uninstall')}
              </button>
            </>
          )}

          <button
            onClick={handleSyncGuard}
            disabled={syncingGuard}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors shrink-0 disabled:opacity-50"
          >
            <Activity className={cn('w-3.5 h-3.5', syncingGuard && 'animate-pulse')} />
            {syncingGuard ? t.refreshing : tr('刷新状态', 'Refresh status')}
          </button>
        </div>
        </div>
      }
      />
    </>
  );
}

interface HostFilterItemProps {
  host: HostOverviewEntry;
  active: boolean;
  onClick: () => void;
}

function HostFilterItem({ host, active, onClick }: HostFilterItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors border',
        active
          ? 'bg-slate-100 text-slate-900 border-slate-200'
          : 'text-slate-600 border-transparent hover:bg-slate-50'
      )}
    >
      <span className="text-base shrink-0">{host.icon}</span>
      <span className="flex-1 text-left truncate min-w-0">{host.name}</span>
      <span className={cn(
        'text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0',
        hostCapabilityClassName(host.managementCapability)
      )}>
        {formatHostCapabilityShort(host.managementCapability)}
      </span>
    </button>
  );
}

interface PlatformFilterItemProps {
  platform: Platform | 'all';
  count: number;
  active: boolean;
  onClick: () => void;
}

function PlatformFilterItem({ platform, count, active, onClick }: PlatformFilterItemProps) {
  const config = platform === 'all'
    ? { name: t.all, icon: '📦' }
    : getPlatformVisual(platform);

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
        active ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'
      )}
    >
      <span className="text-base">{config.icon}</span>
      <span className="flex-1 text-left">{config.name}</span>
      <span className={cn(
        'text-xs px-2 py-0.5 rounded-full',
        active ? 'bg-slate-200' : 'bg-slate-100'
      )}>
        {count}
      </span>
    </button>
  );
}

interface HostOverviewRowProps {
  host: HostOverviewEntry;
  selected: boolean;
  onClick: () => void;
}

function HostOverviewRow({ host, selected, onClick }: HostOverviewRowProps) {
  const hasHighRisk = host.riskSurface.has_secret_signal || host.riskSurface.has_exec_signal;
  const hasAnyRisk = hasHighRisk || host.riskSurface.has_mcp || host.riskSurface.has_skill;

  const riskLabel = hasHighRisk
    ? tr('有风险', 'Risk')
    : hasAnyRisk
      ? tr('需关注', 'Needs attention')
      : tr('安全', 'Safe');
  const riskDotColor = hasHighRisk ? 'bg-red-500' : hasAnyRisk ? 'bg-amber-500' : 'bg-green-500';
  const riskTextColor = hasHighRisk ? 'text-red-600' : hasAnyRisk ? 'text-amber-600' : 'text-green-600';

  return (
    <motion.button
      onClick={onClick}
      whileHover={{ x: 2 }}
      className={cn(
        'w-full text-left p-4 rounded-xl border transition-all',
        selected
          ? 'bg-white border-slate-200 shadow-sm'
          : 'bg-slate-50/50 border-transparent hover:bg-white hover:border-slate-200'
      )}
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: `${host.color}15` }}>
          <span className="text-xl">{host.icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-900 truncate">{host.name}</span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
            <span className="shrink-0">{tr(`${host.componentCount} 个扩展`, `${host.componentCount} extensions`)}</span>
            <span className={cn('inline-flex items-center gap-1 shrink-0', riskTextColor)}>
              <span className={cn('w-1.5 h-1.5 rounded-full', riskDotColor)} />
              {riskLabel}
            </span>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
      </div>
    </motion.button>
  );
}

interface InstalledItemRowProps {
  item: GuardedInstalledMcp;
  selected: boolean;
  onClick: () => void;
}

function InstalledItemRow({ item, selected, onClick }: InstalledItemRowProps) {
  const platformConfig = getPlatformVisual(item.platform_id);
  const trustLabel = formatRuntimeTrustState(item.runtimeTrustState);

  return (
    <motion.button
      onClick={onClick}
      whileHover={{ x: 2 }}
      className={cn(
        'w-full text-left px-3 py-2 rounded-lg border transition-all',
        selected
          ? 'bg-white border-slate-200 shadow-sm'
          : 'bg-slate-50/50 border-transparent hover:bg-white hover:border-slate-200'
      )}
    >
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
          <span className="text-base">{platformConfig.icon}</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-slate-900 truncate">{item.name}</span>
            <span className="text-[11px] text-slate-400 shrink-0">v{item.version}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <SafetyBadge level={item.safety_level} size="small" showIcon={false} />
            {trustLabel ? <span className="text-[11px] text-slate-500">{trustLabel}</span> : null}
          </div>
        </div>

        <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      </div>
    </motion.button>
  );
}

interface HostOverviewDetailProps {
  host: HostOverviewEntry;
  oneClickUnlocked: boolean;
}

function HostOverviewDetail({
  host,
  oneClickUnlocked,
}: HostOverviewDetailProps) {
  const [manualFixSteps, setManualFixSteps] = useState<ManualFixStep[]>([]);
  const [manualFixLoading, setManualFixLoading] = useState(false);
  const [showManualFix, setShowManualFix] = useState(false);

  const handleShowManualFix = useCallback(async () => {
    if (showManualFix) {
      setShowManualFix(false);
      return;
    }
    setManualFixLoading(true);
    setShowManualFix(true);
    try {
      const issueTypes: string[] = [];
      if (host.riskSurface.has_secret_signal) issueTypes.push('exposed_key');
      if (host.riskSurface.has_exec_signal) issueTypes.push('permission');
      if (host.riskSurface.has_mcp) issueTypes.push('remove_mcp');
      if (host.riskSurface.has_skill) issueTypes.push('remove_skill');
      if (issueTypes.length === 0) issueTypes.push('permission');

      const targetPath = host.evidenceItems[0]?.path ?? '';
      const allSteps: ManualFixStep[] = [];
      for (const issueType of issueTypes) {
        const steps = await getManualFixGuide(issueType, targetPath);
        allSteps.push(...steps);
      }
      setManualFixSteps(allSteps);
    } catch {
      setManualFixSteps([]);
    } finally {
      setManualFixLoading(false);
    }
  }, [host, showManualFix]);
  const riskItems: Array<{ icon: string; label: string; level: 'danger' | 'warn' | 'info' }> = [];
  if (host.riskSurface.has_secret_signal) {
    riskItems.push({ icon: '🔑', label: tr('可能接触你的密码和密钥', 'May access your passwords and keys'), level: 'danger' });
  }
  if (host.riskSurface.has_exec_signal) {
    riskItems.push({ icon: '⚙️', label: tr('可以自动运行程序', 'Can run programs automatically'), level: 'danger' });
  }
  if (host.riskSurface.has_mcp) {
    riskItems.push({ icon: '🔌', label: tr(`安装了 ${host.mcpCount} 个插件`, `${host.mcpCount} plugins configured`), level: 'warn' });
  }
  if (host.riskSurface.has_skill) {
    riskItems.push({ icon: '📜', label: tr(`安装了 ${host.skillCount} 个脚本`, `${host.skillCount} scripts installed`), level: 'warn' });
  }

  const overallRisk = riskItems.some((r) => r.level === 'danger')
    ? 'danger'
    : riskItems.length > 0
      ? 'warn'
      : 'safe';

  const riskConfig = {
    danger: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', label: tr('有安全风险', 'Security risk detected'), dot: 'bg-red-500' },
    warn: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', label: tr('需要关注', 'Needs attention'), dot: 'bg-amber-500' },
    safe: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', label: tr('暂时安全', 'Looks safe for now'), dot: 'bg-green-500' },
  }[overallRisk];

  return (
    <div className="p-5 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 mb-4">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm"
          style={{ backgroundColor: `${host.color}15`, border: `1px solid ${host.color}30` }}
        >
          <span className="text-2xl">{host.icon}</span>
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-slate-900">{host.name}</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full', riskConfig.bg, riskConfig.text)}>
              <span className={cn('w-1.5 h-1.5 rounded-full', riskConfig.dot)} />
              {riskConfig.label}
            </span>
            <span className="text-xs text-slate-400">
              {host.hostDetected ? tr('运行中', 'Running') : tr('已发现', 'Detected')}
            </span>
          </div>
        </div>
      </div>

      {/* Risk details */}
      <div className={cn('rounded-xl p-3 mb-4', riskConfig.bg, 'border', riskConfig.border)}>
        {riskItems.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-green-700">
            <span>✅</span>
            <span>{tr('暂未发现风险，请继续保持关注。', 'No current risk found. Keep an eye on it.')}</span>
          </div>
        ) : (
          <div className="space-y-2">
            {riskItems.map((risk) => (
              <div key={risk.label} className="flex items-center gap-2.5">
                <span className="text-base">{risk.icon}</span>
                <span className={cn(
                  'text-sm',
                  risk.level === 'danger' ? 'text-red-700 font-medium' : 'text-amber-700'
                )}>
                  {risk.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 text-center">
          <div className="text-2xl font-bold text-slate-900">{host.componentCount}</div>
          <div className="text-xs text-slate-500 mt-0.5">{tr('扩展数量', 'Extensions')}</div>
        </div>
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 text-center">
          <div className="text-2xl font-bold text-slate-900">{host.riskSurface.evidence_count || host.evidenceItems.length}</div>
          <div className="text-xs text-slate-500 mt-0.5">{tr('发现项', 'Findings')}</div>
        </div>
      </div>

      {/* Capability hint */}
      <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5 mb-4">
        <div className="flex items-center gap-2">
          <span className={cn(
            'text-xs px-2 py-0.5 rounded-full border font-medium',
            hostCapabilityClassName(host.managementCapability)
          )}>
            {formatHostCapability(host.managementCapability)}
          </span>
          <span className="text-xs text-slate-500">
            {host.managementCapability === 'one_click'
              ? (oneClickUnlocked ? tr('支持一键操作', 'One-click actions available') : tr('支持一键操作（需升级）', 'One-click actions need upgrade'))
              : host.managementCapability === 'manual'
                ? tr('需要手动操作', 'Manual actions only')
                : tr('仅可查看', 'View only')}
          </span>
        </div>
      </div>

      {host.evidenceItems.length > 0 && (
        <div className="mb-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
          <h3 className="mb-2 text-xs font-medium text-slate-500">{tr('发现依据', 'Evidence')}</h3>
          <div className="space-y-1.5">
            {host.evidenceItems.map((item, index) => (
              <div
                key={`${item.evidence_type}:${item.path}:${index}`}
                className="flex min-w-0 flex-nowrap items-center gap-2 text-xs text-slate-600"
              >
                <span className="shrink-0 whitespace-nowrap rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500">
                  {formatEvidenceType(item.evidence_type)}
                </span>
                <span className="min-w-0 flex-1 truncate whitespace-nowrap">
                  {item.evidence_type === 'detection_source'
                    ? formatDetectionSourceValue(item.path)
                    : item.path}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Manual fix guide for free users */}
      {hasRiskSurface(host) && !oneClickUnlocked && (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => void handleShowManualFix()}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium transition-colors bg-amber-100 text-amber-800 hover:bg-amber-200"
          >
            <Wrench className="w-4 h-4" />
            {showManualFix
              ? tr('收起手动修复步骤', 'Hide manual fix steps')
              : tr('查看手动修复步骤（免费）', 'View manual fix steps (free)')}
          </button>
          {showManualFix && (
            <div className="mt-3">
              <ManualFixGuide
                steps={manualFixSteps}
                loading={manualFixLoading}
                onDismiss={() => setShowManualFix(false)}
                onMarkFixed={() => setShowManualFix(false)}
              />
            </div>
          )}
        </div>
      )}

      {/* Also show for Pro users but as a secondary option */}
      {hasRiskSurface(host) && oneClickUnlocked && (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => void handleShowManualFix()}
            className="text-xs text-slate-500 hover:text-slate-700 underline"
          >
            {showManualFix
              ? tr('收起手动修复步骤', 'Hide manual fix steps')
              : tr('也可以查看手动修复步骤', 'You can also view manual fix steps')}
          </button>
          {showManualFix && (
            <div className="mt-3">
              <ManualFixGuide
                steps={manualFixSteps}
                loading={manualFixLoading}
                onDismiss={() => setShowManualFix(false)}
              />
            </div>
          )}
        </div>
      )}

      <div className="mt-auto rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3">
        <p className="text-xs text-slate-500">
          {tr(
            '下一步：请在中栏（第 2 步）选择具体组件，再在右侧进行更新、卸载与信任策略管理。',
            'Next: choose a component in the middle column (Step 2), then manage update, uninstall, and trust policy here.',
          )}
        </p>
      </div>
    </div>
  );
}

interface InstalledItemDetailProps {
  item: GuardedInstalledMcp;
  oneClickOpsUnlocked: boolean;
  onBackToHost: () => void;
  onUninstall: () => void;
  onCheckUpdate: () => void;
  onApplyUpdate: () => void;
  checkingUpdate: boolean;
  applyingUpdate: boolean;
  updateStatus: string | null;
  pendingUpdate: UpdateAuditItem | null;
  runtimeSessions: RuntimeGuardSession[];
  runtimeEvents: RuntimeGuardEvent[];
  runtimePolicy: RuntimeGuardPolicy | null;
  runtimeStatus: RuntimeGuardStatus | null;
  onTrustChange: (trustState: string) => void;
  onNetworkPolicySave: (allowedDomains: string[], networkMode?: string) => void;
  onGuardedLaunch: () => void;
  onTerminateSession: (sessionId: string) => void;
  onClearEvents: () => void;
  launchingGuardedItem: boolean;
}

function InstalledItemDetail({
  item,
  oneClickOpsUnlocked,
  onBackToHost,
  onUninstall,
  onCheckUpdate,
  onApplyUpdate,
  checkingUpdate,
  applyingUpdate,
  updateStatus,
  pendingUpdate,
  runtimeSessions,
  runtimeEvents,
  runtimePolicy,
  runtimeStatus,
  onTrustChange,
  onNetworkPolicySave,
  onGuardedLaunch,
  onTerminateSession,
  onClearEvents,
  launchingGuardedItem,
}: InstalledItemDetailProps) {
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [allowedDomainsInput, setAllowedDomainsInput] = useState('');
  const [itemManualFixSteps, setItemManualFixSteps] = useState<ManualFixStep[]>([]);
  const [itemManualFixLoading, setItemManualFixLoading] = useState(false);
  const [showItemManualFix, setShowItemManualFix] = useState(false);

  const handleItemManualFix = useCallback(async () => {
    if (showItemManualFix) {
      setShowItemManualFix(false);
      return;
    }
    setItemManualFixLoading(true);
    setShowItemManualFix(true);
    try {
      const issueType = item.componentType === 'skill' ? 'remove_skill' : 'remove_mcp';
      const targetPath = item.sourceUrl ?? '';
      const steps = await getManualFixGuide(issueType, targetPath, item.name);
      setItemManualFixSteps(steps);
    } catch {
      setItemManualFixSteps([]);
    } finally {
      setItemManualFixLoading(false);
    }
  }, [item, showItemManualFix]);
  const platformConfig = getPlatformVisual(item.platform_id);
  const isRemoteSource = Boolean(item.sourceUrl && /^https?:\/\//.test(item.sourceUrl));
  const guardedLaunchBlocked = ['unknown', 'blocked', 'quarantined'].includes(item.runtimeTrustState || '');
  const updateSummary = pendingUpdate
    ? pendingUpdate.tracked
      ? pendingUpdate.has_update
        ? tr(`已发现新版本 ${pendingUpdate.new_version}`, `New version available: ${pendingUpdate.new_version}`)
        : tr('当前已是最新版本', 'Already up to date')
      : localizedDynamicText(
          pendingUpdate.reason,
          tr('Auto-update is unavailable for this extension. Review source details and handle manually.', 'Auto-update is unavailable for this extension. Review source details and handle manually.'),
        )
    : updateStatus;

  const handleUninstall = () => {
    // Free users: show manual fix guide with uninstall steps
    if (!oneClickOpsUnlocked) {
      if (!showItemManualFix) {
        void handleItemManualFix();
      }
      return;
    }

    if (!confirmUninstall) {
      setConfirmUninstall(true);
      setTimeout(() => setConfirmUninstall(false), 3000);
      return;
    }
    onUninstall();
    setConfirmUninstall(false);
  };

  useEffect(() => {
    setAllowedDomainsInput(item.runtimeAllowedDomains?.join(', ') || '');
  }, [item.runtimeAllowedDomains, item.runtimeComponentId]);

  return (
    <div className="p-6">
      <button
        onClick={onBackToHost}
        className="mb-4 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
      >
        <ChevronRight className="w-3.5 h-3.5 rotate-180" />
        {tr('返回工具概览', 'Back to tool overview')}
      </button>
      <div className="flex items-start gap-4 mb-6">
        <div className="w-14 h-14 rounded-xl bg-slate-100 flex items-center justify-center">
          <span className="text-2xl">{platformConfig.icon}</span>
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-slate-900">{item.name}</h2>
          <p className="text-sm text-slate-500">v{item.version}</p>
        </div>
      </div>

      {item.description && (
        <p className="text-sm text-slate-600 mb-6">{item.description}</p>
      )}

      <div className="sticky top-0 z-20 -mx-6 mb-6 border-y border-slate-200 bg-white/95 px-6 py-3 backdrop-blur">
        <p className="text-[11px] uppercase tracking-wide text-slate-400">{tr('主要操作', 'Primary actions')}</p>
        <div className={cn('mt-2 grid gap-2', pendingUpdate?.has_update ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1 md:grid-cols-2')}>
          <button
            onClick={onCheckUpdate}
            disabled={checkingUpdate}
            className={cn(
              'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium transition-colors',
              checkingUpdate
                ? 'bg-slate-50 text-slate-400'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            )}
          >
            <RefreshCw className={cn('w-4 h-4', checkingUpdate && 'animate-spin')} />
            {checkingUpdate ? t.checking : t.checkUpdate}
          </button>

          {pendingUpdate?.has_update ? (
            <button
              onClick={onApplyUpdate}
              disabled={applyingUpdate}
              className={cn(
                'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium transition-colors',
                applyingUpdate
                  ? 'bg-emerald-50 text-emerald-300'
                  : 'bg-emerald-500 text-white hover:bg-emerald-600'
              )}
            >
              <RefreshCw className={cn('w-4 h-4', applyingUpdate && 'animate-spin')} />
              {applyingUpdate
                ? tr('升级中…', 'Updating…')
                : oneClickOpsUnlocked
                  ? tr(`升级到 ${pendingUpdate.new_version}`, `Update to ${pendingUpdate.new_version}`)
                  : tr('前往官方来源手动更新', 'Open official source for manual update')}
            </button>
          ) : null}

          <button
            onClick={handleUninstall}
            className={cn(
              'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium transition-colors',
              confirmUninstall
                ? 'bg-red-500 text-white'
                : 'bg-red-50 text-red-600 hover:bg-red-100'
            )}
          >
            <Trash2 className="w-4 h-4" />
            {confirmUninstall
              ? t.confirmUninstallAgain
              : oneClickOpsUnlocked
                ? t.uninstall
                : showItemManualFix
                  ? tr('收起卸载步骤', 'Hide uninstall steps')
                  : tr('查看卸载步骤（免费）', 'View uninstall steps (free)')}
          </button>
        </div>
        {updateStatus && (
          <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {updateStatus}
          </div>
        )}
      </div>

      <div className="space-y-4">
        {item.runtimeRiskSummary && (
          <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {localizedDynamicText(
              item.runtimeRiskSummary,
              tr(
                '检测到该扩展存在安全风险，请先审查再继续。',
                'A security risk was detected for this extension. Review it before continuing.',
              ),
            )}
          </div>
        )}

        {(item.runtimeTrustState === 'unknown' || item.runtimeRequiresExplicitApproval) && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {tr(
              '还没得到你的许可：它尝试联网、读写文件或运行程序时，会先暂停并询问你。',
              'Not approved yet: when it tries to go online, read/write files, or run programs, it will pause and ask first.',
            )}
          </div>
        )}

        {item.runtimeComponentId && (
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <h3 className="text-sm font-medium text-slate-700">{tr('一步处理（推荐）', 'Quick actions (recommended)')}</h3>
            <p className="mt-1 text-xs text-slate-500">
              {tr('零基础用户只需要点下面按钮。高级配置可在下方"高级设置"里查看。', 'For most users, just use the buttons below. Advanced settings are under "Advanced settings".')}
            </p>

            <div className="mt-3 space-y-3">
              <div>
                <h4 className="text-xs font-medium text-slate-500 mb-1">{tr('安全操作', 'Safety actions')}</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    onClick={() => onTrustChange('trusted')}
                    className={cn(
                      'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                      item.runtimeTrustState === 'trusted'
                        ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                        : 'bg-slate-50 text-slate-700 hover:bg-slate-100',
                    )}
                  >
                    <ShieldCheck className="w-4 h-4" />
                    {tr('允许正常运行', 'Allow normal run')}
                  </button>
                  <button
                    onClick={() => onTrustChange('restricted')}
                    className={cn(
                      'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                      item.runtimeTrustState === 'restricted'
                        ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                        : 'bg-slate-50 text-slate-700 hover:bg-slate-100',
                    )}
                  >
                    <ShieldAlert className="w-4 h-4" />
                    {tr('允许但监控', 'Allow with monitoring')}
                  </button>
                  <button
                    onClick={() => onTrustChange('blocked')}
                    className={cn(
                      'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                      item.runtimeTrustState === 'blocked'
                        ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
                        : 'bg-slate-50 text-slate-700 hover:bg-slate-100',
                    )}
                  >
                    <ShieldBan className="w-4 h-4" />
                    {tr('继续拦住', 'Keep blocked')}
                  </button>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-medium text-slate-500 mb-1">{tr('网络策略', 'Network policy')}</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    onClick={() => onNetworkPolicySave([], 'observe_only')}
                    className={cn(
                      'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors',
                      item.runtimeNetworkMode !== 'blocked'
                        ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                        : 'bg-slate-50 text-slate-700 hover:bg-slate-100',
                    )}
                  >
                    {tr('允许联网', 'Allow network')}
                  </button>
                  <button
                    onClick={() => onNetworkPolicySave([], 'blocked')}
                    className={cn(
                      'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors',
                      item.runtimeNetworkMode === 'blocked'
                        ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
                        : 'bg-slate-50 text-slate-700 hover:bg-slate-100',
                    )}
                  >
                    <ShieldBan className="w-3.5 h-3.5" />
                    {tr('禁止联网（沙箱）', 'Block network (sandbox)')}
                  </button>
                </div>
                {item.runtimeNetworkMode === 'blocked' && (
                  <p className="mt-2 text-xs text-rose-600">
                    {tr(
                      '下次受控启动时，会使用沙箱阻断网络访问。',
                      'On next supervised launch, the sandbox will block network access.',
                    )}
                  </p>
                )}
              </div>

              <button
                onClick={onGuardedLaunch}
                disabled={launchingGuardedItem || guardedLaunchBlocked}
                className={cn(
                  'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium transition-colors',
                  launchingGuardedItem || guardedLaunchBlocked
                    ? 'bg-slate-50 text-slate-400'
                    : 'bg-sky-50 text-sky-700 hover:bg-sky-100'
                )}
              >
                <Play className="w-4 h-4" />
                {launchingGuardedItem
                  ? tr('受控启动中…', 'Starting with protection…')
                  : guardedLaunchBlocked
                    ? tr('先允许再启动', 'Approve first, then start')
                    : tr('受控启动', 'Start with protection')}
              </button>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <h3 className="text-sm font-medium text-slate-700">{tr('基础信息', 'At a glance')}</h3>
          <div className="mt-2 space-y-1">
            <DetailRow label={t.platform} value={platformConfig.name} />
            <DetailRow label={t.securityScan}>
              <SafetyBadge level={item.safety_level} />
            </DetailRow>
            <DetailRow label={t.version} value={item.version} />
            <DetailRow label={t.installDate} value={item.installDate} />
            {updateSummary && <DetailRow label={tr('版本信息', 'Version status')} value={updateSummary} />}
          </div>
        </div>

        {item.runtimeComponentId && (
          <details className="group rounded-xl border border-slate-200 bg-white p-3">
            <summary className="cursor-pointer list-none text-sm font-medium text-slate-700">
              <span className="inline-flex items-center gap-2">
                {tr('高级设置（联网地址白名单）', 'Advanced settings (network allowlist)')}
                <span className="text-xs text-slate-400 group-open:hidden">{tr('点击展开', 'Click to expand')}</span>
              </span>
            </summary>
            <div className="mt-3 border-t border-slate-100 pt-3">
              <h4 className="text-xs font-medium text-slate-500 mb-1">{tr('允许联网的地址', 'Allowed network domains')}</h4>
              <div className="flex gap-2">
                <input
                  value={allowedDomainsInput}
                  onChange={(event) => setAllowedDomainsInput(event.target.value)}
                  placeholder={tr('例如 api.example.com, *.openai.com', 'Example: api.example.com, *.openai.com')}
                  className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-300"
                />
                <button
                  onClick={() => onNetworkPolicySave(
                    allowedDomainsInput
                      .split(',')
                      .map((domain) => domain.trim())
                      .filter(Boolean)
                  )}
                  className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
                >
                  {t.save}
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {tr(
                  '连接新地址时，AgentShield 会先拦截并询问是否放行。',
                  'When it tries a new domain, AgentShield blocks first and asks for approval.',
                )}
              </p>
            </div>
          </details>
        )}

        <details className="group rounded-xl border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer list-none text-sm font-medium text-slate-700">
            <span className="inline-flex items-center gap-2">
              {tr('技术详情（运行状态 / 事件 / 来源）', 'Technical details (runtime / events / source)')}
              <span className="text-xs text-slate-400 group-open:hidden">{tr('点击展开', 'Click to expand')}</span>
            </span>
          </summary>
          <div className="mt-3 border-t border-slate-100 pt-3 space-y-4">
            <DetailRow
              label={tr('安装来源', 'Install source')}
              value={item.managedByAgentShield ? tr('由 AgentShield 安装', 'Installed by AgentShield') : tr('其他方式安装', 'Installed outside AgentShield')}
            />
            {item.runtimeTrustState && (
              <DetailRow label={tr('当前状态', 'Current status')} value={formatRuntimeTrustState(item.runtimeTrustState)} />
            )}
            {item.runtimeSourceKind && (
              <DetailRow label={tr('来源等级', 'Source level')} value={formatRuntimeSourceKind(item.runtimeSourceKind)} />
            )}
            {item.runtimeNetworkMode && (
              <DetailRow label={tr('联网权限', 'Network access')} value={formatRuntimeNetworkMode(item.runtimeNetworkMode)} />
            )}
            {item.runtimeSensitiveCapabilities && item.runtimeSensitiveCapabilities.length > 0 && (
              <DetailRow
                label={tr('敏感能力', 'Sensitive capabilities')}
                value={item.runtimeSensitiveCapabilities.map((capability) => formatSensitiveCapability(capability)).join(' / ')}
              />
            )}
            {runtimeStatus && (
              <DetailRow label={tr('后台监控', 'Background monitor')} value={runtimeStatus.polling ? tr('运行中', 'Running') : tr('未运行', 'Stopped')} />
            )}
            {runtimePolicy && (
              <DetailRow
                label={tr('默认安全策略', 'Default safety policy')}
                value={tr(
                  `陌生组件=${formatRuntimeTrustStateShort(runtimePolicy.unknown_default_trust)} / 已允许组件=${formatRuntimeNetworkMode(runtimePolicy.restricted_network_mode)}`,
                  `Unknown components=${formatRuntimeTrustStateShort(runtimePolicy.unknown_default_trust)} / Approved components=${formatRuntimeNetworkMode(runtimePolicy.restricted_network_mode)}`,
                )}
              />
            )}

            {item.runtimeComponentId && (
              <div>
                <h3 className="text-sm font-medium text-slate-500 mb-2">{tr('当前正在运行', 'Active sessions')}</h3>
                {runtimeSessions.length === 0 ? (
                  <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-500">
                    {tr('当前未检测到活动会话', 'No active session detected')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {runtimeSessions.map((session) => (
                      <div key={session.session_id} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                              <Activity className="w-4 h-4 text-slate-500" />
                              PID {session.pid}
                              <span className="text-slate-400">{session.status}</span>
                            </div>
                            <div className="mt-1 text-xs text-slate-500 break-all">
                              {session.commandline || session.exe_path || tr('无命令行信息', 'No command line details')}
                            </div>
                            {session.network_connections.length > 0 && (
                              <div className="mt-2 text-xs text-slate-600">
                                {tr('网络', 'Network')}: {session.network_connections.map((connection) => connection.remote_address || connection.local_address).join(' | ')}
                              </div>
                            )}
                          </div>
                          {session.status === 'running' && (
                            <button
                              onClick={() => onTerminateSession(session.session_id)}
                              className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-100"
                            >
                              {tr('终止', 'Stop')}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {item.runtimeComponentId && (
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium text-slate-500">{tr('最近被拦下或提醒的事', 'Recent blocked or flagged events')}</h3>
                  {runtimeEvents.length > 0 ? (
                    <button
                      onClick={onClearEvents}
                      className="text-xs text-slate-500 hover:text-slate-700"
                    >
                      {tr('清空事件', 'Clear events')}
                    </button>
                  ) : null}
                </div>
                {runtimeEvents.length === 0 ? (
                  <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-500">
                    {tr('当前没有与该组件相关的守卫事件', 'No guard events for this component right now')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {runtimeEvents.map((event) => (
                      <div key={event.id} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium text-slate-900">
                            {localizedDynamicText(event.title, tr('Security event detected', 'Security event detected'))}
                          </div>
                          <div className={cn(
                            'rounded-full px-2 py-0.5 text-[11px]',
                            event.severity === 'critical'
                              ? 'bg-rose-50 text-rose-700'
                              : 'bg-amber-50 text-amber-700'
                          )}>
                            {event.severity === 'critical' ? tr('马上处理', 'Action needed now') : tr('提醒', 'Heads-up')}
                          </div>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {localizedDynamicText(
                            event.description,
                            tr('A guarded operation was blocked or flagged.', 'A guarded operation was blocked or flagged.'),
                          )}
                        </div>
                        <div className="mt-2 text-[11px] text-slate-400">
                          {new Date(event.timestamp).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {item.sourceUrl && (
              <div>
                <h3 className="text-sm font-medium text-slate-500 mb-2">
                  {isRemoteSource ? t.sourceUrl : t.fileLocation}
                </h3>
                <button
                  onClick={() => {
                    if (isRemoteSource) {
                      void openExternalUrl(item.sourceUrl!);
                      return;
                    }
                    void invoke('reveal_path_in_finder', { path: item.sourceUrl });
                  }}
                  className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
                >
                  {item.sourceUrl}
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </details>
      </div>

      {/* Manual fix guide for individual item */}
      {!oneClickOpsUnlocked && (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => void handleItemManualFix()}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium transition-colors bg-amber-100 text-amber-800 hover:bg-amber-200"
          >
            <Wrench className="w-4 h-4" />
            {showItemManualFix
              ? tr('收起手动处理步骤', 'Hide manual steps')
              : tr('查看手动处理步骤（免费）', 'View manual steps (free)')}
          </button>
          {showItemManualFix && (
            <div className="mt-3">
              <ManualFixGuide
                steps={itemManualFixSteps}
                loading={itemManualFixLoading}
                onDismiss={() => setShowItemManualFix(false)}
                onMarkFixed={() => setShowItemManualFix(false)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface DetailRowProps {
  label: string;
  value?: string;
  children?: React.ReactNode;
}

function DetailRow({ label, value, children }: DetailRowProps) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100">
      <span className="text-sm text-slate-500">{label}</span>
      {children || <span className="text-sm text-slate-900">{value}</span>}
    </div>
  );
}

function inferVersionFromArgs(command: string, args: string[]): string | null {
  const commandName = command.toLowerCase();
  if (!commandName.endsWith('npx') && !commandName.endsWith('npx.cmd')) {
    return null;
  }

  const packageSpec = args.find((arg) => !arg.startsWith('-'));
  if (!packageSpec) {
    return null;
  }

  if (packageSpec.startsWith('@')) {
    const tail = packageSpec.slice(1);
    const versionIndex = tail.lastIndexOf('@');
    return versionIndex >= 0 ? tail.slice(versionIndex + 1) : null;
  }

  const parts = packageSpec.split('@');
  return parts.length > 1 ? parts[parts.length - 1] : null;
}

function getErrorMessage(error: unknown) {
  const fallback = tr('操作失败，请检查提示后重试。', 'Action failed. Review the message and try again.');
  if (error instanceof Error) {
    return localizedDynamicText(error.message, fallback);
  }
  return localizedDynamicText(String(error), fallback);
}

function getInstalledItemKey(item: InstalledMCP) {
  return `${item.platform_id}:${item.item_id}:${item.sourceUrl || ''}`;
}

function formatRuntimeTrustState(value?: string) {
  switch (value) {
    case 'trusted':
      return tr('已允许运行', 'Allowed');
    case 'restricted':
      return tr('允许但持续监控', 'Allowed with monitoring');
    case 'blocked':
      return tr('已拦截', 'Blocked');
    case 'quarantined':
      return tr('已隔离', 'Quarantined');
    case 'unknown':
      return tr('等待你确认', 'Waiting for your approval');
    default:
      return '';
  }
}

function formatRuntimeTrustStateShort(value?: string) {
  switch (value) {
    case 'trusted':
      return tr('已允许', 'Allowed');
    case 'restricted':
      return tr('监控中', 'Monitoring');
    case 'blocked':
      return tr('已拦截', 'Blocked');
    case 'quarantined':
      return tr('已隔离', 'Quarantined');
    case 'unknown':
      return tr('待确认', 'Pending');
    default:
      return value || '';
  }
}

function formatRuntimeSourceKind(value?: string) {
  switch (value) {
    case 'managed_reviewed':
      return tr('官方商店认证', 'Store verified');
    case 'managed_install':
      return tr('AgentShield 安装', 'Installed by AgentShield');
    case 'manual_skill':
      return tr('手动添加的脚本', 'Manually added script');
    case 'manual_config':
      return tr('手动添加的插件', 'Manually added plugin');
    default:
      return value || '';
  }
}

function formatRuntimeNetworkMode(value?: string) {
  switch (value) {
    case 'inherit':
      return tr('正常联网', 'Normal internet access');
    case 'allowlist':
      return tr('仅允许指定地址', 'Only allowed domains');
    case 'observe_only':
      return tr('联网时提醒你', 'Ask before new network access');
    case 'blocked':
      return tr('禁止联网（沙箱隔离）', 'Network blocked (sandboxed)');
    default:
      return value || '';
  }
}
