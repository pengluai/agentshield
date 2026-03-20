<div align="center">

<img src="src-tauri/icons/icon.png" width="128" alt="AgentShield Logo" />

# AgentShield

**Your AI tools are compromised. You just don't know it yet.**

[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-blue?style=for-the-badge)](https://github.com/pengluai/agentshield/releases)
[![Version](https://img.shields.io/badge/Version-1.0.1-brightgreen?style=for-the-badge)](https://github.com/pengluai/agentshield/releases/tag/agentshield-pilot-v1.0.1)
[![Built with](https://img.shields.io/badge/Rust%20%2B%20Tauri%20v2-black?style=for-the-badge&logo=rust)](https://v2.tauri.app)
[![License](https://img.shields.io/badge/Free%20%2B%20Pro-orange?style=for-the-badge)](https://github.com/pengluai/agentshield/releases)

[English](#the-problem) · [中文](#中文)

</div>

---

## The Problem

Your AI tools have root access to your machine. Every MCP server, every Skill, every config file — they can read your keys, delete your files, and call home. You just never checked.

Nobody checks. That's the problem.

AgentShield is the **only desktop app** that deep-scans 16+ AI tools, intercepts dangerous runtime behavior, and sandboxes untrusted code — before it's too late. First of its kind. No other tool does this.

## What AgentShield Does

- **Deep Security Scan** — Rips through configs of 16+ AI tools (Cursor, Claude Code, Claude Desktop, VS Code, Windsurf, Kiro, Zed, Codex CLI, Gemini CLI, Trae, Continue, Aider, CodeBuddy, Qwen Code, Antigravity, OpenClaw). Finds every exposed key, every permission overreach, every orphaned config still leaking secrets.
- **Runtime Guard** — Real-time behavioral interception. File deletions, shell exec, network calls, payment triggers — all blocked until you explicitly approve. Not logged. Blocked.
- **Sandbox Isolation** — macOS `sandbox-exec` locks untrusted MCP servers and Skills out of your filesystem and network. They run in a cage or they don't run.
- **Key Vault** — Your API keys are sitting in plaintext JSON files right now. AgentShield moves them into your system keychain (macOS Keychain / Windows Credential Manager). Where they should have been from the start.
- **Installed Management** — Visual 3-column dashboard showing every MCP server and Skill across every AI tool on your machine. Trust levels. Network policies. One screen, total visibility.
- **Skill Store** — Browse and install security-reviewed extensions from a curated catalog. Every entry vetted before it reaches your machine.
- **OpenClaw Ecosystem** — One-click environment setup and channel management for the OpenClaw platform.
- **Affiliate Promo Codes** — Partner program with trackable promo codes for distribution and referrals.

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

> 16+ AI hosts detected automatically via dynamic discovery.

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

## Tech Stack

```
Frontend:  React 19 + TypeScript + Tailwind CSS + Framer Motion
Backend:   Rust (Tauri v2) — 91 IPC commands, tokio async, sandbox-exec, Ed25519 license signatures
Size:      ~80MB installer (NOT 200MB+ Electron bloat)
Storage:   System keychain, not plaintext files
Network:   Zero telemetry. All scanning is local. Your data never leaves your machine.
```

**Why Tauri + Rust?** Because Electron apps ship a whole browser. We ship a binary. Rust gives us memory safety without a garbage collector — critical when you're scanning security-sensitive configs. The result: a native app that launches in under a second and uses a fraction of the memory.

## Free vs Pro

| | Free | Pro |
|--|------|-----|
| Full deep security scan | Yes | Yes |
| Real-time protection + auto-quarantine | Yes | Yes |
| Sandbox isolation (network + filesystem) | Yes | Yes |
| Runtime action approval (12 risk types) | Yes | Yes |
| System notifications (native) | Yes | Yes |
| Key vault (system keychain) | Yes | Yes |
| Skill store browsing | Yes | Yes |
| Manual fix with terminal commands | Yes | Yes |
| **One-click batch fix** | — | Yes |
| **One-click install / uninstall** | — | Yes |
| **AI-powered fix suggestions** | — | Yes |
| **Affiliate promo codes** | — | Yes |
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

没人查过。这就是问题。

AgentShield 是**唯一一款**能深度扫描 16+ AI 工具、拦截危险运行时行为、沙箱隔离不可信代码的桌面应用。同类产品不存在。

## 核心功能

- **深度安全扫描** — 自动发现并扫描 16+ AI 工具（Cursor、Claude Code、Claude Desktop、VS Code、Windsurf、Kiro、Zed、Codex CLI、Gemini CLI、Trae、Continue、Aider、CodeBuddy、Qwen Code、Antigravity、OpenClaw）。每一个暴露的密钥、每一个越权的配置、每一个被遗忘的残留文件，全部揪出来。
- **运行时守卫** — 实时行为拦截。文件删除、命令执行、网络请求、支付操作——全部阻断，等你亲自批准。不是记录日志，是直接阻断。
- **沙箱隔离** — macOS `sandbox-exec` 将不可信的 MCP 和 Skill 锁在笼子里。断网、断文件系统。要么在笼子里运行，要么不运行。
- **密钥保险库** — 你的 API Key 现在正以明文形式躺在 JSON 文件里。AgentShield 把它们迁移到系统钥匙串（macOS 钥匙串 / Windows 凭据管理器）。这才是它们该待的地方。
- **已安装管理** — 三栏可视化仪表盘，展示你机器上每个 AI 工具的每个 MCP 和 Skill。信任等级、网络策略、一屏掌控。
- **技能商店** — 浏览和安装经过安全审核的扩展。每一个上架前都经过审查。
- **OpenClaw 生态管理** — 一键环境配置和渠道管理。
- **合作伙伴推广码** — 可追踪的推广码系统，面向分销和推荐合作伙伴。

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

## 下载

| 平台 | 安装包 | 说明 |
|------|--------|------|
| **macOS** (Apple Silicon) | [**下载 .dmg**](https://github.com/pengluai/agentshield/releases/download/agentshield-pilot-v1.0.1/AgentShield-pilot-1.0.1-macos-arm64.dmg) | 首次打开需在「系统设置 → 隐私与安全性」中允许 |
| **Windows** (x64) | [**下载 .exe**](https://github.com/pengluai/agentshield/releases/download/agentshield-pilot-v1.0.1/AgentShield-pilot-1.0.1-windows-x64-setup.exe) | SmartScreen 提示时点击「仍要运行」 |

## 技术栈

```
前端:    React 19 + TypeScript + Tailwind CSS + Framer Motion
后端:    Rust (Tauri v2) — 91 个 IPC 命令, tokio 异步运行时, sandbox-exec, Ed25519 许可证签名
体积:    ~80MB 安装包（不是 200MB+ 的 Electron 膨胀体）
存储:    系统钥匙串，不是明文文件
网络:    零遥测。所有扫描在本地完成。你的数据永远不会离开你的电脑。
```

## 免费版 vs 专业版

| | 免费版 | 专业版 |
|--|--------|--------|
| 完整深度扫描 | Yes | Yes |
| 实时防护 + 自动隔离 | Yes | Yes |
| 沙箱隔离（网络 + 文件系统） | Yes | Yes |
| 运行时行为审批（12 种风险类型） | Yes | Yes |
| 系统通知（原生） | Yes | Yes |
| 密钥保险库（系统钥匙串） | Yes | Yes |
| 技能商店浏览 | Yes | Yes |
| 手动修复（终端命令） | Yes | Yes |
| **一键批量修复** | — | Yes |
| **一键安装 / 卸载** | — | Yes |
| **AI 智能修复建议** | — | Yes |
| **合作伙伴推广码** | — | Yes |
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

---

<div align="center">

**Built with Rust, paranoia, and an unhealthy distrust of AI tools.**

[Report a Bug](https://github.com/pengluai/agentshield/issues) · [Releases](https://github.com/pengluai/agentshield/releases)

</div>
