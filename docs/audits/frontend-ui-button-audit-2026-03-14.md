# 前端 UI 按钮与真实功能全量审查（2026-03-14）

> 范围：真实代码入口界面（`src/App.tsx` 的 `renderContent` 模块分发）+ 可达弹窗/全局交互组件 + 共享 UI 组件。
> 口径：每个触发点（`onClick` / `onAction` / `onChange` / `onCheckedChange` / `onValueChange`）逐条检查。

## 汇总

- 触发点总数：**179**
- 真实后端：**41**
- 真实外部能力（系统/浏览器/剪贴板/外链）：**3**
- 本地 UI / 导航：**135**
- 前端命令缺失后端注册：**0**（已对账）

## 代码入口索引（依据 App.tsx 真实分发）

> 来源：`src/App.tsx:663-713` 的 `switch (currentModule)`；只按真实代码可达界面索引，不按文档倒推。

| 代码模块（`currentModule`） | 入口组件 | 扩展可达组件 | 触发点数 | 结果 |
|---|---|---|---:|---|
| `smartGuard` | `src/components/pages/smart-guard-home.tsx` | - | 7 | ✅ 全量核对 |
| `securityScan` | `src/components/pages/security-scan.tsx` | `SecurityScanDetail`（同文件） | 18 | ✅ 全量核对 |
| `skillStore` | `src/components/pages/skill-store.tsx` | `src/components/pages/install-dialog.tsx`（由安装动作弹出） | 9 | ✅ 全量核对 |
| `installed` | `src/components/pages/installed-management.tsx` | `src/components/pages/env-config-detail.tsx`（管理详情） | 35 | ✅ 全量核对 |
| `keyVault` | `src/components/pages/key-vault.tsx` | - | 8 | ✅ 全量核对 |
| `openClaw` | `src/components/pages/openclaw-wizard.tsx` | - | 15 | ✅ 全量核对 |
| `notifications` | `src/components/pages/notification-center.tsx` | - | 6 | ✅ 全量核对 |
| `settings` | `src/components/pages/settings-page.tsx` | - | 37 | ✅ 全量核对 |
| `upgradePro` | `src/components/pages/upgrade-pro.tsx` | - | 6 | ✅ 全量核对 |

> 额外可见交互（非 `currentModule` 分发项）也已核对：`app-sidebar`、`runtime-approval-modal`、`manual-mode-gate-dialog`、`App.tsx`、共享 UI 组件。  
> `onboarding-wizard` 目前在代码中存在但不在 `App.tsx` 主分发路径中（仍已逐条核对）。

## 审查明细

### src/components/pages/env-config-detail.tsx

| # | 触发点 | 事件 | 处理表达式 | 真实实现映射 | 结果 |
|---|---|---|---|---|---|
| 1 | `src/components/pages/env-config-detail.tsx:124` | `onClick` | `onBack` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 2 | `src/components/pages/env-config-detail.tsx:151` | `onClick` | `onBack` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 3 | `src/components/pages/env-config-detail.tsx:208` | `onClick` | `() => setSelectedTool(tool)` | `setSelectedTool` | ✅ 已确认（本地UI/导航） |
| 4 | `src/components/pages/env-config-detail.tsx:243` | `onClick` | `() => setSelectedTool(tool)` | `setSelectedTool` | ✅ 已确认（本地UI/导航） |
| 5 | `src/components/pages/env-config-detail.tsx:394` | `onClick` | `() => { invoke('reveal_path_in_finder', { path: p }) .catch(err => console.error('Failed to reveal path:', err)); }` | `reveal_path_in_finder` → `src-tauri/src/commands/scan.rs:4082` | ✅ 已确认（真实后端） |
| 6 | `src/components/pages/env-config-detail.tsx:417` | `onClick` | `() => { invoke('reveal_path_in_finder', { path: tool.mcp_config_path }) .catch(err => console.error('Failed to reveal...` | `reveal_path_in_finder` → `src-tauri/src/commands/scan.rs:4082` | ✅ 已确认（真实后端） |
| 7 | `src/components/pages/env-config-detail.tsx:438` | `onClick` | `() => { invoke('reveal_path_in_finder', { path: tool.path }) .catch(err => console.error('Failed to reveal path:', er...` | `reveal_path_in_finder` → `src-tauri/src/commands/scan.rs:4082` | ✅ 已确认（真实后端） |
| 8 | `src/components/pages/env-config-detail.tsx:545` | `onClick` | `() => { invoke('reveal_path_in_finder', { path: item.config_path }) .catch((err) => console.error('Failed to reveal p...` | `reveal_path_in_finder` → `src-tauri/src/commands/scan.rs:4082` | ✅ 已确认（真实后端） |

### src/components/pages/install-dialog.tsx

| # | 触发点 | 事件 | 处理表达式 | 真实实现映射 | 结果 |
|---|---|---|---|---|---|
| 1 | `src/components/pages/install-dialog.tsx:223` | `onClick` | `onClose` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 2 | `src/components/pages/install-dialog.tsx:237` | `onClick` | `onClose` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 3 | `src/components/pages/install-dialog.tsx:320` | `onChange` | `() => togglePlatform(platform)` | `setSelectedPlatforms` | ✅ 已确认（本地UI/导航） |
| 4 | `src/components/pages/install-dialog.tsx:393` | `onClick` | `onClose` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 5 | `src/components/pages/install-dialog.tsx:399` | `onClick` | `handleConfirm` | `install_store_item` → `src-tauri/src/commands/store.rs:1625`<br/>`request_runtime_guard_action_approval` → `src-tauri/src/commands/runtime_guard.rs:3715`<br/>`resolve_install_target_paths` → `src-tauri/src/commands/store.rs:859` | ✅ 已确认（真实后端） |
| 6 | `src/components/pages/install-dialog.tsx:463` | `onClick` | `onChange` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |

### src/components/pages/installed-management.tsx

| # | 触发点 | 事件 | 处理表达式 | 真实实现映射 | 结果 |
|---|---|---|---|---|---|
| 1 | `src/components/pages/installed-management.tsx:846` | `onClick` | `() => setShowRiskOnlyHosts((current) => !current)` | `setShowRiskOnlyHosts` | ✅ 已确认（本地UI/导航） |
| 2 | `src/components/pages/installed-management.tsx:869` | `onClick` | `() => { setSelectedHostId(host.id); setSelectedItem(null); }` | `setSelectedHostId`<br/>`setSelectedItem` | ✅ 已确认（本地UI/导航） |
| 3 | `src/components/pages/installed-management.tsx:896` | `onClick` | `() => { setSelectedHostId(host.id); setSelectedItem(null); }` | `setSelectedHostId`<br/>`setSelectedItem` | ✅ 已确认（本地UI/导航） |
| 4 | `src/components/pages/installed-management.tsx:977` | `onClick` | `async () => { if (!oneClickOpsUnlocked) { setUpdateStatus(t.upgradeToPro); return; } if (!selectedHost) return; setUp...` | `batch_update_items` → `src-tauri/src/commands/store.rs:2205`<br/>`request_runtime_guard_action_approval` → `src-tauri/src/commands/runtime_guard.rs:3715` | ✅ 已确认（真实后端） |
| 5 | `src/components/pages/installed-management.tsx:1045` | `onClick` | `async () => { if (!selectedHost) return; setCheckingUpdates(true); setUpdateStatus(null); try { const results = await...` | `check_installed_updates` → `src-tauri/src/commands/store.rs:1930` | ✅ 已确认（真实后端） |
| 6 | `src/components/pages/installed-management.tsx:1073` | `onClick` | `async () => { if (!oneClickOpsUnlocked) { setUpdateStatus(t.upgradeToPro); return; } if (!selectedHost) return; const...` | `request_runtime_guard_action_approval` → `src-tauri/src/commands/runtime_guard.rs:3715`<br/>`uninstall_item` → `src-tauri/src/commands/store.rs:1808` | ✅ 已确认（真实后端） |
| 7 | `src/components/pages/installed-management.tsx:1135` | `onClick` | `handleSyncGuard` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 8 | `src/components/pages/installed-management.tsx:1158` | `onClick` | `onClick` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 9 | `src/components/pages/installed-management.tsx:1192` | `onClick` | `onClick` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 10 | `src/components/pages/installed-management.tsx:1226` | `onClick` | `onClick` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 11 | `src/components/pages/installed-management.tsx:1270` | `onClick` | `onClick` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 12 | `src/components/pages/installed-management.tsx:1443` | `onClick` | `() => { if (hostComponents[0]) { onSelectItem(hostComponents[0]); } }` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 13 | `src/components/pages/installed-management.tsx:1454` | `onClick` | `() => { if (hostComponents[0]) { onSelectItem(hostComponents[0]); } }` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 14 | `src/components/pages/installed-management.tsx:1468` | `onClick` | `() => onSelectItem(comp)` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 15 | `src/components/pages/installed-management.tsx:1568` | `onClick` | `onBackToHost` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 16 | `src/components/pages/installed-management.tsx:1640` | `onClick` | `() => onTrustChange('trusted')` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 17 | `src/components/pages/installed-management.tsx:1647` | `onClick` | `() => onTrustChange('restricted')` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 18 | `src/components/pages/installed-management.tsx:1654` | `onClick` | `() => onTrustChange('blocked')` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 19 | `src/components/pages/installed-management.tsx:1668` | `onChange` | `(event) => setAllowedDomainsInput(event.target.value)` | `setAllowedDomainsInput` | ✅ 已确认（本地UI/导航） |
| 20 | `src/components/pages/installed-management.tsx:1673` | `onClick` | `() => onNetworkPolicySave( allowedDomainsInput .split(',') .map((domain) => domain.trim()) .filter(Boolean) )` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 21 | `src/components/pages/installed-management.tsx:1690` | `onClick` | `onGuardedLaunch` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 22 | `src/components/pages/installed-management.tsx:1738` | `onClick` | `() => onTerminateSession(session.session_id)` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 23 | `src/components/pages/installed-management.tsx:1758` | `onClick` | `onClearEvents` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 24 | `src/components/pages/installed-management.tsx:1801` | `onClick` | `() => { if (isRemoteSource) { void openExternalUrl(item.sourceUrl!); return; } void invoke('reveal_path_in_finder', {...` | `reveal_path_in_finder` → `src-tauri/src/commands/scan.rs:4082` | ✅ 已确认（真实后端） |
| 25 | `src/components/pages/installed-management.tsx:1824` | `onClick` | `onCheckUpdate` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 26 | `src/components/pages/installed-management.tsx:1838` | `onClick` | `onApplyUpdate` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 27 | `src/components/pages/installed-management.tsx:1856` | `onClick` | `handleUninstall` | `setConfirmUninstall`<br/>`setTimeout` | ✅ 已确认（本地UI/导航） |

### src/components/pages/key-vault.tsx

| # | 触发点 | 事件 | 处理表达式 | 真实实现映射 | 结果 |
|---|---|---|---|---|---|
| 1 | `src/components/pages/key-vault.tsx:242` | `onClick` | `() => setShowAddForm(prev => !prev)` | `setShowAddForm` | ✅ 已确认（本地UI/导航） |
| 2 | `src/components/pages/key-vault.tsx:315` | `onClick` | `() => handleImportKey(exposed.id)` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 3 | `src/components/pages/key-vault.tsx:386` | `onChange` | `e => setName(e.target.value)` | `setName` | ✅ 已确认（本地UI/导航） |
| 4 | `src/components/pages/key-vault.tsx:393` | `onChange` | `e => setService(e.target.value)` | `setService` | ✅ 已确认（本地UI/导航） |
| 5 | `src/components/pages/key-vault.tsx:400` | `onChange` | `e => setValue(e.target.value)` | `setValue` | ✅ 已确认（本地UI/导航） |
| 6 | `src/components/pages/key-vault.tsx:419` | `onClick` | `onCancel` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 7 | `src/components/pages/key-vault.tsx:477` | `onClick` | `handleCopy` | `setCopied`<br/>`setTimeout` | ✅ 已确认（本地UI/导航） |
| 8 | `src/components/pages/key-vault.tsx:488` | `onClick` | `onDelete` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |

### src/components/pages/notification-center.tsx

| # | 触发点 | 事件 | 处理表达式 | 真实实现映射 | 结果 |
|---|---|---|---|---|---|
| 1 | `src/components/pages/notification-center.tsx:99` | `onClick` | `markAllAsRead` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 2 | `src/components/pages/notification-center.tsx:108` | `onClick` | `clearAll` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 3 | `src/components/pages/notification-center.tsx:120` | `onClick` | `() => setFilter("all")` | `setFilter` | ✅ 已确认（本地UI/导航） |
| 4 | `src/components/pages/notification-center.tsx:131` | `onClick` | `() => setFilter("unread")` | `setFilter` | ✅ 已确认（本地UI/导航） |
| 5 | `src/components/pages/notification-center.tsx:174` | `onClick` | `() => markAsRead(notification.id)` | `mark_notification_read` → `src-tauri/src/commands/notification.rs:199` | ✅ 已确认（真实后端） |
| 6 | `src/components/pages/notification-center.tsx:203` | `onClick` | `(e) => { e.stopPropagation(); removeNotification(notification.id); }` | `delete_notification` → `src-tauri/src/commands/notification.rs:231` | ✅ 已确认（真实后端） |

### src/components/pages/onboarding-wizard.tsx

| # | 触发点 | 事件 | 处理表达式 | 真实实现映射 | 结果 |
|---|---|---|---|---|---|
| 1 | `src/components/pages/onboarding-wizard.tsx:197` | `onAction` | `() => handleOpenPermissionSettings('fullDiskAccess')` | `open_macos_permission_settings` → `src-tauri/src/commands/runtime_settings.rs:140` | ✅ 已确认（真实后端） |
| 2 | `src/components/pages/onboarding-wizard.tsx:208` | `onAction` | `() => handleOpenPermissionSettings('accessibility')` | `open_macos_permission_settings` → `src-tauri/src/commands/runtime_settings.rs:140` | ✅ 已确认（真实后端） |
| 3 | `src/components/pages/onboarding-wizard.tsx:218` | `onAction` | `() => handleOpenPermissionSettings('automation')` | `open_macos_permission_settings` → `src-tauri/src/commands/runtime_settings.rs:140` | ✅ 已确认（真实后端） |
| 4 | `src/components/pages/onboarding-wizard.tsx:243` | `onAction` | `notificationGranted ? refreshNotificationStatus : handleNotificationPermission` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 5 | `src/components/pages/onboarding-wizard.tsx:334` | `onClick` | `onComplete` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 6 | `src/components/pages/onboarding-wizard.tsx:340` | `onClick` | `onComplete` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 7 | `src/components/pages/onboarding-wizard.tsx:386` | `onClick` | `() => index < currentStep && setCurrentStep(index)` | `setCurrentStep` | ✅ 已确认（本地UI/导航） |
| 8 | `src/components/pages/onboarding-wizard.tsx:419` | `onClick` | `handleBack` | `setCurrentStep` | ✅ 已确认（本地UI/导航） |
| 9 | `src/components/pages/onboarding-wizard.tsx:432` | `onClick` | `handleNext` | `onComplete`<br/>`setCurrentStep` | ✅ 已确认（本地UI/导航） |
| 10 | `src/components/pages/onboarding-wizard.tsx:512` | `onClick` | `onAction` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |

### src/components/pages/openclaw-wizard.tsx

| # | 触发点 | 事件 | 处理表达式 | 真实实现映射 | 结果 |
|---|---|---|---|---|---|
| 1 | `src/components/pages/openclaw-wizard.tsx:1140` | `onClick` | `() => setCurrentModule('upgradePro')` | `setCurrentModule` | ✅ 已确认（本地UI/导航） |
| 2 | `src/components/pages/openclaw-wizard.tsx:1159` | `onClick` | `() => setCurrentModule('upgradePro')` | `setCurrentModule` | ✅ 已确认（本地UI/导航） |
| 3 | `src/components/pages/openclaw-wizard.tsx:1177` | `onClick` | `() => { void handleAction('install'); }` | `install_openclaw_cmd` → `src-tauri/src/commands/install.rs:414`<br/>`request_runtime_guard_action_approval` → `src-tauri/src/commands/runtime_guard.rs:3715`<br/>`uninstall_openclaw_cmd` → `src-tauri/src/commands/install.rs:654`<br/>`update_openclaw_cmd` → `src-tauri/src/commands/install.rs:803` | ✅ 已确认（真实后端） |
| 4 | `src/components/pages/openclaw-wizard.tsx:1191` | `onClick` | `() => { void handleAction('update'); }` | `install_openclaw_cmd` → `src-tauri/src/commands/install.rs:414`<br/>`request_runtime_guard_action_approval` → `src-tauri/src/commands/runtime_guard.rs:3715`<br/>`uninstall_openclaw_cmd` → `src-tauri/src/commands/install.rs:654`<br/>`update_openclaw_cmd` → `src-tauri/src/commands/install.rs:803` | ✅ 已确认（真实后端） |
| 5 | `src/components/pages/openclaw-wizard.tsx:1202` | `onClick` | `() => { void handleAction('uninstall'); }` | `install_openclaw_cmd` → `src-tauri/src/commands/install.rs:414`<br/>`request_runtime_guard_action_approval` → `src-tauri/src/commands/runtime_guard.rs:3715`<br/>`uninstall_openclaw_cmd` → `src-tauri/src/commands/install.rs:654`<br/>`update_openclaw_cmd` → `src-tauri/src/commands/install.rs:803` | ✅ 已确认（真实后端） |
| 6 | `src/components/pages/openclaw-wizard.tsx:1212` | `onClick` | `() => handleRevealPath(status.config_dir!)` | `reveal_path_in_finder` → `src-tauri/src/commands/scan.rs:4082` | ✅ 已确认（真实后端） |
| 7 | `src/components/pages/openclaw-wizard.tsx:1244` | `onClick` | `() => { void handleAction('uninstall'); }` | `install_openclaw_cmd` → `src-tauri/src/commands/install.rs:414`<br/>`request_runtime_guard_action_approval` → `src-tauri/src/commands/runtime_guard.rs:3715`<br/>`uninstall_openclaw_cmd` → `src-tauri/src/commands/install.rs:654`<br/>`update_openclaw_cmd` → `src-tauri/src/commands/install.rs:803` | ✅ 已确认（真实后端） |
| 8 | `src/components/pages/openclaw-wizard.tsx:1252` | `onClick` | `() => setShowUninstallConfirm(false)` | `setShowUninstallConfirm` | ✅ 已确认（本地UI/导航） |
| 9 | `src/components/pages/openclaw-wizard.tsx:1314` | `onClick` | `() => { resetSetupState(); setActionMessage(null); setActionError(null); }` | `setActionError`<br/>`setActionMessage`<br/>`setAiDiagnosis` | ✅ 已确认（本地UI/导航） |
| 10 | `src/components/pages/openclaw-wizard.tsx:1337` | `onClick` | `() => setSelectedChannelId(channel.id)` | `setSelectedChannelId` | ✅ 已确认（本地UI/导航） |
| 11 | `src/components/pages/openclaw-wizard.tsx:1353` | `onChange` | `(event) => setChannelToken(event.target.value)` | `setChannelToken` | ✅ 已确认（本地UI/导航） |
| 12 | `src/components/pages/openclaw-wizard.tsx:1364` | `onClick` | `() => { void openExternalUrl(selectedChannel.docsUrl); }` | `openExternalUrl` | ✅ 已确认（真实外部能力） |
| 13 | `src/components/pages/openclaw-wizard.tsx:1379` | `onClick` | `() => { void runSmartSetup(); }` | `ai_diagnose_error` → `src-tauri/src/commands/ai_orchestrator.rs:333`<br/>`execute_install_step` → `src-tauri/src/commands/ai_orchestrator.rs:407`<br/>`request_runtime_guard_action_approval` → `src-tauri/src/commands/runtime_guard.rs:3715` | ✅ 已确认（真实后端） |
| 14 | `src/components/pages/openclaw-wizard.tsx:1405` | `onClick` | `() => setCurrentModule('upgradePro')` | `setCurrentModule` | ✅ 已确认（本地UI/导航） |
| 15 | `src/components/pages/openclaw-wizard.tsx:1623` | `onClick` | `onClick` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |

### src/components/pages/security-scan.tsx

| # | 触发点 | 事件 | 处理表达式 | 真实实现映射 | 结果 |
|---|---|---|---|---|---|
| 1 | `src/components/pages/security-scan.tsx:731` | `onClick` | `handleBack` | `scan_cancel` → `src-tauri/src/commands/scan.rs:4169` | ✅ 已确认（真实后端） |
| 2 | `src/components/pages/security-scan.tsx:755` | `onClick` | `handleBack` | `scan_cancel` → `src-tauri/src/commands/scan.rs:4169` | ✅ 已确认（真实后端） |
| 3 | `src/components/pages/security-scan.tsx:762` | `onClick` | `() => setScanAttempt((value) => value + 1)` | `setScanAttempt` | ✅ 已确认（本地UI/导航） |
| 4 | `src/components/pages/security-scan.tsx:787` | `onChange` | `setSortBy` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 5 | `src/components/pages/security-scan.tsx:799` | `onClick` | `() => setSeverityFilter('all')` | `setSeverityFilter` | ✅ 已确认（本地UI/导航） |
| 6 | `src/components/pages/security-scan.tsx:806` | `onClick` | `() => setSeverityFilter('critical')` | `setSeverityFilter` | ✅ 已确认（本地UI/导航） |
| 7 | `src/components/pages/security-scan.tsx:813` | `onClick` | `() => setSeverityFilter('warning')` | `setSeverityFilter` | ✅ 已确认（本地UI/导航） |
| 8 | `src/components/pages/security-scan.tsx:820` | `onClick` | `() => setSeverityFilter('info')` | `setSeverityFilter` | ✅ 已确认（本地UI/导航） |
| 9 | `src/components/pages/security-scan.tsx:830` | `onClick` | `() => setPlatformFilter('all')` | `setPlatformFilter` | ✅ 已确认（本地UI/导航） |
| 10 | `src/components/pages/security-scan.tsx:838` | `onClick` | `() => setPlatformFilter(platform)` | `setPlatformFilter` | ✅ 已确认（本地UI/导航） |
| 11 | `src/components/pages/security-scan.tsx:871` | `onClick` | `() => setSelectedIssue(issue)` | `setSelectedIssue` | ✅ 已确认（本地UI/导航） |
| 12 | `src/components/pages/security-scan.tsx:922` | `onClick` | `() => setFixAllMessage( tr( '已切换为手动模式：请逐项点击问题并手动处理。', 'Switched to manual mode: review and handle issues one by one.'...` | `setFixAllMessage` | ✅ 已确认（本地UI/导航） |
| 13 | `src/components/pages/security-scan.tsx:936` | `onClick` | `handleFixAll` | `fix_all` → `src-tauri/src/commands/scan.rs:4259`<br/>`request_runtime_guard_action_approval` → `src-tauri/src/commands/runtime_guard.rs:3715` | ✅ 已确认（真实后端） |
| 14 | `src/components/pages/security-scan.tsx:970` | `onClick` | `onClick` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 15 | `src/components/pages/security-scan.tsx:1009` | `onClick` | `onClick` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 16 | `src/components/pages/security-scan.tsx:1109` | `onClick` | `() => { invoke('reveal_path_in_finder', { path: issue.filePath }) .catch(err => console.error('Failed to reveal path:...` | `reveal_path_in_finder` → `src-tauri/src/commands/scan.rs:4082` | ✅ 已确认（真实后端） |
| 17 | `src/components/pages/security-scan.tsx:1161` | `onClick` | `handleFix` | `fix_issue` → `src-tauri/src/commands/scan.rs:4201` | ✅ 已确认（真实后端） |
| 18 | `src/components/pages/security-scan.tsx:1179` | `onClick` | `() => { invoke('reveal_path_in_finder', { path: issue.filePath }) .catch(err => console.error('Failed to reveal path:...` | `reveal_path_in_finder` → `src-tauri/src/commands/scan.rs:4082` | ✅ 已确认（真实后端） |

### src/components/pages/settings-page.tsx

| # | 触发点 | 事件 | 处理表达式 | 真实实现映射 | 结果 |
|---|---|---|---|---|---|
| 1 | `src/components/pages/settings-page.tsx:686` | `onChange` | `handleAutoStartToggle` | `setAutostartEnabled`<br/>`setBusyKey`<br/>`setFeedback` | ✅ 已确认（本地UI/导航） |
| 2 | `src/components/pages/settings-page.tsx:693` | `onChange` | `handleMinimizeToTrayToggle` | `setBusyKey`<br/>`setFeedback`<br/>`setFeedbackMessage` | ✅ 已确认（本地UI/导航） |
| 3 | `src/components/pages/settings-page.tsx:700` | `onChange` | `handleAutoCheckUpdatesToggle` | `check_installed_updates` → `src-tauri/src/commands/store.rs:1930` | ✅ 已确认（真实后端） |
| 4 | `src/components/pages/settings-page.tsx:716` | `onChange` | `handleNotificationsToggle` | `setBusyKey`<br/>`setFeedback`<br/>`setFeedbackMessage` | ✅ 已确认（本地UI/导航） |
| 5 | `src/components/pages/settings-page.tsx:723` | `onChange` | `handleSoundToggle` | `setBusyKey`<br/>`setFeedback`<br/>`setFeedbackMessage` | ✅ 已确认（本地UI/导航） |
| 6 | `src/components/pages/settings-page.tsx:730` | `onChange` | `handleCriticalAlertsToggle` | `setBusyKey`<br/>`setFeedback`<br/>`setFeedbackMessage` | ✅ 已确认（本地UI/导航） |
| 7 | `src/components/pages/settings-page.tsx:737` | `onChange` | `handleWeeklyReportToggle` | `create_notification` → `src-tauri/src/commands/notification.rs:220` | ✅ 已确认（真实后端） |
| 8 | `src/components/pages/settings-page.tsx:753` | `onChange` | `handleRealTimeProtectionToggle` | `configure_protection` → `src-tauri/src/commands/protection.rs:1016` | ✅ 已确认（真实后端） |
| 9 | `src/components/pages/settings-page.tsx:760` | `onChange` | `handleAutoQuarantineToggle` | `configure_protection` → `src-tauri/src/commands/protection.rs:1016` | ✅ 已确认（真实后端） |
| 10 | `src/components/pages/settings-page.tsx:767` | `onChange` | `handleSafeModeToggle` | `setBusyKey`<br/>`setFeedback`<br/>`setFeedbackMessage` | ✅ 已确认（本地UI/导航） |
| 11 | `src/components/pages/settings-page.tsx:774` | `onChange` | `handleAutoScanToggle` | `setBusyKey`<br/>`setFeedback`<br/>`setFeedbackMessage` | ✅ 已确认（本地UI/导航） |
| 12 | `src/components/pages/settings-page.tsx:781` | `onChange` | `(event) => handleScanFrequencyChange(event.target.value as 'daily' | 'weekly' | 'manual')` | `setBusyKey`<br/>`setFeedback`<br/>`setFeedbackMessage` | ✅ 已确认（本地UI/导航） |
| 13 | `src/components/pages/settings-page.tsx:826` | `onClick` | `() => { setSemanticAccessKey(''); setSemanticDialogOpen(true); }` | `setSemanticAccessKey`<br/>`setSemanticDialogOpen` | ✅ 已确认（本地UI/导航） |
| 14 | `src/components/pages/settings-page.tsx:837` | `onClick` | `handleClearSemanticAccessKey` | `clear_semantic_guard_key` → `src-tauri/src/commands/semantic_guard.rs:400`<br/>`get_semantic_guard_status` → `src-tauri/src/commands/semantic_guard.rs:365` | ✅ 已确认（真实后端） |
| 15 | `src/components/pages/settings-page.tsx:848` | `onClick` | `() => navigateToUpgrade('semantic_guard_locked')` | `useAppStore.getState().setCurrentModule` | ✅ 已确认（本地UI/导航） |
| 16 | `src/components/pages/settings-page.tsx:919` | `onClick` | `handleClearStartupTimeline` | `setBusyKey`<br/>`setFeedback`<br/>`setFeedbackMessage` | ✅ 已确认（本地UI/导航） |
| 17 | `src/components/pages/settings-page.tsx:973` | `onClick` | `handleClearProtectionIncidents` | `clear_protection_incidents` → `src-tauri/src/commands/protection.rs:1056`<br/>`get_protection_status` → `src-tauri/src/commands/protection.rs:1008` | ✅ 已确认（真实后端） |
| 18 | `src/components/pages/settings-page.tsx:1012` | `onClick` | `() => useAppStore.getState().setCurrentModule('notifications')` | `useAppStore.getState().setCurrentModule` | ✅ 已确认（本地UI/导航） |
| 19 | `src/components/pages/settings-page.tsx:1048` | `onChange` | `(event) => settings.setAiProvider(event.target.value as 'deepseek' | 'gemini' | 'openai' | 'custom')` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 20 | `src/components/pages/settings-page.tsx:1064` | `onChange` | `(event) => settings.setAiBaseUrl(event.target.value)` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 21 | `src/components/pages/settings-page.tsx:1076` | `onChange` | `(event) => settings.setAiModel(event.target.value)` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 22 | `src/components/pages/settings-page.tsx:1088` | `onChange` | `(event) => settings.setAiApiKey(event.target.value)` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 23 | `src/components/pages/settings-page.tsx:1098` | `onClick` | `handleTestAiConnection` | `test_ai_connection` → `src-tauri/src/commands/ai_orchestrator.rs:284` | ✅ 已确认（真实后端） |
| 24 | `src/components/pages/settings-page.tsx:1114` | `onClick` | `() => navigateToUpgrade('ai_diagnosis_locked')` | `useAppStore.getState().setCurrentModule` | ✅ 已确认（本地UI/导航） |
| 25 | `src/components/pages/settings-page.tsx:1134` | `onChange` | `(event) => handleLanguageChange(event.target.value as 'zh-CN' | 'en-US')` | `setBusyKey`<br/>`setFeedback`<br/>`setFeedbackMessage` | ✅ 已确认（本地UI/导航） |
| 26 | `src/components/pages/settings-page.tsx:1164` | `onClick` | `handleCheckForUpdates` | `check_installed_updates` → `src-tauri/src/commands/store.rs:1930` | ✅ 已确认（真实后端） |
| 27 | `src/components/pages/settings-page.tsx:1180` | `onClick` | `() => navigateToUpgrade('rule_updates_locked')` | `useAppStore.getState().setCurrentModule` | ✅ 已确认（本地UI/导航） |
| 28 | `src/components/pages/settings-page.tsx:1191` | `onClick` | `handleSyncRules` | `download_and_apply_rules` → `src-tauri/src/commands/notification.rs:270` | ✅ 已确认（真实后端） |
| 29 | `src/components/pages/settings-page.tsx:1196` | `onClick` | `() => setDialogKey('privacy')` | `setDialogKey` | ✅ 已确认（本地UI/导航） |
| 30 | `src/components/pages/settings-page.tsx:1201` | `onClick` | `() => setDialogKey('terms')` | `setDialogKey` | ✅ 已确认（本地UI/导航） |
| 31 | `src/components/pages/settings-page.tsx:1228` | `onClick` | `() => setActiveSection(section.id)` | `setActiveSection` | ✅ 已确认（本地UI/导航） |
| 32 | `src/components/pages/settings-page.tsx:1277` | `onChange` | `(event) => setSemanticAccessKey(event.target.value)` | `setSemanticAccessKey` | ✅ 已确认（本地UI/导航） |
| 33 | `src/components/pages/settings-page.tsx:1289` | `onClick` | `() => setSemanticDialogOpen(false)` | `setSemanticDialogOpen` | ✅ 已确认（本地UI/导航） |
| 34 | `src/components/pages/settings-page.tsx:1295` | `onClick` | `handleSaveSemanticAccessKey` | `configure_semantic_guard` → `src-tauri/src/commands/semantic_guard.rs:382` | ✅ 已确认（真实后端） |
| 35 | `src/components/pages/settings-page.tsx:1375` | `onClick` | `() => useAppStore.getState().setCurrentModule('installed')` | `useAppStore.getState().setCurrentModule` | ✅ 已确认（本地UI/导航） |
| 36 | `src/components/pages/settings-page.tsx:1421` | `onCheckedChange` | `onChange` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 37 | `src/components/pages/settings-page.tsx:1441` | `onClick` | `onClick` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |

### src/components/pages/skill-store.tsx

| # | 触发点 | 事件 | 处理表达式 | 真实实现映射 | 结果 |
|---|---|---|---|---|---|
| 1 | `src/components/pages/skill-store.tsx:150` | `onClick` | `() => loadCatalog(true)` | `get_store_catalog` → `src-tauri/src/commands/store.rs:1543`<br/>`refresh_catalog` → `src-tauri/src/commands/store.rs:1568` | ✅ 已确认（真实后端） |
| 2 | `src/components/pages/skill-store.tsx:166` | `onChange` | `(e) => setSearchQuery(e.target.value)` | `setSearchQuery` | ✅ 已确认（本地UI/导航） |
| 3 | `src/components/pages/skill-store.tsx:362` | `onClick` | `() => void handleAction()` | `openExternalUrl` | ✅ 已确认（真实外部能力） |

### src/components/pages/smart-guard-home.tsx

| # | 触发点 | 事件 | 处理表达式 | 真实实现映射 | 结果 |
|---|---|---|---|---|---|
| 1 | `src/components/pages/smart-guard-home.tsx:577` | `onClick` | `() => useAppStore.getState().setCurrentModule('upgradePro')` | `useAppStore.getState().setCurrentModule` | ✅ 已确认（本地UI/导航） |
| 2 | `src/components/pages/smart-guard-home.tsx:638` | `onClick` | `onStartScan` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 3 | `src/components/pages/smart-guard-home.tsx:801` | `onClick` | `onStop` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 4 | `src/components/pages/smart-guard-home.tsx:830` | `onClick` | `onRetry` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 5 | `src/components/pages/smart-guard-home.tsx:945` | `onClick` | `onManualFix` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 6 | `src/components/pages/smart-guard-home.tsx:952` | `onClick` | `onFixAll` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 7 | `src/components/pages/smart-guard-home.tsx:969` | `onClick` | `onStartScan` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |

### src/components/pages/upgrade-pro.tsx

| # | 触发点 | 事件 | 处理表达式 | 真实实现映射 | 结果 |
|---|---|---|---|---|---|
| 1 | `src/components/pages/upgrade-pro.tsx:195` | `onClick` | `onBack` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 2 | `src/components/pages/upgrade-pro.tsx:321` | `onClick` | `() => void handlePurchase(option)` | `openExternalUrl` | ✅ 已确认（真实外部能力） |
| 3 | `src/components/pages/upgrade-pro.tsx:345` | `onClick` | `handleStartTrial` | `start_trial` → `src-tauri/src/commands/license.rs:348` | ✅ 已确认（真实后端） |
| 4 | `src/components/pages/upgrade-pro.tsx:367` | `onClick` | `() => setShowKeyInput(!showKeyInput)` | `setShowKeyInput` | ✅ 已确认（本地UI/导航） |
| 5 | `src/components/pages/upgrade-pro.tsx:385` | `onChange` | `(e) => setLicenseKey(e.target.value)` | `setLicenseKey` | ✅ 已确认（本地UI/导航） |
| 6 | `src/components/pages/upgrade-pro.tsx:390` | `onClick` | `handleActivate` | `activate_license` → `src-tauri/src/commands/license.rs:302` | ✅ 已确认（真实后端） |

### src/components/app-sidebar.tsx

| # | 触发点 | 事件 | 处理表达式 | 真实实现映射 | 结果 |
|---|---|---|---|---|---|
| 1 | `src/components/app-sidebar.tsx:126` | `onClick` | `() => setCurrentModule(moduleId)` | `setCurrentModule` | ✅ 已确认（本地UI/导航） |
| 2 | `src/components/app-sidebar.tsx:164` | `onClick` | `onClick` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 3 | `src/components/app-sidebar.tsx:237` | `onClick` | `() => setLanguage('zh-CN')` | `setLanguage` | ✅ 已确认（本地UI/导航） |
| 4 | `src/components/app-sidebar.tsx:248` | `onClick` | `() => setLanguage('en-US')` | `setLanguage` | ✅ 已确认（本地UI/导航） |

### src/components/runtime-approval-modal.tsx

| # | 触发点 | 事件 | 处理表达式 | 真实实现映射 | 结果 |
|---|---|---|---|---|---|
| 1 | `src/components/runtime-approval-modal.tsx:325` | `onClick` | `() => { trackRiskCopyAction( 'runtime_approval', detailsOpen ? 'collapse_details' : 'expand_details', request ? { req...` | `setDetailsOpen` | ✅ 已确认（本地UI/导航） |
| 2 | `src/components/runtime-approval-modal.tsx:363` | `onClick` | `() => { trackRiskCopyAction('runtime_approval', 'deny', { request_id: request.id, action_kind: request.action_kind, p...` | 回调透传到 `src/App.tsx` 的 `handleApprovalDecision` → `resolve_runtime_guard_approval_request` | ✅ 已确认（真实后端） |
| 3 | `src/components/runtime-approval-modal.tsx:384` | `onClick` | `() => { trackRiskCopyAction('runtime_approval', 'approve', { request_id: request.id, action_kind: request.action_kind...` | 回调透传到 `src/App.tsx` 的 `handleApprovalDecision` → `resolve_runtime_guard_approval_request` | ✅ 已确认（真实后端） |

### src/components/manual-mode-gate-dialog.tsx

| # | 触发点 | 事件 | 处理表达式 | 真实实现映射 | 结果 |
|---|---|---|---|---|---|
| 1 | `src/components/manual-mode-gate-dialog.tsx:59` | `onClick` | `() => { onOpenChange(false); onManual(); }` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |
| 2 | `src/components/manual-mode-gate-dialog.tsx:68` | `onClick` | `() => { onOpenChange(false); onUpgrade(); }` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |

### src/App.tsx

| # | 触发点 | 事件 | 处理表达式 | 真实实现映射 | 结果 |
|---|---|---|---|---|---|
| 1 | `src/App.tsx:84` | `onClick` | `() => { this.setState({ hasError: false, error: null }); this.props.onReset?.(); }` | 无后端调用（纯UI交互） | ✅ 已确认（本地UI/导航） |

### src/components/glassmorphic-card.tsx

| # | 触发点 | 事件 | 处理表达式 | 真实实现映射 | 结果 |
|---|---|---|---|---|---|
| 1 | `src/components/glassmorphic-card.tsx:40` | `onClick` | `onClick` | 纯组件回调透传（由页面组件提供，页面级链路已核对） | ✅ 已确认（本地UI/导航） |
| 2 | `src/components/glassmorphic-card.tsx:162` | `onClick` | `(e) => { e.stopPropagation(); onViewClick(); }` | 纯组件回调透传（阻止冒泡后执行父级查看动作） | ✅ 已确认（本地UI/导航） |

### src/components/round-cta-button.tsx

| # | 触发点 | 事件 | 处理表达式 | 真实实现映射 | 结果 |
|---|---|---|---|---|---|
| 1 | `src/components/round-cta-button.tsx:37` | `onClick` | `onClick` | 纯组件回调透传（由调用页面提供动作） | ✅ 已确认（本地UI/导航） |
| 2 | `src/components/round-cta-button.tsx:94` | `onClick` | `onClick` | 纯组件回调透传（由调用页面提供动作） | ✅ 已确认（本地UI/导航） |

### src/components/ui/carousel.tsx

| # | 触发点 | 事件 | 处理表达式 | 真实实现映射 | 结果 |
|---|---|---|---|---|---|
| 1 | `src/components/ui/carousel.tsx:195` | `onClick` | `scrollPrev` | 组件内轮播滚动（`embla` API） | ✅ 已确认（本地UI/导航） |
| 2 | `src/components/ui/carousel.tsx:225` | `onClick` | `scrollNext` | 组件内轮播滚动（`embla` API） | ✅ 已确认（本地UI/导航） |

### src/components/ui/input-group.tsx

| # | 触发点 | 事件 | 处理表达式 | 真实实现映射 | 结果 |
|---|---|---|---|---|---|
| 1 | `src/components/ui/input-group.tsx:70` | `onClick` | `(e) => { if ((e.target as HTMLElement).closest('button')) { return } e.currentTarget.parentElement?.querySelector('input')?.focus() }` | 组件内焦点管理（增强输入体验） | ✅ 已确认（本地UI/导航） |

### src/components/ui/sidebar.tsx

| # | 触发点 | 事件 | 处理表达式 | 真实实现映射 | 结果 |
|---|---|---|---|---|---|
| 1 | `src/components/ui/sidebar.tsx:270` | `onClick` | `(event) => { onClick?.(event); toggleSidebar(); }` | 组件内侧栏折叠逻辑（可叠加父回调） | ✅ 已确认（本地UI/导航） |
| 2 | `src/components/ui/sidebar.tsx:291` | `onClick` | `toggleSidebar` | 组件内侧栏折叠逻辑 | ✅ 已确认（本地UI/导航） |

### src/components/tab-bar.tsx

| # | 触发点 | 事件 | 处理表达式 | 真实实现映射 | 结果 |
|---|---|---|---|---|---|
| 1 | `src/components/tab-bar.tsx:33` | `onClick` | `() => onTabChange(tab.id)` | 纯组件回调透传（父组件切换 tab） | ✅ 已确认（本地UI/导航） |
| 2 | `src/components/tab-bar.tsx:68` | `onClick` | `() => onTabChange(tab.id)` | 纯组件回调透传（父组件切换 tab） | ✅ 已确认（本地UI/导航） |

### src/components/macos-frame.tsx

| # | 触发点 | 事件 | 处理表达式 | 真实实现映射 | 结果 |
|---|---|---|---|---|---|
| 1 | `src/components/macos-frame.tsx:58` | `onClick` | `onRestart` | 纯组件回调透传（父级决定重启动作） | ✅ 已确认（本地UI/导航） |

### src/components/pro-upgrade-banner.tsx

| # | 触发点 | 事件 | 处理表达式 | 真实实现映射 | 结果 |
|---|---|---|---|---|---|
| 1 | `src/components/pro-upgrade-banner.tsx:27` | `onClick` | `handleClick` | 默认跳转 `useAppStore.getState().setCurrentModule('upgradePro')`（可被父回调覆盖） | ✅ 已确认（本地UI/导航） |
| 2 | `src/components/pro-upgrade-banner.tsx:88` | `onClick` | `handleClick` | 默认跳转 `useAppStore.getState().setCurrentModule('upgradePro')`（可被父回调覆盖） | ✅ 已确认（本地UI/导航） |

### src/components/three-column-layout.tsx

| # | 触发点 | 事件 | 处理表达式 | 真实实现映射 | 结果 |
|---|---|---|---|---|---|
| 1 | `src/components/three-column-layout.tsx:46` | `onClick` | `onBack` | 纯组件回调透传（父组件处理返回） | ✅ 已确认（本地UI/导航） |
| 2 | `src/components/three-column-layout.tsx:129` | `onChange` | `(e) => onChange(e.target.value)` | 组件内输入值透传（父组件处理搜索） | ✅ 已确认（本地UI/导航） |
| 3 | `src/components/three-column-layout.tsx:150` | `onChange` | `(e) => onChange(e.target.value)` | 组件内选择值透传（父组件处理排序） | ✅ 已确认（本地UI/导航） |

### src/components/module-hero-page.tsx

| # | 触发点 | 事件 | 处理表达式 | 真实实现映射 | 结果 |
|---|---|---|---|---|---|
| 1 | `src/components/module-hero-page.tsx:104` | `onClick` | `onCtaClick` | 纯组件回调透传（父组件注入模块主动作） | ✅ 已确认（本地UI/导航） |

## 关键确认

- 关键命令注册位置：`src-tauri/src/lib.rs`（`tauri::generate_handler![]`）
- 审批票据强校验：`src-tauri/src/commands/runtime_guard.rs` 的 `require_action_approval_ticket`
- 扫描与修复：`src-tauri/src/commands/scan.rs`（`scan_full`/`fix_issue`/`fix_all`）
- 商店安装链路：`src-tauri/src/commands/store.rs`（`install_store_item`/`update_installed_item`/`uninstall_item`）
- OpenClaw 链路：`src-tauri/src/commands/install.rs`（安装/更新/卸载）和 `ai_orchestrator.rs`（一键分步执行）

## 本轮修复记录

- 已修复 SmartGuard 完成页两个按钮映射错误：`src/components/pages/smart-guard-home.tsx`。
  - “手动处理”改为真实进入手动修复流。
  - “无问题时开始扫描”改为真实启动扫描，不再误走 `fix_all`。

## 验证命令

- `pnpm typecheck` ✅
- `pnpm lint` ✅
- `pnpm test` ✅（20 files / 75 tests）
- `cargo check --manifest-path src-tauri/Cargo.toml` ✅
