# OpenClaw Skill 范围收敛与 macOS 安装流程修正（2026-03-19）

## 背景与目标
用户提出两个问题：
1. OpenClaw 页面里的 Skill 不应混入其他宿主（Cursor/Codex/Claude 等）的 Skill。
2. 官网 macOS 下载说明缺少真实高频路径：`系统设置 -> 隐私与安全性 -> 仍要打开`。

目标是：
- OpenClaw 页面做到“只显示 OpenClaw 自身 Skill”。
- 官网安装说明与 Apple 官方 Gatekeeper 行为一致。

## 官方依据（最佳实践）
### OpenClaw 官方
1. OpenClaw 的技能系统由固定技能目录与 `SKILL.md` 约定驱动。
2. OpenClaw 网关配置支持对技能进行显式启用/禁用（`skills.entries.<skillKey>.enabled`）与来源策略控制（如 `allowBundled`）。

来源（访问日期 2026-03-19）：
- https://docs.openclaw.ai/tools/skills
- https://docs.openclaw.ai/gateway/configuration-reference

### Apple 官方
1. 若应用首次被 Gatekeeper 拦截，可在 `System Settings -> Privacy & Security` 中点 `Open Anyway`。
2. `Open Anyway` 按钮通常在首次被拦截后约 1 小时内可见。

来源（访问日期 2026-03-19）：
- https://support.apple.com/en-us/102445
- https://support.apple.com/en-euro/guide/mac-help/mh40617/mac

## 代码现状诊断
### 已有逻辑
- OpenClaw 专用 API `get_openclaw_skills` 读取 `openclaw_config_candidates(...)/skills`。
- 全局发现逻辑（安全扫描/安装管理）会动态注册任意宿主的 skill root。

### 问题根因
虽然 OpenClaw API 已按目录扫描，但旧实现对符号链接和边界目录约束不够严格，可能把“映射到外部路径”的技能目录视作 OpenClaw skill 展示。

## 技术方案
### 方案原则
1. OpenClaw 页面使用严格边界：只认 OpenClaw skills 根目录内条目。
2. 全局安全扫描维持跨宿主可见（用于风险视角），不与 OpenClaw 页面语义混淆。
3. Skill 识别要满足最小结构：目录 + `SKILL.md`。

### 本次落地实现
在 `get_openclaw_skills` 中执行以下约束：
1. 预先计算 OpenClaw skills 根目录的 canonical path 列表。
2. 每个候选 skill 目录先 canonicalize。
3. 必须满足 `resolved_path.starts_with(any_openclaw_skill_root)` 才纳入结果。
4. 必须是目录；同时保留 `has_skill_md` 标记用于界面提示（不因缺少 `SKILL.md` 直接隐藏）。 

这样可以确保 OpenClaw 页面不再混入外部宿主 skill。

同时在 OpenClaw 专区界面新增了 `OpenClaw Skills` 列表，直接展示：
- skill 名称
- 实际路径
- 文件数量
- `SKILL.md` 完整性状态

## 官网安装流程修正
在 storefront 的 macOS 安装弹窗中，新增并强化了 Apple 官方流程：
1. 先尝试右键“打开”。
2. 若仍拦截，进入 `系统设置 -> 隐私与安全性 -> 仍要打开 / Open Anyway`。
3. 补充“按钮一般仅在首次被拦截后约 1 小时内显示”的说明。

## 变更文件
1. OpenClaw Skill 范围约束：
- `/Users/luheng/Downloads/ai01/agentshield/src-tauri/src/commands/install.rs`

2. 官网 macOS 安装说明：
- `/Users/luheng/Downloads/ai01/agentshield/workers/storefront/site/index.html`

## 验证结果
1. Rust 编译校验：
- `cargo check --manifest-path src-tauri/Cargo.toml` 通过。

2. 前端文案校验：
- 页面源码包含 `仍要打开 / Open Anyway` 与 `Privacy & Security`。

3. 线上部署：
- `wrangler deploy` 成功。
- 线上页面已可检索到更新后的 macOS 步骤文案。

## 后续建议（可选）
1. 在 OpenClaw UI 中增加“仅显示 OpenClaw 技能 / 同时显示外部链接技能”的开关，便于高级用户排查。
2. 对被过滤掉的外部 symlink 技能增加审计日志，避免用户误解“技能丢失”。
3. 对 OpenClaw skill 增加 metadata 校验提示（非阻断），提高来源可解释性。

## Context7 适用性说明
本任务不依赖具体框架/SDK API 版本差异，Context7 不适用。
