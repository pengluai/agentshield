# 47. Cloudflare Worker License Gateway 迁移方案

- 日期：2026-03-16
- 目标：把 AgentShield 的临时 `trycloudflare.com` license gateway 升级为可正式商用的稳定公网 HTTPS 网关
- 适用范围：Creem payment links + webhook + activation code + online verify

## 1. 当前阻塞

当前仓库的 `scripts/license-gateway.mjs` 是 Node HTTP 服务：

1. 依赖 `http.createServer`
2. 依赖本地文件 `data/license-gateway.json`
3. 依赖 `spawnSync` 调用 Rust `issue_activation_code` 二进制发码

因此它不能直接原样部署到 Cloudflare Workers。

## 2. 官方最佳实践依据

检索日期：2026-03-16

1. Cloudflare Workers 推荐使用 module worker `export default { fetch() {} }`
2. Workers 适合做 API endpoint、auth layer、proxy/routing logic
3. Durable Objects 提供全局唯一实例和强一致事务型存储，适合 webhook 幂等、订单状态和 license 状态管理
4. Workers Web Crypto 支持 `sign()` / `verify()`，并支持 `Ed25519`

来源：

1. <https://developers.cloudflare.com/workers/>
2. <https://developers.cloudflare.com/workers/runtime-apis/web-crypto/>
3. <https://developers.cloudflare.com/workers/glossary/#durable-objects>
4. <https://developers.cloudflare.com/workers/wrangler/configuration/>

## 3. 迁移决策

### 3.1 运行时

采用 Cloudflare Worker module handler：

- `GET /health`
- `POST /webhooks/creem`
- `POST /client/licenses/verify`
- `GET /admin/licenses`
- `GET /admin/webhook-failures`
- `POST /admin/licenses/:id/reissue`
- `POST /admin/licenses/:id/revoke`

### 3.2 状态存储

采用 Durable Object 作为单一强一致状态存储。

原因：

1. webhook 幂等需要强一致
2. 退款撤销和续费延长不能接受 KV 的最终一致性窗口
3. 现有 Node 脚本就是“单文件单状态”的模型，映射到单个 Durable Object 最直接

### 3.3 激活码签发

不再依赖 Rust 子进程，改为 Worker 内使用 `Ed25519` 对 JSON payload 直接签名，保持现有激活码格式：

`AGSH.<payload_base64url>.<signature_base64url>`

签名 payload 字段保持与 `src-tauri/src/bin/issue_activation_code.rs` 一致：

1. `plan`
2. `billing_cycle`
3. `expires_at`
4. `issued_at`
5. `license_id`
6. `customer`

### 3.4 结账链接策略

Creem 真实 payment link 使用：

1. `https://www.creem.io/payment/prod_2T8qrIwLHQ3AlG4KtTB849`
2. `https://www.creem.io/payment/prod_7kbjugsRm1gGN6lKXOR1NG`
3. `https://www.creem.io/payment/prod_4rh2nT74Cqk4IQ5EfvcjbH`

后端 billing cycle 识别以 `CREEM_PRODUCT_BILLING_MAP_JSON` 为主，不依赖 checkout metadata 是否被 payment link 透传。

## 4. 实施顺序

1. 新增 Worker 版本 license gateway
2. 用本地测试向量验证 Worker 发码格式与 Rust 客户端兼容
3. 部署到稳定 `workers.dev` 地址
4. 回填：
   - `AGENTSHIELD_LICENSE_GATEWAY_URL`
   - `CREEM_WEBHOOK_SECRET`
   - `CREEM_PRODUCT_BILLING_MAP_JSON`
   - `VITE_CHECKOUT_*`
5. 在 Creem 配置 webhook endpoint
6. 跑 readiness gate + lint + test

## 5. 验收标准

满足以下条件才算商用可交付：

1. Cloudflare Worker 返回稳定 HTTPS 地址
2. `GET /health` 正常
3. `POST /webhooks/creem` 能正确校验签名
4. `checkout.completed` 能发码
5. `refund.created` 能撤销
6. `subscription.paid` 能续期
7. `POST /client/licenses/verify` 能返回在线状态
8. 本地 `pnpm run release:public:ready` 通过
9. 前端打开购买链接时不再出现占位 URL

## 6. 当前已知真值

### 6.1 Creem Product IDs

1. Monthly: `prod_2T8qrIwLHQ3AlG4KtTB849`
2. Yearly: `prod_7kbjugsRm1gGN6lKXOR1NG`
3. Lifetime: `prod_4rh2nT74Cqk4IQ5EfvcjbH`

### 6.2 Creem Payment Links

1. Monthly: `https://www.creem.io/payment/prod_2T8qrIwLHQ3AlG4KtTB849`
2. Yearly: `https://www.creem.io/payment/prod_7kbjugsRm1gGN6lKXOR1NG`
3. Lifetime: `https://www.creem.io/payment/prod_4rh2nT74Cqk4IQ5EfvcjbH`

## 7. 假设

1. 第一阶段继续使用 monthly/yearly/lifetime 的 one-time 商业模型
2. Cloudflare 账户可创建新的 Worker
3. 允许把当前本地激活码签名种子作为 Worker secret 使用
