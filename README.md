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
| **Permission Overreach** | Config files readable by any user on the machine | ✅ Detected |
| **Unsafe Automation** | MCP servers with unrestricted filesystem or shell access | ✅ Detected |
| **Unvetted Plugins** | Skills/MCP from unknown sources without security review | ✅ Detected |
| **Key Sprawl** | Same API key copy-pasted across 5 different tool configs | ✅ Detected |
| **Orphaned Configs** | Leftover MCP configs from uninstalled tools still holding secrets | ✅ Detected |

## 🛡️ Supported AI Tools

AgentShield automatically discovers and scans configs for:

| | | | |
|---|---|---|---|
| **Cursor** | **Claude Code** | **Claude Desktop** | **VS Code / Cline** |
| **Windsurf** | **Zed** | **Trae** | **Gemini CLI** |
| **Codex CLI** | **Continue** | **Aider** | **OpenClaw** |

> 12+ AI hosts detected automatically. No manual config needed.

## ⚡ How It Works

```
1. Install          2. Scan              3. Review & Fix
   ↓                   ↓                    ↓
 Download DMG/EXE   One-click full scan   See every risk with
 → open → done      of all AI tools       clear fix suggestions
                    on your machine        → fix one by one (Free)
                                           → batch fix all (Pro)
```

## 📦 Download

| Platform | Installer | Note |
|----------|-----------|------|
| 🍎 **macOS** (Apple Silicon) | [**Download .dmg**](https://github.com/pengluai/agentshield/releases/download/agentshield-pilot-v1.0.1/AgentShield-pilot-1.0.1-macos-arm64.dmg) | First launch: allow in Privacy & Security |
| 🪟 **Windows** (x64) | [**Download .exe**](https://github.com/pengluai/agentshield/releases/download/agentshield-pilot-v1.0.1/AgentShield-pilot-1.0.1-windows-x64-setup.exe) | Click "Run anyway" if SmartScreen warns |

## ✨ Core Features

- **🔍 Security Scan** — Deep scan of all local AI tool configs, MCP servers, and Skills
- **🗺️ Security Map** — Visual ownership: which MCP/Skill belongs to which AI tool
- **🔐 Key Vault** — Import exposed keys into system keychain (macOS Keychain / Windows Credential Manager)
- **🛒 Skill Store** — Browse and install security-reviewed MCP/Skills from curated catalog
- **🤖 AI Advisor** — AI-powered analysis with context-aware fix suggestions
- **⚙️ OpenClaw Deploy** — One-click environment setup for OpenClaw ecosystem

## 💎 Free vs Pro

|  | Free | Pro |
|--|------|-----|
| Full security scan | ✅ | ✅ |
| Risk review & security map | ✅ | ✅ |
| Key vault (system keychain) | ✅ | ✅ |
| Skill store browsing | ✅ | ✅ |
| Fix issues one-by-one | ✅ | ✅ |
| **One-click batch fix** | — | ✅ |
| **AI-powered fix suggestions** | — | ✅ |
| **Automation acceleration** | — | ✅ |
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
│ Tailwind CSS           │ 69 IPC commands              │
│ Zustand state mgmt     │ tokio async runtime          │
│ Framer Motion          │ keyring (system keychain)     │
│ Radix UI primitives    │ Ed25519 license signatures    │
│ Recharts               │ sysinfo + walkdir scanning   │
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
| 🗺️ **安全映射** | 可视化展示每个 MCP / Skill 归属哪个 AI 工具 |
| 🔐 **密钥保险库** | 将暴露的密钥导入系统钥匙串，告别明文存储 |
| 🛒 **技能商店** | 浏览和安装经过安全审核的 MCP / Skill |
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
| 密钥保险库 + 安全映射 | ✅ | ✅ |
| 逐项修复 | ✅ | ✅ |
| **一键批量修复** | — | ✅ |
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
