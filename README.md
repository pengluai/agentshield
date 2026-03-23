<div align="center">

<img src="src-tauri/icons/icon.png" width="100" alt="AgentShield" />

# AgentShield

**Desktop security suite for AI coding tools.** Scans 16+ tools, intercepts dangerous actions, sandboxes untrusted code.

[![Platform](https://img.shields.io/badge/macOS%20%7C%20Windows-blue?style=flat-square)](https://github.com/pengluai/agentshield/releases)
[![Version](https://img.shields.io/badge/v1.0.1-brightgreen?style=flat-square)](https://github.com/pengluai/agentshield/releases/tag/agentshield-pilot-v1.0.1)
[![Rust + Tauri v2](https://img.shields.io/badge/Rust%20%2B%20Tauri%20v2-black?style=flat-square&logo=rust)](https://v2.tauri.app)
[![License](https://img.shields.io/badge/Free%20%2B%20Pro-orange?style=flat-square)](https://app.51silu.com)

[Website](https://app.51silu.com) · [Download](https://github.com/pengluai/agentshield/releases) · [Report Bug](https://github.com/pengluai/agentshield/issues)

</div>

---

<p align="center">
  <img src="workers/storefront/site/images/1.png" width="700" alt="AgentShield Dashboard" />
</p>

## What It Does

AgentShield deep-scans your AI tool ecosystem and protects against real threats:

- **Security Scan** — 23-check scan across privacy leaks, key exposure, permission risks, malicious plugins, and background activity
- **Real-time Guard** — Monitors MCP configs and Skill directories. Blocks dangerous actions (file deletion, payment, shell exec) until you approve
- **Key Vault** — System keychain encryption for API keys. No more plaintext in config files
- **Skill Store** — 228+ security-reviewed MCP extensions with safety ratings
- **Installed Management** — Full control over 196+ AI tools: review, fix, update, or uninstall
- **OpenClaw Hub** — One-click install + AI-guided setup for OpenClaw framework *(Pro)*

### Supported Tools

Cursor · Claude Code · Claude Desktop · VS Code/Cline · Windsurf · Zed · Trae · Gemini CLI · Codex CLI · Kiro · Continue · Aider · OpenClaw · CodeBuddy · Qwen Code · Antigravity

<p align="center">
  <img src="workers/storefront/site/images/44639047-3d66-4211-b1a7-caa377d74bf4.png" width="700" alt="Security Scan Results" />
</p>

## Why This Exists

| Incident | Impact | Source |
|----------|--------|--------|
| Claude Code ran `rm -rf ~/` | Entire Mac wiped — Desktop, Keychain, credentials | [Reddit](https://whenaifail.com/) |
| Stolen Gemini API key | $82,314 bill in 48 hours | [The Register](https://www.theregister.com/2026/03/03/gemini_api_key_82314_dollar_charge/) |
| Malicious MCP server (`postmark-mcp`) | ~300 orgs' emails silently stolen | [The Hacker News](https://thehackernews.com/2025/09/first-malicious-mcp-server-found.html) |
| Claude Code agent destroyed database | 2.5 years of production data gone | [Fortune](https://fortune.com/2026/03/18/ai-coding-risks-amazon-agents-enterprise/) |
| 53% of MCP servers use static API keys | 5,200 servers analyzed by Astrix | [Astrix Research](https://astrix.security/learn/blog/state-of-mcp-server-security-2025/) |

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Core** | Rust | Memory-safe config parsing. No GC pauses during runtime interception |
| **Framework** | Tauri v2 | 80MB install (not 200MB+ Electron). Native OS API access to Keychain, sandbox, process control |
| **Frontend** | React + TypeScript | Type-safe UI with real-time state management |
| **Sandbox** | macOS `sandbox-exec` | Kernel-level process isolation. Network + filesystem cutoff for untrusted code |
| **License** | Ed25519 signatures | Tamper-proof offline license verification |
| **Telemetry** | Zero | All scanning is local. Your keys and configs never leave your machine |

## Install

| Platform | Download | Note |
|----------|----------|------|
| **macOS** (Apple Silicon) | [Download .dmg](https://github.com/pengluai/agentshield/releases/download/agentshield-pilot-v1.0.1/AgentShield-pilot-1.0.1-macos-arm64.dmg) | Allow in System Settings → Privacy & Security |
| **Windows** (x64) | [Download .exe](https://github.com/pengluai/agentshield/releases/download/agentshield-pilot-v1.0.1/AgentShield-pilot-1.0.1-windows-x64-setup.exe) | Click "Run anyway" on SmartScreen |

## Free vs Pro

| Feature | Free | Pro |
|---------|------|-----|
| Full 23-check scan | ✅ | ✅ |
| Real-time guard + sandbox | ✅ | ✅ |
| Runtime approval (12 risk types) | ✅ | ✅ |
| Key vault (system keychain) | ✅ | ✅ |
| Skill store browsing | ✅ | ✅ |
| Manual fix (terminal commands) | ✅ | ✅ |
| **One-click batch fix** | — | ✅ |
| **OpenClaw one-click install + AI setup** | — | ✅ |
| **AI-guided fix suggestions** | — | ✅ |
| **Live threat rule updates** | — | ✅ |
| **Batch operations** | — | ✅ |

> Free is fully functional. Pro saves time. 14-day Pro trial included — no credit card.

## FAQ

<details><summary><b>macOS says "unidentified developer"</b></summary>
System Settings → Privacy & Security → click "Open Anyway". Binary is safe — verify checksum on the Releases page.
</details>

<details><summary><b>Scan found no AI tools</b></summary>
Make sure each AI tool has been launched at least once (to create its config directory). AgentShield discovers tools via config paths.
</details>

<details><summary><b>Does it upload my data?</b></summary>
No. All scanning runs locally. The only network request is optional license validation — it sends zero scan data.
</details>

<details><summary><b>Does it replace antivirus?</b></summary>
No. Antivirus detects known malware signatures. AgentShield audits what your AI tools <i>can do</i> — file access, shell execution, network connections. Different threat model, complementary protection.
</details>

---

<div align="center">

**Rust · Tauri v2 · React · TypeScript · Zero telemetry**

[Website](https://app.51silu.com) · [Releases](https://github.com/pengluai/agentshield/releases) · [Report Bug](https://github.com/pengluai/agentshield/issues)

</div>
