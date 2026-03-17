# AgentShield v1.0.1 审计修复逐条核对清单

> 核对日期：2026-03-17  
> 对照文档：`docs/audits/full-cross-platform-audit-2026-03-17.md`  
> 结论：38/38 项已完成修复并通过构建验证。

## CRITICAL（4/4）

| ID | 状态 | 核对说明 | 主要文件 |
|---|---|---|---|
| C-01 | ✅ | async 命令中的阻塞命令执行统一改为 `spawn_blocking` 封装 | `src-tauri/src/commands/install.rs`, `src-tauri/src/commands/ai_orchestrator.rs` |
| C-02 | ✅ | 移除 setup 中 `block_on`，改为异步 `spawn` 启动扫描初始化 | `src-tauri/src/commands/runtime_guard.rs` |
| C-03 | ✅ | `tauri.conf.json` 去除 macOS 专属窗口项；macOS 样式改为运行时 cfg 设置 | `src-tauri/tauri.conf.json`, `src-tauri/src/lib.rs` |
| C-04 | ✅ | OpenClaw 向导数据加载增加并发互斥与 focus/visibility 防抖，避免轮询放大阻塞 | `src/components/pages/openclaw-wizard.tsx` |

## HIGH（10/10）

| ID | 状态 | 核对说明 | 主要文件 |
|---|---|---|---|
| H-01 | ✅ | MCP 配置路径补齐 Windows Roaming 路径（Cursor/Kiro/VSCode/Claude/Trae/Codex 等） | `src-tauri/src/commands/scan.rs` |
| H-02 | ✅ | vault 目录与文件补充 Windows ACL 加固，接入 `run_windows_permission_fix` | `src-tauri/src/commands/vault.rs`, `src-tauri/src/commands/scan.rs` |
| H-03 | ✅ | 通知渠道 token 不再明文落盘，改为 keyring `token_ref` + 脱敏显示 | `src-tauri/src/commands/ai_orchestrator.rs` |
| H-04 | ✅ | AI 诊断 prompt 不再硬编码 macOS，改为动态 `std::env::consts::OS` | `src-tauri/src/commands/ai_orchestrator.rs` |
| H-05 | ✅ | 审计点名的 13 个 service `invoke` 增加 try/catch 与错误链 `cause` | `src/services/runtime-guard.ts`, `src/services/semantic-guard.ts`, `src/services/ai-orchestrator.ts` |
| H-06 | ✅ | 新增全局 `tauriInvoke` 超时机制，并将前端 `invoke` 调用统一迁移到包装器 | `src/services/tauri.ts`, `src/services/*.ts`, `src/components/pages/*.tsx` |
| H-07 | ✅ | License 公钥运行时环境变量覆盖限制为 debug；release 使用编译期/默认公钥 | `src-tauri/src/commands/license.rs` |
| H-08 | ✅ | Onboarding 权限卡片按平台渲染：Windows 隐藏 macOS 权限并提供 Defender 引导 | `src/components/pages/onboarding-wizard.tsx` |
| H-09 | ✅ | `harden_permissions` 在 Windows 不再空操作，接入 ACL 加固并覆盖 OpenClaw 配置路径 | `src-tauri/src/commands/ai_orchestrator.rs` |
| H-10 | ✅ | 去除重复服务职责：AI 安装/诊断函数保留在 `ai-orchestrator.ts`，`runtime-settings.ts` 不再重复导出 | `src/services/ai-orchestrator.ts`, `src/services/runtime-settings.ts` |

## MEDIUM（14/14）

| ID | 状态 | 核对说明 | 主要文件 |
|---|---|---|---|
| M-01 | ✅ | Windows 命令执行增加 `CREATE_NO_WINDOW`，避免 `npm.cmd` 黑窗闪烁 | `src-tauri/src/commands/install.rs` |
| M-02 | ✅ | JSON 读取增加 UTF-8 BOM 清理 | `src-tauri/src/commands/store.rs` |
| M-03 | ✅ | 托盘菜单文案按 locale 自动中英切换 | `src-tauri/src/lib.rs` |
| M-04 | ✅ | Approval 为 `pending` 时不再标记 `failed`，改为 `pending` 并提示确认审批 | `src/components/pages/openclaw-wizard.tsx` |
| M-05 | ✅ | vault 读改写链路加全局互斥锁，消除 TOCTOU 竞争窗口 | `src-tauri/src/commands/vault.rs` |
| M-06 | ✅ | runtime_guard JSON 持久化统一走原子写 helper，避免半写入 | `src-tauri/src/commands/runtime_guard.rs` |
| M-07 | ✅ | `get_license_path()` 移除 `expect`，改为安全降级路径 | `src-tauri/src/commands/license.rs` |
| M-08 | ✅ | 渠道配置与权限加固路径补齐 Windows ACL，消除“显示成功但未加固” | `src-tauri/src/commands/ai_orchestrator.rs` |
| M-09 | ✅ | Approval 请求新增 TTL/过期字段与自动过期刷新 | `src-tauri/src/commands/runtime_guard.rs`, `src-tauri/src/types/runtime_guard.rs` |
| M-10 | ✅ | shell open 白名单支持 `ms-settings:` 协议 | `src-tauri/capabilities/default.json`, `src/services/runtime-settings.ts` |
| M-11 | ✅ | autostart 插件已在 Tauri Builder 中初始化 | `src-tauri/src/lib.rs` |
| M-12 | ✅ | 移除 `vendor/mac-notification-sys` path patch，恢复 crates.io 来源 | `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` |
| M-13 | ✅ | login shell PATH 解析修复 early-return，shell 失败时继续尝试降级 shell | `src-tauri/src/commands/install.rs` |
| M-14 | ✅ | 停止强制 vendor 旧通知实现，使用上游维护版本依赖链 | `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` |

## LOW（10/10）

| ID | 状态 | 核对说明 | 主要文件 |
|---|---|---|---|
| L-01 | ✅ | `System::new_all()` 改为 `System::new()` + `refresh_processes` | `src-tauri/src/commands/scan.rs` |
| L-02 | ✅ | `mask_value` 改为按字符切分，避免 UTF-8 字节切片 panic | `src-tauri/src/commands/scan.rs` |
| L-03 | ✅ | 明文缓存更新与导入路径增加 `zeroize` 清理 | `src-tauri/src/commands/vault.rs`, `src-tauri/Cargo.toml` |
| L-04 | ✅ | autostart 依赖从“未使用”变为实际启用（与 M-11 一致） | `src-tauri/src/lib.rs` |
| L-05 | ✅ | 路径归一化仅在 Windows/macOS 转小写，Linux 保留大小写 | `src-tauri/src/commands/platform.rs` |
| L-06 | ✅ | 移除 `navigator.platform`，改为 `userAgent` 平台判定 | `src/components/macos-frame.tsx`, `src/App.tsx` |
| L-07 | ✅ | 写入 MCP 命令按平台使用 `npx` / `npx.cmd` | `src-tauri/src/commands/store.rs` |
| L-08 | ✅ | CLI 默认扫描目录补齐 Windows 常见安装路径 | `src-tauri/src/commands/scan.rs` |
| L-09 | ✅ | Spotlight 查询词增加输入过滤/清洗 | `src-tauri/src/commands/scan.rs` |
| L-10 | ✅ | macOS 关闭事件改为直接退出，移除 `prevent_close` 时序风险 | `src-tauri/src/lib.rs` |

## 验证命令

- `pnpm typecheck` ✅
- `pnpm lint` ✅
- `pnpm test` ✅（22 files / 81 tests passed）
- `cargo check --manifest-path src-tauri/Cargo.toml` ✅

