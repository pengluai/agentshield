# 2026-03-21 文案修复：License Key -> Activation Code（中英文）

## 1. Objective and Scope
- 目标：将升级页“输入许可证密钥 / Enter license key”统一替换为“输入激活码 / Enter activation code”。
- 范围：
  - `src/constants/i18n.ts` 中对应中英文文案
  - 保持现有 i18n key 不变，仅改显示文本

## 2. Assumptions and Constraints
- 假设：当前产品对用户暴露的核心概念是“激活码（AGSH.*）”，不是“许可证密钥”。
- 约束：最小改动，不影响现有调用链与测试。

## 3. Official Basis (2026-03-21)
- Google Developer Style（plain/clear wording）：https://developers.google.com/style/word-list
- Microsoft UX writing guidance（use real-world language, avoid jargon）：https://learn.microsoft.com/en-us/windows/desktop/uxguide/text-style-tone

## 4. Execution Plan
1. 定位并修改 `enterLicenseKey` 的中英文值。
2. 同步修改 `licenseKey` 的中英文值，避免其他页面出现术语不一致。
3. 运行 typecheck + 目标测试验证。

## 5. Validation Plan
- `pnpm typecheck`
- `pnpm test -- src/components/pages/__tests__/upgrade-pro.test.tsx`

## 6. Reverse Review Pass 1
- 假设风险：只改一个键值可能导致其他页面仍显示“许可证密钥”。  
  处理：同时覆盖 `enterLicenseKey` 与 `licenseKey`。
- 依赖风险：重命名 key 会引发连锁。  
  处理：不改 key 名，仅改 value。

## 7. Reverse Review Pass 2
- 失败路径：文案统一后，历史截图/文档可能与 UI 不一致。  
  处理：本次只改 UI；文档在下一次合并说明中同步。
- 回滚：单文件回滚 `src/constants/i18n.ts`。

## 8. Completion Criteria
- 中文界面显示“输入激活码”。
- 英文界面显示“Enter activation code”。
- typecheck 与目标测试通过。
