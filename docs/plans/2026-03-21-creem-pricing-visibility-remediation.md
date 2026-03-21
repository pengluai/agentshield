# 2026-03-21 Creem 价格可见性整改方案（官网 + 升级页）

## 1. Objective and Scope
- 目标：修复 Creem `Request changes` 中“价格不可见/客户在点击前无法看到最终费用”的审核问题。
- 范围：
  - `workers/storefront/site/index.html`（官网 pricing 区）
  - `src/components/pages/upgrade-pro.tsx`（桌面应用升级页文案与引导）
  - 必要时补充相关测试
- 非目标：
  - 不改 License Gateway 核心签发/验签逻辑
  - 不改 Creem 产品 ID / webhook / payout 配置

## 2. Assumptions and Constraints
- 假设：
  1. 当前真实售卖档位仍为：Monthly / Yearly / Lifetime（已在代码与支付链接中存在）。
  2. 当前结算货币以 Creem checkout 页显示为准，整改需确保用户在点击前看到清晰价格与计费周期。
  3. 用户当前问题由“展示透明度”导致，不是支付网关不可用。
- 约束：
  1. 必须遵循仓库强制流程：先文档、两轮反向审查、后施工。
  2. 必须使用官方来源（Creem 官方文档）作为整改依据。
  3. 不得引入会破坏现有购买链路的变更。

## 3. Official Basis (with dates)
- Creem Account Reviews（访问日期：2026-03-21）  
  https://docs.creem.io/merchant-of-record/account-reviews/account-reviews  
  关键依据：
  - `Pricing is visible`（价格需清晰可见、易于找到）
  - 常见驳回原因包含 `Support email mismatch`、`Website not accessible`、`Missing legal pages`
- Creem Discounts（访问日期：2026-03-21）  
  https://docs.creem.io/features/discounts  
  关键依据：`discount_code` 为 checkout 合法参数，优惠码链路与激活码链路是两套流程，不可混用。
- Context7: `/websites/creem_io`（访问日期：2026-03-21）  
  校验了上述页面与 checkout 参数行为，确认与当前代码实现方向一致。

## 4. Step-by-step Execution Plan
1. 修复官网 pricing 区价格可见性：
   - Pro 卡片直接显示月付与年付实际金额（含周期）。
   - Lifetime 卡片直接显示一次性金额。
   - 增加清晰的计费说明（结算货币与最终金额展示位置）。
2. 修复应用升级页文案歧义：
   - 强化“优惠码”和“激活码”的区别提示，避免用户将 `AGSH.*` 填到优惠码输入框。
   - 保持激活入口与购买入口语义分离。
3. 回归验证：
   - 本地 lint/typecheck/test/build
   - 线上 smoke（页面包含价格文本、购买链接仍可达）
4. 输出复审操作清单：
   - 明确 Creem 后台点击 `请求重新审核` 前需核对的页面证据。

## 5. Validation Plan
- 代码质量门禁：
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm build`
- 目标性校验：
  - `curl https://app.51silu.com` 抽样检查 pricing 文本是否包含 monthly/yearly/lifetime 对应金额。
  - 校验购买链接仍指向 `https://www.creem.io/payment/prod_*`。
  - 桌面升级页检查“优惠码 vs 激活码”文案是否可见且不冲突。

## 6. Reverse Review Pass 1 (Assumptions / Contradictions / Dependencies)
- 假设错误风险：价格数值若与 Creem 实际 checkout 不一致，会形成新的合规风险。  
  处理：以当前应用内已用价格作为基线，并在页面加“以结算页最终金额为准”说明；如后续价格变更，需同步更新官网与应用。
- 需求冲突风险：营销文案想弱化价格，合规要求需前置价格。  
  处理：以合规优先，价格前置展示。
- 依赖遗漏风险：只改本地文件不部署，Creem 复审仍看到旧页面。  
  处理：修复后执行部署并做线上检查。

## 7. Reverse Review Pass 2 (Failure Paths / Security / Rollback)
- 失败路径：前端改动可能影响现有 CTA 样式与移动端布局。  
  处理：只做最小结构改动，保留现有 class，重点改文本与少量说明块。
- 安全风险：本任务不涉及新增 secret、鉴权、执行入口；安全面增量低。  
  处理：不改后端鉴权逻辑，不新增敏感配置。
- 回滚缺口：若新文案导致转化下降或布局异常，需要快速回退。  
  处理：回滚单文件改动（storefront + upgrade-pro）即可恢复。

## 8. Risks, Rollback, Completion Criteria
- 风险清单：
  1. 价格文案与实际账单不一致（高）
  2. 仅本地通过、线上未生效（高）
  3. 用户继续误填优惠码（中）
- 回滚方案：
  1. 回退 `workers/storefront/site/index.html`
  2. 回退 `src/components/pages/upgrade-pro.tsx`
  3. 重新部署 storefront worker
- 完成标准：
  1. 官网 pricing 区在点击前可见清晰价格与计费周期（Monthly/Yearly/Lifetime）。
  2. 线上页面抽检通过。
  3. 本地质量门禁全部通过。
  4. 复审提交前检查清单可执行。

## 9. Implementation Record (2026-03-21)
- 已执行：
  1. storefront 已部署到 `app.51silu.com`（Worker 版本：`9c95ff1f-d299-4f6f-a534-84067adf3e9a`）。
  2. 升级页新增优惠码/激活码分流提示，并在优惠码验证中识别 `AGSH.` 前缀防误用。
  3. pricing 补充 USD 结算说明与价格文本抽检通过。

## 10. Post-implementation Reconciliation
- 与方案对齐检查：
  1. 目标 1（官网价格透明）已达成：线上页面可见 `$39.9/year`、`$4.9/month`、`$79.9 one-time`。
  2. 目标 2（减少误填）已达成：升级页已在优惠码入口新增激活码分流提示。
  3. 目标 3（验证）部分达成：`typecheck/test/build` 通过；`lint` 被仓库既有问题阻塞。
- 验证结果：
  - `pnpm typecheck` ✅
  - `pnpm test` ✅
  - `pnpm build` ✅
  - `pnpm lint` ❌（现存阻塞：`src/components/ai-install-chat.tsx` 条件 Hook 调用，非本次修复引入）
