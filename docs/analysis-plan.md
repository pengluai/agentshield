# AgentShield 综合分析与修复计划

> 基于代码实际分析（非文档），2026-03-17

---

## 一、真实扫描能力评估（基于 scan.rs 代码）

### 1.1 支持的 AI 工具（17 个硬编码定义）

| # | 工具名 | macOS | Windows | MCP 扫描 | Skill 扫描 |
|---|--------|-------|---------|----------|-----------|
| 1 | Cursor | ✅ | ✅ | ✅ | ✅ |
| 2 | Kiro | ✅ | ✅ | ✅ | ✅ |
| 3 | VS Code | ✅ | ✅ | ✅ | ✅ |
| 4 | Claude Desktop | ✅ | ✅ | ✅ | ❌ (无 skill 目录) |
| 5 | Windsurf | ✅ | ✅ | ✅ | ✅ |
| 6 | Claude Code | ✅ | ✅ | ✅ | ✅ |
| 7 | Antigravity | ✅ | ✅ | ✅ | ✅ |
| 8 | Codex CLI | ✅ | ✅ | ✅ | ❌ |
| 9 | Gemini CLI | ✅ | ✅ | ✅ | ❌ |
| 10 | Qwen Code | ✅ | ✅ | ✅ | ❌ |
| 11 | Kimi CLI | ✅ | ✅ | ✅ | ❌ |
| 12 | CodeBuddy | ✅ | ✅ | ✅ | ✅ |
| 13 | Trae | ✅ | ✅ | ✅ | ✅ |
| 14 | Continue | ✅ | ✅ | ✅ | ❌ |
| 15 | Aider | ✅ | ✅ | ✅ (YAML) | ❌ |
| 16 | Zed | ✅ | ❌ (macOS only) | ✅ | ❌ |
| 17 | Cline / Roo | ✅ | ✅ | ✅ | ❌ |
| 18 | OpenClaw | ✅ | ✅ | ✅ | ✅ |

### 1.2 扫描能力详情

**MCP 服务器提取：**
- 支持 JSON 键名：`mcpServers`、`mcp_servers`、`servers`、`mcp.servers`、`context_servers`、`projects[*].mcpServers`
- 解析格式：JSON + YAML（Aider）
- 提取信息：命令、参数、环境变量中的密钥

**Skill 扫描：**
- 递归扫描 skill 目录，最多 3 级深度
- 检测 9 种能力类型：filesystem, network, shell, env_access, crypto, database, process, code_execution, system_info
- 基于关键词匹配 skill.md / README / 源代码文件

**密钥检测模式：**
- `sk-`（OpenAI）、`sk-ant-`（Anthropic）、`ghp_`（GitHub）、`AKIA`（AWS）等 10+ 种模式
- 检测环境变量中的 API 密钥
- 检测文件权限过于宽松（非当前用户可读）

### 1.3 实际能力 vs 用户期望差距

| 用户期望 | 实际情况 | 差距 |
|---------|---------|------|
| 自动发现新安装的 AI 工具 | ❌ 仅扫描 17 个硬编码路径 | 新工具需手动添加到 TOOL_DEFS |
| 可视化查看所有 MCP/Skill | ✅ 安全映射页面展示 | 功能完整 |
| 卸载/更新/安装 MCP/Skill | ⚠️ 仅通过 Skill Store 安装，无卸载功能 | 安装管理功能有限 |
| 全局清理/环境清理 | ⚠️ 有 Pro 功能的批量修复 | 仅限 Pro 用户 |

---

## 二、待修复问题清单

### 2.1 Rust 后端硬编码中文（i18n 遗漏）

**文件：`src-tauri/src/commands/store.rs`**

| 行号 | 原文（中文） | 英文翻译 |
|------|------------|---------|
| 195 | `已通过 AgentShield 的 OpenClaw 兼容性与安装路径复核` | `Passed AgentShield OpenClaw compatibility and install path review` |
| 197 | `内置目录条目，可扫描和审查，但尚未列入 OpenClaw 专区` | `Built-in catalog entry, scannable and reviewable, but not yet listed in OpenClaw section` |
| 526 | `来自 MCP Registry 的实时目录数据，尚未经过 AgentShield 人工复核` | `Live catalog data from MCP Registry, not yet manually reviewed by AgentShield` |

**文件：`src-tauri/src/commands/runtime_guard.rs`**

| 行号 | 原文（中文） | 英文翻译 |
|------|------------|---------|
| 3677 | `已拦下未允许的联网地址` | `Blocked unauthorized network address` |
| 3679 | `发现未允许的联网地址，但未能自动暂停` | `Detected unauthorized network address, but failed to auto-suspend` |
| 3682-3689 | 整段描述 format! 内容 | 完整英文对照 |

**修复方案：** Rust 后端引入 locale 参数。Tauri IPC 命令接收前端传入的 `locale: String` 参数，根据 locale 返回对应语言文本。

### 2.2 侧边栏布局问题

**问题：** 9 个导航项堆在顶部，下方大面积空白。

**根因：** `<nav>` 使用 `flex-1` 撑满剩余空间，但内部 `<div className="space-y-2">` 没有垂直居中或分散对齐。

**修复方案（推荐方案 A - 垂直居中）：**
```tsx
// app-sidebar.tsx 第 98 行
// 改前：
<nav className="flex-1 py-2 px-3 overflow-y-auto">
  <div className="space-y-2">

// 改后：
<nav className="flex-1 py-2 px-3 overflow-y-auto flex flex-col justify-center">
  <div className="space-y-2">
```

### 2.3 OpenClaw Hub UX 简化

**当前问题：**
1. 7 个安装步骤太多，零基础用户容易放弃
2. 9 个通知渠道选项导致选择困难
3. Token 输入对新手不友好

**修复方案（渐进式，先改最影响体验的）：**

**Phase 1（本次执行）：**
- 将 7 步合并展示为 3 个大阶段："环境准备" → "安装配置" → "验证完成"
- 通知渠道按地区分组：国际（Telegram, Slack, Discord）/ 国内（飞书, 企微, 钉钉）/ 通用（Email, Webhook, ntfy）
- 为每个渠道添加 1 行简短说明

**Phase 2（后续优化）：**
- 自动检测系统地区，默认展示对应渠道组
- Token 输入增加"测试连接"按钮验证有效性

### 2.4 通知页面中文问题

**问题：** 已存储的历史通知数据包含中文标题/描述，来自 runtime_guard.rs。

**修复方案：** 前端展示通知时，使用 `localizedDynamicText()` 或 `containsCjk()` 检测并翻译。与 store.rs 的 review_notes 采用相同前端兜底策略。

---

## 三、执行优先级

| 优先级 | 任务 | 预计改动量 | 影响范围 |
|--------|------|-----------|---------|
| P0 | 侧边栏布局修复 | 1 行 CSS | 全局视觉 |
| P1 | Rust 后端 i18n（store.rs + runtime_guard.rs）| ~30 行 Rust | Skill Store + 通知 |
| P2 | 通知页面前端兜底翻译 | ~20 行 TS | 通知页面 |
| P3 | OpenClaw UX 渠道分组 | ~50 行 TSX | OpenClaw 页面 |

---

## 四、开始执行

按 P0 → P1 → P2 → P3 顺序依次修复。
