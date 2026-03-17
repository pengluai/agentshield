# AgentShield 扫描与修复能力整改方案

> 基于代码深度分析 + MCP 官方规范 + 安全行业最佳实践 + 真实 CVE 案例
> 2026-03-17 | 反向审查通过后方可施工

---

## 一、问题诊断：风险的真正来源

### 1.1 核心原则

**风险不来自 AI 工具本身，而来自它加载的 MCP 服务器和 Skill。**

一个没有安装 MCP/Skill 的 Cursor 只是一个编辑器，没有安全风险。
一旦用户添加了 MCP 服务器或安装了 Skill，就等于给了第三方代码执行权限。

### 1.2 六大高风险源（按严重程度排序）

| # | 风险源 | 严重性 | 真实案例 | 根因 |
|---|--------|--------|---------|------|
| 1 | **MCP 明文 API 密钥** | Critical | OpenAI key 写在 mcp.json env 里，任何进程可读 | 开发者图省事把 key 直接写进配置 |
| 2 | **MCP 无限制 Shell 执行** | Critical | Cursor MCP 命令注入 CVE、Zed MCP RCE | MCP 用 `sh -c` 启动，无沙箱 |
| 3 | **Skill 无权限约束** | High | Skill 没有 allowed-tools，可调用任何工具 | SKILL.md 缺少 allowed-tools 字段 |
| 4 | **配置文件权限过宽** | High | `chmod 644` 的 mcp.json 任何用户可读 | 系统默认 umask 导致 |
| 5 | **来源不可信的 MCP/Skill** | Medium | npm typosquatting 攻击，恶意 VS Code 扩展 | 无签名验证机制 |
| 6 | **数据外泄链路** | High | 读文件 + 发网络请求 = 工作区文件被盗 | Skill/MCP 同时拥有读和网络权限 |

### 1.3 溯源逻辑

```
用户装了 AI 工具 (Cursor/Claude Code/...)
  └→ 工具配置了 MCP 服务器 (mcp.json / settings.json)
       └→ MCP 配置中包含：
            ├→ 明文 API Key (sk-xxx) → 密钥泄露风险
            ├→ Shell 命令 (bash/sh) → 任意代码执行风险
            └→ 环境变量引用 → 间接密钥暴露风险
  └→ 工具安装了 Skill (.claude/skills/ / .cursor/rules/)
       └→ Skill 代码中包含：
            ├→ subprocess/exec 调用 → 命令执行风险
            ├→ HTTP 请求 + 文件读取 → 数据外泄风险
            └→ 无 allowed-tools 约束 → 过度授权风险
```

**结论：扫描逻辑应该是 "MCP/Skill → 反查工具"，而不是 "工具 → 查 MCP/Skill"。**

---

## 二、现有架构缺陷

### 2.1 发现能力

| 缺陷 | 代码位置 | 影响 |
|------|---------|------|
| 仅 17 个硬编码工具 (TOOL_DEFS) | scan.rs:86-398 | 新 AI 工具无法自动发现 |
| 纯路径检测，无动态扫描 | scan.rs:1543 | 非标准安装路径的工具被遗漏 |
| OneClick 仅限 TOOL_DEFS 工具 | scan.rs:1594-1606 | 动态发现的工具无法自动修复 |
| 无包管理器集成 | — | npm 全局 MCP 包不被发现 |

### 2.2 修复能力

| 缺陷 | 代码位置 | 影响 |
|------|---------|------|
| 免费用户无任何修复能力 | store.rs:63-77 | 免费用户只能看，不能动 |
| 全局清理是全有或全无 | store.rs:2580+ | 不能选择性清理 |
| 无回滚机制 | store.rs:1849-2150 | 修复失败后无法恢复 |
| 手动修复无引导 | — | 免费用户不知道怎么手动修 |

---

## 三、整改方案

### 3.1 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                    AgentShield v2.0 Architecture                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Discovery Layer (全部免费)                                      │
│  ┌──────────────┐  ┌──────────────────┐  ┌─────────────────┐   │
│  │ Tier A:      │  │ Tier B:          │  │ Tier D:         │   │
│  │ TOOL_DEFS    │  │ 开源社区工具      │  │ 动态发现        │   │
│  │ (17个已知)   │  │ (Continue/Zed)   │  │ (任意MCP/Skill)  │   │
│  └──────┬───────┘  └────────┬─────────┘  └────────┬────────┘   │
│         │                   │                      │            │
│         └───────────────────┼──────────────────────┘            │
│                             ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Unified Risk Assessment Engine               │   │
│  │  MCP安全 │ 密钥安全 │ Skill安全 │ 环境配置 │ 系统防护    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                             │                                   │
│              ┌──────────────┼──────────────┐                    │
│              ▼              ▼              ▼                    │
│  ┌─────────────────┐ ┌───────────────┐ ┌──────────────────┐    │
│  │ Free: 手动修复   │ │ Free: 单项    │ │ Pro: 一键修复    │    │
│  │ 引导 (终端命令)  │ │ 手动删除      │ │ 批量自动化       │    │
│  └─────────────────┘ └───────────────┘ └──────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 动态发现引擎（核心改动）

**新增函数：`discover_mcp_configs_dynamically()`**

```rust
// 扫描目录列表（macOS）
const DISCOVERY_ROOTS_MACOS: &[&str] = &[
    "~/.config",                        // XDG config
    "~/Library/Application Support",     // macOS app data
    "~",                                // dotfiles (depth=1)
];

// 扫描目录列表（Windows）
const DISCOVERY_ROOTS_WINDOWS: &[&str] = &[
    "%APPDATA%",
    "%LOCALAPPDATA%",
    "%USERPROFILE%",
];

// 跳过的目录（性能优化）
const SKIP_DIRS: &[&str] = &[
    "node_modules", ".git", ".cache", "Cache", "Caches",
    "Downloads", "Documents", "Desktop", "Pictures",
    "Music", "Movies", "Library/Caches", "tmp",
    ".Trash", "Logs", "CrashReporter",
];

// MCP 配置文件名模式
const MCP_CONFIG_NAMES: &[&str] = &[
    "mcp.json", "mcp_settings.json", "mcp.yaml", "mcp.toml",
    "settings.json", "config.json", "config.yaml",
    "claude_desktop_config.json",
];

// MCP 配置键名（JSON）
const MCP_JSON_KEYS: &[&str] = &[
    "mcpServers", "mcp_servers", "servers",
    "context_servers", "mcp.servers",
];
```

**发现流程：**
1. 遍历 DISCOVERY_ROOTS 下的子目录（max depth=3）
2. 跳过 SKIP_DIRS 中的目录名
3. 对每个匹配 MCP_CONFIG_NAMES 的文件：
   - 解析 JSON/YAML/TOML
   - 检查是否包含 MCP_JSON_KEYS 中的键
   - 如果键的值是对象，且子对象包含 `command` 或 `url` → 确认为 MCP 配置
4. 从文件路径推断所属工具：
   - 路径包含 "cursor" → Cursor
   - 路径包含 "claude" → Claude
   - 路径包含已知 TOOL_DEFS ID → 对应工具
   - 否则 → 用目录名生成工具 ID

**新增函数：`discover_skill_dirs_dynamically()`**
1. 遍历相同根目录
2. 查找名为 `skills/` 或 `rules/` 的子目录
3. 检查是否包含 .md 文件（SKILL.md、skill.md、README.md）
4. 如果包含 YAML frontmatter 且有 name + description → 确认为 Skill 目录

### 3.3 修复能力分层

#### 免费用户：手动修复引导

**新增 IPC 命令：`generate_manual_fix_guide`**

针对每种风险类型生成终端命令：

| 风险类型 | 手动修复命令 |
|---------|-------------|
| 明文 API Key | `打开 {path}，删除包含 {pattern} 的行` |
| 文件权限过宽 | `chmod 600 {path}` |
| Shell 命令执行 | `打开 {path}，将 command 从 "sh" 改为具体二进制路径` |
| 可疑 Skill | `rm -rf {skill_path}` |
| MCP 服务器卸载 | `打开 {path}，删除 mcpServers.{name} 整个对象` |

**前端展示：**
```
┌─────────────────────────────────────────┐
│ ⚠️ 发现风险：明文 API Key               │
│                                         │
│ 文件：~/.cursor/mcp.json               │
│ 密钥：sk-proj-****...（OpenAI）         │
│                                         │
│ 手动修复步骤：                          │
│ 1. 打开终端                             │
│ 2. 运行以下命令打开文件：               │
│    ┌────────────────────────────┐       │
│    │ open ~/.cursor/mcp.json   │ [复制] │
│    └────────────────────────────┘       │
│ 3. 找到 "OPENAI_API_KEY" 所在行        │
│ 4. 删除该行或替换为环境变量引用        │
│ 5. 保存文件                             │
│                                         │
│ [✅ 我已修复]     [🔐 一键修复 (Pro)]   │
└─────────────────────────────────────────┘
```

#### 免费用户：手动删除

**修改 `uninstall_item()` 逻辑：**

当前：免费用户调用 → 返回错误 "需要 Pro"
改后：免费用户调用 → 返回手动删除命令列表

```rust
// store.rs 修改
pub async fn uninstall_item(item_id: String, manual_mode: bool) -> Result<UninstallResult, String> {
    if manual_mode || !license_allows_one_click() {
        // 返回手动删除指令而非执行
        return Ok(UninstallResult::ManualSteps(generate_uninstall_commands(&item_id)));
    }
    // 现有自动卸载逻辑...
}
```

#### Pro 用户：一键修复（保持现有逻辑）

- 批量修复所有检测到的问题
- 自动将密钥迁移到系统钥匙串
- 自动修改文件权限
- 一键全局清理

### 3.4 全局清理增强

**免费用户清理流程：**
1. 点击"全局清理" → 显示清理预览
2. 预览中列出所有要清理的 MCP/Skill
3. 每项旁边显示手动删除命令
4. 用户可以选择性勾选要清理的项目
5. 勾选后显示汇总的终端命令列表
6. 用户复制命令到终端执行

**Pro 用户清理流程：**
1. 点击"全局清理" → 显示清理预览
2. 勾选要清理的项目（默认全选）
3. 点击"一键执行" → 自动备份 + 删除
4. 显示清理报告

### 3.5 管理能力推断规则修改

```rust
// 修改前（scan.rs:1594-1606）
fn infer_management_capability(tool, ...) -> ManagementCapability {
    if tool.install_target_ready && is_supported_tool_id(&tool.id) {
        ManagementCapability::OneClick  // 仅 TOOL_DEFS 工具
    } else if has_mcp_surface || has_skill_surface {
        ManagementCapability::Manual
    } else {
        ManagementCapability::DetectOnly
    }
}

// 修改后
fn infer_management_capability(tool, ...) -> ManagementCapability {
    let config_writable = tool.mcp_config_paths.iter().any(|p| is_writable(p));
    let format_supported = tool.mcp_config_paths.iter().any(|p| {
        p.ends_with(".json") || p.ends_with(".yaml") || p.ends_with(".toml")
    });

    if config_writable && format_supported {
        ManagementCapability::OneClick  // 任何可写的已知格式配置
    } else if has_mcp_surface || has_skill_surface {
        ManagementCapability::Manual
    } else {
        ManagementCapability::DetectOnly
    }
}
```

---

## 四、文件改动清单

| 文件 | 改动类型 | 改动内容 | 预估行数 |
|------|---------|---------|---------|
| `src-tauri/src/commands/scan.rs` | 新增+修改 | 动态发现引擎 + 合并逻辑 | ~200 行 |
| `src-tauri/src/commands/store.rs` | 修改 | 手动修复指令生成 + uninstall 分支 | ~120 行 |
| `src/components/pages/installed-management.tsx` | 修改 | 手动修复 UI + 动态工具展示 | ~100 行 |
| `src/components/pages/smart-guard-home.tsx` | 修改 | 动态发现工具展示 | ~30 行 |
| `src/components/manual-fix-guide.tsx` | 新增 | 手动修复引导组件 | ~150 行 |
| `src/types/domain.ts` | 修改 | 新增 ManualFixStep 类型 | ~20 行 |

**总预估：~620 行改动**

---

## 五、反向审查清单

### 5.1 架构审查

- [x] 动态发现不破坏现有 TOOL_DEFS 逻辑（纯增量）
- [x] SKIP_DIRS 列表完整，不会扫描无关目录导致性能问题
- [x] MCP 配置验证有结构性检查，不会把随机 JSON 误认为 MCP 配置
- [x] 免费用户的手动修复是只读操作，不修改任何文件
- [x] Pro 用户的自动修复保持现有备份机制

### 5.2 安全审查

- [x] 扫描过程不记录文件完整内容到日志
- [x] 发现的密钥在 UI 中脱敏显示（仅前 4 位）
- [x] 手动修复命令不包含实际密钥值
- [x] 动态发现不扫描 /tmp、Downloads 等非配置目录

### 5.3 兼容性审查

- [x] macOS 和 Windows 路径分别处理
- [x] JSON/YAML/TOML 三种格式均已支持（已有 crate）
- [x] 现有 i18n 系统兼容新增的 UI 文案
- [x] 现有 Pro/Free 授权逻辑不被修改，仅增加手动模式分支

### 5.4 已知风险

| 风险 | 概率 | 缓解措施 |
|------|------|---------|
| 扫描大量目录导致卡顿 | 中 | 设置 max_depth=3, max_files=100/目录，异步执行 |
| 误识别非 MCP 的 JSON 文件 | 低 | 要求 mcpServers 键的值必须包含 command/url 子键 |
| 手动修复命令用户执行错误 | 中 | 命令前加注释说明，提供 "确认执行" 提示 |
| 配置文件写入格式错误 | 低 | 写入前创建备份，写入后重新解析验证 |

---

## 六、施工顺序

```
Phase 1: 动态发现引擎 (scan.rs)
  ├→ 1.1 实现 discover_mcp_configs_dynamically()
  ├→ 1.2 实现 discover_skill_dirs_dynamically()
  ├→ 1.3 修改 scan_full() 合并动态发现结果
  └→ 1.4 修改 infer_management_capability() 移除 TOOL_DEFS 限制

Phase 2: 手动修复系统 (store.rs + types)
  ├→ 2.1 新增 ManualFixStep 类型定义
  ├→ 2.2 实现 generate_manual_fix_guide() IPC 命令
  ├→ 2.3 修改 uninstall_item() 支持手动模式
  └→ 2.4 修改 preview_global_cleanup() 包含手动命令

Phase 3: 前端 UI
  ├→ 3.1 新增 ManualFixGuide 组件
  ├→ 3.2 修改 installed-management 展示动态工具 + 手动修复
  ├→ 3.3 修改 smart-guard-home 显示动态发现数量
  └→ 3.4 i18n 翻译所有新增文案

Phase 4: 测试与验证
  ├→ 4.1 TypeScript 编译验证
  ├→ 4.2 Rust 编译验证
  └→ 4.3 构建测试
```

---

## 七、验收标准

1. **动态发现**：在没有任何 TOOL_DEFS 条目的情况下，能发现用户机器上所有包含 MCP/Skill 的 AI 工具
2. **免费用户修复**：免费用户看到每个风险项的手动修复步骤，包含可复制的终端命令
3. **免费用户删除**：免费用户可以通过手动命令删除任何 MCP/Skill
4. **Pro 用户一键**：Pro 用户保持现有一键修复功能不变
5. **全局清理**：免费用户看到清理预览和命令，Pro 用户一键执行
6. **无回归**：现有 17 个已知工具的扫描功能不受影响
