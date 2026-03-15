export interface ModuleDefinition {
  id: string;
  name: string;
  colorKey: string;
  path: string;
  badge?: 'dot' | 'count';
}

export const MODULES: ModuleDefinition[] = [
  { id: 'smartGuard', name: '智能守护', colorKey: 'smartGuard', path: '/' },
  { id: 'securityScan', name: '安全扫描', colorKey: 'securityScan', path: '/scan' },
  { id: 'openClaw', name: 'OpenClaw 专区', colorKey: 'openClaw', path: '/openclaw', badge: 'dot' },
  { id: 'skillStore', name: '技能商店', colorKey: 'skillStore', path: '/store' },
  { id: 'installed', name: '已安装管理', colorKey: 'installed', path: '/installed', badge: 'count' },
  { id: 'keyVault', name: '密钥保险库', colorKey: 'keyVault', path: '/vault' },
  { id: 'notifications', name: '通知中心', colorKey: 'notifications', path: '/notifications', badge: 'count' },
  { id: 'settings', name: '设置', colorKey: 'settings', path: '/settings' },
];

/** Visual separator appears after this index (0-based) in the sidebar */
export const SEPARATOR_AFTER_INDEX = 6;
