# AgentShield 原生能力修复实施文档

> 修复三个"名不副实"功能：通知、网络拦截、沙箱隔离

## 修复概览

| # | 功能 | 当前状态 | 修复目标 | 难度 | 是否需要root |
|---|------|----------|----------|------|-------------|
| 1 | 系统通知 | ✅ 已实现（sendDesktopNotification 在 6 个场景中调用） | 无需修改 | - | 否 |
| 2 | 网络拦截 | 只能监测，无法拦截 | 使用sandbox-exec阻断子进程网络 | 中 | 否 |
| 3 | 沙箱隔离 | 不存在 | 使用sandbox-exec隔离子进程 | 中 | 否 |

---

## 1. 系统通知（Native Notification）

### 1.1 问题分析

**当前实现**：`notification.rs` 将通知写入 `~/.agentshield/notifications.json`，前端通过 Zustand store 调用 `loadNotifications()` 一次性加载。用户看不到系统级弹窗。

**目标**：在写入JSON的同时，调用 `tauri-plugin-notification` 发送 macOS 原生通知。

### 1.2 技术方案

**依赖状态**：
- `Cargo.toml`: `tauri-plugin-notification = "2"` ✅ 已安装
- `lib.rs`: `.plugin(tauri_plugin_notification::init())` ✅ 已注册
- `capabilities/default.json`: `"notification:default"` ✅ 已配置

**Rust API 用法**（来自 Context7 官方文档）：
```rust
use tauri_plugin_notification::NotificationExt;

// 通过 AppHandle 发送
app.notification()
    .builder()
    .title("AgentShield")
    .body("检测到安全威胁")
    .show()
    .unwrap();
```

**JS API 用法**（来自 Context7 官方文档）：
```typescript
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

// 检查权限
let granted = await isPermissionGranted();
if (!granted) {
  const permission = await requestPermission();
  granted = permission === 'granted';
}

// 发送通知
if (granted) {
  sendNotification({ title: 'AgentShield', body: '检测完成' });
}
```

### 1.3 实施计划

**方案选择**：在前端 `notificationStore.ts` 的 `pushNotification()` 方法中集成 JS API 发送原生通知。

理由：
- 前端已有通知优先级判断逻辑，可精细控制哪些通知弹系统通知
- 避免修改大量 Rust 后端代码
- JS API 已经有权限检查和请求机制

**修改文件**：
1. `src/stores/notificationStore.ts` — 在 `pushNotification()` 中添加原生通知发送
2. `src/App.tsx` — 在应用启动时请求通知权限

**通知触发规则**：
- `critical` 优先级 → 始终发送系统通知
- `warning` 优先级 → 发送系统通知
- `info` 优先级 → 不发送系统通知（避免打扰）

**代码改动**：

```typescript
// notificationStore.ts - pushNotification 方法中添加
import {
  isPermissionGranted,
  sendNotification,
} from '@tauri-apps/plugin-notification';

// 在 pushNotification 内部（参数名为 input）：
if (input.priority !== 'info') {
  try {
    const granted = await isPermissionGranted();
    if (granted) {
      sendNotification({
        title: input.title,
        body: input.body,
      });
    }
  } catch {
    // 非 Tauri 环境忽略
  }
}
```

```typescript
// App.tsx - 启动时请求权限
import { requestPermission, isPermissionGranted } from '@tauri-apps/plugin-notification';

// 在 useEffect 初始化中添加：
async function initNotificationPermission() {
  try {
    const granted = await isPermissionGranted();
    if (!granted) {
      await requestPermission();
    }
  } catch {
    // 非 Tauri 环境忽略
  }
}
initNotificationPermission();
```

### 1.4 已知限制
- macOS 首次需要用户点击"允许"通知权限
- 应用在前台时，macOS 默认不显示横幅通知（这是系统行为）
- 不需要 root 权限

---

## 2. 网络拦截（sandbox-exec Network Blocking）

### 2.1 问题分析

**当前实现**：`runtime_guard.rs` 能检测子进程的网络连接（通过 `lsof -i -n -P`），有审批工作流，但**无法实际阻断网络**。用户设置"拒绝网络"后，MCP server 仍然可以自由访问网络。

**目标**：当用户将组件网络策略设为"拒绝"时，使用 `sandbox-exec` 在子进程启动时注入网络隔离沙箱。

### 2.2 技术方案

**sandbox-exec**（来自 Tavily 搜索的官方信息）：
- macOS 内置命令，路径 `/usr/bin/sandbox-exec`
- 不需要 root 权限
- 按进程粒度执行，不影响系统其他进程
- 已被 OpenAI Codex CLI 和 Anthropic Claude Code 生产使用
- Apple 已标记为 deprecated，但在 macOS 15 (Sequoia) 上仍然可用
- Apple 未提供等效的非 deprecated 替代方案（App Sandbox 不适用于动态子进程）

**沙箱 Profile 语法**：
```
(version 1)
(allow default)
(deny network*)
```

**命令行用法**：
```bash
# 原始命令：node /path/to/mcp-server.js
# 沙箱化：
sandbox-exec -p '(version 1)(allow default)(deny network*)' node /path/to/mcp-server.js
```

### 2.3 实施计划

**修改文件**：
1. `src-tauri/src/commands/runtime_guard.rs` — 在 `spawn_supervised_component()` 函数（实际创建子进程的地方，调用 `StdCommand::new()`）中，根据网络策略决定是否用 `sandbox-exec` 包装启动命令

**核心逻辑**：

```rust
// 在 spawn_supervised_component 的进程启动逻辑中：
fn build_sandboxed_command(
    original_cmd: &str,
    original_args: &[String],
    network_blocked: bool,
    fs_readonly: bool,
) -> std::process::Command {
    // 仅 macOS 支持 sandbox-exec
    #[cfg(target_os = "macos")]
    if network_blocked || fs_readonly {
        let mut profile_parts = vec!["(version 1)", "(allow default)"];
        if network_blocked {
            profile_parts.push("(deny network*)");
        }
        if fs_readonly {
            profile_parts.push("(deny file-write*)");
        }
        let profile = profile_parts.join("");

        let mut cmd = std::process::Command::new("sandbox-exec");
        cmd.arg("-p").arg(&profile)
            .arg(original_cmd)
            .args(original_args);
        return cmd;
    }

    // 非 macOS 或不需要沙箱：原始命令
    let mut cmd = std::process::Command::new(original_cmd);
    cmd.args(original_args);
    cmd
}
```

**网络策略映射**（基于代码中实际存在的值）：
- 当前代码中的 network_mode 值为 `"observe_only"`、`"allowlist"`、`"inherit"`
- 需要新增 `"blocked"` 值，表示完全阻断网络
- `network_mode = "blocked"` → 注入 `(deny network*)`
- `network_mode = "allowlist"` → 当前仍使用审计模式（sandbox-exec 不支持细粒度域名控制）
- `network_mode = "observe_only"` → 不注入，仅监测
- `network_mode = "inherit"` → 继承全局策略后再判断

**限制**：
- sandbox-exec 是全有全无的网络控制，不支持按域名/IP 白名单
- 仅 macOS 支持，Windows/Linux 需要其他方案（当前 AgentShield 仅支持 macOS）
- sandbox-exec 已 deprecated，但 Apple 未移除，生产环境仍在使用

### 2.4 回退方案

如果 sandbox-exec 在未来 macOS 版本被移除：
- 监控 Apple Container framework (WWDC 2025) 的成熟度
- 考虑 HTTP_PROXY 注入作为 HTTP 层面的降级方案

---

## 3. 沙箱隔离（Process Sandboxing）

### 3.1 问题分析

**当前实现**：`runtime_guard.rs` 有"组件信任状态"和"审批工作流"，但组件启动后没有任何系统级隔离。一个被标记为"受限"的组件仍然可以自由读写文件、执行命令。

**目标**：为 restricted/unknown 信任状态的组件启动时注入 sandbox-exec 沙箱，限制文件写入和网络访问。

### 3.2 技术方案

与网络拦截共用 `sandbox-exec`。不同的 Profile 组合：

| 信任状态 | 网络策略 | 沙箱 Profile |
|---------|---------|-------------|
| trusted | observe_only | 无沙箱 |
| trusted | blocked | `(deny network*)` |
| unknown | observe_only | `(deny file-write*)(允许特定写入路径)` |
| unknown | blocked | `(deny network*)(deny file-write*)` |
| restricted | any | `(deny network*)(deny file-write*)(deny process-exec*)` |

**精细化文件写入控制**：
```
(version 1)
(allow default)
(deny file-write*)
(allow file-write* (subpath "/tmp"))
(allow file-write* (subpath "/var/folders"))
```

### 3.3 实施计划

**修改文件**：
1. `src-tauri/src/commands/runtime_guard.rs` — 扩展 `build_sandboxed_command()` 支持信任状态级别的沙箱

**核心逻辑**：

```rust
/// 根据信任状态和网络策略生成 sandbox-exec profile
fn generate_sandbox_profile(trust_state: &str, network_mode: &str) -> Option<String> {
    // trusted + audit = 无沙箱
    if trust_state == "trusted" && network_mode != "blocked" {
        return None;
    }

    let mut rules = vec![
        "(version 1)".to_string(),
        "(allow default)".to_string(),
    ];

    // 网络控制
    if network_mode == "blocked" {
        rules.push("(deny network*)".to_string());
    }

    // 文件写入控制（unknown 和 restricted）
    if trust_state == "unknown" || trust_state == "restricted" {
        rules.push("(deny file-write*)".to_string());
        // 允许临时目录写入（MCP server 常需要）
        rules.push("(allow file-write* (subpath \"/tmp\"))".to_string());
        rules.push("(allow file-write* (subpath \"/var/folders\"))".to_string());
    }

    // 进程执行控制（仅 restricted）
    if trust_state == "restricted" {
        rules.push("(deny process-exec*)".to_string());
        // 允许自身进程（否则无法启动）
        rules.push("(allow process-exec* (literal \"/bin/sh\"))".to_string());
        rules.push("(allow process-exec* (literal \"/usr/bin/env\"))".to_string());
    }

    Some(rules.join(""))
}
```

### 3.4 前端集成

**修改文件**：
1. 设置页面或组件详情中显示当前沙箱状态
2. `runtime_guard` 相关前端需添加沙箱状态展示

**UI 变更**：
- 组件详情中显示"沙箱状态"徽章：已隔离/未隔离
- 当 sandbox-exec 不可用时显示警告

### 3.5 已知限制
- sandbox-exec 已 deprecated（但 macOS 15 仍可用）
- 过于严格的沙箱可能导致某些 MCP server 无法正常工作
- `process-exec*` 限制可能阻断需要子进程的工具
- 仅 macOS 支持

---

## 4. 实施顺序

1. **系统通知**（最简单，独立修改，10分钟）
   - 修改 `notificationStore.ts` 和 `App.tsx`

2. **sandbox-exec 核心函数**（网络拦截 + 沙箱隔离共用）
   - 在 `runtime_guard.rs` 中添加 `generate_sandbox_profile()` 和 `build_sandboxed_command()`

3. **网络拦截集成**
   - 将 `build_sandboxed_command()` 接入组件启动流程

4. **沙箱隔离集成**
   - 将信任状态映射添加到沙箱 Profile 生成

## 5. 测试计划

1. `cargo check` — Rust 编译检查
2. `npx tsc --noEmit` — TypeScript 类型检查
3. `cargo test` — Rust 单元测试
4. `npm run build` (vite build) — 前端构建

**手动验证**：
- 触发 critical 通知 → 应看到 macOS 系统通知弹窗
- 启动 restricted 组件 → `ps aux` 中应看到 `sandbox-exec -p ...` 前缀
- restricted 组件尝试网络请求 → 应收到连接拒绝错误

---

## 6. 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| sandbox-exec 未来被 Apple 移除 | 代码中加 `#[cfg(target_os = "macos")]` 条件编译，可快速替换 |
| 沙箱导致 MCP server 功能异常 | 默认仅对 unknown/restricted 启用，trusted 不受影响 |
| 用户拒绝通知权限 | 降级为仅 JSON 存储（当前行为），不影响功能 |
| sandbox-exec 路径不存在 | 启动前检查 `/usr/bin/sandbox-exec` 是否存在，不存在则跳过 |

---

## 7. 参考来源

1. **tauri-plugin-notification** — Context7 官方文档 (https://v2.tauri.app/plugin/notification/)
2. **sandbox-exec** — Apple man page, OpenAI Codex CLI 源码, Claude Code 源码
3. **Tauri v2 capabilities** — Context7 官方文档
4. **Apple Container framework** — WWDC 2025 (未来方向，本次不采用)
