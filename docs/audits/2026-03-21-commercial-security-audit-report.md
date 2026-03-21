# 2026-03-21 商用链路安全审计报告（已修复复核）

## Executive Summary

本次审计覆盖 AgentShield 商用售卖与激活关键路径（Creem webhook -> license 发放 -> 客户激活验证 -> proxy token -> AI 调用）。

结论：
1. 本轮发现的高风险逻辑缺陷已完成修复并通过本地与线上真实性复核。
2. 核心商用链路已可真实执行（非 mock）：发码、激活、鉴权、额度、对话均成功。
3. 仍存在可接受残余风险（主要为第三方 webhook 签名机制天然不含时间窗），已通过事件去重与幂等策略降低影响。

## 审计范围

- `workers/license-gateway/src/index.mjs`
- `workers/ai-proxy/src/index.mjs`
- `src-tauri/src/commands/ai_orchestrator.rs`
- `workers/*/wrangler.jsonc`
- `scripts/verify-*.mjs`

## 发现与修复

### [CS-001] checkout.completed 失败后事件锁死（严重）
- 影响：首次失败后，重试可能无法补发 license，导致已支付用户无法激活。
- 修复：
  - 仅在处理成功（`status < 500`）时标记 webhook 已处理。
  - 对“已有订单但无有效 license”场景允许补发。
- 代码：`workers/license-gateway/src/index.mjs`

### [CS-002] subscription.paid 无 event_id 时可重复续期（高危）
- 影响：重放同一事件可能重复延长 `expires_at`，直接影响计费准确性。
- 修复：
  - 引入 `event_key`（优先 event_id，其次 payload hash）去重。
  - 增加 `last_subscription_paid_marker` 与 period-end 覆盖检查，阻断二次续期。
- 代码：`workers/license-gateway/src/index.mjs`

### [CS-003] 过期 active license 仍可换 token（高危）
- 影响：超期授权继续使用 AI 能力。
- 修复：
  - 在客户端校验路径增加到期 reconcile：`active + expires_at <= now` 自动迁移为 `expired`。
- 代码：`workers/license-gateway/src/index.mjs`

### [CS-004] /client/proxy-token 对无效码返回伪成功（中危）
- 影响：客户端可能误判授权成功，触发错误分支。
- 修复：
  - `/client/proxy-token` 切换为严格模式：无效码返回 `4xx`，不再 `200 + found:false`。
- 代码：`workers/license-gateway/src/index.mjs`

### [CS-005] /client/proxy-token 缺限速（中危）
- 影响：增加撞库/DoS 压力。
- 修复：
  - 新增 `CLIENT_PROXY_TOKEN_RATE_LIMITER`（20 req/60s）并在 token 端点执行限制。
- 代码：
  - `workers/license-gateway/src/index.mjs`
  - `workers/license-gateway/wrangler.jsonc`

### [CS-006] AI Proxy Bearer 缺 typ 校验（中危）
- 影响：不满足 JWT BCP “explicit typing”建议。
- 修复：
  - 新增 `AI_PROXY_TOKEN_TYP` 校验（默认 `at+jwt`）。
- 代码：
  - `workers/ai-proxy/src/index.mjs`
  - `workers/ai-proxy/wrangler.jsonc`

### [CS-007] Legacy 回退长期开放风险（中危）
- 影响：增加攻击面与迁移风险。
- 修复：
  - 增加 `ALLOW_LEGACY_AUTH`（Worker）与 `AGENTSHIELD_ALLOW_LEGACY_PROXY_AUTH`（桌面端）开关。
  - 已做线上开关演练：关闭时 legacy 实时拒绝、Bearer 正常；恢复后 legacy 正常。
- 代码：
  - `workers/ai-proxy/src/index.mjs`
  - `workers/ai-proxy/wrangler.jsonc`
  - `src-tauri/src/commands/ai_orchestrator.rs`

## 真实性验证证据

### 本地质量门禁
- `pnpm lint` ✅
- `pnpm typecheck` ✅
- `pnpm test` ✅
- `pnpm test:e2e` ✅
- `pnpm build` ✅
- `cargo test --manifest-path src-tauri/Cargo.toml` ✅
- `node scripts/verify-proxy-auth-flow.mjs` ✅

### 线上真实链路
1. 真实签名 webhook（checkout.completed）成功发证。 ✅
2. admin reissue 获取激活码后，客户激活验证成功。 ✅
3. `/client/proxy-token` 成功签发 Bearer。 ✅
4. AI Proxy `quota/chat` Bearer 调用成功。 ✅
5. Legacy 调用在默认开启时成功。 ✅
6. 无效 activation code 访问 `/client/proxy-token` 返回 `400/403`（不再伪成功）。 ✅
7. `subscription.paid` 无 event_id 重放第二次不再延长到期时间。 ✅

## 残余风险与建议

1. Creem 官方 webhook 签名机制为静态 HMAC（文档未提供签名时间窗头）；当前已用 event key/哈希去重缓解重放。
2. 建议后续引入异步事件队列（先 ack 再异步处理）与补偿任务，进一步降低外部依赖抖动时的发证风险。
3. 建议将 legacy 下线计划产品化（灰度批次 + 监控阈值 + 自动回滚）。

## 官方依据（访问日期：2026-03-21）

- Cloudflare Workers Best Practices
  - https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
- Cloudflare Wrangler Environments
  - https://developers.cloudflare.com/workers/wrangler/environments/
- Cloudflare Rate Limiting Binding
  - https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- JWT BCP (RFC 8725)
  - https://datatracker.ietf.org/doc/html/rfc8725
- Creem Webhooks
  - https://docs.creem.io/code/webhooks
