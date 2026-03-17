<div align="center">

<img src="src-tauri/icons/icon.png" width="128" alt="AgentShield Logo" />

# AgentShield

**Security scanner for local AI tool ecosystems**

Your machine runs Cursor, Claude Code, MCP servers, and AI Skills —
but do you know which ones can read your API keys?

[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-blue?style=for-the-badge)](https://github.com/pengluai/agentshield/releases)
[![Version](https://img.shields.io/badge/Version-1.0.1-brightgreen?style=for-the-badge)](https://github.com/pengluai/agentshield/releases/tag/agentshield-pilot-v1.0.1)
[![Built with](https://img.shields.io/badge/Rust%20%2B%20Tauri%20v2-black?style=for-the-badge&logo=rust)](https://v2.tauri.app)
[![License](https://img.shields.io/badge/Free%20%2B%20Pro-orange?style=for-the-badge)](https://github.com/pengluai/agentshield/releases)

[English](#-the-problem) · [中文](#-中文)

</div>

---

## 🔥 The Problem

You installed 8 AI tools last week. Each one brought MCP servers, Skills, and config files.

Now ask yourself:

- Which MCP server has your `OPENAI_API_KEY` in **plaintext** inside `~/.cursor/mcp.json`?
- Which Skill has **unrestricted shell access** and can run any command on your machine?
- Which config file has **world-readable permissions** (`chmod 644`) exposing your secrets?

**You don't know. Nobody checks. That's the problem.**

AgentShield scans your machine in 30 seconds and shows you exactly what's at risk.

<!--
## 📸 Screenshots
TODO: Add 2-4 screenshots of the app UI here
| ![Scan Results](images/scan.png) | ![Security Map](images/map.png) |
|---|---|
| ![Key Vault](images/vault.png) | ![Skill Store](images/store.png) |
-->

## 🔍 What It Detects

| Threat | Real-World Example | Status |
|--------|-------------------|--------|
| **Secret Exposure** | API keys in plaintext MCP configs (`mcp.json`, `settings.json`) | ✅ Detected |
| **Permission Overreach** | Config files readable by any user on the machine | ✅ Detected + Auto-fix |
| **Unsafe Automation** | MCP servers with unrestricted filesystem or shell access | ✅ Detected |
| **Unvetted Plugins** | Skills/MCP from unknown sources without security review | ✅ Detected + Sandboxed |
| **Key Sprawl** | Same API key copy-pasted across 5 different tool configs | ✅ Detected |
| **Orphaned Configs** | Leftover MCP configs from uninstalled tools still holding secrets | ✅ Detected |
| **Dangerous Runtime Actions** | MCP deleting files, sending payments, exfiltrating data | ✅ Blocked + Approval |
| **Unauthorized Network Access** | Unknown MCP connecting to external servers | ✅ Monitored + Sandboxed |

## 🛡️ Supported AI Tools

AgentShield automatically discovers and scans configs for:

| | | | |
|---|---|---|---|
| **Cursor** | **Claude Code** | **Claude Desktop** | **VS Code / Cline** |
| **Windsurf** | **Zed** | **Trae** | **Gemini CLI** |
| **Codex CLI** | **Continue** | **Aider** | **OpenClaw** |
| **Kiro** | **CodeBuddy** | **Qwen Code** | **Antigravity** |

> 16+ AI hosts detected automatically via dynamic discovery. No manual config needed.

## ⚡ How It Works

```
1. Install          2. Scan              3. Protect            4. Fix
   ↓                   ↓                    ↓                    ↓
 Download DMG/EXE   One-click full scan   Real-time watcher    Manual fix (Free)
 → open → done      of all AI tools       auto-quarantines     or batch fix (Pro)
                    on your machine        new threats
                                           Sandbox blocks
                                           untrusted processes
                                           Approval popup for
                                           high-risk actions
```

## 📦 Download

| Platform | Installer | Note |
|----------|-----------|------|
| 🍎 **macOS** (Apple Silicon) | [**Download .dmg**](https://github.com/pengluai/agentshield/releases/download/agentshield-pilot-v1.0.1/AgentShield-pilot-1.0.1-macos-arm64.dmg) | First launch: allow in Privacy & Security |
| 🪟 **Windows** (x64) | [**Download .exe**](https://github.com/pengluai/agentshield/releases/download/agentshield-pilot-v1.0.1/AgentShield-pilot-1.0.1-windows-x64-setup.exe) | Click "Run anyway" if SmartScreen warns |

## ✨ Core Features

- **🔍 Security Scan** — Deep scan of all local AI tool configs, MCP servers, and Skills
- **🛡️ Real-Time Protection** — Filesystem watcher detects new threats the instant a config changes
- **🔒 Sandbox Isolation** — macOS `sandbox-exec` blocks untrusted MCP/Skills from network & filesystem access
- **⚠️ Runtime Approval** — High-risk actions (file delete, shell exec, payments) require your explicit approval before executing
- **🔐 Key Vault** — Import exposed keys into system keychain (macOS Keychain / Windows Credential Manager)
- **🔔 System Notifications** — Native macOS/Windows notification alerts for critical security events
- **🛒 Skill Store** — Browse and install security-reviewed MCP/Skills from curated catalog
- **🗺️ Installed Management** — Visual overview of all MCP/Skills across all AI tools, with trust levels and network policies
- **🤖 AI Advisor** — AI-powered analysis with context-aware fix suggestions
- **⚙️ OpenClaw Deploy** — One-click environment setup for OpenClaw ecosystem

## 💎 Free vs Pro

|  | Free | Pro |
|--|------|-----|
| Full security scan | ✅ | ✅ |
| Real-time protection & auto-quarantine | ✅ | ✅ |
| Sandbox isolation (network & filesystem) | ✅ | ✅ |
| Runtime action approval (12 risk types) | ✅ | ✅ |
| System notifications (macOS native) | ✅ | ✅ |
| Key vault (system keychain) | ✅ | ✅ |
| Skill store browsing | ✅ | ✅ |
| Manual fix with terminal commands | ✅ | ✅ |
| **One-click batch fix** | — | ✅ |
| **One-click install / uninstall** | — | ✅ |
| **AI-powered fix suggestions** | — | ✅ |
| **Priority support** | — | ✅ |

> **Start free.** Everything you need to find and understand risks is included.
> Upgrade to Pro when batch-fixing 20 issues by hand gets old.
> **14-day Pro trial included** — no credit card required.

## 🏗️ Tech Stack

```
┌──────────────────────────────────────────────────────┐
│                  AgentShield v1.0.1                   │
├────────────────────────┬─────────────────────────────┤
│     Frontend           │     Backend (Rust)           │
├────────────────────────┼─────────────────────────────┤
│ React 19 + TypeScript  │ Tauri v2 (native, no Electron) │
│ Tailwind CSS           │ 91 IPC commands              │
│ Zustand state mgmt     │ tokio async runtime          │
│ Framer Motion          │ keyring (system keychain)     │
│ Radix UI primitives    │ Ed25519 license signatures    │
│ Recharts               │ sandbox-exec process isolation│
│                        │ sysinfo + walkdir scanning   │
│                        │ notify fs watcher            │
└────────────────────────┴─────────────────────────────┘
```

**Why Tauri + Rust?**
- Native performance, ~80MB installer (not 200MB+ Electron)
- Rust backend = memory-safe security scanning
- System keychain integration (not plaintext file storage)
- No runtime dependency — download and run

---

## 🇨🇳 中文

### AgentShield 智盾 — AI 工具安全扫描器

你电脑里装了 Cursor、Claude、好几个 MCP 插件。
**但你知道哪个插件正在明文存储你的 API Key 吗？**

AgentShield 30 秒扫描全盘，帮你一眼看清所有风险。

### 核心能力

| 功能 | 说明 |
|------|------|
| 🔍 **安全扫描** | 自动发现 12+ AI 工具，深度扫描 MCP / Skill 配置 |
| 🛡️ **实时防护** | 文件系统监控，配置文件变更即刻检测威胁并自动隔离 |
| 🔒 **沙箱隔离** | 使用 macOS sandbox-exec 阻断不可信组件的网络和文件写入 |
| ⚠️ **行为审批** | 12 种高危操作（删除文件、执行命令、发送支付等）需你手动授权才能执行 |
| 🔐 **密钥保险库** | 将暴露的密钥导入系统钥匙串，告别明文存储 |
| 🔔 **系统通知** | macOS 原生通知推送安全告警 |
| 🛒 **技能商店** | 浏览和安装经过安全审核的 MCP / Skill |
| 🗺️ **已安装管理** | 可视化展示每个 MCP / Skill 归属、信任状态和网络策略 |
| 🤖 **AI 助手** | 智能分析风险，给出修复建议 |
| ⚙️ **一键部署** | OpenClaw 环境一键配置 |

### 下载

| 平台 | 安装包 |
|------|--------|
| 🍎 **macOS** (Apple Silicon) | [**下载 .dmg**](https://github.com/pengluai/agentshield/releases/download/agentshield-pilot-v1.0.1/AgentShield-pilot-1.0.1-macos-arm64.dmg) |
| 🪟 **Windows** (x64) | [**下载 .exe**](https://github.com/pengluai/agentshield/releases/download/agentshield-pilot-v1.0.1/AgentShield-pilot-1.0.1-windows-x64-setup.exe) |

> macOS 首次打开需在「系统设置 → 隐私与安全性」中点击「仍要打开」

### 免费 vs 专业版

| | 免费版 | 专业版 |
|--|--------|--------|
| 完整扫描 + 风险审查 | ✅ | ✅ |
| 实时防护 + 自动隔离 | ✅ | ✅ |
| 沙箱隔离（网络 + 文件系统） | ✅ | ✅ |
| 行为审批（12 种高危操作） | ✅ | ✅ |
| 系统通知 | ✅ | ✅ |
| 密钥保险库 | ✅ | ✅ |
| 手动修复（终端命令） | ✅ | ✅ |
| **一键批量修复** | — | ✅ |
| **一键安装/卸载** | — | ✅ |
| **AI 智能修复建议** | — | ✅ |

> 免费版功能完整，够用。专业版省时间。
> 内含 **14 天专业版试用**，无需信用卡。

---

## ❓ FAQ

<details>
<summary><b>macOS: "Cannot verify developer" / 无法验证开发者</b></summary>

Go to **System Settings → Privacy & Security** → click **"Open Anyway"**.

打开「系统设置 → 隐私与安全性」→ 点击「仍要打开」。
</details>

<details>
<summary><b>Windows: "Unknown publisher" / 未知发布者</b></summary>

The installer is not code-signed yet. Verify the download is from this GitHub release page, then click **"Run anyway"**.

安装包暂未签名。确认下载来源是本页面后，点击「仍要运行」。
</details>

<details>
<summary><b>No AI tools detected / 扫描没有发现 AI 工具</b></summary>

Make sure the AI tool is installed and has been **launched at least once** (to create its config directory), then scan again.

请确保 AI 工具已安装并至少运行过一次，然后重新扫描。
</details>

<details>
<summary><b>Is my data sent anywhere? / 数据会上传吗？</b></summary>

**No.** All scanning happens locally on your machine. No config data, keys, or scan results leave your computer. The only network call is optional license verification.

**不会。** 所有扫描在本机完成，配置、密钥、扫描结果不会离开你的电脑。唯一的网络请求是可选的许可证验证。
</details>

---

<div align="center">

**Made with Rust, paranoia, and ❤️ by the AgentShield Team**

[Report a Bug](https://github.com/pengluai/agentshield/issues) · [Releases](https://github.com/pengluai/agentshield/releases)

</div>
