import { isEnglishLocale, t } from '@/constants/i18n';

// Module gradient color system (8 modules)
// Each theme uses 3 color stops for smoother gradients without visible banding
export const MODULE_THEMES = {
  smartGuard: {
    from: '#0B1120',
    via: '#0C3A5F',
    to: '#0EA5E9',
    accent: '#0EA5E9',
    get label() {
      return t.moduleSmartGuard;
    },
    icon: 'Shield'
  },
  securityScan: {
    from: '#1A0505',
    via: '#5C1111',
    to: '#EF4444',
    accent: '#EF4444',
    get label() {
      return t.moduleSecurityScan;
    },
    icon: 'Search'
  },
  openClaw: {
    from: '#042F2E',
    via: '#0A5C58',
    to: '#14B8A6',
    accent: '#14B8A6',
    get label() {
      return t.moduleOpenClaw;
    },
    icon: 'Bot'
  },
  skillStore: {
    from: '#1E0A3E',
    via: '#4A1D8E',
    to: '#8B5CF6',
    accent: '#8B5CF6',
    get label() {
      return t.moduleSkillStore;
    },
    icon: 'Store'
  },
  installed: {
    from: '#022C22',
    via: '#065F46',
    to: '#10B981',
    accent: '#10B981',
    get label() {
      return t.moduleInstalled;
    },
    icon: 'Package'
  },
  keyVault: {
    from: '#1C1006',
    via: '#6B4106',
    to: '#F59E0B',
    accent: '#F59E0B',
    get label() {
      return t.moduleKeyVault;
    },
    icon: 'Lock'
  },
  notifications: {
    from: '#1A0612',
    via: '#7A1434',
    to: '#F43F5E',
    accent: '#F43F5E',
    get label() {
      return t.moduleNotifications;
    },
    icon: 'Bell'
  },
  settings: {
    from: '#0F172A',
    via: '#1E293B',
    to: '#475569',
    accent: '#475569',
    get label() {
      return t.moduleSettings;
    },
    icon: 'Settings'
  },
  upgradePro: {
    from: '#1C1006',
    via: '#6B4106',
    to: '#F59E0B',
    accent: '#F59E0B',
    get label() {
      return t.moduleUpgradePro;
    },
    icon: 'Crown'
  },
};

export type ModuleThemeKey = keyof typeof MODULE_THEMES;

// Card gradients for scanning state
export const CARD_GRADIENTS = {
  mcpSecurity: {
    from: '#0C2D48',
    to: '#1B6B93',
    get label() {
      return t.cardMcpSecurity;
    },
  },
  keySecurity: {
    from: '#0D3B4F',
    to: '#2496A8',
    get label() {
      return t.cardKeySecurity;
    },
  },
  envConfig: {
    from: '#0A2540',
    to: '#1565A0',
    get label() {
      return t.cardEnvConfig;
    },
  },
  installedRisk: {
    from: '#0B3142',
    to: '#1E8CA8',
    get label() {
      return t.cardInstalledRisk;
    },
  },
  systemProtection: {
    from: '#0E2233',
    to: '#2C6485',
    get label() {
      return t.cardSystemProtection;
    },
  },
};

// Safety level colors
export const SAFETY_COLORS = {
  safe: {
    bg: '#10B981',
    text: '#ECFDF5',
    get label() {
      return t.safetySafe;
    },
  },
  caution: {
    bg: '#F59E0B',
    text: '#FFFBEB',
    get label() {
      return t.safetyCaution;
    },
  },
  dangerous: {
    bg: '#EF4444',
    text: '#FEF2F2',
    get label() {
      return t.safetyDangerous;
    },
  },
  blocked: {
    bg: '#1F2937',
    text: '#F9FAFB',
    get label() {
      return t.safetyBlocked;
    },
  },
  unverified: {
    bg: '#6B7280',
    text: '#F9FAFB',
    get label() {
      return t.safetyUnverified;
    },
  },
};

// Severity colors
export const SEVERITY_COLORS = {
  critical: {
    bg: '#EF4444',
    dot: '#EF4444',
    get label() {
      return t.severityCritical;
    },
  },
  warning: {
    bg: '#F59E0B',
    dot: '#F59E0B',
    get label() {
      return t.severityWarning;
    },
  },
  info: {
    bg: '#3B82F6',
    dot: '#3B82F6',
    get label() {
      return t.severityInfo;
    },
  },
};

// Platform colors and icons
export const PLATFORM_CONFIG: Record<string, { name: string; color: string; icon: string }> = {
  cursor: { name: 'Cursor', color: '#00D1FF', icon: '⚡' },
  kiro: { name: 'Kiro', color: '#7C3AED', icon: '🪄' },
  vscode: { name: 'VS Code', color: '#007ACC', icon: '💻' },
  claude_desktop: { name: 'Claude Desktop', color: '#D97706', icon: '🤖' },
  windsurf: { name: 'Windsurf', color: '#22C55E', icon: '🏄' },
  claude_code: { name: 'Claude Code', color: '#F59E0B', icon: '🔧' },
  antigravity: { name: 'Antigravity', color: '#4285F4', icon: '🚀' },
  openclaw: { name: 'OpenClaw', color: '#14B8A6', icon: '🦀' },
  codex: { name: 'Codex CLI', color: '#10A37F', icon: '🧠' },
  qwen_code: { name: 'Qwen Code', color: '#FF6A00', icon: '🧭' },
  kimi_cli: { name: 'Kimi CLI', color: '#7C5CFF', icon: '🌙' },
  codebuddy: { name: 'CodeBuddy', color: '#00BFA5', icon: '🧩' },
  gemini_cli: { name: 'Gemini CLI', color: '#8E75B2', icon: '♊' },
  trae: { name: 'Trae', color: '#FF6B35', icon: '🔥' },
  continue_dev: { name: 'Continue', color: '#FF4500', icon: '▶️' },
  aider: { name: 'Aider', color: '#00BCD4', icon: '🤝' },
  copilot: { name: 'GitHub Copilot', color: '#000000', icon: '🐙' },
  zed: { name: 'Zed', color: '#8B5CF6', icon: '⚡' },
  cline: { name: 'Cline/Roo', color: '#E91E63', icon: '🤖' },
  unknown_ai_tool: {
    get name() {
      return isEnglishLocale ? 'Unknown AI Tool' : '未知 AI 工具';
    },
    color: '#6B7280',
    icon: '🧩',
  },
};
