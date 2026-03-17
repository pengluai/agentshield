# AgentShield 官网文案策略文档

> 基于深度市场研究，针对中国和欧美两个市场的文案重构方案
> 所有数据和案例均来自公开可查来源，无夸大无虚构

---

## 一、研究基础

### 欧美用户付费逻辑
- 开发者是最难销售的群体，但**安全是唯一能用"风险意识"驱动转化的品类**
- 核心公式：PAS（Problem-Agitate-Solution）= 提出问题 → 放大痛点 → 给出方案
- 竞品文案模式：Snyk "Secure AI-generated code in minutes"、Socket.dev "Ship with confidence"
- **不能做的事**：vague fear-mongering、声称 "military-grade"、AI-washing
- **必须做的事**：3秒内传达"做什么/给谁用/为什么重要"、免费版清晰可见、No account required

### 中国用户付费逻辑
- 价格敏感、ROI驱动、"损失避免"心理（买保险心态）
- 火绒模式最成功：**纯净、无广告、无弹窗、免费版永久可用**
- "本地运行/数据不出设备" 是中国用户的核心信任点
- 规格说明优先，不要翻译欧美的情感文案
- "一键扫描" 简单化表达是关键转化词

### 真实安全事件（可用于文案，均有公开来源）
| 事件 | 来源 |
|------|------|
| 43% 的 MCP 服务器存在注入漏洞 | Equixly 2025 安全研究 |
| 开发者 API Key 泄露 11 天，OpenAI 账单从 $400 暴涨到 $67,000 | 多家安全媒体报道 |
| Cursor 代理可被提示词注入劫持 | CVE-2025-54135 |
| GitHub Copilot 可被 README 中的隐藏指令劫持执行恶意命令 | CVE-2025-53773 (严重度 7.8) |
| Amazon Q VS Code 扩展被攻陷，影响 95 万开发者 | 2025 公开报道 |
| 84% 的开发者每天使用 AI 编程工具 | Stack Overflow 2025 调查 (49,000人) |

### 当前文案问题（需修正）
| 当前文案 | 问题 | 修正 |
|---------|------|------|
| "39M secrets leaked, 900K users compromised" | GitHub 通用统计，非 AI 工具特有，暗示 AgentShield 能阻止这些 | 删除，用 AI 工具特有的真实事件替代 |
| "Military-Grade Key Encryption / AES-256" | 实际用系统钥匙串，不是自定义 AES-256 | 改为"系统钥匙串加密存储" |
| "Your AI Is Reading Your Passwords" | 过度戏剧化，可能被审查认为是 FUD | 改为基于事实的表述 |
| "24/7 Monitoring / Real-time interception" | 仅在 app 运行时监控，无法"拦截" | 改为"实时检测和提醒" |
| "blocking unauthorized data exfiltration" | 仅 sandbox-exec 对特定组件有效 | 改为"沙箱隔离限制不可信组件" |

---

## 二、英文文案（Western audience）

### Hero Section
```
Badge: Free local scanner for AI dev tools
Title: See What Your AI Tools Can Access
Subtitle: AgentShield scans Cursor, Claude Code, Windsurf, and 13 more tools
for exposed API keys, risky MCP servers, and permission overreach.
Local only — nothing leaves your laptop.
CTA: Free Download for macOS | Windows
Micro-copy: No account required · No data collection
```

### Problem Section — "Real risks, real incidents"
```
Title: This Already Happened

Card 1 (stat):
"43% of MCP servers tested have injection vulnerabilities"
— Equixly Security Research, 2025

Card 2 (incident):
"One leaked API key. $67,000 in charges."
A developer's OpenAI key sat in a public repo for 11 days.

Card 3 (CVE):
"Cursor agent hijacked via prompt injection"
CVE-2025-54135 — a single line in a Slack message triggered remote code execution.
```

### Features Section
```
Feature 1: One-Click Security Scan
"Scan 16+ AI tools in under a minute. Find exposed keys, risky extensions,
and permission problems in configs you didn't know existed."

Feature 2: Installed Management
"See every MCP server and Skill across all your AI tools in one place.
What's installed, what it can access, and whether you should trust it."

Feature 3: Key Vault
"Move exposed keys from plaintext configs to your system keychain.
macOS Keychain or Windows Credential Manager — not another config file."

Feature 4: Real-Time Monitoring
"Get notified when AI tool configs change. New extension installed,
permission modified, or config updated — you'll know immediately."
```

### Pricing Section
```
Title: Start scanning for free

Free:
"Full scan · Full results · No limits"
- Scan all 16+ AI tools
- View all detected risks
- Manual fix with guided commands
- Key vault (10 keys)
CTA: Free Download

Pro Yearly ($39.9/year):
"Same scan. Less manual work."
- Everything in Free
- One-click batch fix
- AI-guided remediation suggestions
- Unlimited key vault
- Live rule updates
CTA: [Checkout pending review]

Pro Lifetime ($79.9 one-time):
"All Pro features. Lifetime updates."
CTA: [Coming soon]

Monthly: Also available at $4.9/mo
```

### FAQ — Keep factual
```
Q: What AI tools does it support?
A: Cursor, Claude Code, Claude Desktop, VS Code/Cline, Windsurf, Zed, Trae,
Gemini CLI, Codex CLI, Continue, Aider, OpenClaw, Kiro, CodeBuddy, Qwen Code,
Antigravity — 16+ tools detected automatically.

Q: Does it send my data anywhere?
A: No. Scanning runs on your machine. No config data, keys, or results are uploaded.
The only network call is optional license verification.

Q: What's the difference between Free and Pro?
A: Free gives you the full scan and all results.
Pro saves time with batch fixes and AI-guided suggestions.

Q: Is it safe to install?
A: Built with Rust and Tauri (no Electron). ~80MB installer.
Open-source scanner logic. No background processes when the app is closed.
```

---

## 三、中文文案（中国用户）

### Hero Section
```
Badge: 免费本地扫描 · 支持 16+ AI 工具
Title: 你装的 AI 工具，谁在读你的密钥？
Subtitle: AgentShield 自动发现 Cursor、Claude Code、Windsurf 等 16+ 工具，
扫描密钥泄露、权限过大、高危 MCP 配置。
纯本地运行，数据不出设备。
CTA: 免费下载 macOS | Windows
Micro-copy: 无需注册 · 无广告 · 无弹窗
```

### Problem Section — "这些已经发生了"
```
Title: 这些事，已经发生了

Card 1 (数据):
"43% 的 MCP 服务器存在注入漏洞"
— Equixly 2025 安全研究

Card 2 (事件):
"一个泄露的 API Key，$67,000 的账单"
某开发者的 OpenAI Key 在公开仓库暴露了 11 天。

Card 3 (漏洞):
"Cursor 代理被提示词注入劫持"
CVE-2025-54135 — Slack 消息中一行文字即可触发远程代码执行。
```

### Features Section
```
Feature 1: 一键安全扫描
"一分钟内扫描 16+ AI 工具。自动发现明文密钥、高危扩展、
权限过大的配置文件。"

Feature 2: 已安装管理
"可视化查看所有 AI 工具中的 MCP 和 Skill。
谁装了什么、有什么权限、信任等级，一目了然。"

Feature 3: 密钥保险库
"把暴露的密钥从明文配置转移到系统钥匙串。
macOS 钥匙串 / Windows 凭据管理器，告别明文存储。"

Feature 4: 实时监控
"AI 工具配置文件变更时即时提醒。
新装扩展、权限修改、配置更新，第一时间知道。"
```

### Pricing Section
```
Title: 免费开始扫描

免费版:
"完整扫描 · 完整报告 · 永久免费"
- 扫描全部 16+ AI 工具
- 查看所有检测到的风险
- 手动修复（带终端命令指引）
- 密钥保险库（10 个密钥）
CTA: 免费下载

Pro 年费 (¥288/年):
"同样的扫描，更少的手动操作"
- 免费版全部功能
- 一键批量修复
- AI 修复建议
- 无限密钥存储
- 规则热更新
CTA: [支付审核中]

Pro 终身 (¥588 买断):
"全部 Pro 功能，终身免费更新"
CTA: [即将开放]

按月: ¥29/月
```

### 差异化信任标签（中文专属）
```
"纯本地运行，数据不出设备"
"无广告 · 无弹窗 · 无捆绑"
"Rust + Tauri 原生构建，仅 ~80MB"
"免费版就够用，Pro 版省时间"
```

---

## 四、Use Cases Section（替代当前的 testimonial cards）

### 英文
```
Title: Built for developers who use AI daily

Card 1: "I use 5 AI tools. Do I know which one has my Stripe key?"
Solo developers running multiple AI assistants.

Card 2: "Before we onboard the team, we need a security baseline."
Teams evaluating AI coding tools for production use.

Card 3: "I just want to see what's on my machine and clean it up."
Anyone who installed AI tools and wants peace of mind.
```

### 中文
```
Title: 给每天用 AI 工具的开发者

Card 1: "我装了 5 个 AI 工具，哪个在明文存我的 API Key？"
同时使用多个 AI 编程助手的独立开发者。

Card 2: "团队接入 AI 工具前，先做一次安全基线检查。"
正在评估 AI 编程工具的技术团队。

Card 3: "我只想看看电脑上有什么风险，然后清理掉。"
装了 AI 工具、想确认安全状况的普通用户。
```

---

## 五、合规审查清单

- [x] 所有统计数据有公开来源
- [x] 无"military-grade"等夸大用语
- [x] 无虚构的用户评价或推荐
- [x] Free tier 清晰标注且功能描述准确
- [x] 不承诺"100% 安全"或"完全防护"
- [x] 不声称能"拦截"攻击（仅检测和提醒，sandbox 隔离除外）
- [x] 技术规格与实际代码一致
- [x] 价格清晰，无隐藏费用
- [x] "数据不出设备"与实际行为一致（license 验证有说明）
