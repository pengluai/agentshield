# 2026-03-20 51silu.com 自定义生产域名切换方案

- 日期：2026-03-20
- 负责人：Codex
- 目标：将 AgentShield 官网与 license gateway 从 `workers.dev` 迁移到 `51silu.com` 自定义生产域名

## 1. Objective & Scope

### Objective
满足 Creem 对“自定义生产域名”的要求，并将对外生产地址统一为：

1. 官网：`https://app.51silu.com`
2. 授权网关：`https://api.51silu.com`

### Scope

1. Cloudflare Worker 自定义域名绑定。
2. 项目环境变量与公开 URL 更新。
3. storefront 与 license gateway 重新部署。
4. 线上访问、下载、健康检查、购买链路验证。

Out of scope:

1. 域名注册商迁移。
2. 新加坡服务器反代方案。
3. Windows 构建环境调整。

## 2. Official Basis

检索日期：2026-03-20

1. Cloudflare Workers Custom Domains:
   - https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
   - 自定义域名依赖 Cloudflare zone 托管。
2. Cloudflare Partial Setup:
   - https://developers.cloudflare.com/dns/zone-setups/partial-setup/setup/
   - 保留外部权威 DNS 需要更高方案，不是当前最稳路径。
3. Creem Account Reviews:
   - https://docs.creem.io/merchant-of-record/account-reviews/account-reviews
   - 网站可访问性、产品就绪度、支持信息一致性会影响审核。
4. Creem llms-full:
   - https://docs.creem.io/llms-full.txt

## 3. Assumptions & Constraints

### Assumptions

1. 生产主域名选择 `51silu.com`。
2. 接受将 `51silu.com` 的权威 DNS 从腾讯切换到 Cloudflare。
3. Cloudflare 账户继续使用当前 Wrangler 已登录账号。

### Constraints

1. 不暴露任何 Cloudflare / Creem secrets。
2. 切换 DNS 前不能承诺自定义域名马上生效。
3. 对外支持邮箱需要与官网/Creem 后台保持一致。

## 4. Execution Plan

1. 在 Cloudflare 中添加 `51silu.com` zone。
2. 获取 Cloudflare 分配的两条 nameserver。
3. 在腾讯域名控制台将 `51silu.com` 的 nameserver 改为 Cloudflare 指定值。
4. 等待 zone 变为 active。
5. 为 storefront Worker 绑定 `app.51silu.com`。
6. 为 license gateway Worker 绑定 `api.51silu.com`。
7. 更新项目中所有生产公开地址引用与环境变量。
8. 重新部署 storefront 与 license gateway。
9. 验证：
   - `https://app.51silu.com`
   - `https://app.51silu.com/download/macos`
   - `https://api.51silu.com/health`
   - 购买跳转与 webhook 地址

## 5. Validation Plan

1. `app.51silu.com` 首页返回 200。
2. `app.51silu.com/download/macos` 返回可下载文件。
3. `api.51silu.com/health` 返回健康状态。
4. 官网购买入口正常打开 Creem checkout。
5. Creem 后台可填入自定义 Website URL / webhook URL。

## 6. Reverse Review Pass 1

关注：假设错误 / 依赖遗漏 / 需求冲突

1. 风险：只切官网域名，不切 gateway 域名，导致公开链路不统一。
   - 处理：官网与网关一起切。
2. 风险：仍使用 `workers.dev` 提交给 Creem。
   - 处理：切换完成后同步替换后台 Website / webhook 地址。
3. 风险：支持邮箱与新域名不一致，再次触发审核问题。
   - 处理：切换时同步复核官网、法律页、Creem 后台联系邮箱。

## 7. Reverse Review Pass 2

关注：失败路径 / 安全风险 / 回滚缺口

1. 风险：切换 nameserver 后旧 DNS 记录缺失，站点短暂不可访问。
   - 处理：切换前在 Cloudflare 先完整录入必要 DNS 记录。
2. 风险：DNS 生效慢，Creem 立刻复审失败。
   - 处理：等 `app.51silu.com` 和 `api.51silu.com` 实测稳定后再点重新审核。
3. 风险：误改邮件相关 DNS 影响收信。
   - 处理：优先保留现有邮件所需记录，逐项核对 MX/SPF/DMARC。

## 8. Completion Criteria

1. 不再对外使用 `*.workers.dev` 作为生产官网地址。
2. 官网与网关都使用 `51silu.com` 子域名。
3. 购买、下载、健康检查都通过。
4. Creem 后台“请求重新审核”前的域名要求已满足。

## 9. Execution Outcome

执行日期：2026-03-20

1. Cloudflare zone 已创建并切换为腾讯注册商 NS：
   - `steven.ns.cloudflare.com`
   - `summer.ns.cloudflare.com`
2. Cloudflare DNS 已补齐切换前的关键记录：
   - `A 51silu.com -> 43.163.98.156`
   - `A www -> 43.163.98.156`
   - `TXT resend._domainkey.mail -> SES DKIM`
   - `MX send.mail -> feedback-smtp.us-east-1.amazonses.com`
   - `TXT send.mail -> v=spf1 include:amazonses.com ~all`
3. Worker 自定义域名已绑定并部署成功：
   - storefront -> `https://app.51silu.com`
   - license gateway -> `https://api.51silu.com`
4. 代码与发版环境已切换到正式域名：
   - `VITE_LICENSE_GATEWAY_URL=https://api.51silu.com`
   - `AGENTSHIELD_LICENSE_GATEWAY_URL=https://api.51silu.com`
5. GitHub 仓库 `pengluai/agentshield` 的公开发版变量/密钥已同步。
6. 新 macOS DMG 已重打并覆盖线上下载资产：
   - SHA256 `06fbd9920680deabe8d51a68563c162c4c98b7523ca9d86d8064950ef02971ba`

## 10. Validation Result

1. `https://app.51silu.com` 返回 `HTTP 200`。
2. `https://app.51silu.com/download/macos` 返回 `HTTP 200` 且下载文件 SHA256 与新构建一致。
3. `https://api.51silu.com/health` 返回 `{\"ok\":true,...}`。
4. 官网购买链接已验证为真实 `https://www.creem.io/payment/...`，不再是 `coming soon` / `example.com`。
5. 新构建的桌面二进制中已验证包含 `https://api.51silu.com`。

## 11. Post-Implementation Reconciliation

1. `2026-03-20 16:49 CST`，Creem 后台已从“请求更改”切换为“审核中”，说明重新审核请求已成功提交。
2. `2026-03-20 16:53 CST`，Creem `Settings -> General -> Website URL` 已从旧的 `https://app.51silu.com` 更新为 `https://app.51silu.com`。
3. `2026-03-20 16:50 CST`，本地 DNS 查询 `51silu.com NS` 仍返回旧值 `canary.dnspod.net` / `big.dnspod.net`，表明 nameserver 切换仍在全球传播中；该状态需要继续观察，直到全网稳定指向 Cloudflare。
4. 当前对外关键链路已可访问：
   - `https://app.51silu.com`
   - `https://app.51silu.com/download/macos`
   - `https://api.51silu.com/health`
5. 后续收尾标准：
   - `dig NS 51silu.com` 稳定返回 Cloudflare nameserver。
   - Creem 审核通过，不再提示 `workers.dev` 子域名问题。
