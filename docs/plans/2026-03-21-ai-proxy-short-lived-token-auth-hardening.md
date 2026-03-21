# 2026-03-21 AI Proxy 短时效令牌认证加固方案

## 0. 目标与范围

目标：将当前 `X-License-ID + X-Activation-Code + X-Signature` 直传模式升级为“license-gateway 签发短时效 access token，ai-proxy 本地验签”的主路径，并保留旧路径短期兼容，降低凭据暴露面、减少主链路远程依赖、提升撤销窗口可控性。

范围内：
- `workers/license-gateway/src/index.mjs`：新增客户端令牌签发端点。
- `workers/ai-proxy/src/index.mjs`：新增 Bearer token 验证路径（`iss/aud/exp/nbf/iat/jti/sub`），并保留旧签名路径兼容。
- `src-tauri/src/commands/ai_orchestrator.rs`：桌面端优先获取并使用短时效 token，请求失败时降级旧头部路径。
- `src-tauri/src/commands/license.rs`：导出 license-gateway 解析函数供 AI 认证链路复用。

范围外：
- 不引入 Durable Objects 新存储结构（本次保持最小侵入）。
- 不引入完整 OAuth2/refresh token 协议栈（本次实现短时效 access token + 缓存）。
- 不改支付/许可业务规则。

## 1. 约束与假设

约束：
- 现有生产链路不能中断，必须向后兼容。
- 现有 `USAGE_KV` 仍用于配额和 nonce 去重，不新增强一致存储依赖。
- 密钥不得进入代码仓库，使用 Workers Secret。

假设：
- 可在 gateway/proxy 两侧配置同一 `PROXY_TOKEN_SIGNING_SECRET`（HMAC）。
- token 默认 TTL 为 300 秒，可通过环境变量覆盖。
- license-gateway 与 ai-proxy 将同版本发布，桌面端保留回退避免灰度期间不可用。

## 2. 官方依据（已检索）

访问日期：2026-03-21。

- JWT 关键声明定义：`iss/aud/exp/nbf/iat/jti`（RFC 7519）
  - https://www.rfc-editor.org/rfc/rfc7519
- JWT BCP：算法校验、受众校验、不同 token 类型互斥校验（RFC 8725）
  - https://www.rfc-editor.org/rfc/rfc8725
- Token Revocation 语义与返回约定（RFC 7009）
  - https://www.rfc-editor.org/rfc/rfc7009
- Token Introspection 与缓存安全权衡（RFC 7662）
  - https://www.rfc-editor.org/rfc/rfc7662
- Cloudflare Workers 鉴权签名示例（HMAC + 过期时间）
  - https://developers.cloudflare.com/workers/examples/signing-requests/
- Cloudflare Access JWT 验签（`jose`、`kid`、`aud/iss`、轮换提示）
  - https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- Workers Secrets 管理（不要把敏感信息放 `vars`）
  - https://developers.cloudflare.com/workers/wrangler/environments/
- KV 一致性说明（最终一致）与 DO 强一致建议
  - https://developers.cloudflare.com/kv/concepts/how-kv-works/
  - https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/

Context7（Cloudflare Workers 官方文档索引）结果用于实现细节核对：
- `/websites/developers_cloudflare_workers`

## 3. 执行步骤

1. gateway 新增 `POST /client/proxy-token`：
- 输入：`activation_code`。
- 过程：验 activation_code 签名 -> 查 license -> 检查 active/pro 资格。
- 输出：`{ access_token, token_type, expires_in, expires_at }`。
- token 负载最小集：`iss aud sub iat nbf exp jti plan billing_cycle`。

2. ai-proxy 增加 Bearer 主认证：
- 优先读取 `Authorization: Bearer <token>`。
- 本地验证 HMAC-SHA256 签名与 claims（`iss/aud/sub/jti` + `exp/nbf/iat` 窗口）。
- claims 映射到现有配额逻辑（`plan + billing_cycle` -> quotaPlan）。
- 保留 legacy 头部鉴权路径作为兼容后备。

3. 桌面端优先走 token：
- 新增“获取并缓存 proxy token”逻辑，过期前 30 秒刷新。
- `pro_ai_chat` 与 `pro_ai_quota_status` 优先 Bearer；若遇 401/403 回退 legacy 头部。

4. 文档/注释更新：
- 标注新环境变量与兼容策略。

## 4. 验证方案

代码质量：
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `cargo test --manifest-path src-tauri/Cargo.toml`

真实性可执行验证（新增）：
- Node 脚本级 worker 认证链路测试：
  - gateway 签发 token 成功/失败分支。
  - ai-proxy Bearer 验签成功/过期/受众错误/签名错误。
  - ai-proxy 在 Bearer 缺失时仍可走 legacy 路径。
- Rust 单测：
  - proxy token 缓存命中/刷新策略。

通过标准：
- 主路径（Bearer）与回退路径（legacy）均可用。
- 不引入明文 secret、不放宽现有防护。

## 5. 风险、回滚与完成标准

风险：
- 发布不同步导致部分请求认证失败。
- token 时钟偏差导致误拒绝。

缓解：
- 保留 legacy 回退。
- `nbf/iat` 校验引入小幅时钟容忍（60 秒）。

回滚：
- 将桌面端临时强制回退 legacy（禁用 token 使用）。
- proxy 保持 legacy 路径，不阻塞现网。

完成标准：
- 三端改造完成并通过验证。
- 方案项与实现项逐条对齐，无未解释偏差。

## 6. 反向审查（第 1 轮：假设/冲突/依赖）

- 假设冲突检查：
  - 若 `PROXY_TOKEN_SIGNING_SECRET` 未配置，Bearer 路径会失败；需确保错误信息明确且 legacy 可回退。
- 依赖遗漏检查：
  - 桌面端需要 gateway URL 解析能力，不能重复硬编码；必须复用 license 模块解析逻辑。
- 需求冲突检查：
  - “减少专业术语、傻瓜式操作”要求对用户透明，因此 token 获取必须自动进行，不新增用户输入步骤。

结论：可进入施工，但必须先实现缺失配置的显式失败与自动回退。

## 7. 反向审查（第 2 轮：失败路径/安全/回滚缺口）

- 失败路径：
  - gateway 暂时不可达：桌面端应回退 legacy，不应直接让 AI 全不可用。
  - token 过期：自动刷新并重试一次，避免频繁失败。
- 安全路径：
  - 必须强制 `alg=HS256`，拒绝算法混淆。
  - 必须强制 `iss/aud`，拒绝跨上下文 token 替换。
  - 必须检查 `jti` 存在，保留后续撤销扩展点。
- 回滚缺口：
  - 若仅改桌面端不改 proxy，会出现 Bearer 401；通过 fallback 关闭缺口。

结论：进入施工，按“Bearer 主路径 + legacy 兜底”执行。

## 8. 实施与真实性验证结果（2026-03-21）

### 8.1 生产修复与发布

1. 修复 `ai-proxy` 指向旧网关地址导致 legacy 回退链路 `404/502` 的问题：
   - `workers/ai-proxy/wrangler.jsonc` 将 `LICENSE_GATEWAY_URL` 更新为 `https://api.51silu.com`。
2. 重新部署 `agentshield-ai-proxy`，版本：
   - `3d887983-581e-4d43-aa8e-38c31c8d605e`

### 8.2 真实付费码链路回归（非 mock）

使用本机真实付费激活码进行线上验证，链路全部通过：

1. `POST /client/licenses/verify`：
   - `200`，`ok=true`，`found=true`，`license.status=active`，`plan=pro`。
2. `POST /client/proxy-token`：
   - `200`，成功返回 `Bearer access_token`，`expires_in=300`。
3. `GET /v1/quota`（Bearer）：
   - `200`，返回配额字段（`daily_limit=100`）。
4. `POST /v1/chat/completions`（Bearer）：
   - `200`，返回模型响应（真实上游调用）。
5. `GET /v1/quota`（legacy 头部签名回退）：
   - `200`，回退链路可用。

### 8.3 代码质量与可执行验证

以下命令全部通过：

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm build`
- `node scripts/verify-proxy-auth-flow.mjs`
- `cargo test --manifest-path src-tauri/Cargo.toml`

### 8.4 本轮审计结论（聚焦认证路径）

1. 未发现可复现的 P0/P1 级绕过漏洞（基于当前实现和实测路径）。
2. 主要残余风险（P2）：
   - 回退链路仍默认开启，建议后续按灰度计划增加开关与下线窗口，避免长期保留旧鉴权面。
   - `/client/proxy-token` 端点暂无显式按 IP/设备限速，建议补充速率限制以降低撞库/DoS 压力。
   - Bearer 校验当前未检查 `typ`，建议补充以对齐 JWT BCP 的“显式类型”建议。

### 8.5 与官方最佳实践对齐（访问日期：2026-03-21）

1. Cloudflare Workers Secrets/vars/环境隔离：
   - https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
   - https://developers.cloudflare.com/workers/wrangler/environments/
2. JWT Best Current Practices（显式类型、受众/签发者校验等）：
   - https://datatracker.ietf.org/doc/html/rfc8725
