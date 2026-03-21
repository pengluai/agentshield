# 2026-03-21 激活码术语全量清扫（不遗漏检查）

## 1. Objective and Scope
- 目标：对产品运行界面进行全量术语检查，确保“输入激活码 / Enter activation code / Activation Code”等用户可见文案统一为“激活码 / Activation code”。
- 范围：
  - `src/constants/i18n.ts`
  - `src-tauri/src/commands/*.rs`（会返回给前端的错误提示）
  - `workers/storefront/site/*`（若存在相关文案）
- 非范围：
  - 历史规格文档（`docs/specs`）中的研究术语不作为运行界面文案。

## 2. Assumptions and Constraints
- 假设：当前用户理解成本最高的点是“Activation Code”术语不直观，统一为“激活码”可显著降低误操作。
- 约束：
  1. 保持 i18n key 不变，仅改 value，避免连锁改动。
  2. 只改用户可见文案，不改底层许可证模型代码逻辑。

## 3. Research and Evidence (2026-03-21)
- Tavily：不可用（超配额），按规则启用官方站点兜底检索。
- Google Developer Style（plain language）：https://developers.google.com/style/word-list
- Microsoft UX writing（clear familiar words, avoid jargon）：https://learn.microsoft.com/en-us/windows/desktop/uxguide/text-style-tone
- Context7：本任务无特定框架 API 约束，标记为 not applicable。

## 4. Step-by-step Plan
1. 全仓扫描关键词：
   - `激活码`, `Activation Code`, `Enter activation code`, `activation code`, `输入激活`
2. 按“运行界面/历史文档”分组：
   - 运行界面：必须修复
   - 历史文档：仅记录，不做批量改写
3. 实施修复：
   - i18n 文案值
   - Rust 返回给 UI 的提示语
4. 二次回扫确认残留为 0（运行界面范围）。
5. 执行验证命令。

## 5. Validation Plan
- `pnpm typecheck`
- `pnpm test -- src/components/pages/__tests__/upgrade-pro.test.tsx`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- 关键字回扫（运行界面路径）：
  - `src/`
  - `src-tauri/`
  - `workers/storefront/site/`

## 6. Reverse Review Pass 1
- 假设错误：只改前端 i18n，漏掉后端提示文案。  
  处理：把 `src-tauri/src/commands` 一并纳入扫描。
- 依赖遗漏：改 key 名会破坏调用。  
  处理：不改 key，仅改文案值。

## 7. Reverse Review Pass 2
- 失败路径：语义改动过大导致“许可证状态”概念丢失。  
  处理：仅把“输入激活码”相关入口改为“输入激活码”；保留“许可证状态”语句。
- 回滚：单文件回滚 `i18n.ts` 与 `install.rs/store.rs`。

## 8. Completion Criteria
- 运行界面范围内不再出现“输入激活码 / Enter activation code / Activation Code”残留。
- 中英文入口统一显示“激活码 / Activation code”。
- typecheck、目标测试、cargo check 通过。

## 9. Implementation Record (2026-03-21)
- 已修复：
  1. `src/constants/i18n.ts`：`licenseKey` / `enterLicenseKey` 中英文值统一为激活码术语。
  2. `src-tauri/src/commands/install.rs`：3 处提示改为“输入激活码/输入新的激活码”。
  3. `src-tauri/src/commands/store.rs`：3 处提示改为“输入激活码/输入新的激活码”。
- 回扫结果（运行界面范围）：
  - 关键词 `激活码|Activation Code|Enter activation code|输入激活` 命中数：0

## 10. Post-implementation Reconciliation
- 与目标逐项核对：
  1. UI 主入口按钮：已显示“输入激活码 / Enter activation code”。
  2. 后端返回提示：已无“输入激活码”残留。
  3. 历史文档中的 Activation Codes 术语保留（仅文档语境，不影响运行界面）。
- 验证结果：
  - `pnpm typecheck` ✅
  - `pnpm test -- src/components/pages/__tests__/upgrade-pro.test.tsx` ✅
  - `cargo check --manifest-path src-tauri/Cargo.toml` ✅
