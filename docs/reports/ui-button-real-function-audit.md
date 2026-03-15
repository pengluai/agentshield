# UI Button Real-Function Audit (Code-Derived)

Generated: 2026-03-14  
Source: Real code paths in `src/components/pages/*.tsx`, `src/services/*.ts`, and `src-tauri/src/commands/*.rs`

## Scope and Rule
- Audit unit is **actual button behavior in code**, not product docs.
- `REAL` means it calls backend command / runtime service and can change real machine state.
- `UI` means local state / navigation only.

## 1) Smart Guard (`src/components/pages/smart-guard-home.tsx`)

| Button | Handler | Backend binding | Reality |
|---|---|---|---|
| Start Scan | `startScan` | `runFullScanWithProgress` -> `scan_full` | REAL |
| Stop | `handleStopScan` | `cancelScan` -> `scan_cancel` | REAL |
| Retry | `onRetry` | Re-runs `startScan` | REAL |
| Card click (each risk card) | `onViewScanDetail(cardId)` | Route/state jump to scan detail | UI |
| Manual mode | `onManualFix` | Switches to manual handling flow | UI |
| One-click Fix All | `onFixAll` | `request_runtime_guard_action_approval` + `fix_all` + `runFullScan` | REAL |
| Upgrade CTA | `setCurrentModule('upgradePro')` | Navigation | UI |

## 2) Security Scan Detail (`src/components/pages/security-scan.tsx`)

| Button | Handler | Backend binding | Reality |
|---|---|---|---|
| Back | `handleBack` | `cancelScan` when scanning | REAL/UI |
| Retry (error state) | `setScanAttempt + 1` | Re-runs `scan_full` effect | REAL |
| Severity filters | `setSeverityFilter` | Local filter | UI |
| Tool filters | `setPlatformFilter` | Local filter | UI |
| Issue row click | `setSelectedIssue` | Local selection | UI |
| Rescan now | `setScanAttempt + 1` | `scan_full` | REAL |
| Review manually one by one | sets hint message only | No backend mutation | UI |
| One-click Fix All (Pro) | `handleFixAll` | approval + `fix_all` | REAL |
| View file location | `invoke('reveal_path_in_finder')` | `reveal_path_in_finder` | REAL |
| Fix This Issue | `handleFix` | `fix_issue` | REAL |
| Open config file for manual fix | `reveal_path_in_finder` | `reveal_path_in_finder` | REAL |

## 3) Installed Management (`src/components/pages/installed-management.tsx`)

| Button | Handler | Backend binding | Reality |
|---|---|---|---|
| Refresh status | `loadInstalledData` | `scan_installed_mcps`, `list_installed_items`, `detect_ai_tools`, runtime-guard APIs | REAL |
| Show only risky tools toggle | `setShowRiskOnlyHosts` | Local filter | UI |
| Reveal source/evidence path | `reveal_path_in_finder` | `reveal_path_in_finder` | REAL |
| Check updates (single/all) | `handleCheckUpdates` | `check_installed_updates` | REAL |
| Apply update (single/all) | `handleApplyUpdate` / batch action | `update_installed_item`, `batch_update_items` | REAL |
| Uninstall | `handleUninstall` | `uninstall_item` | REAL |
| Sync runtime guard | `handleSyncGuard` | `sync_runtime_guard_components` | REAL |
| Trust state buttons | `handleTrustChange` | `update_component_trust_state` | REAL |
| Save network policy | `handleNetworkPolicySave` | `update_component_network_policy` | REAL |
| Guarded launch | `handleGuardedLaunch` | `launch_runtime_guard_component` | REAL |
| Terminate session | `handleTerminateSession` | `terminate_runtime_guard_session` | REAL |
| Clear runtime events | `handleClearEvents` | `clear_runtime_guard_events` | REAL |
| Back to tool overview | `onBackToHost` | Local selection reset | UI |

## 4) OpenClaw Hub (`src/components/pages/openclaw-wizard.tsx`)

| Button | Handler | Backend binding | Reality |
|---|---|---|---|
| Install | `handleAction('install')` | `install_openclaw_cmd` | REAL |
| Update | `handleAction('update')` | `update_openclaw_cmd` | REAL |
| Uninstall | `handleAction('uninstall')` + confirm | `uninstall_openclaw_cmd` | REAL |
| Check latest version | load effect | `check_openclaw_latest_version` | REAL |
| Open config/file path | `handleRevealPath` | `reveal_path_in_finder` | REAL |
| Open docs/channel links | `openExternalUrl` | Shell open URL | REAL |
| Upgrade CTA / step switch | module/state update | Navigation | UI |

## 5) Key Vault (`src/components/pages/key-vault.tsx`)

| Button | Handler | Backend binding | Reality |
|---|---|---|---|
| Add key | `handleAddKey` | `vault_add_key` | REAL |
| Delete key | `handleDeleteKey` | approval + `vault_delete_key` | REAL |
| Copy key value | `handleCopyKey` | approval + `vault_reveal_key_value` | REAL |
| Import exposed key | `handleImportKey` | `vault_import_exposed_key` | REAL |
| Refresh list/scan | page load callbacks | `vault_list_keys`, `vault_scan_exposed_keys` | REAL |
| Form expand/cancel | local state | No backend write | UI |

## 6) Skill Store (`src/components/pages/skill-store.tsx`)

| Button | Handler | Backend binding | Reality |
|---|---|---|---|
| Refresh catalog | `loadCatalog(true)` | `refresh_catalog` | REAL |
| Search/filter tabs | local state + search call | `search_store` / local filter | REAL/UI |
| Install action | `handleAction()` | opens install flow -> `install_store_item` (in dialog confirm) | REAL |

## 7) Env Config Detail (`src/components/pages/env-config-detail.tsx`)

| Button | Handler | Backend binding | Reality |
|---|---|---|---|
| Back | `onBack` | Navigation | UI |
| Select tool/item | `setSelectedTool` | Local selection | UI |
| Open path/config buttons | `invoke('reveal_path_in_finder')` | `reveal_path_in_finder` | REAL |

## 8) Settings (`src/components/pages/settings-page.tsx`)

| Button | Handler | Backend binding | Reality |
|---|---|---|---|
| Language switch | `handleLanguageChange` | `settings.setLanguage` (runtime i18n update) | UI (runtime state) |
| Auto start/minimize/notification/security toggles | corresponding handlers | runtime/autostart/protection services | REAL (local app behavior) |
| Clear protection incidents | `handleClearProtectionIncidents` | `clear_protection_incidents` | REAL |
| Test AI connection | `handleTestAiConnection` | `test_ai_connection` | REAL |
| Save/Clear semantic key | semantic handlers | `configure_semantic_guard`, `clear_semantic_guard_key` | REAL |
| Check updates | `handleCheckForUpdates` | rule/update status calls | REAL |
| Sync rules | `handleSyncRules` | `download_and_apply_rules` | REAL |
| Privacy/Terms buttons | open dialog | UI |

## 9) Notification Center (`src/components/pages/notification-center.tsx`)

| Button | Handler | Backend binding | Reality |
|---|---|---|---|
| Mark all read | store action | persists notification state via backend store APIs | REAL |
| Clear all | store action | clears notification records | REAL |
| Filter tabs | `setFilter` | Local filter | UI |
| Mark single read / delete single | store action | notification commands | REAL |

## 10) Upgrade Pro (`src/components/pages/upgrade-pro.tsx`)

| Button | Handler | Backend binding | Reality |
|---|---|---|---|
| Start trial | `handleStartTrial` | `start_trial` | REAL |
| Activate license | `handleActivate` | `activate_license` | REAL |
| Purchase buttons | `handlePurchase` | external checkout URL open | REAL |
| Back | `onBack` | Navigation | UI |

## 11) Install Dialog (`src/components/pages/install-dialog.tsx`)

| Button | Handler | Backend binding | Reality |
|---|---|---|---|
| Close / Cancel | `onClose` | Dialog close only | UI |
| Platform selectors | `togglePlatform` | Local selected targets | UI |
| Install | `handleConfirm` | `resolve_install_target_paths` + `request_runtime_guard_action_approval` + `install_store_item` | REAL |
| Upgrade to Pro | `setCurrentModule('upgradePro')` | Navigation | UI |

## 12) Runtime Approval Modal (`src/components/runtime-approval-modal.tsx`)

| Button | Handler | Backend binding | Reality |
|---|---|---|---|
| Expand / Collapse details | `setDetailsOpen` | Local state | UI |
| Keep blocked | `onDeny` | `resolve_runtime_guard_approval_request` (`deny`) | REAL |
| Allow and continue/launch | `onApprove` | `resolve_runtime_guard_approval_request` (`approve`) | REAL |

## 13) Sidebar & Shell Controls (`src/components/app-sidebar.tsx`, `src/components/macos-frame.tsx`)

| Button | Handler | Backend binding | Reality |
|---|---|---|---|
| Module navigation entries | `setCurrentModule` | Navigation only | UI |
| Language toggle ZH/EN | `setLanguage` -> `setAppLanguage` | Runtime i18n state update | UI (runtime state) |
| Restart (optional) | `onRestart` from parent | Parent-defined action | UI/depends on parent |

## 14) Onboarding Wizard (`src/components/pages/onboarding-wizard.tsx`)

| Button | Handler | Backend binding | Reality |
|---|---|---|---|
| Open system settings | `openMacPermissionSettings` | `open_macos_permission_settings` | REAL |
| Request/refresh notification permission | permission APIs | OS permission flow | REAL |
| Next / Back / step jump | local step state | Local navigation | UI |

## High-risk buttons checked in this repair
- `Fix This Issue` -> only calls `fix_issue`, no scan auto-trigger.
- `One-click Fix All` -> requires runtime approval ticket, then `fix_all`; fixed items are removed from current list and cached category list.
- `Rescan now` -> only triggers explicit new scan attempt (`scan_full`), not mixed into single-fix action.
- Installed Management detail panel now localizes runtime dynamic text in EN mode (event title/description, risk summary, sensitive capability labels, backend error text) to avoid mixed-language leakage.
