# AgentShield Real Capability Matrix (Code-Verified)

Generated: 2026-03-14  
Method: traced from frontend button handlers -> Tauri `invoke` -> Rust command implementation.

## 1) What this app can really scan

### 1.1 AI host and extension discovery
- Detects AI hosts (IDE/CLI/app) such as Cursor, Kiro, VS Code, Claude Desktop, Claude Code, Codex CLI, OpenClaw, Gemini CLI, Qwen Code, etc.
- Evidence in code:
  - Tool definitions and known paths: `src-tauri/src/commands/scan.rs` (`TOOL_DEFS`, starts near line 80)
  - Commands exposed to frontend: `src-tauri/src/lib.rs` (`detect_ai_tools`, `scan_installed_mcps`, near lines 92-95)

### 1.2 Scope control: AI risk surface only (not generic software inventory)
- Discovery keeps paths only if they look like AI/MCP/Skill config roots or have MCP/Skill signatures.
- Supports non-standard/custom paths when file or directory has MCP/Skill signatures.
- Evidence in code:
  - `is_ai_risk_config_candidate`: `src-tauri/src/commands/discovery.rs` (near line 292)
  - `is_ai_risk_skill_root`: `src-tauri/src/commands/discovery.rs` (near line 320)
  - `sanitize_snapshot_for_home`: `src-tauri/src/commands/discovery.rs` (near line 480)
  - `is_allowed_snapshot_path`: `src-tauri/src/commands/discovery.rs` (near line 462)

### 1.3 Security scan categories (real backend scan)
- Full scan includes:
  - host/process correlation
  - MCP command/transport risk checks
  - key exposure checks
  - skill risk checks
  - file permission checks
  - system/runtime governance checks
- Entry point:
  - `scan_full`: `src-tauri/src/commands/scan.rs` (near line 3291)

## 2) What this app can really fix (and how)

### 2.1 Single issue fix (`修复此问题`)
- Backend command: `fix_issue`
- Real operation:
  - checks target exists
  - applies permission tightening on file
  - verifies permission issue is gone
- Evidence:
  - frontend call: `src/components/pages/security-scan.tsx` (near line 1135)
  - backend logic: `src-tauri/src/commands/scan.rs` (near line 4200)

### 2.2 Batch fix (`一键无损修复全部`)
- Backend command: `fix_all`
- Real operation:
  - validates license
  - validates action targets against current scan-derived targets
  - requires approval ticket before execution
  - applies permission fixes and verifies
- Evidence:
  - frontend call: `src/components/pages/security-scan.tsx` (near lines 687-738)
  - backend logic: `src-tauri/src/commands/scan.rs` (near line 4258)
  - target collection: `collect_fix_all_targets` in `scan.rs` (near line 2453)

### 2.3 Current fix boundary (important)
- Current automatic fix path is focused on permission hardening for risk config files.
- Not all issue categories are auto-remediated; some remain manual review/open-file flows.

## 3) High-risk behavior interception and user approval

### 3.1 Approval ticket is enforced
- High-risk actions can require explicit approval ticket.
- Evidence:
  - ticket gate: `require_action_approval_ticket` in `src-tauri/src/commands/runtime_guard.rs` (near line 611)
  - request approval API: `request_runtime_guard_action_approval` (near line 3715)
  - decision API: `resolve_runtime_guard_approval_request` (near line 3911)

### 3.2 Launch interception exists
- Sensitive component launches can be blocked pending approval.
- Evidence:
  - launch path: `launch_runtime_guard_component` in `runtime_guard.rs` (near line 4048)
  - approval precheck: `launch_requires_approval` in `runtime_guard.rs` (near line 1149)

### 3.3 Realtime protection exists
- Filesystem watcher monitors AI risk roots and emits incidents.
- Optional auto-quarantine behavior exists for certain cases.
- Evidence:
  - protection command: `configure_protection` in `src-tauri/src/commands/protection.rs` (near line 1016)
  - watch event handling: `handle_watch_event` in `protection.rs` (near line 872)
  - quarantine paths: `quarantine_dangerous_mcp_entries`, `quarantine_skill_root` in `protection.rs`

## 4) Button reality audit

- Full page-by-page button audit (code-derived) is here:
  - `docs/reports/ui-button-real-function-audit.md`
- That file marks each button as:
  - `REAL`: backend/runtime action with actual effect
  - `UI`: navigation/filter/local state only

## 5) External pain points that these controls target

Reference incidents and complaints used for alignment:
- OpenClaw-style unintended mailbox deletion incident reports:
  - https://uk.pcmag.com/ai/163336/meta-security-researchers-ai-agent-accidentally-deleted-her-emails
  - https://the-decoder.com/an-openclaw-ai-agent-asked-to-delete-a-confidential-email-nuked-its-own-mail-client-and-called-it-fixed/
- Agent/code-edit destructive complaints:
  - https://github.com/orgs/community/discussions/161952
  - https://www.reddit.com/r/GithubCopilot/comments/1rla2wz/github_copilot_deleted_my_entire_winforms/
- Risk taxonomy for excessive autonomy:
  - https://genai.owasp.org/llmrisk2023-24/llm08-excessive-agency/

## 6) Validation status

- Frontend tests: pass (`vitest`, 76 passed)
- Frontend typecheck/lint: pass
- Rust tests: pass (`cargo test`, 90 passed)
