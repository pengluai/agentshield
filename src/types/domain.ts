// TypeScript interfaces for AgentShield

export type SafetyLevel = 'safe' | 'caution' | 'dangerous' | 'blocked' | 'unverified';

export type ScanStatus = 'idle' | 'scanning' | 'completed' | 'failed';

// Dynamic platform type - supports known platforms and any discovered ones
export type Platform = string;

export type Severity = 'critical' | 'warning' | 'info';

export type NotificationType = 'security' | 'system' | 'update';

export type NotificationPriority = 'critical' | 'warning' | 'info';

export interface ScanReport {
  id: string;
  score: number;
  issues: SecurityIssue[];
  passed: string[];
  platform_reports: PlatformReport[];
  timestamp: string;
}

export interface PlatformReport {
  platform: Platform;
  mcpCount: number;
  issueCount: number;
  status: 'scanned' | 'pending' | 'failed';
}

export interface SecurityIssue {
  id: string;
  severity: Severity;
  title: string;
  description: string;
  platform: Platform;
  hostName?: string;
  componentType?: 'skill' | 'mcp' | 'config' | 'system' | 'unknown';
  componentName?: string;
  ownershipLabel?: string;
  fixable: boolean;
  affectedScope?: string;
  filePath?: string;
  semanticReview?: {
    verdict: string;
    confidence: number;
    summary: string;
    recommendedAction: string;
  };
}

export interface InstalledMCP {
  item_id: string;
  name: string;
  platform_id: Platform;
  safety_level: SafetyLevel;
  permissions: string[];
  version: string;
  installDate: string;
  sourceUrl?: string;
  description?: string;
  icon?: string;
  managedByAgentShield?: boolean;
  updateTrackable?: boolean;
  updateReason?: string;
}

export interface VaultKey {
  id: string;
  name: string;
  service: string;
  masked_value: string;
  isPlaintext?: boolean;
  platform?: Platform;
}

export interface StoreCatalogItem {
  id: string;
  name: string;
  description: string;
  safety_level: SafetyLevel;
  compatible_platforms: Platform[];
  rating: number;
  install_count: number;
  icon?: string;
  featured?: boolean;
  item_type?: string;
  category?: string;
  source_url?: string;
  installable?: boolean;
  install_strategy?: string;
  install_identifier?: string;
  install_version?: string;
  registry_name?: string;
  requires_auth?: boolean;
  auth_headers?: string[];
  openclaw_ready?: boolean;
  review_status?: string;
  review_notes?: string;
}

export interface Notification {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  body: string;
  timestamp: string;
  read: boolean;
  actionUrl?: string;
}

export interface ScanCardState {
  id: string;
  name: string;
  status: 'waiting' | 'scanning' | 'completed';
  progress?: number;
  result?: {
    issueCount: number;
    canFix: boolean;
    message?: string;
    headline?: string;
    detail?: string;
    actionLabel?: string;
  };
  gradient: {
    from: string;
    to: string;
  };
}

export interface WizardStep {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'completed';
}

export interface Channel {
  id: string;
  name: string;
  icon: string;
  connected?: boolean;
}

// Navigation types
export type ModuleId =
  | 'smartGuard'
  | 'securityScan'
  | 'openClaw'
  | 'skillStore'
  | 'installed'
  | 'keyVault'
  | 'notifications'
  | 'settings'
  | 'upgradePro';

export interface NavItem {
  id: ModuleId;
  label: string;
  icon: string;
  accent: string;
  badge?: number;
}

// App state
export interface AppState {
  currentModule: ModuleId;
  scanStatus: ScanStatus;
  scanProgress: number;
  scanScore: number;
  isExpanded: boolean;
  unreadCount: number;
}

// --- Additional types per spec ---

export type PlanType = 'free' | 'trial' | 'pro' | 'enterprise';
export type LicenseStatus = 'active' | 'expired' | 'cancelled' | 'suspended';

export interface TechnicalDetail {
  checkId: string;
  filePath?: string;
  currentValue?: string;
  expectedValue?: string;
  cveId?: string;
  referenceUrl?: string;
}

export interface ToolStatus {
  installed: boolean;
  version?: string;
  path?: string;
}

export interface SystemInfo {
  os: string;
  arch: string;
  hostname: string;
  node: ToolStatus;
  npm: ToolStatus;
  git: ToolStatus;
  docker: ToolStatus;
}

export interface OpenClawStatus {
  installed: boolean;
  version?: string;
  securityScore?: number;
  channels: ChannelInfo[];
}

export interface ChannelInfo {
  platform: Platform;
  connected: boolean;
  mcpCount: number;
  lastSync?: string;
}

export interface StoreItemDetail extends StoreCatalogItem {
  longDescription: string;
  author: string;
  version: string;
  permissions: string[];
  screenshots?: string[];
  changelog?: string;
}

export interface InstalledItem {
  itemId: string;
  name: string;
  version: string;
  platform: Platform;
  safetyLevel: SafetyLevel;
  installedAt: string;
  hasUpdate: boolean;
  newVersion?: string;
}

export interface InstallResult {
  success: boolean;
  message: string;
  itemId?: string;
  installed_platforms?: string[];
  errors?: string[];
}

export interface UpdateCheckResult {
  itemId: string;
  currentVersion: string;
  newVersion: string;
  hasUpdate: boolean;
}

export interface LicenseInfo {
  plan: PlanType;
  status: LicenseStatus;
  expiresAt?: string;
  trialDaysLeft?: number;
  features: string[];
}

export interface RuleUpdateInfo {
  version: string;
  changelog: string;
  ruleCount: number;
  lastUpdated: string;
}

export interface NotificationRecord extends Notification {
  actionLabel?: string;
  itemId?: string;
}
