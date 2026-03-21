<div align="center">

<img src="src-tauri/icons/icon.png" width="128" alt="AgentShield Logo" />

# AgentShield

**Your AI tools are compromised. You just don't know it yet.**

[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-blue?style=for-the-badge)](https://github.com/pengluai/agentshield/releases)
[![Version](https://img.shields.io/badge/Version-1.0.1-brightgreen?style=for-the-badge)](https://github.com/pengluai/agentshield/releases/tag/agentshield-pilot-v1.0.1)
[![Built with](https://img.shields.io/badge/Rust%20%2B%20Tauri%20v2-black?style=for-the-badge&logo=rust)](https://v2.tauri.app)
[![License](https://img.shields.io/badge/Free%20%2B%20Pro-orange?style=for-the-badge)](https://github.com/pengluai/agentshield/releases)

[English](#why-this-exists) · [中文](#中文)

</div>

---

## Why This Exists — Real Losses, Not Hypotheticals

### Your AI Tools Are Already Causing Real Damage

> *"The agent kept deleting files, and at some point, it output: 'I will do a terraform destroy.'"*
> — [Alexey Grigorev](https://fortune.com/2026/03/18/ai-coding-risks-amazon-agents-enterprise/), whose Claude Code agent **wiped 2.5 years of production data** from two websites. Database + all backup snapshots. Gone. Fortune magazine headline: *"An AI agent destroyed this coder's entire database."*

> *"So much work lost."*
> — [Reddit user](https://whenaifail.com/), whose Claude Code ran `rm -rf tests/ patches/ plan/ ~/` and **deleted their entire Mac**: Desktop, Documents, Downloads, Keychain, credentials — everything.

> *"If Google enforces even a third of this amount, our company goes bankrupt."*
> — [3-person startup in Mexico](https://www.reddit.com/r/googlecloud/comments/1reqtvi/82000_in_48_hours_from_stolen_gemini_api_key_my/), whose stolen Gemini API key generated **$82,314 in charges in 48 hours**. Normal monthly bill: $180. A 455x spike. Google cited "shared responsibility."

> *"One developer. One line of code. Thousands upon thousands of stolen emails."*
> — [Koi Security CTO](https://thehackernews.com/2025/09/first-malicious-mcp-server-found.html), on the **first malicious MCP server found in the wild**: a trojanized `postmark-mcp` npm package that BCC'd every email — password resets, invoices, customer data — to an attacker. ~300 organizations compromised.

### This Is Not Rare. This Is Systemic.

| What's Happening | Scale | Source |
|-----------------|-------|--------|
| AI agents deleting files, databases, entire machines | Multiple incidents in 2025–2026 | [Fortune](https://fortune.com/2026/03/18/ai-coding-risks-amazon-agents-enterprise/), [Reddit](https://www.reddit.com/r/ClaudeAI/comments/1rshuz9/an_ai_agent_deleted_25000_documents_from_the/), [WhenAIFail](https://whenaifail.com/) |
| API keys stolen → $1K–$82K bills in hours | Ongoing, multiple providers | [The Register](https://www.theregister.com/2026/03/03/gemini_api_key_82314_dollar_charge/), [OpenAI Forum](https://community.openai.com/t/my-api-keeps-getting-leaked-the-chinese-are-happy/1247052) |
| Malicious MCP servers stealing emails & credentials | First wild case Sep 2025 | [The Hacker News](https://thehackernews.com/2025/09/first-malicious-mcp-server-found.html), [Snyk](https://snyk.io/blog/malicious-mcp-server-on-npm-postmark-mcp-harvests-emails/) |
| 53% of MCP servers use static, never-rotated API keys | 5,200 servers analyzed | [Astrix Research](https://astrix.security/learn/blog/state-of-mcp-server-security-2025/) |
| MCP configs weaponized via hidden Unicode injection | Copilot & Cursor affected | [CVE-2025-54136](https://thehackernews.com/2025/08/cursor-ai-code-editor-vulnerability.html) |

Your AI tools have root access to your machine. Every MCP server, every Skill, every config file — they can read your keys, delete your files, drain your API budget, and exfiltrate your emails. **And nobody is checking.**

AgentShield is the **only desktop app** that deep-scans 16+ AI tools, intercepts dangerous runtime behavior, and sandboxes untrusted code — before your next `rm -rf ~/` or $82K invoice.

## What AgentShield Does

- **Deep Security Scan** — Rips through configs of 16+ AI tools (Cursor, Claude Code, Claude Desktop, VS Code, Windsurf, Kiro, Zed, Codex CLI, Gemini CLI, Trae, Continue, Aider, CodeBuddy, Qwen Code, Antigravity, OpenClaw). Finds every exposed key, every permission overreach, every orphaned config still leaking secrets.
- **Runtime Guard** — Real-time behavioral interception. File deletions, shell exec, network calls, payment triggers — all blocked until you explicitly approve. Not logged. **Blocked.** The `rm -rf ~/` that wiped that developer's Mac? AgentShield would have caught it and asked first.
- **Sandbox Isolation** — macOS `sandbox-exec` locks untrusted MCP servers and Skills out of your filesystem and network. They run in a cage or they don't run. The `postmark-mcp` email theft? Sandboxed = no network = no exfiltration.
- **Key Vault** — Your API keys are sitting in plaintext JSON files right now. That's how the $82K Gemini bill happened. AgentShield moves them into your system keychain (macOS Keychain / Windows Credential Manager). Where they should have been from the start.
- **Installed Management** — Visual 3-column dashboard showing every MCP server and Skill across every AI tool on your machine. Trust levels. Network policies. One screen, total visibility.
- **Skill Store** — Browse and install security-reviewed extensions from a curated catalog. Every entry vetted before it reaches your machine.
- **One-Click OpenClaw Setup** *(Pro)* — AI-powered guided setup for OpenClaw: environment detection, installation, channel configuration, and troubleshooting — all in one click with an AI assistant walking you through every step.

## Threat Detection

| Threat | What's Really Happening | Status |
|--------|------------------------|--------|
| **Secret Exposure** | Your `OPENAI_API_KEY` is sitting in plaintext inside `~/.cursor/mcp.json`. Anyone on your machine can read it. | **DETECTED** |
| **Permission Overreach** | Config files with `chmod 644` — world-readable. Your secrets, everyone's business. | **DETECTED + AUTO-FIX** |
| **Unsafe Automation** | MCP servers with unrestricted shell access. They can `rm -rf /` and you'd never know until it's done. | **DETECTED** |
| **Unvetted Plugins** | Skills from unknown sources running with full privileges. No review. No audit. Just blind trust. | **DETECTED + SANDBOXED** |
| **Key Sprawl** | Same API key copy-pasted across 5 different tool configs. One breach = total compromise. | **DETECTED** |
| **Orphaned Configs** | You uninstalled that tool months ago. Its config is still there. Still holding your secrets. | **DETECTED** |
| **Dangerous Runtime Actions** | An MCP server just tried to delete your files, send a payment, and exfiltrate data to an unknown server. All in one request. | **BLOCKED + APPROVAL REQUIRED** |
| **Unauthorized Network Access** | That "local-only" MCP server? It's phoning home to an IP address you've never seen. | **MONITORED + SANDBOXED** |

## Supported AI Tools

AgentShield automatically discovers and scans every one of these. No manual config. No setup. Just launch and scan.

| | | | |
|---|---|---|---|
| **Cursor** | **Claude Code** | **Claude Desktop** | **VS Code / Cline** |
| **Windsurf** | **Zed** | **Trae** | **Gemini CLI** |
| **Codex CLI** | **Continue** | **Aider** | **OpenClaw** |
| **Kiro** | **CodeBuddy** | **Qwen Code** | **Antigravity** |

> 16+ AI hosts detected automatically via dynamic config discovery.

## Security-First Architecture

Every architectural choice exists for a security reason:

```
┌─────────────────────────────────────────────────────────┐
│                    AgentShield Desktop                   │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Config       │  │  Runtime     │  │  Key Vault   │  │
│  │  Scanner      │  │  Guard       │  │  (Keychain)  │  │
│  │  (16+ tools)  │  │  (12 risk    │  │              │  │
│  │              │  │   types)     │  │  Ed25519     │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                 │          │
│  ┌──────┴─────────────────┴─────────────────┴───────┐  │
│  │            Rust Backend (Tauri v2)                │  │
│  │   91 IPC commands · tokio async · sandbox-exec   │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │  React 19 + TypeScript + Tailwind + Framer Motion│  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
         │                    │                │
    ┌────┴─────┐    ┌────────┴──────┐   ┌─────┴──────┐
    │ macOS    │    │ OS Keychain   │   │ Zero       │
    │ sandbox- │    │ (not JSON     │   │ Telemetry  │
    │ exec     │    │  files)       │   │ (local     │
    │ (kernel) │    │               │   │  only)     │
    └──────────┘    └───────────────┘   └────────────┘
```

**Why Rust?** Memory-safe by design. When you're parsing configs that hold API keys, buffer overflows aren't acceptable. No garbage collector pauses during real-time behavioral interception.

**Why Tauri v2, not Electron?** 80MB installer, not 200MB+. No bundled Chromium = smaller attack surface. Native OS APIs for keychain access, sandboxing, and process control.

**Why Ed25519 signatures?** Tamper-proof license verification. Offline-first. No phone-home required for validation.

**Why macOS sandbox-exec?** OS-level kernel-enforced process isolation. Lighter than Docker, stronger than user-space sandboxes. Untrusted code gets no filesystem, no network.

**Why zero telemetry?** A security tool that phones home is a liability. All scanning runs locally. Your config data, your keys, your scan results — they never leave your machine.

## How It Works

```
1. INSTALL           2. SCAN              3. INTERCEPT          4. FIX
   ↓                    ↓                    ↓                    ↓
 Download DMG/EXE    One-click deep scan   Runtime Guard blocks  Manual fix (Free)
 → open → done       of ALL AI tools       dangerous actions     or one-click batch
                     on your machine       Sandbox isolates      fix (Pro)
                                           untrusted processes
                                           You approve or deny
                                           every high-risk call
```

**30 seconds from install to your first scan results.** No accounts. No sign-up. No telemetry.

## Download

| Platform | Installer | Note |
|----------|-----------|------|
| **macOS** (Apple Silicon) | [**Download .dmg**](https://github.com/pengluai/agentshield/releases/download/agentshield-pilot-v1.0.1/AgentShield-pilot-1.0.1-macos-arm64.dmg) | First launch: allow in Privacy & Security |
| **Windows** (x64) | [**Download .exe**](https://github.com/pengluai/agentshield/releases/download/agentshield-pilot-v1.0.1/AgentShield-pilot-1.0.1-windows-x64-setup.exe) | Click "Run anyway" if SmartScreen warns |

## Free vs Pro

| | Free | Pro |
|--|------|-----|
| Full deep security scan (23 checks) | Yes | Yes |
| Real-time protection + auto-quarantine | Yes | Yes |
| Sandbox isolation (network + filesystem) | Yes | Yes |
| Runtime action approval (12 risk types) | Yes | Yes |
| System notifications (native) | Yes | Yes |
| Key vault (system keychain) | Yes | Yes |
| Skill store browsing | Yes | Yes |
| Manual fix with terminal commands | Yes | Yes |
| **One-click batch fix** | — | Yes |
| **One-click install / uninstall** | — | Yes |
| **AI install assistant (priority access)** | — | Yes |
| **AI-powered fix suggestions** | — | Yes |
| **Rule database auto-update** | — | Yes |
| **Priority support** | — | Yes |

> **Start free.** Everything you need to find threats is included — no walls, no crippled features.
> Upgrade to Pro when you're tired of fixing 20 issues by hand.
> **14-day Pro trial included.** No credit card. No catch.

## FAQ

<details>
<summary><b>macOS: "Cannot verify developer"</b></summary>

Go to **System Settings > Privacy & Security** > click **"Open Anyway"**. This happens because the app is not notarized with Apple yet. The binary is safe — you can verify the checksum against the GitHub release.
</details>

<details>
<summary><b>Windows: "Unknown publisher"</b></summary>

The installer is not code-signed yet. Verify the download URL matches this GitHub release page, then click **"Run anyway"**.
</details>

<details>
<summary><b>No AI tools detected after scanning</b></summary>

Make sure the AI tool has been **launched at least once** (to create its config directory). AgentShield discovers tools by their config paths — no config, no detection. Launch the tool, then scan again.
</details>

<details>
<summary><b>Is my data sent anywhere?</b></summary>

**No.** All scanning happens locally. No config data, no keys, no scan results ever leave your machine. The only network call is optional license verification — and even that sends zero scan data.
</details>

<details>
<summary><b>Does AgentShield replace my antivirus?</b></summary>

No. Antivirus tools look for known malware signatures. AgentShield looks at what your AI tools can *do* — what they can read, what they can execute, what they can send over the network. Different threat model. Complementary protection.
</details>

---

# 中文

<div align="center">

<img src="src-tauri/icons/icon.png" width="80" alt="AgentShield Logo" />

## AgentShield 智盾

**你装了 8 个 AI 工具。每一个都能读你的密码、删你的文件、连外网。你查过吗？**

</div>

## 这不是假设——这些是真实的损失

### 你的 AI 工具正在造成真实的破坏

> *"Agent 一直在删文件，然后它输出：'我来做一个 terraform destroy。'"*
> — [Alexey Grigorev](https://fortune.com/2026/03/18/ai-coding-risks-amazon-agents-enterprise/)，Claude Code agent **删除了他 2.5 年的生产数据**，两个网站全挂，数据库 + 所有备份快照全没了。Fortune 杂志标题：*"AI agent 毁了这个程序员的整个数据库。"*

> *"失去了太多工作成果。"*
> — [Reddit 用户](https://whenaifail.com/)，Claude Code 执行了 `rm -rf tests/ patches/ plan/ ~/`，**删除了整台 Mac**：桌面、文档、下载、钥匙串、所有凭据——全部清零。

> *"如果 Google 收我们三分之一，公司就破产了。"*
> — [墨西哥 3 人创业团队](https://www.reddit.com/r/googlecloud/comments/1reqtvi/82000_in_48_hours_from_stolen_gemini_api_key_my/)，Gemini API Key 被盗，**48 小时产生 $82,314 账单**。正常月账单 $180，暴涨 455 倍。Google 说"共同责任"。

> *"一个开发者，一行代码，成千上万封被盗的邮件。"*
> — [Koi Security CTO](https://thehackernews.com/2025/09/first-malicious-mcp-server-found.html)，**全球首个恶意 MCP Server**：伪装成合法 `postmark-mcp` npm 包，BCC 每一封邮件——密码重置、发票、客户数据——到攻击者邮箱。~300 个组织中招。

> *"API Key 一直在泄露，一个月内 $250 就没了，日志里全是中文调用。"*
> — [OpenAI 论坛用户](https://community.openai.com/t/my-api-keeps-getting-leaked-the-chinese-are-happy/1247052)，API Key 被反复盗用，明文存在配置文件里，怎么也堵不住。

### 这不是个案。这是系统性风险。

| 正在发生什么 | 规模 | 来源 |
|-------------|------|------|
| AI Agent 删文件、删数据库、删整台电脑 | 2025-2026 多起事件 | [Fortune](https://fortune.com/2026/03/18/ai-coding-risks-amazon-agents-enterprise/)、[Reddit](https://www.reddit.com/r/ClaudeAI/comments/1rshuz9/an_ai_agent_deleted_25000_documents_from_the/)、[WhenAIFail](https://whenaifail.com/) |
| API Key 被盗 → 几小时亏 $1K–$82K | 持续发生，多个云厂商 | [The Register](https://www.theregister.com/2026/03/03/gemini_api_key_82314_dollar_charge/)、[OpenAI 论坛](https://community.openai.com/t/my-api-keeps-getting-leaked-the-chinese-are-happy/1247052) |
| 恶意 MCP Server 窃取邮件和凭据 | 首例 2025.9，~300 组织 | [The Hacker News](https://thehackernews.com/2025/09/first-malicious-mcp-server-found.html)、[Snyk](https://snyk.io/blog/malicious-mcp-server-on-npm-postmark-mcp-harvests-emails/) |
| 53% MCP Server 使用永不轮换的静态密钥 | 5,200 个服务器 | [Astrix Research](https://astrix.security/learn/blog/state-of-mcp-server-security-2025/) |
| MCP 配置被隐藏 Unicode 注入攻击 | 影响 Copilot & Cursor | [CVE-2025-54136](https://thehackernews.com/2025/08/cursor-ai-code-editor-vulnerability.html) |

你的 Cursor、Claude Code、VS Code 里的每一个 MCP 和 Skill，都可能在读你的密钥、删你的文件、掏空你的 API 预算、偷你的邮件。**没有人在替你检查。**

AgentShield 是**唯一一款**能深度扫描 16+ AI 工具、拦截危险运行时行为、沙箱隔离不可信代码的桌面应用——在你的下一个 `rm -rf ~/` 或 $82K 账单到来之前。

## 核心功能

- **深度安全扫描** — 自动发现并扫描 16+ AI 工具（Cursor、Claude Code、Claude Desktop、VS Code、Windsurf、Kiro、Zed、Codex CLI、Gemini CLI、Trae、Continue、Aider、CodeBuddy、Qwen Code、Antigravity、OpenClaw）。每一个暴露的密钥、每一个越权的配置、每一个被遗忘的残留文件，全部揪出来。
- **运行时守卫** — 实时行为拦截。文件删除、命令执行、网络请求、支付操作——全部阻断，等你亲自批准。不是记录日志，是**直接阻断**。那个把开发者整台 Mac 删掉的 `rm -rf ~/`？AgentShield 会先拦住，问你要不要继续。
- **沙箱隔离** — macOS `sandbox-exec` 将不可信的 MCP 和 Skill 锁在笼子里。断网、断文件系统。要么在笼子里运行，要么不运行。`postmark-mcp` 偷邮件？沙箱里没有网络，偷不出去。
- **密钥保险库** — 你的 API Key 现在正以明文形式躺在 JSON 文件里。那个 $82K Gemini 账单就是这么来的。AgentShield 把它们迁移到系统钥匙串（macOS 钥匙串 / Windows 凭据管理器）。这才是它们该待的地方。
- **已安装管理** — 三栏可视化仪表盘，展示你机器上每个 AI 工具的每个 MCP 和 Skill。信任等级、网络策略、一屏掌控。
- **技能商店** — 浏览和安装经过安全审核的扩展。每一个上架前都经过审查。
- **一键 OpenClaw 安装** *(Pro)* — AI 驱动的 OpenClaw 一键配置：环境检测、安装、渠道配置、排障——全程 AI 助手引导，一键搞定。

## 威胁检测

| 威胁类型 | 真实场景 | 状态 |
|---------|---------|------|
| **密钥暴露** | 你的 `OPENAI_API_KEY` 正在 `~/.cursor/mcp.json` 里明文裸奔 | **已检测** |
| **权限越界** | 配置文件权限 `644`——任何用户都能读你的密钥 | **已检测 + 自动修复** |
| **不安全自动化** | MCP 拥有不受限的 shell 权限，能执行任意命令 | **已检测** |
| **未审核插件** | 来源不明的 Skill 以完整权限运行，零审核 | **已检测 + 已隔离** |
| **密钥泛滥** | 同一个 API Key 复制粘贴到了 5 个工具的配置里 | **已检测** |
| **残留配置** | 工具卸载了，配置文件还在，密钥还在泄露 | **已检测** |
| **危险运行时操作** | MCP 试图删文件、发支付、向未知服务器传数据 | **已阻断 + 需审批** |
| **未授权网络访问** | 那个"只在本地运行"的 MCP？它正在连接你从没见过的 IP | **已监控 + 已隔离** |

## 安全优先架构

每一个技术决策都有安全原因：

**为什么用 Rust？** 内存安全，无垃圾回收。解析包含 API Key 的配置文件时，缓冲区溢出是不可接受的。实时行为拦截期间不能有 GC 停顿。

**为什么用 Tauri v2 而不是 Electron？** 80MB 安装包，不是 200MB+。不打包 Chromium = 更小的攻击面。原生 OS API 直接访问钥匙串、沙箱和进程控制。

**为什么用 Ed25519 签名？** 防篡改的许可证验证。离线优先。验证不需要联网。

**为什么用 macOS sandbox-exec？** 操作系统内核级进程隔离。比 Docker 更轻，比用户态沙箱更强。不可信代码：断网、断文件系统。

**为什么零遥测？** 一个会"打电话回家"的安全工具本身就是风险。所有扫描在本地完成。你的配置、密钥、扫描结果——永远不会离开你的电脑。

## 下载

| 平台 | 安装包 | 说明 |
|------|--------|------|
| **macOS** (Apple Silicon) | [**下载 .dmg**](https://github.com/pengluai/agentshield/releases/download/agentshield-pilot-v1.0.1/AgentShield-pilot-1.0.1-macos-arm64.dmg) | 首次打开需在「系统设置 → 隐私与安全性」中允许 |
| **Windows** (x64) | [**下载 .exe**](https://github.com/pengluai/agentshield/releases/download/agentshield-pilot-v1.0.1/AgentShield-pilot-1.0.1-windows-x64-setup.exe) | SmartScreen 提示时点击「仍要运行」 |

## 免费版 vs 专业版

| | 免费版 | 专业版 |
|--|--------|--------|
| 完整深度扫描（23 项检测） | Yes | Yes |
| 实时防护 + 自动隔离 | Yes | Yes |
| 沙箱隔离（网络 + 文件系统） | Yes | Yes |
| 运行时行为审批（12 种风险类型） | Yes | Yes |
| 系统通知（原生） | Yes | Yes |
| 密钥保险库（系统钥匙串） | Yes | Yes |
| 技能商店浏览 | Yes | Yes |
| 手动修复（终端命令） | Yes | Yes |
| **一键批量修复** | — | Yes |
| **一键安装 / 卸载** | — | Yes |
| **AI 安装助手（优先通道）** | — | Yes |
| **AI 智能修复建议** | — | Yes |
| **规则库自动更新** | — | Yes |
| **优先支持** | — | Yes |

> **免费版功能完整。** 发现威胁、理解风险——全部包含，不设限。
> 专业版省时间。当你厌倦了手动修复 20 个问题的时候，升级就好。
> **内含 14 天专业版试用。** 无需信用卡。

## 常见问题

<details>
<summary><b>macOS 提示「无法验证开发者」</b></summary>

打开「系统设置 → 隐私与安全性」→ 点击「仍要打开」。应用尚未通过 Apple 公证，二进制文件是安全的——你可以对照 GitHub Release 页面验证校验和。
</details>

<details>
<summary><b>Windows 提示「未知发布者」</b></summary>

安装包暂未签名。确认下载 URL 来自本 GitHub Release 页面后，点击「仍要运行」。
</details>

<details>
<summary><b>扫描没有发现 AI 工具</b></summary>

确保 AI 工具已经**至少启动过一次**（以创建配置目录）。AgentShield 通过配置路径发现工具——没有配置文件就无法检测。启动工具后重新扫描。
</details>

<details>
<summary><b>我的数据会被上传吗？</b></summary>

**不会。** 所有扫描在本机完成。配置数据、密钥、扫描结果永远不会离开你的电脑。唯一的网络请求是可选的许可证验证——而且那个请求也不发送任何扫描数据。
</details>

<details>
<summary><b>AgentShield 能替代杀毒软件吗？</b></summary>

不能。杀毒软件检测已知恶意软件特征。AgentShield 检测的是你的 AI 工具**能做什么**——能读什么文件、能执行什么命令、能连什么网络。不同的威胁模型，互补的防护。
</details>

---

<div align="center">

**Built with Rust, paranoia, and an unhealthy distrust of AI tools.**

[Report a Bug](https://github.com/pengluai/agentshield/issues) · [Releases](https://github.com/pengluai/agentshield/releases)

</div>
