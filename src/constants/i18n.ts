// i18n: multi-language support with auto-detection
// Default behavior follows system locale. Manual language choice overrides system locale.
export type AppLanguage = 'zh-CN' | 'zh-TW' | 'en-US' | 'ja-JP';

function normalizeLanguage(raw: string | null | undefined): AppLanguage {
  const value = (raw || '').toLowerCase();
  if (value.startsWith('en')) return 'en-US';
  if (value.startsWith('ja')) return 'ja-JP';
  if (value === 'zh-tw' || value.startsWith('zh-hant')) return 'zh-TW';
  return 'zh-CN';
}

function detectLanguage(): AppLanguage {
  if (typeof window === 'undefined') return 'zh-CN';

  const manualSelected = localStorage.getItem('agentshield-language-manual') === '1';
  const saved = localStorage.getItem('agentshield-language');

  if (manualSelected && saved) {
    return normalizeLanguage(saved);
  }

  const systemLang = normalizeLanguage(navigator.language || 'zh-CN');
  if (saved !== systemLang) {
    localStorage.setItem('agentshield-language', systemLang);
  }
  return systemLang;
}

export let currentLang: AppLanguage = detectLanguage();
export let isEnglishLocale = currentLang.startsWith('en');

// Translation keys interface
interface Translations {
  // App
  appName: string;
  appTitle: string;

  // Common
  welcome: string;
  welcomeSubtitle: string;
  startScan: string;
  stop: string;
  run: string;
  fixAll: string;
  back: string;
  cancel: string;
  confirm: string;
  done: string;
  view: string;
  install: string;
  uninstall: string;
  update: string;
  search: string;
  sort: string;
  filter: string;
  all: string;
  loading: string;
  retry: string;
  close: string;
  save: string;
  reset: string;
  enabled: string;
  disabled: string;
  previewModeNoticeTitle: string;
  desktopOnlyInBrowserShell: string;

  // Smart Guard
  smartGuard: string;
  realTimeProtection: string;
  protectionDisabled: string;
  lastScan: string;
  hoursAgo: string;
  scanComplete: string;
  scanning: string;
  scanningFiles: string;
  lookingForThreats: string;
  smartGuardScopedProtectionDetail: string;

  // Scan steps
  scanStepFilesystem: string;
  scanStepMcp: string;
  scanStepSkill: string;
  scanStepKey: string;
  scanStepSystem: string;

  // Security Scan
  securityScan: string;
  securityScanDesc: string;
  scanResults: string;
  score: string;
  sortBy: string;
  severity: string;
  criticalRisk: string;
  warning: string;
  info: string;
  fixIssue: string;
  affectedScope: string;
  issuesFound: string;
  severityFilter: string;
  platform: string;
  fixable: string;
  fixed: string;
  fixing: string;
  fixFailed: string;
  fixFailedManual: string;
  noAutoFixable: string;
  noIssuesFound: string;
  allIssuesFixed: string;
  allFixedCongrats: string;
  allFixedScore: string;
  issueDescription: string;
  fileLocation: string;
  viewFileLocation: string;
  fixSuggestion: string;
  fixSuggestionCritical: string;
  fixSuggestionWarning: string;
  fixSuggestionInfo: string;
  scanStatusScanning: string;
  fixedCount: string;

  // Skill Store
  skillStore: string;
  searchPlaceholder: string;
  skillStoreScopeHint: string;
  openClawFeatured: string;
  openClawDesc: string;
  openClawFeaturedDesc: string;
  storeTabAll: string;
  storeTabOpenClaw: string;
  storeTabDevTools: string;
  storeTabDatabase: string;
  storeTabAI: string;
  storeTabSearch: string;
  storeTabCloud: string;
  storeTabComm: string;
  storeTabSecurity: string;
  storeTabWeb: string;
  storeTabFile: string;
  storeTabBiz: string;
  storeTabSocial: string;
  storeTabDesign: string;
  storeTabUtil: string;
  storeTabSkill: string;
  storeItemCount: string;
  refreshing: string;
  refreshCatalog: string;
  loadingStore: string;
  noResults: string;
  showingItems: string;
  storeItemUnit: string;

  // Install
  installs: string;
  installTo: string;
  permissionExplain: string;
  readWriteFiles: string;
  accessNetwork: string;
  executeCommands: string;
  confirmInstall: string;
  installing: string;
  installed: string;
  installFailed: string;

  // Installed Management
  installedManagement: string;
  totalMCPs: string;
  checkUpdate: string;
  checkAllUpdates: string;
  permissionDetails: string;
  sourceUrl: string;
  installDate: string;
  version: string;
  foundUpdates: string;
  allUpToDate: string;
  checkUpdatesFailed: string;
  platformFilter: string;
  noInstalledPlugins: string;
  selectPluginDetails: string;
  checking: string;
  confirmUninstallAgain: string;

  // Key Vault
  keyVault: string;
  keyVaultDesc: string;
  manageKeys: string;
  addKey: string;
  freeLimit: string;
  copyKey: string;
  deleteKey: string;
  plaintextWarning: string;
  importToVault: string;
  unlimitedKeys: string;
  keyNamePlaceholder: string;
  servicePlaceholder: string;
  keyValuePlaceholder: string;
  copied: string;

  // OpenClaw
  openClawWizard: string;
  openClawManagement: string;
  openClawSubtitle: string;
  openClawDetecting: string;
  openClawNotInstalled: string;
  currentVersion: string;
  latestVersion: string;
  updateAvailable: string;
  envReady: string;
  needNodeJs: string;
  installedStatus: string;
  notInstalledStatus: string;
  installedSkills: string;
  mcpServers: string;
  configDirectory: string;
  oneClickInstall: string;
  oneClickUpdate: string;
  openConfigDir: string;
  confirmUninstallTitle: string;
  confirmUninstallDesc: string;
  confirmUninstallBtn: string;
  operationComplete: string;
  noInstalledSkills: string;
  installViaClawHub: string;
  noConfiguredMcps: string;
  addInConfigFile: string;
  officialResources: string;
  clawHubStore: string;
  officialDocs: string;
  securityAnnouncements: string;
  openFileLocation: string;
  filesCount: string;

  // Wizard steps
  systemDetect: string;
  envPrepare: string;
  installation: string;
  securityHarden: string;
  channelConnect: string;
  firstCheck: string;
  selectChannel: string;
  channelDesc: string;
  pasteBotToken: string;
  verify: string;
  connectionSuccess: string;
  skipForNow: string;
  nextStep: string;

  // Notifications
  notifications: string;
  unread: string;
  securityAlerts: string;
  systemUpdates: string;
  handleNow: string;
  viewDetails: string;
  unreadNotifications: string;
  noUnreadNotifications: string;
  justNow: string;
  minutesAgo: string;
  hoursAgoTime: string;
  daysAgo: string;

  // Settings
  settings: string;
  generalSettings: string;
  language: string;
  theme: string;
  startupBehavior: string;
  accountLicense: string;
  proTrial: string;
  daysRemaining: string;
  licenseKey: string;
  upgradeToPro: string;
  restorePurchase: string;
  scanSettings: string;
  autoScan: string;
  scanFrequency: string;
  scanScope: string;
  notificationSettings: string;
  systemNotification: string;
  criticalAlerts: string;
  about: string;
  checkForUpdates: string;

  // Settings - General
  settingsGeneral: string;
  autoStart: string;
  autoStartDesc: string;
  minimizeToTray: string;
  minimizeToTrayDesc: string;
  autoCheckUpdates: string;
  autoCheckUpdatesDesc: string;

  // Settings - Notifications
  settingsNotifications: string;
  enableNotifications: string;
  enableNotificationsDesc: string;
  soundEffects: string;
  soundEffectsDesc: string;
  criticalAlertsDesc: string;
  weeklyReport: string;
  weeklyReportDesc: string;

  // Settings - Security
  settingsSecurity: string;
  activeDefense: string;
  activeDefenseDesc: string;
  autoQuarantine: string;
  autoQuarantineDesc: string;
  autoScanDesc: string;
  scanFrequencyDesc: string;
  scanFrequencyDaily: string;
  scanFrequencyWeekly: string;
  scanFrequencyManual: string;
  protectionWatchingPaths: string;
  protectionNoIncidents: string;
  protectionRecentIncidents: string;
  protectionClearIncidents: string;
  protectionLastEvent: string;
  twoFactor: string;
  twoFactorDesc: string;
  biometric: string;
  biometricDesc: string;
  autoLock: string;
  autoLockDesc: string;
  viewSecurityLog: string;
  viewSecurityLogDesc: string;
  exportData: string;
  exportDataDesc: string;
  dataExported: string;
  exportUnavailable: string;

  // Settings - Appearance
  settingsAppearance: string;
  themeLight: string;
  themeDark: string;
  themeSystem: string;
  accentColor: string;
  animationEffects: string;
  animationEffectsDesc: string;

  // Settings - Language
  settingsLanguageRegion: string;
  region: string;
  regionChina: string;
  regionUS: string;
  regionJapan: string;
  regionUK: string;

  // Settings - Storage
  settingsStorage: string;
  cacheUsage: string;
  clearCache: string;
  clearCacheDesc: string;
  cacheCleared: string;
  clearScanHistory: string;
  clearScanHistoryDesc: string;
  scanHistoryCleared: string;
  resetAllData: string;
  resetAllDataDesc: string;
  allSettingsReset: string;

  // Settings - AI
  settingsAI: string;
  settingsAIDesc: string;
  aiProvider: string;
  aiProviderDeepseek: string;
  aiProviderGemini: string;
  aiProviderOpenai: string;
  aiProviderMinimax: string;
  aiProviderCustom: string;
  apiEndpoint: string;
  apiKey: string;
  apiKeyHint: string;
  model: string;
  modelRecommend: string;
  testConnection: string;
  connectionOk: string;
  connectionFailed: string;
  testing: string;

  // Settings - API
  settingsAPI: string;
  viewApiDocs: string;
  viewApiDocsDesc: string;

  // Settings - About
  aboutApp: string;
  versionInfo: string;
  upToDate: string;
  upToDateDesc: string;
  syncRules: string;
  syncRulesDesc: string;
  syncRulesUpToDate: string;
  syncRulesAvailable: string;
  syncRulesApplied: string;
  viewChangelog: string;
  viewChangelogDesc: string;
  privacyPolicy: string;
  privacyPolicyDesc: string;
  termsOfService: string;
  termsOfServiceDesc: string;

  // Upgrade Pro
  upgradePro: string;
  upgradeProSubtitle: string;
  proActivated: string;
  proActivatedDesc: string;
  freeFeature1: string;
  freeFeature2: string;
  freeFeature3: string;
  proFeature1: string;
  proFeature2: string;
  proFeature3: string;
  proFeature4: string;
  proFeature5: string;
  proFeature6: string;
  proFeature7: string;
  freeBasicProtection: string;
  proFullProtection: string;
  currentPlan: string;
  recommended: string;
  perYear: string;
  forever: string;
  proActivationMode: string;
  proActivationHint: string;
  freeTrial30: string;
  trialActive: string;
  enterLicenseKey: string;
  activate: string;
  activateFailed: string;
  trialFailed: string;
  purchaseActivationCode: string;
  monthlyActivationCode: string;
  yearlyActivationCode: string;
  lifetimeActivationCode: string;
  validFor30Days: string;
  validFor365Days: string;
  validForever: string;
  oneTimePaymentNoSubscription: string;
  buyActivationCode: string;
  checkoutLinkMissing: string;
  purchaseOpenedInBrowser: string;
  openPurchaseFailed: string;
  pasteCodeAfterPurchase: string;

  // Promo Code
  promoCode: string;
  promoCodePlaceholder: string;
  promoApply: string;
  promoChecking: string;
  promoInvalid: string;
  promoDiscountApplied: string;

  // Env Config
  envConfig: string;
  detectingEnv: string;
  envDetectFailed: string;
  detectedToolsCount: string;
  systemEnv: string;

  // Onboarding
  onboardingWelcome: string;
  onboardingSubtitle: string;
  onboardingDesc: string;
  permissionTitle: string;
  permissionSubtitle: string;
  permFullDisk: string;
  permFullDiskDesc: string;
  permAccessibility: string;
  permAccessibilityDesc: string;
  permAutomation: string;
  permAutomationDesc: string;
  permNotification: string;
  permNotificationDesc: string;
  featureTitle: string;
  featureSubtitle: string;
  featureSmartClean: string;
  featureSmartCleanDesc: string;
  featureSecurity: string;
  featureSecurityDesc: string;
  featurePerformance: string;
  featurePerformanceDesc: string;
  featureKeyVault: string;
  featureKeyVaultDesc: string;

  // General shared
  detectedTools: string;
  mcpDetected: string;
  noMcpDetected: string;
  notInstalled: string;
  previousStep: string;
  startSecurityCheck: string;
  allFixed: string;
  fixedKeyExposure: string;
  fixedPermission: string;
  updatedPlugins: string;
  viewDetailReport: string;
  backToHome: string;
  unlockPro: string;
  proExclusive: string;
  freeTrial: string;
  pricePerMonth: string;
  waiting: string;
  allPassed: string;
  canFix: string;
  canClean: string;
  canRemove: string;
  toRun: string;
  toInstall: string;

  // Module labels
  moduleSmartGuard: string;
  moduleSecurityScan: string;
  moduleOpenClaw: string;
  moduleSkillStore: string;
  moduleInstalled: string;
  moduleKeyVault: string;
  moduleNotifications: string;
  moduleSettings: string;
  moduleUpgradePro: string;

  // Cards
  cardMcpSecurity: string;
  cardKeySecurity: string;
  cardEnvConfig: string;
  cardInstalledRisk: string;
  cardSystemProtection: string;

  // Safety levels
  safetySafe: string;
  safetyCaution: string;
  safetyDangerous: string;
  safetyBlocked: string;
  safetyUnverified: string;
  severityCritical: string;
  severityWarning: string;
  severityInfo: string;

  // MacOS Frame
  restart: string;
  lastScanTime: string;

  // Onboarding - Ready step
  readyTitle: string;
  readyDesc: string;
  allReady: string;
  readyProtectionDesc: string;
  startFirstScan: string;
  maybeLater: string;
  prevStep: string;
  continueBtn: string;
  required: string;

  // Notification Center
  markAllRead: string;
  clearAll: string;
  filterAll: string;
  filterUnread: string;
  noNotifications: string;

  // Security Scan - detail
  selectIssueToView: string;

  // Env Config Detail
  detectedAiTools: string;
  noMcp: string;
  notDetected: string;
  mcpConfigured: string;
  unknown: string;
  installPath: string;
  mcpConfig: string;
  configured: string;
  notConfigured: string;
  configFileCount: string;
  mcpConfigPaths: string;
  open: string;
  noMcpConfig: string;
  noMcpConfigDesc: string;
  unit: string;
}

const zhCN: Translations = {
  // App
  appName: 'AgentShield 智盾',
  appTitle: 'AgentShield 智盾',

  // Common
  welcome: '你的 AI 工具，正在偷偷做什么？',
  welcomeSubtitle: '每 5 个 MCP 插件就有 1 个被发现存在恶意行为。30 秒扫描，一键揪出隐患。',
  startScan: '扫描',
  stop: '停止',
  run: '运行',
  fixAll: '一键修复',
  back: '后退',
  cancel: '取消',
  confirm: '确认',
  done: '完成',
  view: '查看',
  install: '安装',
  uninstall: '卸载',
  update: '更新',
  search: '搜索',
  sort: '排序',
  filter: '筛选',
  all: '全部',
  loading: '加载中...',
  retry: '重试',
  close: '关闭',
  save: '保存',
  reset: '重置',
  enabled: '已开启',
  disabled: '已关闭',
  previewModeNoticeTitle: '预览模式提示',
  desktopOnlyInBrowserShell: '当前为浏览器预览模式，{feature} 仅在桌面版 AgentShield 中可用。',

  // Smart Guard
  smartGuard: '智能守护',
  realTimeProtection: '实时防护运行中',
  protectionDisabled: '实时防护已关闭',
  lastScan: '上次扫描',
  hoursAgo: '小时前',
  scanComplete: '扫描完成',
  scanning: '扫描中...',
  scanningFiles: '正在扫描文件系统，发现 AI 工具...',
  lookingForThreats: '正在查找潜在威胁...',
  smartGuardScopedProtectionDetail: '只盯 OpenClaw 和支持 MCP / Skill 的 AI 工具，敏感操作会先问你再放行',

  // Scan steps
  scanStepFilesystem: '正在检测你的 AI 工具...',
  scanStepMcp: '检查隐私泄露风险...',
  scanStepSkill: '检查恶意插件风险...',
  scanStepKey: '检查密码暴露风险...',
  scanStepSystem: '检查后台偷跑风险...',

  // Security Scan
  securityScan: '安全扫描',
  securityScanDesc: '扫描所有 AI 工具，发现隐藏风险。',
  scanResults: '安全扫描结果',
  score: '评分',
  sortBy: '排序方式按',
  severity: '严重程度',
  criticalRisk: '严重风险',
  warning: '警告',
  info: '提示',
  fixIssue: '修复此问题',
  affectedScope: '影响范围',
  issuesFound: '发现 {count} 处风险',
  severityFilter: '严重程度筛选',
  platform: '平台',
  fixable: '可修复',
  fixed: '已修复',
  fixing: '正在修复...',
  fixFailed: '修复失败',
  fixFailedManual: '修复未成功，请手动处理',
  noAutoFixable: '没有可自动修复的问题',
  noIssuesFound: '未发现安全问题',
  allIssuesFixed: '所有问题已修复',
  allFixedCongrats: '你的 AI 工具环境现在更安全了',
  allFixedScore: '所有问题已修复，安全评分 100/100',
  issueDescription: '问题描述',
  fileLocation: '文件位置',
  viewFileLocation: '查看文件位置',
  fixSuggestion: '修复建议',
  fixSuggestionCritical: '建议立即修复此问题，以防止潜在的安全风险。自动修复将移除明文密钥并替换为安全引用。',
  fixSuggestionWarning: '建议尽快处理此问题。自动修复将应用推荐的安全配置。',
  fixSuggestionInfo: '此为信息性提示，建议在方便时处理。',
  scanStatusScanning: '安全扫描中',
  fixedCount: '已修复 {count} 个问题',

  // Skill Store
  skillStore: '技能商店',
  searchPlaceholder: '搜索安全扩展组件...',
  skillStoreScopeHint: '面向 Codex、Cursor、Claude、Windsurf、Zed、Trae、Gemini CLI、OpenClaw 等支持自动化扩展的 AI 工具。',
  openClawFeatured: 'OpenClaw 精选',
  openClawDesc: '经过安全审查的专属插件',
  openClawFeaturedDesc: '这里展示的是已通过 AgentShield 兼容性复核、适用于 OpenClaw 以及其他支持自动化扩展的 AI 工具的一键托管条目。',
  storeTabAll: '全部',
  storeTabOpenClaw: 'OpenClaw 专区',
  storeTabDevTools: '开发工具',
  storeTabDatabase: '数据库',
  storeTabAI: 'AI / LLM',
  storeTabSearch: '搜索',
  storeTabCloud: '云服务',
  storeTabComm: '通讯协作',
  storeTabSecurity: '安全',
  storeTabWeb: 'Web',
  storeTabFile: '文件',
  storeTabBiz: '商业',
  storeTabSocial: '社交',
  storeTabDesign: '设计',
  storeTabUtil: '工具',
  storeTabSkill: 'Skill',
  storeItemCount: '个插件可用',
  refreshing: '刷新中...',
  refreshCatalog: '刷新目录',
  loadingStore: '加载商店数据...',
  noResults: '没有找到匹配的插件',
  showingItems: '显示',
  storeItemUnit: '项',

  // Install
  installs: '安装',
  installTo: '安装到哪个工具？',
  permissionExplain: '权限说明',
  readWriteFiles: '读写本地文件',
  accessNetwork: '访问网络',
  executeCommands: '执行命令',
  confirmInstall: '确认安装',
  installing: '正在安装...',
  installed: '已安装',
  installFailed: '安装失败',

  // Installed Management
  installedManagement: '已安装管理',
  totalMCPs: '共 {count} 个扩展组件',
  checkUpdate: '检查更新',
  checkAllUpdates: '检查更新',
  permissionDetails: '权限详情',
  sourceUrl: '来源地址',
  installDate: '安装日期',
  version: '版本',
  foundUpdates: '发现 {count} 个可更新项',
  allUpToDate: '所有插件已是最新版本',
  checkUpdatesFailed: '检查更新失败，请稍后重试',
  platformFilter: 'IDE 与 AI 工具',
  noInstalledPlugins: '暂无已安装的插件',
  selectPluginDetails: '选择一个插件查看详情',
  checking: '检查中...',
  confirmUninstallAgain: '确认卸载？再次点击确认',

  // Key Vault
  keyVault: '密钥保险库',
  keyVaultDesc: '通过系统钥匙串集中保护并管理你所有 AI 工具的 API 密钥。',
  manageKeys: '管理密钥',
  addKey: '添加密钥',
  freeLimit: '免费版',
  copyKey: '复制',
  deleteKey: '删除',
  plaintextWarning: '从 {platform} 配置中发现明文密钥',
  importToVault: '导入到保险库',
  unlimitedKeys: '升级 Pro 解锁无限密钥存储',
  keyNamePlaceholder: '密钥名称 (如 OpenAI API Key)',
  servicePlaceholder: '服务 (如 GPT-4)',
  keyValuePlaceholder: '密钥值 (如 sk-proj-...)',
  copied: '已复制',

  // OpenClaw
  openClawWizard: 'OpenClaw 专区',
  openClawManagement: 'OpenClaw 管理中心',
  openClawSubtitle: '管理 OpenClaw AI 代理框架 — 安装、更新、查看 Skill 和 MCP 配置',
  openClawDetecting: '正在检测 OpenClaw 状态...',
  openClawNotInstalled: '（未安装）',
  currentVersion: '当前版本:',
  latestVersion: '最新版本:',
  updateAvailable: '有更新',
  envReady: '环境已就绪，可一键安装',
  needNodeJs: '需要先安装 Node.js (nodejs.org)',
  installedStatus: '已安装',
  notInstalledStatus: '未安装',
  installedSkills: '已安装 Skill',
  mcpServers: 'MCP 服务器',
  configDirectory: '配置目录',
  oneClickInstall: '一键安装',
  oneClickUpdate: '一键更新',
  openConfigDir: '打开配置目录',
  confirmUninstallTitle: '⚠ 确认完全卸载 OpenClaw？',
  confirmUninstallDesc: '将删除 OpenClaw 程序、配置目录 (~/.openclaw)、所有平台的 OpenClaw MCP 配置、LaunchAgent 服务。',
  confirmUninstallBtn: '确认卸载',
  operationComplete: '操作完成',
  noInstalledSkills: '暂无已安装的 Skill',
  installViaClawHub: '可通过 clawhub install <skill> 安装',
  noConfiguredMcps: '暂无配置的 MCP 服务器',
  addInConfigFile: '可在 OpenClaw 配置文件中添加',
  officialResources: '官方资源',
  clawHubStore: 'ClawHub 技能商店',
  officialDocs: '官方文档',
  securityAnnouncements: '安全公告',
  openFileLocation: '打开文件位置',
  filesCount: '{count} 个文件',

  // Wizard steps
  systemDetect: '系统检测',
  envPrepare: '环境准备',
  installation: '安装',
  securityHarden: '安全加固',
  channelConnect: '渠道对接',
  firstCheck: '首次体检',
  selectChannel: '选择你想对接的通讯渠道',
  channelDesc: '为了确保你的 AI Agent 能正常通讯，请选择一个渠道配置。',
  pasteBotToken: '请粘贴你的 Bot Token',
  verify: '验证',
  connectionSuccess: '连接验证成功',
  skipForNow: '跳过，稍后配置',
  nextStep: '下一步',

  // Notifications
  notifications: '通知中心',
  unread: '未读',
  securityAlerts: '安全告警',
  systemUpdates: '系统更新',
  handleNow: '立即处理',
  viewDetails: '查看详情',
  unreadNotifications: '{count} 条未读通知',
  noUnreadNotifications: '没有未读通知',
  justNow: '刚刚',
  minutesAgo: '{count} 分钟前',
  hoursAgoTime: '{count} 小时前',
  daysAgo: '{count} 天前',

  // Settings
  settings: '设置',
  generalSettings: '常规设置',
  language: '语言',
  theme: '主题',
  startupBehavior: '启动行为',
  accountLicense: '账户与许可证',
  proTrial: 'Pro 试用',
  daysRemaining: '剩余 {days} 天',
  licenseKey: '激活码',
  upgradeToPro: '升级 Pro，30 秒处理全部',
  restorePurchase: '恢复购买',
  scanSettings: '扫描设置',
  autoScan: '自动扫描',
  scanFrequency: '扫描频率',
  scanScope: '扫描范围',
  notificationSettings: '通知设置',
  systemNotification: '系统通知',
  criticalAlerts: '严重警报',
  about: '关于',
  checkForUpdates: '检查组件更新',

  // Settings sections
  settingsGeneral: '通用设置',
  autoStart: '开机自动启动',
  autoStartDesc: '系统启动时自动运行 AgentShield 智盾',
  minimizeToTray: '最小化到托盘',
  minimizeToTrayDesc: '关闭窗口时最小化到系统托盘（30 秒内再次关闭将直接退出）',
  autoCheckUpdates: '自动检查更新',
  autoCheckUpdatesDesc: '定期检查并通知新版本',

  settingsNotifications: '通知设置',
  enableNotifications: '启用通知',
  enableNotificationsDesc: '允许应用发送桌面通知',
  soundEffects: '声音效果',
  soundEffectsDesc: '通知时播放提示音',
  criticalAlertsDesc: '安全威胁等重要事件始终通知',
  weeklyReport: '每周报告',
  weeklyReportDesc: '每周发送系统健康摘要',

  settingsSecurity: '安全与隐私',
  activeDefense: '实时主动防御',
  activeDefenseDesc: '持续监听 MCP 配置和 Skill 目录变更，发现高风险项立即拦截',
  autoQuarantine: '自动隔离高风险项',
  autoQuarantineDesc: '仅对 AgentShield 托管条目与 Skill 隔离生效；外部 IDE / CLI 配置只告警，不会后台自动改写',
  autoScanDesc: '应用启动后自动执行一次后台安全扫描',
  scanFrequencyDesc: '后台自动扫描的执行频率',
  scanFrequencyDaily: '每天一次',
  scanFrequencyWeekly: '每周一次',
  scanFrequencyManual: '仅手动触发',
  protectionWatchingPaths: '当前监听 {count} 条路径',
  protectionNoIncidents: '最近没有新的拦截事件',
  protectionRecentIncidents: '最近拦截事件',
  protectionClearIncidents: '清空拦截记录',
  protectionLastEvent: '最近事件：{time}',
  twoFactor: '双重身份验证',
  twoFactorDesc: '登录时需要额外验证',
  biometric: '生物识别解锁',
  biometricDesc: '使用 Touch ID 或 Face ID 解锁',
  autoLock: '自动锁定',
  autoLockDesc: '闲置 5 分钟后自动锁定应用',
  viewSecurityLog: '查看安全日志',
  viewSecurityLogDesc: '查看近期的安全事件记录',
  exportData: '导出数据',
  exportDataDesc: '导出您的所有数据',
  dataExported: '数据导出成功',
  exportUnavailable: '导出功能暂不可用',

  settingsAppearance: '外观设置',
  themeLight: '浅色',
  themeDark: '深色',
  themeSystem: '跟随系统',
  accentColor: '强调色',
  animationEffects: '动画效果',
  animationEffectsDesc: '启用界面过渡动画',

  settingsLanguageRegion: '语言与地区',
  region: '地区',
  regionChina: '中国',
  regionUS: '美国',
  regionJapan: '日本',
  regionUK: '英国',

  settingsStorage: '存储管理',
  cacheUsage: '缓存使用',
  clearCache: '清除缓存',
  clearCacheDesc: '删除临时文件以释放空间',
  cacheCleared: '缓存已清除 ✓',
  clearScanHistory: '清除扫描历史',
  clearScanHistoryDesc: '删除所有扫描记录',
  scanHistoryCleared: '扫描历史已清除 ✓',
  resetAllData: '重置所有数据',
  resetAllDataDesc: '将应用恢复到初始状态',
  allSettingsReset: '所有设置已重置为默认值',

  settingsAI: 'AI 智能配置',
  settingsAIDesc: '配置 AI 模型用于智能安装向导的错误诊断和自动修复（Pro 功能）',
  aiProvider: 'AI 服务商',
  aiProviderDeepseek: '最佳性价比 · $0.28/MTok',
  aiProviderGemini: '免费额度 · $0.10/MTok',
  aiProviderOpenai: '通用 · $2.50/MTok',
  aiProviderMinimax: 'MiniMax · 国产高性价比',
  aiProviderCustom: 'OpenAI 兼容端点',
  apiEndpoint: 'API 端点',
  apiKey: 'API 密钥',
  apiKeyHint: '请输入你的 API 密钥',
  model: '模型',
  modelRecommend: '推荐',
  testConnection: '测试连接',
  connectionOk: '连接成功！',
  connectionFailed: '连接失败',
  testing: '正在测试连接...',

  settingsAPI: 'API 设置',
  viewApiDocs: '查看 API 文档',
  viewApiDocsDesc: '了解如何使用 AgentShield 智盾 API',

  aboutApp: '关于 AgentShield 智盾',
  versionInfo: '版本 1.0.0',
  upToDate: '组件已是最新状态 ✓',
  upToDateDesc: '当前没有可用的托管组件更新',
  syncRules: '同步安全规则',
  syncRulesDesc: '下载并应用最新的 MCP / Skill 风险规则，后续扫描会立即采用。',
  syncRulesUpToDate: '当前规则库版本 {version}，已是最新状态',
  syncRulesAvailable: '发现新规则版本 {version}，点击即可同步',
  syncRulesApplied: '已应用规则版本 {version}',
  viewChangelog: '查看更新日志',
  viewChangelogDesc: '了解版本更新内容',
  privacyPolicy: '隐私政策',
  privacyPolicyDesc: '了解我们如何保护您的数据',
  termsOfService: '服务条款',
  termsOfServiceDesc: '查看使用条款和条件',

  // Upgrade Pro
  upgradePro: '升级 Pro',
  upgradeProSubtitle: '30 秒修复全部风险，不再手动逐个处理',
  proActivated: 'Pro 已激活',
  proActivatedDesc: '感谢您的支持！您已享有所有高级功能。',
  freeFeature1: '基础安全扫描',
  freeFeature2: '最多 10 个密钥存储',
  freeFeature3: '基本通知',
  proFeature1: '完整安全扫描 (23项检测)',
  proFeature2: '一键自动修复',
  proFeature3: '无限密钥存储',
  proFeature4: '高级通知与周报',
  proFeature5: '优先技术支持',
  proFeature6: '规则库自动更新',
  proFeature7: '批量操作',
  freeBasicProtection: '基础安全防护',
  proFullProtection: '完整安全防护 + 高级功能',
  currentPlan: '当前方案',
  recommended: '推荐',
  perYear: '/年',
  forever: '/永久',
  proActivationMode: '14 天试用 + 激活码升级',
  proActivationHint: '先购买激活码再粘贴到应用中激活。月度 / 年度 / 永久版均为一次性付款，不会自动续费。',
  freeTrial30: '免费试用 14 天',
  trialActive: '试用中 - {days} 天剩余',
  enterLicenseKey: '输入激活码',
  activate: '激活',
  activateFailed: '激活失败，请检查离线授权码',
  trialFailed: '试用激活失败',
  purchaseActivationCode: '购买激活码',
  monthlyActivationCode: '月度激活码',
  yearlyActivationCode: '年度激活码',
  lifetimeActivationCode: '永久激活码',
  validFor30Days: '有效期 30 天',
  validFor365Days: '有效期 365 天',
  validForever: '永久有效',
  oneTimePaymentNoSubscription: '一次性付款，不自动续费',
  buyActivationCode: '立即购买',
  checkoutLinkMissing: '购买链接未配置，请联系支持团队',
  purchaseOpenedInBrowser: '已打开购买页面，支付后请返回并粘贴激活码',
  openPurchaseFailed: '打开购买页面失败',
  pasteCodeAfterPurchase: '支付成功后，请在下方输入 AGSH 激活码完成升级',

  // Promo Code
  promoCode: '优惠码',
  promoCodePlaceholder: '输入优惠码',
  promoApply: '验证',
  promoChecking: '验证中…',
  promoInvalid: '无效的优惠码',
  promoDiscountApplied: '🎉 优惠 {pct}% 折扣已生效',

  // Env Config
  envConfig: '环境配置',
  detectingEnv: '正在检测系统环境...',
  envDetectFailed: '环境检测失败',
  detectedToolsCount: '检测到 {count} 个 AI 工具',
  systemEnv: '系统环境',

  // Onboarding
  onboardingWelcome: '欢迎使用 AgentShield 智盾',
  onboardingSubtitle: '您的智能 AI 安全守护者，让我们开始设置吧',
  onboardingDesc: 'AgentShield 智盾是您的智能 AI 安全守护者，帮助您扫描 MCP 插件、保护 API 密钥、管理 AI 工具安全，让您的 AI 工具始终保持安全状态。',
  permissionTitle: '系统权限',
  permissionSubtitle: '为了更好地保护您的设备，我们需要一些权限',
  permFullDisk: '完全磁盘访问权限',
  permFullDiskDesc: '允许扫描和检查配置文件',
  permAccessibility: '辅助功能权限',
  permAccessibilityDesc: '允许自动化操作和优化',
  permAutomation: '自动化权限',
  permAutomationDesc: '允许控制其他应用程序',
  permNotification: '通知权限',
  permNotificationDesc: '接收重要安全警报和更新',
  featureTitle: '核心功能',
  featureSubtitle: '了解 AgentShield 智盾能为您做什么',
  featureSmartClean: '安全扫描',
  featureSmartCleanDesc: '自动扫描 AI 工具中的安全隐患',
  featureSecurity: '安全防护',
  featureSecurityDesc: '实时监控 MCP 插件和 Skill 安全状态',
  featurePerformance: '密钥管理',
  featurePerformanceDesc: '加密管理你的 API 密钥，防止泄露',
  featureKeyVault: '密钥保险库',
  featureKeyVaultDesc: '安全管理您的 API 密钥',

  // General shared
  detectedTools: '检测到你已安装以下 AI 工具',
  mcpDetected: '已检测到 {count} 个 MCP 插件',
  noMcpDetected: '未检测到 MCP 插件',
  notInstalled: '未安装',
  previousStep: '上一步',
  startSecurityCheck: '开始安全体检',
  allFixed: '太棒了！所有问题已修复',
  fixedKeyExposure: '修复了 {count} 个密钥暴露',
  fixedPermission: '修复了 {count} 个权限问题',
  updatedPlugins: '更新了 {count} 个过期插件',
  viewDetailReport: '查看详细报告',
  backToHome: '返回首页',
  unlockPro: '解锁一键修复',
  proExclusive: 'Pro 专属功能',
  freeTrial: '免费试用 14 天',
  pricePerMonth: '¥29/月',
  waiting: '等待中...',
  allPassed: '暂时安全',
  canFix: '可一键修复',
  canClean: '可清理',
  canRemove: '可移除',
  toRun: '要运行',
  toInstall: '要安装',

  // Module labels
  moduleSmartGuard: '智能守护',
  moduleSecurityScan: '安全扫描',
  moduleOpenClaw: 'OpenClaw 专区',
  moduleSkillStore: '技能商店',
  moduleInstalled: '已安装管理',
  moduleKeyVault: '密钥保险库',
  moduleNotifications: '通知中心',
  moduleSettings: '设置',
  moduleUpgradePro: '升级 Pro',

  // Cards
  cardMcpSecurity: '隐私泄露风险',
  cardKeySecurity: '密码暴露风险',
  cardEnvConfig: '权限失控风险',
  cardInstalledRisk: '恶意插件风险',
  cardSystemProtection: '后台偷跑风险',

  // Safety levels
  safetySafe: '安全',
  safetyCaution: '谨慎',
  safetyDangerous: '危险',
  safetyBlocked: '已拒绝',
  safetyUnverified: '未验证',
  severityCritical: '严重风险',
  severityWarning: '警告',
  severityInfo: '提示',

  // MacOS Frame
  restart: '重新开始',
  lastScanTime: '上次扫描: {time}',

  // Onboarding - Ready step
  readyTitle: '准备就绪',
  readyDesc: '开始使用 AgentShield 智盾 保护您的 Mac',
  allReady: '一切就绪！',
  readyProtectionDesc: '您的 Mac 现在受到 AgentShield 智盾 的全面保护。点击下方按钮开始首次扫描。',
  startFirstScan: '开始首次扫描',
  maybeLater: '稍后再说',
  prevStep: '上一步',
  continueBtn: '继续',
  required: '必需',

  // Notification Center
  markAllRead: '全部已读',
  clearAll: '清空',
  filterAll: '全部',
  filterUnread: '未读',
  noNotifications: '暂无通知',

  // Security Scan - detail
  selectIssueToView: '选择一个问题查看详情',

  // Env Config Detail
  detectedAiTools: '已检测到的 AI 工具',
  noMcp: '无MCP',
  notDetected: '未检测到',
  mcpConfigured: 'MCP 已配置',
  unknown: '未知',
  installPath: '安装路径',
  mcpConfig: 'MCP 配置',
  configured: '已配置',
  notConfigured: '未配置',
  configFileCount: '配置文件数',
  mcpConfigPaths: 'MCP 配置文件路径',
  open: '打开',
  noMcpConfig: '未发现 MCP 配置',
  noMcpConfigDesc: '该工具已安装但未检测到 MCP 配置文件。如果您已配置 MCP 服务器，可能使用了非标准路径。',
  unit: '个',
};

const enUS: Translations = {
  // App
  appName: 'AgentShield',
  appTitle: 'AgentShield',

  // Common
  welcome: 'What Are Your AI Tools Doing Behind Your Back?',
  welcomeSubtitle: '1 in 5 MCP extensions has been found malicious. Scan in 30 seconds. Fix in one click.',
  startScan: 'Scan',
  stop: 'Stop',
  run: 'Run',
  fixAll: 'Fix All',
  back: 'Back',
  cancel: 'Cancel',
  confirm: 'Confirm',
  done: 'Done',
  view: 'View',
  install: 'Install',
  uninstall: 'Uninstall',
  update: 'Update',
  search: 'Search',
  sort: 'Sort',
  filter: 'Filter',
  all: 'All',
  loading: 'Loading...',
  retry: 'Retry',
  close: 'Close',
  save: 'Save',
  reset: 'Reset',
  enabled: 'Enabled',
  disabled: 'Disabled',
  previewModeNoticeTitle: 'Preview Mode Notice',
  desktopOnlyInBrowserShell: 'You are in browser preview mode. {feature} is only available in the desktop build of AgentShield.',

  // Smart Guard
  smartGuard: 'Smart Guard',
  realTimeProtection: 'Real-time Protection Enabled',
  protectionDisabled: 'Real-time Protection Disabled',
  lastScan: 'Last Scan',
  hoursAgo: 'hours ago',
  scanComplete: 'Scan Complete',
  scanning: 'Scanning...',
  scanningFiles: 'Scanning filesystem, discovering AI tools...',
  lookingForThreats: 'Looking for potential threats...',
  smartGuardScopedProtectionDetail: 'Only watches OpenClaw and AI tools with automation extensions. Sensitive actions still require your approval.',

  // Scan steps
  scanStepFilesystem: 'Detecting your AI tools...',
  scanStepMcp: 'Checking for privacy leaks...',
  scanStepSkill: 'Checking for malicious plugins...',
  scanStepKey: 'Checking for password exposure...',
  scanStepSystem: 'Checking background activity...',

  // Security Scan
  securityScan: 'Security Scan',
  securityScanDesc: 'Scan all AI tools to find hidden risks.',
  scanResults: 'Security Scan Results',
  score: 'Score',
  sortBy: 'Sort by',
  severity: 'Severity',
  criticalRisk: 'Critical Risk',
  warning: 'Warning',
  info: 'Info',
  fixIssue: 'Fix This Issue',
  affectedScope: 'Affected Scope',
  issuesFound: '{count} risks found',
  severityFilter: 'Filter by Severity',
  platform: 'Platform',
  fixable: 'Fixable',
  fixed: 'Fixed',
  fixing: 'Fixing...',
  fixFailed: 'Fix Failed',
  fixFailedManual: 'Auto-fix unsuccessful, please handle manually',
  noAutoFixable: 'No auto-fixable issues found',
  noIssuesFound: 'No security issues found',
  allIssuesFixed: 'All issues have been fixed',
  allFixedCongrats: 'Your AI tools are now more secure',
  allFixedScore: 'All issues fixed, security score 100/100',
  issueDescription: 'Description',
  fileLocation: 'File Location',
  viewFileLocation: 'View File Location',
  fixSuggestion: 'Fix Suggestion',
  fixSuggestionCritical: 'Fix this issue immediately to prevent security risks. Auto-fix will remove plaintext keys and replace with secure references.',
  fixSuggestionWarning: 'Address this issue soon. Auto-fix will apply recommended security settings.',
  fixSuggestionInfo: 'This is an informational tip. Address it when convenient.',
  scanStatusScanning: 'Security Scanning',
  fixedCount: 'Fixed {count} issues',

  // Skill Store
  skillStore: 'Skill Store',
  searchPlaceholder: 'Search secure extensions...',
  skillStoreScopeHint: 'For AI tools with automation extensions, including Codex, Cursor, Claude, Windsurf, Zed, Trae, Gemini CLI, and OpenClaw.',
  openClawFeatured: 'OpenClaw Featured',
  openClawDesc: 'Security-reviewed exclusive plugins',
  openClawFeaturedDesc: 'These are AgentShield-reviewed managed items that work with OpenClaw and other AI tools with automation extensions.',
  storeTabAll: 'All',
  storeTabOpenClaw: 'OpenClaw Featured',
  storeTabDevTools: 'Dev Tools',
  storeTabDatabase: 'Database',
  storeTabAI: 'AI / LLM',
  storeTabSearch: 'Search',
  storeTabCloud: 'Cloud',
  storeTabComm: 'Communication',
  storeTabSecurity: 'Security',
  storeTabWeb: 'Web',
  storeTabFile: 'Files',
  storeTabBiz: 'Business',
  storeTabSocial: 'Social',
  storeTabDesign: 'Design',
  storeTabUtil: 'Utilities',
  storeTabSkill: 'Skill',
  storeItemCount: 'plugins available',
  refreshing: 'Refreshing...',
  refreshCatalog: 'Refresh',
  loadingStore: 'Loading store data...',
  noResults: 'No matching plugins found',
  showingItems: 'Showing',
  storeItemUnit: 'items',

  // Install
  installs: 'Installs',
  installTo: 'Install to which tool?',
  permissionExplain: 'Permissions',
  readWriteFiles: 'Read/Write local files',
  accessNetwork: 'Access network',
  executeCommands: 'Execute commands',
  confirmInstall: 'Confirm Install',
  installing: 'Installing...',
  installed: 'Installed',
  installFailed: 'Install failed',

  // Installed Management
  installedManagement: 'Installed',
  totalMCPs: '{count} extensions total',
  checkUpdate: 'Check Update',
  checkAllUpdates: 'Check Updates',
  permissionDetails: 'Permission Details',
  sourceUrl: 'Source URL',
  installDate: 'Install Date',
  version: 'Version',
  foundUpdates: 'Found {count} updatable items',
  allUpToDate: 'All plugins are up to date',
  checkUpdatesFailed: 'Update check failed, please try again later',
  platformFilter: 'IDE & AI Tools',
  noInstalledPlugins: 'No installed plugins',
  selectPluginDetails: 'Select a plugin to view details',
  checking: 'Checking...',
  confirmUninstallAgain: 'Confirm uninstall? Click again to confirm',

  // Key Vault
  keyVault: 'Key Vault',
  keyVaultDesc: 'Protect and manage AI tool API keys with the system keychain.',
  manageKeys: 'Manage Keys',
  addKey: 'Add Key',
  freeLimit: 'Free Plan',
  copyKey: 'Copy',
  deleteKey: 'Delete',
  plaintextWarning: 'Plaintext key found in {platform} config',
  importToVault: 'Import to Vault',
  unlimitedKeys: 'Upgrade to Pro for unlimited key storage',
  keyNamePlaceholder: 'Key name (e.g. OpenAI API Key)',
  servicePlaceholder: 'Service (e.g. GPT-4)',
  keyValuePlaceholder: 'Key value (e.g. sk-proj-...)',
  copied: 'Copied',

  // OpenClaw
  openClawWizard: 'OpenClaw Hub',
  openClawManagement: 'OpenClaw Management',
  openClawSubtitle: 'Manage OpenClaw AI agent framework — install, update, view Skills and MCP configurations',
  openClawDetecting: 'Detecting OpenClaw status...',
  openClawNotInstalled: '(Not installed)',
  currentVersion: 'Current:',
  latestVersion: 'Latest:',
  updateAvailable: 'Update Available',
  envReady: 'Environment ready, one-click install available',
  needNodeJs: 'Node.js required first (nodejs.org)',
  installedStatus: 'Installed',
  notInstalledStatus: 'Not installed',
  installedSkills: 'Installed Skills',
  mcpServers: 'MCP Servers',
  configDirectory: 'Config Directory',
  oneClickInstall: 'Install',
  oneClickUpdate: 'Update',
  openConfigDir: 'Open Config Directory',
  confirmUninstallTitle: '⚠ Confirm complete uninstall of OpenClaw?',
  confirmUninstallDesc: 'This will delete the OpenClaw program, config directory (~/.openclaw), all platform MCP configs, and LaunchAgent service.',
  confirmUninstallBtn: 'Confirm Uninstall',
  operationComplete: 'Operation Complete',
  noInstalledSkills: 'No installed Skills',
  installViaClawHub: 'Install via: clawhub install <skill>',
  noConfiguredMcps: 'No configured MCP servers',
  addInConfigFile: 'Add in OpenClaw config file',
  officialResources: 'Official Resources',
  clawHubStore: 'ClawHub Skill Store',
  officialDocs: 'Official Documentation',
  securityAnnouncements: 'Security Announcements',
  openFileLocation: 'Open file location',
  filesCount: '{count} files',

  // Wizard steps
  systemDetect: 'System Detection',
  envPrepare: 'Environment Setup',
  installation: 'Installation',
  securityHarden: 'Security Hardening',
  channelConnect: 'Channel Integration',
  firstCheck: 'First Check',
  selectChannel: 'Select a communication channel to connect',
  channelDesc: 'To ensure your AI Agent can communicate properly, please select a channel to configure.',
  pasteBotToken: 'Please paste your Bot Token',
  verify: 'Verify',
  connectionSuccess: 'Connection verified successfully',
  skipForNow: 'Skip for now',
  nextStep: 'Next',

  // Notifications
  notifications: 'Notifications',
  unread: 'Unread',
  securityAlerts: 'Security Alerts',
  systemUpdates: 'System Updates',
  handleNow: 'Handle Now',
  viewDetails: 'View Details',
  unreadNotifications: '{count} unread notifications',
  noUnreadNotifications: 'No unread notifications',
  justNow: 'Just now',
  minutesAgo: '{count} min ago',
  hoursAgoTime: '{count} hours ago',
  daysAgo: '{count} days ago',

  // Settings
  settings: 'Settings',
  generalSettings: 'General',
  language: 'Language',
  theme: 'Theme',
  startupBehavior: 'Startup Behavior',
  accountLicense: 'Account & License',
  proTrial: 'Pro Trial',
  daysRemaining: '{days} days remaining',
  licenseKey: 'Activation Code',
  upgradeToPro: 'Upgrade to Pro — fix all in 30s',
  restorePurchase: 'Restore Purchase',
  scanSettings: 'Scan Settings',
  autoScan: 'Auto Scan',
  scanFrequency: 'Scan Frequency',
  scanScope: 'Scan Scope',
  notificationSettings: 'Notification Settings',
  systemNotification: 'System Notifications',
  criticalAlerts: 'Critical Alerts',
  about: 'About',
  checkForUpdates: 'Check Component Updates',

  // Settings sections
  settingsGeneral: 'General Settings',
  autoStart: 'Launch at Startup',
  autoStartDesc: 'Auto-run AgentShield when system starts',
  minimizeToTray: 'Minimize to Tray',
  minimizeToTrayDesc: 'Minimize to system tray on close (close again within 30s to exit)',
  autoCheckUpdates: 'Auto Check Updates',
  autoCheckUpdatesDesc: 'Periodically check and notify about new versions',

  settingsNotifications: 'Notification Settings',
  enableNotifications: 'Enable Notifications',
  enableNotificationsDesc: 'Allow app to send desktop notifications',
  soundEffects: 'Sound Effects',
  soundEffectsDesc: 'Play sounds for notifications',
  criticalAlertsDesc: 'Always notify for security threats and critical events',
  weeklyReport: 'Weekly Report',
  weeklyReportDesc: 'Send weekly system health summary',

  settingsSecurity: 'Security & Privacy',
  activeDefense: 'Real-time Active Defense',
  activeDefenseDesc: 'Continuously watch MCP configs and Skill folders, then block high-risk changes immediately',
  autoQuarantine: 'Auto Quarantine High-risk Items',
  autoQuarantineDesc: 'Only auto-isolate AgentShield-managed items and Skills; external IDE / CLI configs stay read-only and require manual review',
  autoScanDesc: 'Run one background security scan automatically after launch',
  scanFrequencyDesc: 'Frequency for background automatic scans',
  scanFrequencyDaily: 'Daily',
  scanFrequencyWeekly: 'Weekly',
  scanFrequencyManual: 'Manual only',
  protectionWatchingPaths: 'Watching {count} paths now',
  protectionNoIncidents: 'No recent defense incidents',
  protectionRecentIncidents: 'Recent Defense Incidents',
  protectionClearIncidents: 'Clear Incidents',
  protectionLastEvent: 'Last event: {time}',
  twoFactor: 'Two-Factor Authentication',
  twoFactorDesc: 'Require additional verification when logging in',
  biometric: 'Biometric Unlock',
  biometricDesc: 'Use Touch ID or Face ID to unlock',
  autoLock: 'Auto Lock',
  autoLockDesc: 'Automatically lock app after 5 minutes of inactivity',
  viewSecurityLog: 'View Security Log',
  viewSecurityLogDesc: 'View recent security events',
  exportData: 'Export Data',
  exportDataDesc: 'Export all your data',
  dataExported: 'Data exported successfully',
  exportUnavailable: 'Export feature not available yet',

  settingsAppearance: 'Appearance',
  themeLight: 'Light',
  themeDark: 'Dark',
  themeSystem: 'System',
  accentColor: 'Accent Color',
  animationEffects: 'Animations',
  animationEffectsDesc: 'Enable interface transition animations',

  settingsLanguageRegion: 'Language & Region',
  region: 'Region',
  regionChina: 'China',
  regionUS: 'United States',
  regionJapan: 'Japan',
  regionUK: 'United Kingdom',

  settingsStorage: 'Storage Management',
  cacheUsage: 'Cache Usage',
  clearCache: 'Clear Cache',
  clearCacheDesc: 'Delete temporary files to free up space',
  cacheCleared: 'Cache cleared ✓',
  clearScanHistory: 'Clear Scan History',
  clearScanHistoryDesc: 'Delete all scan records',
  scanHistoryCleared: 'Scan history cleared ✓',
  resetAllData: 'Reset All Data',
  resetAllDataDesc: 'Restore app to initial state',
  allSettingsReset: 'All settings have been reset to defaults',

  settingsAI: 'AI Configuration',
  settingsAIDesc: 'Configure AI model for smart install wizard error diagnosis and auto-fix (Pro feature)',
  aiProvider: 'AI Provider',
  aiProviderDeepseek: 'Best value · $0.28/MTok',
  aiProviderGemini: 'Free tier · $0.10/MTok',
  aiProviderOpenai: 'General · $2.50/MTok',
  aiProviderMinimax: 'MiniMax · China-optimized',
  aiProviderCustom: 'OpenAI-compatible endpoint',
  apiEndpoint: 'API Endpoint',
  apiKey: 'API Key',
  apiKeyHint: 'Enter your API key',
  model: 'Model',
  modelRecommend: 'Recommended',
  testConnection: 'Test Connection',
  connectionOk: 'Connection successful!',
  connectionFailed: 'Connection failed',
  testing: 'Testing connection...',

  settingsAPI: 'API Settings',
  viewApiDocs: 'View API Docs',
  viewApiDocsDesc: 'Learn how to use the AgentShield API',

  aboutApp: 'About AgentShield',
  versionInfo: 'Version 1.0.0',
  upToDate: 'Components up to date ✓',
  upToDateDesc: 'No managed component updates are available right now',
  syncRules: 'Sync Security Rules',
  syncRulesDesc: 'Download and apply the latest MCP / Skill risk rules for future scans.',
  syncRulesUpToDate: 'Rule bundle {version} is already up to date',
  syncRulesAvailable: 'Rule bundle {version} is available. Click to sync',
  syncRulesApplied: 'Applied rule bundle version {version}',
  viewChangelog: 'View Changelog',
  viewChangelogDesc: 'See what\'s new in this version',
  privacyPolicy: 'Privacy Policy',
  privacyPolicyDesc: 'Learn how we protect your data',
  termsOfService: 'Terms of Service',
  termsOfServiceDesc: 'View terms and conditions',

  // Upgrade Pro
  upgradePro: 'Upgrade Pro',
  upgradeProSubtitle: 'Fix all risks in 30 seconds. No more manual fixes.',
  proActivated: 'Pro Activated',
  proActivatedDesc: 'Thank you for your support! You now have all premium features.',
  freeFeature1: 'Basic security scan',
  freeFeature2: 'Up to 10 key storage slots',
  freeFeature3: 'Basic notifications',
  proFeature1: 'Full security scan (23 checks)',
  proFeature2: 'One-click auto fix',
  proFeature3: 'Unlimited key storage',
  proFeature4: 'Advanced notifications & weekly report',
  proFeature5: 'Priority support',
  proFeature6: 'Auto rule updates',
  proFeature7: 'Batch operations',
  freeBasicProtection: 'Basic security protection',
  proFullProtection: 'Full protection + advanced features',
  currentPlan: 'Current Plan',
  recommended: 'Recommended',
  perYear: '/year',
  forever: '/forever',
  proActivationMode: '14-day trial + activation code',
  proActivationHint: 'Buy an activation code, then paste it in-app to unlock Pro. Monthly, yearly, and lifetime plans are one-time purchases and do not auto-renew.',
  freeTrial30: '14-day Free Trial',
  trialActive: 'Trial active - {days} days left',
  enterLicenseKey: 'Enter activation code',
  activate: 'Activate',
  activateFailed: 'Activation failed, please check your offline activation code',
  trialFailed: 'Trial activation failed',
  purchaseActivationCode: 'Purchase Activation Code',
  monthlyActivationCode: 'Monthly Activation Code',
  yearlyActivationCode: 'Yearly Activation Code',
  lifetimeActivationCode: 'Lifetime Activation Code',
  validFor30Days: 'Valid for 30 days',
  validFor365Days: 'Valid for 365 days',
  validForever: 'Never expires',
  oneTimePaymentNoSubscription: 'One-time payment, no auto-renewal',
  buyActivationCode: 'Buy now',
  checkoutLinkMissing: 'Checkout link is not configured. Contact support.',
  purchaseOpenedInBrowser: 'Checkout opened in your browser. Paste your AGSH code after payment.',
  openPurchaseFailed: 'Failed to open checkout page',
  pasteCodeAfterPurchase: 'After payment, paste your AGSH activation code below to unlock Pro.',

  // Promo Code
  promoCode: 'Promo Code',
  promoCodePlaceholder: 'Enter promo code',
  promoApply: 'Apply',
  promoChecking: 'Checking…',
  promoInvalid: 'Invalid promo code',
  promoDiscountApplied: '🎉 {pct}% discount applied',

  // Env Config
  envConfig: 'Environment Config',
  detectingEnv: 'Detecting system environment...',
  envDetectFailed: 'Environment detection failed',
  detectedToolsCount: 'Detected {count} AI tools',
  systemEnv: 'System Environment',

  // Onboarding
  onboardingWelcome: 'Welcome to AgentShield',
  onboardingSubtitle: 'Your intelligent AI security guardian. Let\'s get started.',
  onboardingDesc: 'AgentShield is your intelligent AI security guardian that scans MCP plugins, protects API keys, and manages AI tool security to keep your tools safe at all times.',
  permissionTitle: 'System Permissions',
  permissionSubtitle: 'To better protect your device, we need some permissions',
  permFullDisk: 'Full Disk Access',
  permFullDiskDesc: 'Allow scanning and checking config files',
  permAccessibility: 'Accessibility',
  permAccessibilityDesc: 'Allow automation and optimization',
  permAutomation: 'Automation',
  permAutomationDesc: 'Allow controlling other applications',
  permNotification: 'Notifications',
  permNotificationDesc: 'Receive important security alerts and updates',
  featureTitle: 'Core Features',
  featureSubtitle: 'See what AgentShield can do for you',
  featureSmartClean: 'Security Scan',
  featureSmartCleanDesc: 'Automatically scan AI tools for security risks',
  featureSecurity: 'Security Protection',
  featureSecurityDesc: 'Monitor MCP plugins and Skills security in real-time',
  featurePerformance: 'Key Management',
  featurePerformanceDesc: 'Encrypt and manage your API keys to prevent leaks',
  featureKeyVault: 'Key Vault',
  featureKeyVaultDesc: 'Securely manage your API keys',

  // General shared
  detectedTools: 'We detected the following AI tools installed',
  mcpDetected: '{count} MCP plugins detected',
  noMcpDetected: 'No MCP plugins detected',
  notInstalled: 'Not installed',
  previousStep: 'Previous',
  startSecurityCheck: 'Start Security Check',
  allFixed: 'All issues have been fixed!',
  fixedKeyExposure: 'Fixed {count} key exposure(s)',
  fixedPermission: 'Fixed {count} permission issue(s)',
  updatedPlugins: 'Updated {count} outdated plugin(s)',
  viewDetailReport: 'View Detailed Report',
  backToHome: 'Back to Home',
  unlockPro: 'Unlock One-Click Fix',
  proExclusive: 'Pro Exclusive Features',
  freeTrial: '14-day Free Trial',
  pricePerMonth: '$4.99/mo',
  waiting: 'Waiting...',
  allPassed: 'Safe for Now',
  canFix: 'One-click Fix',
  canClean: 'Cleanable',
  canRemove: 'Removable',
  toRun: 'To Run',
  toInstall: 'To Install',

  // Module labels
  moduleSmartGuard: 'Smart Guard',
  moduleSecurityScan: 'Security Scan',
  moduleOpenClaw: 'OpenClaw Hub',
  moduleSkillStore: 'Skill Store',
  moduleInstalled: 'Installed',
  moduleKeyVault: 'Key Vault',
  moduleNotifications: 'Notifications',
  moduleSettings: 'Settings',
  moduleUpgradePro: 'Upgrade Pro',

  // Cards
  cardMcpSecurity: 'Privacy Leak Risk',
  cardKeySecurity: 'Password Exposure Risk',
  cardEnvConfig: 'Permission Risk',
  cardInstalledRisk: 'Malicious Plugin Risk',
  cardSystemProtection: 'Background Activity Risk',

  // Safety levels
  safetySafe: 'Safe',
  safetyCaution: 'Caution',
  safetyDangerous: 'Dangerous',
  safetyBlocked: 'Blocked',
  safetyUnverified: 'Unverified',
  severityCritical: 'Critical Risk',
  severityWarning: 'Warning',
  severityInfo: 'Info',

  // MacOS Frame
  restart: 'Restart',
  lastScanTime: 'Last scan: {time}',

  // Onboarding - Ready step
  readyTitle: 'All Set',
  readyDesc: 'Start using AgentShield to protect your Mac',
  allReady: 'All Ready!',
  readyProtectionDesc: 'Your Mac is now fully protected by AgentShield. Click the button below to start your first scan.',
  startFirstScan: 'Start First Scan',
  maybeLater: 'Maybe Later',
  prevStep: 'Previous',
  continueBtn: 'Continue',
  required: 'Required',

  // Notification Center
  markAllRead: 'Mark All Read',
  clearAll: 'Clear All',
  filterAll: 'All',
  filterUnread: 'Unread',
  noNotifications: 'No notifications',

  // Security Scan - detail
  selectIssueToView: 'Select an issue to view details',

  // Env Config Detail
  detectedAiTools: 'Detected AI Tools',
  noMcp: 'No MCP',
  notDetected: 'Not Detected',
  mcpConfigured: 'MCP Configured',
  unknown: 'Unknown',
  installPath: 'Install Path',
  mcpConfig: 'MCP Config',
  configured: 'Configured',
  notConfigured: 'Not Configured',
  configFileCount: 'Config Files',
  mcpConfigPaths: 'MCP Config File Paths',
  open: 'Open',
  noMcpConfig: 'No MCP Configuration Found',
  noMcpConfigDesc: 'This tool is installed but no MCP config files were detected. If you have configured MCP servers, a non-standard path may be in use.',
  unit: '',
};

const translations: Record<string, Translations> = {
  'zh-CN': zhCN,
  'zh-TW': zhCN,
  'en-US': enUS,
  'ja-JP': zhCN,
};

export let t: Translations = translations[currentLang] || zhCN;

export function setAppLanguage(lang: AppLanguage): void {
  currentLang = normalizeLanguage(lang);
  isEnglishLocale = currentLang.startsWith('en');
  t = translations[currentLang] || zhCN;

  if (typeof document !== 'undefined') {
    document.documentElement.lang = currentLang;
    document.title = t.appTitle;
  }
}
export type TranslationKey = keyof Translations;
