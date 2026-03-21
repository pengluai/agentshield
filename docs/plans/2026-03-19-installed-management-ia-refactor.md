# Installed Management IA Refactor Plan (analysis-first)

Date: 2026-03-19
Status: Implemented and validated
Scope: `/src/components/pages/installed-management.tsx` only
Out of scope: OpenClaw page, storefront page, backend APIs

## 1) Objective
Resolve IA confusion in Installed Management for beginner users by making the 3-column flow strictly hierarchical:
1. Select host/tool
2. Select component under that host
3. View detail and execute actions

## 2) Current-code findings
- Left column and middle column both render host-level choices from `visibleHostEntries`.
- Right column mixes host summary and a second component list, which duplicates middle-column responsibility.
- Result: no explicit parent-child relationship between column 1 and column 2.

## 3) Constraints & assumptions
- Keep existing visual language and component style.
- Reuse existing state (`selectedHostId`, `selectedItem`) with minimal risk.
- Keep current bottom action bar behavior, but gate actions by selection stage.

## 4) Official references (accessed 2026-03-19)
- Apple WWDC22 NavigationSplitView guidance:
  https://developer.apple.com/videos/play/wwdc2022/10058/
- Android list-detail adaptive guidance:
  https://developer.android.com/develop/ui/views/layout/responsive-adaptive-design-with-views
- Microsoft list/details pattern:
  https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/list-details
- W3C WCAG 2.2 consistent navigation:
  https://www.w3.org/WAI/WCAG22/Understanding/consistent-navigation.html

## 5) Step-by-step implementation plan (after approval)
1. Keep left column as host selector only.
2. Replace middle column content with selected-host components only.
3. Remove component list block from right-host overview.
4. Add visible step labels: Step 1 / Step 2 / Step 3.
5. Ensure empty states are instructional (e.g., “select a component in Step 2”).

## 6) Validation plan
- `pnpm run typecheck`
- UI smoke test:
  - no host -> host selected -> component selected transitions
  - switching host resets selected component as expected
  - bottom action buttons reflect current stage

## 7) Reverse review pass #1 (assumption/dependency conflicts)
- Risk: hidden dependencies on middle-column host rows.
- Mitigation: reuse existing `items.filter(item.platform_id === selectedHost.id)` and `InstalledItemRow`.
- Risk: users lose high-level risk context.
- Mitigation: keep concise host summary in right column when no component selected.

## 8) Reverse review pass #2 (failure/security/rollback)
- Failure path: selection state desync when host changes.
- Mitigation: reset `selectedItem` on host change.
- Security: no privilege or command-surface changes in this task.
- Rollback: single-file revert possible (`installed-management.tsx`).

## 9) Completion criteria
- Columns have unique semantics (host / component / detail).
- Beginner can complete flow without tutorial.
- No lint/type errors.

## 10) Context7 applicability
Not applicable for this task because no third-party framework API integration decision is required; this is IA restructuring on existing local React/Tauri UI code.

## 11) Execution reconciliation (completed)
Implemented exactly as planned:
1. Left column remains host selector (Step 1 label added).
2. Middle column now renders only selected-host component list (Step 2).
3. Right host overview no longer duplicates component list; it focuses on host context + step guidance (Step 3).
4. Selection path is now deterministic: host -> component -> detail actions.

Validation results:
- `pnpm run lint` ✅
- `pnpm run typecheck` ✅
- `pnpm exec vitest run src/components/pages/__tests__/installed-management.test.tsx` ✅
- `pnpm run test` ✅ (22 files, 81 tests passed)
- `pnpm run build` ✅

Notes:
- Full test run still prints pre-existing jsdom/React Router warnings in stderr, but all tests pass.
