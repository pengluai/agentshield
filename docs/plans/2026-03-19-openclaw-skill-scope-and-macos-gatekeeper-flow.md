# OpenClaw Skill Scope + macOS Gatekeeper Flow Plan (2026-03-19)

## Objective and scope
Address two user-facing issues:
1. In OpenClaw UI, scan/display only OpenClaw-owned skills (not unrelated host skills).
2. Update website macOS download/install guidance to include the real Gatekeeper path: System Settings -> Privacy & Security -> Open Anyway.

## Assumptions and constraints
- User expects OpenClaw page semantics to be OpenClaw-only, while global security scan can remain cross-host.
- Existing codebase already has separate OpenClaw commands (`get_openclaw_skills`) and global discovery code.
- Time-sensitive behavior (Gatekeeper/Open Anyway) must be source-backed from Apple docs.

## Research summary (official)
- OpenClaw skills model: location precedence and eligibility are defined in OpenClaw official docs.
- OpenClaw config reference confirms skills gating via `skills.entries.<skillKey>.enabled` and `allowBundled`.
- Apple official support documents confirm: after first blocked launch, go to System Settings -> Privacy & Security -> Open Anyway; button appears for about one hour.

## Execution plan
1. Inspect current OpenClaw skill loading command and determine where cross-host leakage can occur.
2. Implement strict scope in `get_openclaw_skills`: include only directories physically under OpenClaw skills roots and require SKILL.md presence.
3. Keep global discovery logic unchanged (security modules still need broader visibility).
4. Update storefront macOS modal copy to reflect Apple official Gatekeeper override path.
5. Validate:
   - compile/tests for Rust command path
   - static grep check for modal text
   - deploy storefront and confirm live page includes new copy

## Validation plan
- Rust: run targeted/full tests feasible in project context.
- Frontend/storefront: text presence checks + deploy + HTTP fetch/grep.

## Reverse review pass 1 (assumptions/dependencies/conflicts)
- Risk: forcing OpenClaw-only could hide symlink-based external skills intentionally linked into OpenClaw.
- Decision: strict mode should enforce path boundary for the OpenClaw UI to match user expectation; global scan remains broad to preserve security coverage.
- Dependency: use canonicalized paths to avoid symlink/path traversal mismatches.

## Reverse review pass 2 (failure/security/rollback)
- Failure mode: canonicalization can fail on broken symlinks. Handle gracefully by skipping invalid entries.
- Security: prevent external path injection into OpenClaw skill list by requiring in-root canonical path.
- Rollback: revert only `get_openclaw_skills` filtering logic if users need legacy behavior.

## Completion criteria
- OpenClaw skill API returns only OpenClaw-root skills with SKILL.md.
- Website modal includes System Settings -> Privacy & Security -> Open Anyway guidance in zh/en.
- Changes are source-backed and validated.

## Sources (accessed 2026-03-19)
- https://docs.openclaw.ai/tools/skills
- https://docs.openclaw.ai/gateway/configuration-reference
- https://support.apple.com/en-us/102445
- https://support.apple.com/en-euro/guide/mac-help/mh40617
