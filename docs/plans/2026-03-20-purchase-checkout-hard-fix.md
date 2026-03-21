# 2026-03-20 购买链路硬修复方案（App + 官网）

- 日期：2026-03-20
- 负责人：Codex
- 目标读者：项目维护者 / 发布人员

## 1. 目标与范围

### 1.1 目标
彻底修复 AgentShield 的购买入口可用性问题，满足：
1. 桌面 App（升级 Pro 页）点击任一「立即购买」都能打开真实可支付的 Creem 结账页。
2. 官网（storefront pricing 区）点击购买按钮都能打开真实可支付的 Creem 结账页。
3. 不能再出现 `example.com`、`coming soon`、或占位 checkout 导致的错误跳转。

### 1.2 范围
本次仅覆盖：
1. `src/components/pages/upgrade-pro.tsx`（App 购买入口）
2. `src/components/pages/__tests__/upgrade-pro.test.tsx`（App 购买行为测试）
3. `workers/storefront/site/index.html`（官网定价购买按钮）
4. 必要时补充 storefront 脚本逻辑与验证脚本

不在本次范围：
1. 许可证签发核心逻辑（webhook、发码、验码）
2. 邮件投递系统（Resend）
3. Creem 后台 KYC/账号审核流程

## 2. Skill 路由与 MCP 使用

### 2.1 Skill 选择
- 使用 `$playwright` skill 用于真实浏览器点击验证（官网购买按钮可点击、目标 URL 正确）。
- 其他改动采用常规代码实现（当前技能库没有“支付链路修复”专用 skill）。

### 2.2 MCP 执行记录
1. Sequential Thinking MCP：已完成结构化拆解（根因、方案、验证标准）。
2. Tavily MCP：已提取 `https://docs.creem.io/llms-full.txt` 的官方文档聚合内容。
3. Context7 MCP：已检索 Creem 文档/SDK，确认 checkout + metadata + webhook + key 安全的官方实践。

说明：Tavily Search 在本次会话中触发配额限制，改用 Tavily Extract + Context7 做官方依据补齐。

## 3. 约束与假设

### 3.1 约束
1. 不能暴露 `CREEM_API_KEY`、`CREEM_WEBHOOK_SECRET` 等敏感信息。
2. 客户端只能使用公开 checkout URL；服务端密钥仍仅在 gateway/worker 使用。
3. 修复必须通过现有质量门禁（至少：lint、typecheck、targeted test）。

### 3.2 假设
1. 当前生效商品链接为：
   - Monthly: `https://www.creem.io/payment/prod_2T8qrIwLHQ3AlG4KtTB849`
   - Yearly: `https://www.creem.io/payment/prod_7kbjugsRm1gGN6lKXOR1NG`
   - Lifetime: `https://www.creem.io/payment/prod_4rh2nT74Cqk4IQ5EfvcjbH`
2. 线上问题主要由前端入口配置/文案状态导致，不是 webhook 侧阻断。

## 4. 官方依据（含日期）

检索日期：2026-03-20

1. Creem 全文档：<https://docs.creem.io/llms-full.txt>
   - API key 使用 `x-api-key`，且应服务端保管；生产建议依赖 webhook 驱动授权状态。
2. Creem Checkout API：<https://docs.creem.io/features/checkout/checkout-api>
   - Checkout 支持 `metadata`、`discount_code` 等字段用于归因与优惠。
3. Creem Test Mode：<https://docs.creem.io/getting-started/test-mode>
   - 明确测试与生产 API endpoint 分离，避免误用环境。
4. Creem Discounts：<https://docs.creem.io/features/discounts>
   - 支持折扣码预应用，应通过 checkout 参数/创建会话配置。
5. Context7（Creem docs 聚合）查询结果（会话内）
   - 重申最佳实践：以 webhook 为准、metadata 关联内部订单、密钥仅在服务端。

## 5. 实施步骤（先文档后施工）

1. 识别现状根因
   - App：购买 URL 只读环境变量；错误配置会导致不可用跳转。
   - 官网：购买按钮被静态禁用（审核期遗留）。
2. 实现 App 端稳态策略
   - 新增可信 checkout 解析逻辑：优先使用有效 env URL；若 env 为空/占位 host，回退到正式 Creem 链接。
   - 保留 metadata / discount 参数拼接逻辑。
3. 实现官网购买按钮恢复
   - 将 pricing 区 `coming soon` disabled 按钮替换为真实可点击购买链接。
   - 增加 `target="_blank" rel="noopener noreferrer"`，并补齐追踪参数（source/campaign/sku）。
4. 补充和更新测试
   - 更新 `upgrade-pro` 单测，覆盖“占位 URL 自动 fallback 到正式 checkout”。
5. 运行验证
   - `pnpm run lint`
   - `pnpm run typecheck`
   - `pnpm test -- src/components/pages/__tests__/upgrade-pro.test.tsx`
   - Playwright/浏览器验证官网按钮实际可点击并跳转至 `creem.io/payment/prod_*`。
6. 结果回对
   - 对照本方案“完成标准”逐项核对，确保无偏差。

## 6. 验证计划

### 6.1 功能验证
1. App 中月付/年付/永久按钮点击后都调用 `openExternalUrl`，且目标 host 为 `www.creem.io`。
2. App URL 包含 `metadata[sku_code]`、`metadata[campaign]=desktop_upgrade`、`metadata[source]=agentshield_app`。
3. 官网 Pricing 区英文/中文可见态均存在可点击购买入口，不再是 disabled。

### 6.2 质量验证
1. ESLint 通过。
2. TypeScript typecheck 通过。
3. 目标单测通过。
4. 如可执行，进行浏览器端人工/自动点击验证并记录结果。

## 7. 反向审查（两轮，施工前）

### 7.1 第 1 轮：假设错误 / 需求冲突 / 依赖遗漏
1. 风险：硬编码 fallback 链接未来若替换商品会失效。
   - 处理：保留 env 优先级，fallback 仅兜底，且将 product id 与现有 specs 对齐。
2. 风险：官网和 App 链接来源分离，后续可能漂移。
   - 处理：本次先修可用性；后续可收敛到统一配置源（非本次阻塞）。
3. 风险：若 Creem 账号 live payment 被暂停，链接可达但无法支付。
   - 处理：这是外部账号状态，不是代码错误；本次确保跳转入口与参数正确。

### 7.2 第 2 轮：失败路径 / 安全风险 / 回滚缺口
1. 失败路径：误把 secret 参数拼到前端 URL。
   - 处理：仅允许公开 metadata/discount/tracking 参数，禁止任何 secret 注入。
2. 安全风险：`window.open` 新标签安全属性缺失。
   - 处理：官网外链统一 `noopener noreferrer`。
3. 回滚缺口：上线后若链接异常，需可快速恢复。
   - 处理：回滚仅需恢复本次三个文件改动；不涉及数据迁移。

## 8. 风险、回滚与完成标准

### 8.1 风险
1. 外部支付平台状态变化（非代码可控）。
2. 历史构建产物仍可能引用旧环境变量，需要重新构建/发布。

### 8.2 回滚
1. 回滚提交至修复前版本。
2. 恢复官网按钮为禁用态（仅在支付平台不可用时作为临时应急）。

### 8.3 完成标准
1. App 与官网购买点击都不再出现 `example.com` 与 `coming soon`。
2. 点击后进入 Creem 正式支付链接（`www.creem.io/payment/prod_*`）。
3. 代码检查与测试通过，且验证记录可复现。

## 9. 施工后核对（Post-implementation Reconciliation）

### 9.1 实际改动
1. `src/components/pages/upgrade-pro.tsx`
   - 新增正式 Creem checkout fallback（当 env 为空或占位 host 时自动回退）。
2. `src/components/pages/__tests__/upgrade-pro.test.tsx`
   - 单测改为校验 fallback 生效与真实 Creem URL 打开行为。
3. `workers/storefront/site/index.html`
   - 将 Pro/Lifetime 的 `coming soon` 禁用按钮替换为真实可点击购买链接（含追踪 metadata 参数）。
4. `workers/storefront` 已执行线上部署（Cloudflare Worker）。

### 9.2 验证结果
1. `pnpm test -- src/components/pages/__tests__/upgrade-pro.test.tsx`：通过。
2. `pnpm run lint`：通过。
3. `pnpm run typecheck`：通过。
4. Playwright 线上验证：访问 `https://agentshield-storefront.pengluailll.workers.dev`，点击 `Buy Pro Yearly` 后弹窗 URL 为 `https://www.creem.io/checkout/...`，确认可跳转真实 Creem checkout。

### 9.3 与方案逐项对齐
1. 目标 1（App 可用）：已达成（fallback + 测试通过，避免 example.com 占位跳转）。
2. 目标 2（官网可用）：已达成（线上已部署并实测跳转 Creem checkout）。
3. 目标 3（不再 coming soon / 占位）：已达成（购买按钮已恢复且 URL 指向正式产品）。
4. 安全约束：已遵守（未将 API key 或 webhook secret 暴露到前端）。
