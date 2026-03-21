# AgentShield Plan - Step 3 UX + Safe Repair Hardening (2026-03-19)

## 1) Objective and Scope

### Objective
Fix two high-impact problems in Installed Management:

1. **Step 3 (right panel) usability** is too dense and requires scrolling to reach core actions, which is confusing for zero-basis users.
2. **Repair safety** is not robust enough: update/remove flows that edit MCP config files can leave invalid config states (example reported: `~/.codex/config.toml` parse failure), causing external tools to fail.

### In scope
- Redesign Step 3 information architecture to be **action-first** and **progressive disclosure**.
- Keep core actions visible near the top; move advanced technical details behind explicit expansion.
- Harden config writes in `src-tauri/src/commands/store.rs` with **atomic write + validation + rollback**.
- Add/adjust tests and run full validation.

### Out of scope
- Rebuilding unrelated pages (Security Scan, OpenClaw zone, Storefront copy) unless directly affected.
- New monetization/payment features.

## 2) Assumptions and Constraints

- User is Pro; UI should prioritize one-click safe actions.
- Existing three-column layout remains (Step 1 -> Step 2 -> Step 3), but Step 3 internal layout can be refactored.
- Context7/SequentialThinking/Tavily MCP are not available in current environment; fallback is direct official documentation lookup via web.
- No destructive file operations; preserve backup/rollback paths.

## 3) Structured Decomposition (before coding)

1. Diagnose Step 3 vertical space usage and identify what must always be visible.
2. Split content into:
   - Primary controls (always visible)
   - Guided quick choices (always visible)
   - Advanced technical details (collapsed by default)
3. Harden write paths for JSON/YAML/TOML config updates:
   - Pre-serialize and parse validation
   - Temporary file write and flush
   - Atomic replace
   - Post-write parse validation
   - Auto-rollback on failure
4. Add regression tests for codex TOML safety path.

## 4) Execution Plan

### A. Step 3 UX refactor (beginner-first)

Target file: `src/components/pages/installed-management.tsx`

Planned changes:
- Add a compact **Quick Decision** block directly under "Primary actions":
  - Safety mode segmented controls: `允许正常运行 / 允许但监控 / 继续拦住`
  - Network mode segmented controls: `允许联网 / 禁止联网（沙箱）`
  - Keep `受控启动` visible in same top area.
- Replace long explanatory blocks with short plain-language hints.
- Move technical sections into `<details>` blocks:
  - Runtime sessions
  - Recent guard events
  - Evidence/source paths
  - Advanced policy metadata
- Reduce oversized spacings (`mb-6`, large cards) in Step 3 and make hierarchy more compact.
- Keep action wording beginner-friendly; technical jargon only appears in expandable detail sections.

### B. Safe write hardening (config integrity)

Target file: `src-tauri/src/commands/store.rs`

Planned changes:
- Introduce shared safe-write helper(s), e.g.:
  - `safe_write_text_file_atomic(path, content, validate)` where `validate` parses serialized result.
- For TOML writes:
  - Serialize with `toml::to_string_pretty`.
  - Validate serialized text via TOML parse before write.
  - Write to temp file in same directory, flush/sync, rename replace.
  - Re-read target and parse-validate again.
  - If failure, restore from `.bak`.
- Apply same hardening path to JSON/YAML writes where feasible.
- Keep existing `.bak` generation and make rollback deterministic.
- Ensure errors returned to frontend are explicit and actionable.

### C. Regression tests

Target file: `src-tauri/src/commands/store.rs` (test module)

Planned additions:
- Test that write/remove for codex TOML remain parseable after update/removal.
- Test rollback path when validation fails (simulated malformed output path/hook if practical).
- Preserve existing tests and ensure no regressions.

## 5) Validation Plan

Run after implementation:

1. `pnpm run typecheck`
2. `pnpm run lint`
3. `pnpm exec vitest run src/components/pages/__tests__/installed-management.test.tsx`
4. `pnpm run test`
5. `pnpm run build`
6. `cd src-tauri && cargo test commands::store::tests -- --nocapture`

If any check fails: stop, fix, rerun full set.

## 6) Reverse Review Pass 1 (Assumptions / Conflicts / Missing Dependencies)

Checklist:
- [x] Does Step 3 still preserve Step 1 -> Step 2 -> Step 3 mental model? Yes.
- [x] Are core actions accessible without scrolling on common desktop heights? Must verify with real app after changes.
- [x] Any coupling with runtime guard logic? Only presentation and existing callback wiring; no protocol change.
- [x] Any dependency missing for atomic write? No new crate required (use `std::fs`), optional improvements can be added later.

Decision:
- Proceed with refactor + write hardening.

## 7) Reverse Review Pass 2 (Failure Paths / Security Risks / Rollback Gaps)

Failure-risk checklist:
- [x] Partial write can corrupt config -> mitigated by temp write + atomic rename.
- [x] Serialization bug can emit invalid TOML/JSON/YAML -> mitigated by pre- and post-write parse validation.
- [x] Replace failure may leave temp file -> ensure cleanup and explicit error.
- [x] Backup exists but not restored automatically -> add restore-on-failure path.
- [x] UI one-click actions could remain overly aggressive -> keep existing confirmation gate for uninstall and keep high-risk actions explicit.

Rollback plan:
- Keep `.bak` copy before mutation.
- On validation/replace failure, restore `.bak` to primary file and surface error message.

Decision:
- Safe to implement.

## 8) Risks, Rollback, Completion Criteria

### Risks
- Cross-platform rename semantics differences.
- Over-compressing Step 3 could hide useful data for advanced users.

### Risk controls
- Preserve advanced data in collapsible sections (not removed).
- Keep deterministic rollback path and add regression tests.

### Completion criteria
- Step 3 core actions visible and operable without deep scroll.
- Beginner flow is action-first and readable.
- Config write flows (especially codex TOML) remain parse-valid across update/remove paths.
- Validation suite passes.

## 9) Official References (Best-practice Evidence)

Access date: **2026-03-19**

1. Microsoft List-Details pattern (master-detail workflow):  
   https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/list-details
2. Microsoft progressive disclosure guidance:  
   https://learn.microsoft.com/en-us/windows/win32/uxguide/ctrl-progressive-disclosure-controls
3. Apple Gatekeeper "Open Anyway" flow (user-facing install reality for unsigned builds):  
   https://support.apple.com/en-us/102445
4. OpenAI Codex config location and TOML configuration (`~/.codex/config.toml`):  
   https://developers.openai.com/codex/config-basic
5. Rust `std::fs::rename` semantics (replace/move behavior):  
   https://doc.rust-lang.org/std/fs/fn.rename.html
6. Rust `std::fs::write` semantics:  
   https://doc.rust-lang.org/std/fs/fn.write.html
7. Rust `File::sync_all` semantics:  
   https://doc.rust-lang.org/std/fs/struct.File.html#method.sync_all
8. TOML parsing API (`toml::from_str`) for validation:  
   https://docs.rs/toml/latest/toml/fn.from_str.html

