# 2026-03-21 激活码术语全仓替换方案（全部修改）

## 1. Objective and Scope
- 目标：将仓库内旧术语统一替换为“激活码 / Activation Code”表述，满足“全部修改”要求。
- 范围：
  - 运行界面与用户提示：`src/`, `src-tauri/`, `workers/storefront/site/`
  - 历史文档：`docs/specs/`, `docs/plans/`
- 非目标：
  - 不改变许可证状态机、签名验签、网关协议逻辑。

## 2. Assumptions and Constraints
- 假设：统一术语可降低用户误解与误填概率。
- 约束：
  1. 最小风险，优先文本替换，不做不必要结构性重构。
  2. 术语替换后需保持语义可读。

## 3. Official Basis (2026-03-21)
- Tavily：当前配额不可用，按项目规则启用官方来源兜底。
- 微文案原则（plain language）：
  - Google style resources: https://developers.google.com/style
  - Microsoft UX text guidance: https://learn.microsoft.com/en-us/windows/desktop/uxguide/text-style-tone
- Context7：本任务不涉及具体框架 API 行为，标记为 not applicable。

## 4. Execution Plan
1. 全量扫描旧术语命中清单。
2. 先完成两轮反向审查。
3. 对命中文件逐个替换为新术语。
4. 回扫确认旧术语全仓命中为 0。
5. 执行验证命令（前端 + Rust）。

## 5. Validation Plan
- `pnpm typecheck`
- `pnpm test -- src/components/pages/__tests__/upgrade-pro.test.tsx`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- 关键词回扫（全仓）：旧术语命中数必须为 0。

## 6. Reverse Review Pass 1
- 风险：只改界面，不改历史文档，导致“全部修改”不满足。  
  处理：本次把 `docs/specs` 与 `docs/plans` 一并纳入替换。
- 风险：替换时误改 key 名或 API 标识。  
  处理：仅替换自然语言文本，不修改键名、协议名和 URL。

## 7. Reverse Review Pass 2
- 风险：内部错误文本替换后语义怪异。  
  处理：逐条人工检查改后句子可读性。
- 风险：遗漏注释/标题。  
  处理：回扫覆盖注释、正文、标题所有文本。

## 8. Completion Criteria
- 全仓旧术语命中数 = 0。
- 运行界面文案均为“激活码 / Activation Code”。
- 验证命令通过。

## 9. Implementation Record (2026-03-21)
- 已修改文件：
  1. `src/components/pages/upgrade-pro.tsx`（注释术语）
  2. `src-tauri/src/commands/license.rs`（keychain 错误提示术语）
  3. `docs/specs/42-Creem支付替换研究与迁移方案-2026-03-16.md`（历史文档术语）
  4. `docs/plans/2026-03-21-activation-code-copy-update.md`（历史计划术语）
  5. `docs/plans/2026-03-21-activation-code-wording-full-sweep.md`（历史计划术语）
- 文件重命名：
  - `docs/plans/2026-03-21-license-key-copy-to-activation-code.md`
  - -> `docs/plans/2026-03-21-activation-code-copy-update.md`

## 10. Post-implementation Reconciliation
- 全仓回扫结果：
  - 关键词（旧术语）命中数：`0`
  - 回扫命令：`rg -n -i "<legacy-term-pattern>" --hidden`
- 验证结果：
  - `pnpm typecheck` ✅
  - `pnpm test -- src/components/pages/__tests__/upgrade-pro.test.tsx` ✅
  - `cargo check --manifest-path src-tauri/Cargo.toml` ✅
