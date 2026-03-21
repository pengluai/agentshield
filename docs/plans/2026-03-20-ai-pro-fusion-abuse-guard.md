# 2026-03-20 AI Pro 融合与防滥用施工计划

## 1. 目标与范围

### 1.1 目标
严格按 `docs/specs/73-AI-Pro融合与防滥用施工文档-2026-03-20.md` 完成以下能力落地：
1. 所有 Pro AI 请求走 Proxy（免用户自配 key）。
2. 免费版拦截 + Pro 配额（按日/按月）管控。
3. 请求签名（HMAC）+ 防重放（nonce + TTL）。
4. semantic_guard 支持 Proxy 零配置模式，并保留自定义 key 兼容路径。
5. 设置页显示 Pro 内置 AI 与配额信息，并支持“切换到自定义 AI”。

### 1.2 范围内文件（计划）
- `workers/ai-proxy/wrangler.jsonc`
- `workers/ai-proxy/src/index.mjs`
- `src-tauri/Cargo.toml`
- `src-tauri/src/commands/license.rs`
- `src-tauri/src/commands/ai_orchestrator.rs`
- `src-tauri/src/commands/semantic_guard.rs`
- `src/services/semantic-guard.ts`
- `src/components/ai-install-chat.tsx`
- `src/components/pages/settings-page.tsx`
- 相关测试文件（按实际受影响范围补充）

### 1.3 明确不做
- 不新增 Tier C / UNKNOWN 可写能力。
- 不暴露任何明文密钥。
- 不做与本次 AI Pro 防滥用无关的功能重构。

## 2. 约束与假设

1. 当前 `license-gateway` 的 `/client/licenses/verify` 入参为 `activation_code`，不是 `license_id`。
2. 本次优先采用“App 向 Proxy 传 activation_code + license_id”方案，不新增 `verify-by-id` 端点（降低改动面，满足文档可选方案）。
3. `workers/ai-proxy` 当前尚未接入 KV 配额与签名校验，且目录在工作区为新增状态，本次直接补全。
4. Tavily MCP 当前不可用（配额限制），外部证据按强制流程改用官方域名检索与 Context7。
5. 当前仓库处于脏工作区，本次只在目标文件内增量修改，不回滚任何非本任务变更。

## 3. 证据与实现依据（官方来源）

访问日期：2026-03-20

1. Cloudflare KV `put()` 支持 `expirationTtl`（秒），且同 key 每秒最多 1 次写入：
   - https://developers.cloudflare.com/kv/api/write-key-value-pairs/
2. Cloudflare Workers Rate Limit binding：`simple.period` 仅支持 10 或 60 秒：
   - https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
3. Cloudflare Workers HMAC 签名示例，建议使用 `crypto.subtle.verify` 做恒时验证，并做过期校验：
   - https://developers.cloudflare.com/workers/examples/signing-requests/
4. Cloudflare Workers Secret 管理与 `wrangler secret put`：
   - https://developers.cloudflare.com/workers/configuration/secrets/
5. Context7（Cloudflare Workers 官方文档镜像）用于二次核验 rate limit 与签名流程：
   - Library: `/websites/developers_cloudflare_workers`

Context7 对 Rust `hmac` crate 未返回可用库条目（本次标记为“不适用”）；Rust 侧以编译期校验和现有 crate API 对齐为准。

## 4. 执行步骤（先后顺序）

1. Proxy 侧基线升级（先做）
   - 增加 `USAGE_KV` 绑定。
   - 增加 `checkAndIncrementQuota()`（daily/monthly key + TTL）。
   - 增加免费版拦截（plan=free 或缺失 plan）。
   - 增加 `verifySignature()`（timestamp 窗口、nonce 防重放、HMAC verify）。
   - 增加响应头配额透传。
   - 增加配额查询端点（只读，不递增）。

2. Rust `pro_ai_chat` 签名与身份来源修复
   - 不再依赖前端传入“licenseId”。
   - 从本地已激活 license 读取 `activation_code` 并解析 `license_id`。
   - 生成 `X-Signature`（HMAC-SHA256 + timestamp + nonce）。
   - 发送 `X-License-ID`、`X-Activation-Code`、`X-Signature`。
   - 解析 Proxy 响应头中的配额信息并缓存/返回给前端查询命令。

3. semantic_guard 迁移
   - 增加 Proxy 路径（优先）：走 `pro_ai_chat` 等价请求。
   - 保留旧自定义 key（DeepSeek）回退路径。
   - `get_semantic_guard_status` 对 Pro 在 Proxy 可用时返回“已启用（零配置）”。

4. 设置页改造
   - Pro 用户显示内置 AI 启用状态 + 配额用量。
   - 免费用户展示锁定与升级引导。
   - 增加“切换到自定义 AI”折叠区，仅展开后展示 provider/model/key 测试连接。

5. 兼容改造
   - `ai-install-chat.tsx` 移除伪造 `licenseId` 参数调用。
   - 更新受影响测试快照/断言（仅必要改动）。

## 5. 验证计划

1. JS/前端
   - `pnpm lint`
   - `pnpm typecheck`
   - `pnpm test`（至少覆盖 settings 与现有关键测试）
   - `pnpm build`

2. Rust
   - `cargo check --manifest-path src-tauri/Cargo.toml`
   - `cargo test --manifest-path src-tauri/Cargo.toml --lib`

3. Worker 逻辑
   - 针对 `workers/ai-proxy` 进行最小可执行检查（至少语法/本地模拟请求路径）。
   - 关键场景：缺签名 403、伪造签名 403、free 403、超配额 429、成功请求带 quota headers。

## 6. 反向审查（第 1 轮：假设/冲突/依赖）

1. 假设风险：Proxy 当前用 `license_id` 调 verify。实际网关需要 `activation_code`，存在鉴权失效并“降级放行”风险。
   - 处理：改为强校验 activation_code，失败即拒绝，不再因网关失败默认放行。
2. 需求冲突：文档要求“免费版完全不能用 AI”，而现状在网关异常时允许通过。
   - 处理：改为 fail-closed（鉴权失败直接拒绝）。
3. 依赖遗漏：HMAC 依赖 Rust `hmac` crate 与 nonce 存储（KV）。
   - 处理：补 Cargo 依赖；USAGE_KV 统一承载 quota + nonce。
4. 依赖遗漏：前端当前没有真实 license_id 来源。
   - 处理：将身份源下沉至 Rust 命令层，从本地激活码解析，前端不再组装。

## 7. 反向审查（第 2 轮：失败路径/安全/回滚）

1. 失败路径：KV 并发写同 key 可能触发 429 或计数误差。
   - 处理：单请求仅一次 daily 与 monthly 写；接受非金融场景轻微误差；错误时返回可诊断信息。
2. 安全风险：nonce 仅按 nonce 值去重会跨用户冲突。
   - 处理：nonce key 绑定 `license_id`（`nonce:{license}:{nonce}`）。
3. 安全风险：仅做字符串比较会暴露时序信息。
   - 处理：Worker 使用 `crypto.subtle.verify`。
4. 回滚缺口：切到强校验后若客户端未升级会全量 403。
   - 处理：保留明确错误提示；回滚可通过关闭签名强校验分支（单点在 Proxy）快速恢复。
5. 可观测性不足：用户不知配额剩余。
   - 处理：响应头返回 quota + 设置页实时展示。

## 8. 回滚策略

1. Proxy 回滚：
   - 回退 `workers/ai-proxy/src/index.mjs` 到当前版本，重新部署。
2. 客户端回滚：
   - 回退 `ai_orchestrator.rs` 与 `semantic_guard.rs` 到未签名版本。
3. UI 回滚：
   - 回退设置页折叠面板改造，恢复原自定义输入模式。

## 9. 完成标准（DoD）

1. 免费版 AI 请求被稳定拒绝（403）。
2. Pro 请求必须携带有效签名，重放与过期签名被拒绝（403）。
3. Pro 用户配额按日/月生效并返回配额头或等价查询结果。
4. semantic_guard 在 Pro 下可零配置走 Proxy，自定义 key 仍可用。
5. 设置页准确展示 Pro 内置 AI 状态与配额，并提供自定义折叠入口。
6. 通过本计划中的 lint/typecheck/test/build/cargo check（若有失败，必须修复或明确阻塞项）。
