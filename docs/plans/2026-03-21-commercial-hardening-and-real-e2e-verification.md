# 2026-03-21 商用售卖链路加固与真实全链路验证方案

## 1. 目标与范围

### 1.1 目标
在当前 AgentShield 代码基础上完成以下四件事，并提供可复现证据：
1. 完成 3 个加固项：
   - AI Proxy Bearer 增加 `typ` 显式校验。
   - License Gateway `/client/proxy-token` 增加限速防护。
   - Legacy 回退链路增加可控开关，支持后续平滑下线。
2. 对齐生产 URL，避免旧域名导致链路分叉。
3. 以“真实客户路径”执行商用联通测试（售卖/发码->激活->授权调用）。
4. 完成 lint/typecheck/test/e2e/build/cargo test 与认证链路脚本验证。

### 1.2 范围内文件（预期）
- `workers/ai-proxy/src/index.mjs`
- `workers/license-gateway/src/index.mjs`
- `workers/license-gateway/wrangler.jsonc`
- `src-tauri/src/commands/ai_orchestrator.rs`
- URL 对齐涉及文件（按扫描结果最小改动）
- `scripts/verify-*`（如需补充测试）

### 1.3 非目标
- 不改 Tier C / UNKNOWN 可写能力。
- 不新增复杂 OAuth 刷新令牌协议。
- 不伪造“支付成功”，仅在可执行边界内做真实请求验证并明确说明限制。

## 2. 约束与假设

1. Tavily MCP 当前账户配额不足，按规则降级为官方域名检索 + Context7。
2. 当前仓库是脏工作区，仅做最小必要改动，不回滚用户既有修改。
3. “真实支付”若受外部支付账户/卡组织限制，采用真实网关接口 + 真实激活流程 + webhook 处理验证替代，并明确差距。
4. 生产密钥只能通过 Worker secrets，不入仓库。

## 3. 官方最佳实践依据（访问日期：2026-03-21）

1. Cloudflare Workers secrets 与 vars 分离（敏感信息使用 secrets）：
   - https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
   - https://developers.cloudflare.com/workers/wrangler/environments/
2. Cloudflare rate limiting binding（`ratelimits` + `limit()`）：
   - https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
3. JWT BCP（显式类型、受众/签发者校验等）：
   - https://datatracker.ietf.org/doc/html/rfc8725
4. Creem webhook 验签与事件处理官方指南：
   - https://docs.creem.io/code/webhooks

Context7 使用：
- `/websites/developers_cloudflare_workers`（用于 Cloudflare Worker 生产配置与限速绑定对照）

## 4. 执行步骤

1. URL 与配置基线巡检：定位旧域名与分叉配置，形成最小修复集合。
2. 实施 3 项加固：
   - `typ` 校验。
   - `/client/proxy-token` 限速。
   - legacy 回退开关（默认兼容，支持后续关闭）。
3. 对齐生产 URL：仅修复影响运行链路的地址。
4. 运行质量门禁：`lint/typecheck/test/test:e2e/build/cargo test`。
5. 真实全链路验证：
   - 后端真实发码（admin generate）。
   - 客户端真实激活写入。
   - `/client/licenses/verify`、`/client/proxy-token`、`/v1/quota`、`/v1/chat/completions`。
   - 在开关开启/关闭下验证 legacy 行为符合预期。
6. 结果核对：将实际结果对齐方案并输出残余风险。

## 5. 验证计划

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm build`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `node scripts/verify-proxy-auth-flow.mjs`
- 真实接口脚本回归（带状态码与关键字段断言）

通过标准：
1. 三个加固项代码、配置、测试均落地。
2. 核心商用链路（发码->激活->调用）真实返回成功。
3. URL 配置无关键分叉。
4. 无新增高危逻辑错误。

## 6. 反向审查第 1 轮（假设/冲突/依赖）

1. 假设风险：认为 legacy 可长期保留与“最小攻击面”冲突。
   - 处置：加开关 + 默认兼容 + 文档化下线路径。
2. 依赖遗漏：若仅代码加限速，不更新 wrangler binding，生产仍无效。
   - 处置：同步更新 `wrangler.jsonc` 并部署验证。
3. 需求冲突：过严限速可能误伤合法用户 token 刷新。
   - 处置：按 IP+license 组合 key，给出保守阈值并记录可调参数。
4. URL 冲突：`workers.dev` 与 `51silu.com` 混用可能导致链路不一致。
   - 处置：先扫描再最小替换，只改运行关键路径。

## 7. 反向审查第 2 轮（失败路径/安全/回滚）

1. 失败路径：关闭 legacy 后 bearer 临时不可用会导致功能中断。
   - 处置：开关默认开启；仅在验证通过后允许关闭。
2. 安全风险：`typ` 未校验可能存在跨 token 混淆空间。
   - 处置：强制校验 `typ` 与预期值匹配。
3. 安全风险：`/client/proxy-token` 缺限速增加撞库/DoS 面。
   - 处置：新增 rate limiter + 429 响应 + 明确提示。
4. 回滚缺口：若加固导致兼容问题，需要可快速回滚。
   - 处置：仅增量改动，保留开关，必要时回滚单文件并复测。

## 8. 完成标准（DoD）

1. 三个加固项全部落地并通过测试。
2. 全链路真实验证通过并附证据。
3. 商用售卖与激活关键路径可复现可执行。
4. 输出残余风险与后续建议，不隐瞒不可验证边界。

## 9. 实施结果与证据（2026-03-21）

### 9.1 已落地修复

1. 三个原定加固项全部完成：
   - AI Proxy 新增 `typ` 校验与 legacy 开关。
   - `/client/proxy-token` 新增限速（Cloudflare rate limiter）。
   - 桌面端 legacy 回退加入环境开关控制。
2. 结合子代理审计新增修复（高风险商用逻辑）：
   - 修复 `checkout.completed` 失败后重试“锁死”问题（仅成功事件才标记 processed；存在订单无 license 时允许补发）。
   - 修复 `subscription.paid` 无 `event_id` 时重复续期问题（事件 key + marker 去重）。
   - 修复过期 license 仍可换 token 问题（client 校验时自动 reconcile 到 `expired`）。
   - 修复 `/client/proxy-token` 对无效码语义歧义问题（返回 `4xx`，不再伪成功）。
3. URL 运行链路对齐结果：
   - License Gateway 生产域名保持 `https://api.51silu.com`。
   - AI Proxy 验证上游 License Gateway 指向 `https://api.51silu.com`。
   - 文档历史域名残留仅在历史记录文档中，未影响运行链路。

### 9.2 代码与配置变更

- `workers/ai-proxy/src/index.mjs`
- `workers/ai-proxy/wrangler.jsonc`
- `workers/license-gateway/src/index.mjs`
- `workers/license-gateway/wrangler.jsonc`
- `src-tauri/src/commands/ai_orchestrator.rs`
- `scripts/verify-ai-proxy-auth-flow.mjs`
- `scripts/verify-license-gateway-proxy-token.mjs`
- `scripts/verify-license-gateway-webhook-idempotency.mjs`（新增）
- `scripts/verify-proxy-auth-flow.mjs`

### 9.3 本地质量门禁（全部通过）

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm build`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `node scripts/verify-proxy-auth-flow.mjs`

### 9.4 线上部署版本

1. `agentshield-license-gateway`
   - Version: `d8821210-0a6a-4b41-a9c7-9afc69a89438`
2. `agentshield-ai-proxy`
   - Version: `46453b7e-aa64-41fa-8dc2-490a9733e21e`（最终版本，`ALLOW_LEGACY_AUTH=1`）

### 9.5 真实商用全链路验证（通过）

1. 真实 webhook 支付事件 -> 发证：
   - `POST /webhooks/creem`（签名校验）返回 `200`，订单与 license 创建成功。
2. 真实客户激活路径：
   - admin reissue 获取激活码 -> `POST /client/licenses/verify` 成功（`found=true, active`）。
3. 真实鉴权路径：
   - `POST /client/proxy-token` 成功返回 Bearer token。
   - `GET /v1/quota`（Bearer）成功。
   - `POST /v1/chat/completions`（Bearer）成功。
   - `GET /v1/quota`（legacy）在默认开关开启时成功。
4. 真实安全语义验证：
   - 无效 activation code 访问 `/client/proxy-token` 返回 `400/403`，不再伪成功。
   - `subscription.paid` 无 event_id 重放第二次为 duplicate，`expires_at` 不再二次增加。
   - 临时线上切 `ALLOW_LEGACY_AUTH=0` 后 legacy 实时返回 `401`，Bearer 仍可用；随后恢复为 `1`。

### 9.6 残余风险

1. Creem webhook 官方签名头为静态 HMAC 方案（无 timestamp header），无法在网关侧做标准“签名时间窗”校验；当前通过事件 key/哈希去重降低重放影响。
2. 历史文档仍有旧域名记录，运行链路不受影响；如需“文档全仓零旧域名”，建议单独做一次文档清扫任务并避免改写历史结论文档语义。
