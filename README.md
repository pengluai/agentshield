# AgentShield

> English: A desktop safety app for AI tools that use `MCP` and `Skill`. AgentShield helps beginners find risky local configs, exposed secrets, and unsafe automation on their own machine.
>
> 中文：一款面向零基础用户的 AI 工具安全桌面应用。AgentShield 专门帮助你发现本机里使用 `MCP` / `Skill` 的工具、危险配置、密钥暴露和高风险自动化问题。

AgentShield is a desktop security companion for AI tools that use `MCP` and `Skill`.

It is built for beginners:

- detect which AI tools on this machine use MCP / Skill
- find where their MCP / Skill configs live
- scan those configs and installed items for risky behavior
- help install, update, review, and uninstall managed MCP / Skill items
- protect OpenClaw as one supported ecosystem, not the only one

AgentShield is **not** a system-wide antivirus. It only focuses on AI tools and local ecosystems that use `MCP` / `Skill`.

## Quick Start

1. Download the latest GitHub release for your system.
2. Install it directly from the downloaded asset. You do not need the Apple App Store or Microsoft Store.
3. Open AgentShield and finish onboarding.
4. Run the first full scan.
5. Review:
   - detected AI tools
   - detected MCP / Skill items
   - risky configs
   - high-risk approvals

First success checkpoint:

- the app opens normally
- at least one AI host or config path is detected, or the scan completes with a clear "nothing found" result
- you can open `Security Scan`, `Installed`, and `Key Vault` without fake/demo behavior

## What AgentShield Protects

AgentShield currently targets AI tools and hosts that use MCP / Skill, including:

- Codex CLI
- Cursor
- VS Code / Cline / Roo-style config locations
- Claude Code / Claude Desktop
- Windsurf
- Zed
- Trae
- Gemini CLI
- Continue
- Aider
- Antigravity
- OpenClaw

The exact discovery list is implemented in the desktop scanner and may expand over time.

## What It Does Today

- Detect installed AI tools and their MCP config locations
- Scan local MCP / Skill configs for risky patterns and weak file permissions
- Show which MCP / Skill belongs to which AI tool
- Refresh, install, update, and uninstall managed catalog items
- Provide a system-keychain-backed key vault
- Run controlled launch and network allowlist checks for supported local components
- Require backend approval tickets before:
  - deleting keys
  - revealing keys in plaintext
  - uninstalling OpenClaw
  - uninstalling managed MCP / Skill items
  - running one-click batch permission fixes

## Free vs Pro (Current Truth)

- Free:
  - full scan and risk review
  - manual per-item fix and approval
  - no one-click batch fix
- Pro / Trial:
  - one-click batch fix for supported issues
  - faster automation-oriented handling for repeated operations

## What It Does Not Claim Yet

AgentShield does **not** currently claim all of the following:

- system-wide protection for every app on the computer
- complete action-level interception of every third-party agent delete / email / browser / payment action
- in-app self-serve monthly or annual subscription checkout

Known current gaps:

- approval UI is still a full modal (corner-card approval UX is not shipped yet)
- opening macOS permission pages can fail on some setups; manual fallback is required
- Feishu / WeCom / Telegram guided notification setup is not shipped yet

Current real license path:

- free plan
- 14-day trial
- one-time checkout links for monthly / yearly / lifetime activation codes
- offline activation code

## License Gateway (Minimal Commercial Loop)

This repository now includes a minimal `License Gateway` service for:

- Lemon Squeezy webhook verification (`order_created`, `order_refunded`, `subscription_payment_refunded`)
- idempotent order processing
- activation code issuance via existing `issue_activation_code` signer
- automatic license revoke on refund webhooks
- public client verification endpoint (`POST /client/licenses/verify`) for in-app online status checks
- admin resend/reissue/revoke operations
- local audit and delivery records

### Run locally

```bash
cp .env.license-gateway.example .env.license-gateway.local
# fill required secrets in .env.license-gateway.local
set -a && source .env.license-gateway.local && set +a
pnpm run gateway:dev
```

The service listens on `LICENSE_GATEWAY_PORT` (default `8787`) and persists data to `LICENSE_GATEWAY_DATA_PATH` (default `data/license-gateway.json`).

Required env vars:

- `LEMONSQUEEZY_WEBHOOK_SECRET`
- `LICENSE_GATEWAY_ADMIN_PASSWORD`
- `AGENTSHIELD_LICENSE_SIGNING_SEED`

Optional (real email delivery instead of delivery-log only):

- `RESEND_API_KEY`
- `LICENSE_DELIVERY_FROM_EMAIL`
- `LICENSE_DELIVERY_REPLY_TO`

Recommended webhook subscriptions on Lemon Squeezy:

- `order_created`
- `order_refunded`
- `subscription_payment_refunded`

## Public Sale Readiness and Packaging

Before public commercial release, prepare:

- legal docs under `docs/legal/`
- real checkout URLs in env (`VITE_CHECKOUT_*`)
- real online verification endpoint in env (`AGENTSHIELD_LICENSE_GATEWAY_URL`)
- real release signing env + updater env (`TAURI_SIGNING_*`, `TAURI_UPDATER_*`)

For GitHub direct distribution (pilot/public sale without notarization):

```bash
# optional: bootstrap local release env template
cp .env.public-sale.example .env.public-sale.local
# fill .env.public-sale.local with real values

pnpm run release:github:ready
pnpm run release:github:bundle
```

For notarized public release (strict signing + updater path):

```bash
# optional: bootstrap local release env template
cp .env.public-sale.example .env.public-sale.local
# fill .env.public-sale.local with real values

pnpm run release:public:ready
pnpm run release:public:bundle
```

`scripts/public-sale-gate.sh` will auto-load `.env.public-sale.local` when present.
If `src-tauri/tauri.release.json` is absent, the gate will auto-generate it from `TAURI_UPDATER_PUBLIC_KEY` and `TAURI_UPDATER_ENDPOINT` via `pnpm run release:render-config`.

### GitHub Actions configuration

The release workflows in `.github/workflows/` expect the following GitHub repository configuration:

Repository Variables:

- `VITE_CHECKOUT_MONTHLY_URL`
- `VITE_CHECKOUT_YEARLY_URL`
- `VITE_CHECKOUT_LIFETIME_URL`
- `AGENTSHIELD_LICENSE_GATEWAY_URL`
- `AGENTSHIELD_LICENSE_PUBLIC_KEY`
- `LICENSE_DELIVERY_FROM_EMAIL`
- `LICENSE_DELIVERY_REPLY_TO` (optional)
- `TAURI_UPDATER_ENDPOINT` (signed release)
- `WINDOWS_TIMESTAMP_URL` (signed release)

Repository Secrets:

- `LEMONSQUEEZY_WEBHOOK_SECRET`
- `LICENSE_GATEWAY_ADMIN_PASSWORD`
- `AGENTSHIELD_LICENSE_SIGNING_SEED`
- `RESEND_API_KEY`
- `TAURI_SIGNING_PRIVATE_KEY` (signed release)
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (signed release)
- `TAURI_UPDATER_PUBLIC_KEY` (signed release)
- `WINDOWS_CERTIFICATE` (optional if Windows auto-import is enabled)
- `WINDOWS_CERTIFICATE_PASSWORD` (optional if Windows auto-import is enabled)
- `WINDOWS_CERTIFICATE_THUMBPRINT` (signed release)
- `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` / `APPLE_SIGNING_IDENTITY` (macOS signed release)
- `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` / `KEYCHAIN_PASSWORD` (optional if macOS certificate import is automated)

Workflows:

- `publish-pilot-artifacts`: builds draft macOS + Windows pilot artifacts from the `pilot` branch or manual dispatch
- `publish-signed-release`: builds draft signed artifacts from the `release` branch or manual dispatch

## GitHub Direct Install

### Windows

- Download the release asset from GitHub.
- If Windows shows a trust warning, verify the download source and filename first.
- Continue only if the asset came from this repository's GitHub release page.

### macOS

- Download the release asset from GitHub.
- Open it normally first.
- If macOS blocks the app, go to `Privacy & Security` and allow it there, then reopen the app.

Direct GitHub install is supported for pilot distribution. App Store distribution is not required for this project.

## Beginner Workflow

### 1. Scan this machine

Open `Security Scan` and run a full scan.

You should be able to tell at a glance:

- which AI tools were found
- which MCP / Skill items were found
- what the risk means
- whether AgentShield can auto-fix it

### 2. Review installed items

Open `Installed`.

Use it to:

- see which platform owns each MCP / Skill
- check versions and source URLs
- check for updates
- uninstall managed items

### 3. Protect keys

Open `Key Vault`.

Use it to:

- import exposed plaintext keys
- store keys in the system keychain
- export or delete keys only after explicit approval

### 4. Manage OpenClaw when needed

Open `OpenClaw Hub` only if you use OpenClaw.

Use it to:

- install OpenClaw
- update OpenClaw
- uninstall OpenClaw
- inspect OpenClaw-specific Skill / MCP configuration

OpenClaw is one supported ecosystem inside AgentShield. It is not the whole product scope.

## Troubleshooting

### No AI tools were detected

- Make sure the AI tool is actually installed on this machine.
- Launch the tool once if it has never created its config directory.
- Run the scan again.

### The app says a desktop action is unavailable

- Browser-shell preview mode cannot execute native desktop actions.
- Use the packaged desktop build from GitHub releases.

### Auto-fix says there is nothing to fix

- Auto-fix currently focuses on issues AgentShield can change safely and truthfully.
- Re-run the scan first; if the issue is still present but marked manual, review the file path and suggested fix instead.

### A dangerous action is blocked

- This is expected for key export, key deletion, uninstall, and batch fix flows that now require explicit approval.

## Developer Validation

These checks were used to validate the current repo-local desktop build:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
pnpm typecheck
pnpm test
pnpm exec playwright test e2e/smoke.spec.ts --reporter=line
pnpm run release:gate
```

## Sources

- Internal delivery boundary: [docs/specs/21-商用发布前复核与阻塞项更新-2026-03-11.md](docs/specs/21-商用发布前复核与阻塞项更新-2026-03-11.md), updated 2026-03-11
- Completion audit and gap list: [docs/specs/24-代码完成度核对与未完成清单-2026-03-11.md](docs/specs/24-代码完成度核对与未完成清单-2026-03-11.md), updated 2026-03-11
- GitHub pilot distribution flow: [docs/specs/16-试点GitHub分发流程.md](docs/specs/16-试点GitHub分发流程.md), updated 2026-03-09
- Release pipeline and signing expectations: [docs/specs/15-GitHub发布流水线与密钥配置.md](docs/specs/15-GitHub发布流水线与密钥配置.md), updated 2026-03-09
- Tauri macOS signing docs: [v2.tauri.app/distribute/sign/macos](https://v2.tauri.app/distribute/sign/macos/), checked 2026-03-11
- Tauri Windows signing docs: [v2.tauri.app/distribute/sign/windows](https://v2.tauri.app/distribute/sign/windows/), checked 2026-03-11
