# 2026-03-20 旧域名全量排查与生产域名切换方案

## 1. Objective

- 目标：在 AgentShield 仓库中，彻底找出并替换所有仍指向“之前生产域名”的运行时、支付、官网、授权网关、部署配置、发版脚本与说明文档残留。
- 范围：
  - 前端运行时购买与激活链路
  - Tauri 桌面端 license gateway fallback
  - Cloudflare Workers 自定义域名配置
  - 公开发版环境变量与 GitHub 同步脚本
  - storefront / download / gateway 相关公开地址
  - 历史方案/规格文档中的旧生产域名
- 非目标：
  - 不修改测试里用于安全占位的 `example.com` 样例
  - 不修改本地开发 `localhost`、`127.0.0.1` 调试地址
  - 不改动与域名无关的业务逻辑

## 2. Current Findings

### 2.1 当前运行时/部署相关的旧生产域名残留

1. 前端 fallback：
   - `src/components/pages/upgrade-pro.tsx`
   - 当前硬编码 `https://api.51silu.com`
2. 桌面端 fallback：
   - `src-tauri/src/commands/license.rs`
   - 当前硬编码 `https://api.51silu.com`
3. 公开发版 env：
   - `.env.public-sale.local`
   - 当前 `VITE_LICENSE_GATEWAY_URL` 与 `AGENTSHIELD_LICENSE_GATEWAY_URL` 指向 `https://api.51silu.com`
4. Workers 自定义域名：
   - `workers/storefront/wrangler.jsonc`
   - 当前 `app.51silu.com`
   - `workers/license-gateway/wrangler.jsonc`
   - 当前 `api.51silu.com`
5. 发件地址域名：
   - `.env.public-sale.local`
   - 当前 `license@mail.51silu.com`

### 2.2 当前文档中的旧生产域名残留

1. 大量历史 `docs/specs/*.md`、`docs/plans/*.md` 仍引用：
   - `agentshield-storefront.pengluailll.workers.dev`
   - `agentshield-license-gateway.pengluailll.workers.dev`
   - `app.51silu.com`
   - `api.51silu.com`
   - `license@mail.51silu.com`
2. 这些文档多数属于历史执行记录，需要区分：
   - 是否应该保留为“历史事实”
   - 是否应该统一加注“已过时”
   - 是否应该直接替换为新的生产域名

### 2.3 当前阻塞项

1. 用户本轮明确表示“已改域名”，但当前仓库中尚未出现新的目标域名。
2. 在未确认新官网域名和新 API 域名前，不能安全开始全量替换，否则会把线上支付/授权链路改错。

## 3. Official Best-Practice Basis

访问日期：2026-03-20

1. Cloudflare Workers Custom Domains
   - 来源：Cloudflare 官方文档
   - 链接：<https://developers.cloudflare.com/workers/configuration/routing/custom-domains/>
   - 结论：
     - 推荐在 `wrangler.jsonc` 的 `routes` 中配置 `pattern` + `custom_domain: true`
     - 自定义域名适合让 Worker 直接作为某个 hostname 的 origin
2. Cloudflare Workers / Wrangler Configuration
   - 来源：Cloudflare 官方文档（通过 Context7 验证）
   - 链接：<https://developers.cloudflare.com/workers/wrangler/configuration>
   - 结论：
     - 生产环境应在配置层固定自定义域名，避免只靠临时 CLI 绑定
3. Creem Account Reviews
   - 来源：Creem 官方文档
   - 链接：<https://docs.creem.io/merchant-of-record/account-reviews/account-reviews>
   - 结论：
     - 商家审核会检查可访问的网站、产品详情、联系信息与支付链路一致性
     - `workers.dev` 这类平台子域名不适合作为最终生产官网
4. Creem LLM 文档索引
   - 来源：Creem 官方文档
   - 链接：<https://docs.creem.io/llms-full.txt>
   - 结论：
     - 文档结构中包含 checkout、discounts、test mode、merchant review 等关键模块
     - 生产配置应保证官网、支付、webhook 和商家资料可追溯且一致

## 4. Stable Technical Strategy

基于上述官方依据，最稳的实施框架如下：

1. 使用 Cloudflare Worker `custom_domain: true` 作为公开生产入口。
2. 将“新官网域名”和“新 API 域名”同时切换，避免前端与桌面端落到不同域名。
3. 保留前端和桌面端的“生产 fallback”，但 fallback 必须改成新的正式 API 域名，而不是旧域名或 placeholder。
4. 公开发版 env、GitHub 仓库同步脚本、release gate 必须与新域名保持一致，避免构建产物继续嵌入旧地址。
5. 文档层分两类处理：
   - 面向当前执行与上线的文档：更新为新域名
   - 纯历史记录文档：保留历史事实，但明确标注“旧域名 / 已过时”

## 5. Implementation Plan

### Step 1. 确认新的目标域名

1. 官网域名（例如 `https://app.new-domain.com`）
2. API/授权网关域名（例如 `https://api.new-domain.com`）
3. 如发件邮箱域名也变更，确认新的发件地址域名

### Step 2. 替换运行时与部署配置

1. 更新 `workers/storefront/wrangler.jsonc`
2. 更新 `workers/license-gateway/wrangler.jsonc`
3. 更新前端 fallback
4. 更新桌面端 fallback
5. 更新 `.env.public-sale.local`
6. 更新发布同步与门禁脚本

### Step 3. 替换支付与官网公开入口

1. 确认 storefront 中所有购买按钮仍指向真实 Creem 支付链接
2. 确认下载入口与官网入口引用的是新官网域名
3. 确认授权校验请求落到新 API 域名

### Step 4. 清理历史旧域名引用

1. 区分“运行相关文档”和“历史归档文档”
2. 对运行相关文档直接更新
3. 对历史文档保留历史事实，但必要时补一行“当前生产域名已迁移”

### Step 5. 部署与验证

1. 部署 storefront Worker
2. 部署 license gateway Worker
3. 验证新官网、新下载、新 health、新购买跳转
4. 全仓库二次 grep，确认无运行相关旧域名残留

## 6. Validation Plan

1. `rg` 二次搜索：
   - 运行时目录中不再残留旧官网/API 域名
2. `pnpm test -- src/components/pages/__tests__/upgrade-pro.test.tsx`
3. `pnpm run lint`
4. `pnpm run typecheck`
5. `bash ./scripts/public-sale-gate.sh`
6. `curl` / `HTTP 200` 检查：
   - 新官网首页
   - 新下载地址
   - 新 API `/health`
7. 必要时重新构建桌面包，并验证构建产物字符串中已无旧域名

## 7. Reverse Review Pass 1

关注：假设错误 / 依赖遗漏 / 需求冲突

1. 风险：用户只改了官网域名，但 API 域名未改。
   - 应对：实施前明确要求确认官网域名和 API 域名一对地址。
2. 风险：只改代码，不改 `.env.public-sale.local` 和 GitHub 同步脚本，导致发布包仍嵌旧域名。
   - 应对：代码、env、脚本必须一起替换。
3. 风险：把测试样例的 `example.com` 一并删掉，破坏测试语义。
   - 应对：仅替换“生产旧域名”，保留测试占位域名。

## 8. Reverse Review Pass 2

关注：失败路径 / 安全风险 / 回滚缺口

1. 风险：新域名未在 Cloudflare 完成 custom domain 绑定就切代码，线上立即失效。
   - 应对：先验证新域名已可访问，再改 fallback 和 env。
2. 风险：Creem 后台和代码域名不一致，审核再次失败。
   - 应对：代码切换后同步复核 Creem `Website URL` 与支付页入口。
3. 风险：发件邮箱仍使用旧域名，支持邮箱/网站域名不一致。
   - 应对：如邮箱域名也变更，连带更新公开联系信息与发件配置。

## 9. Completion Criteria

1. 运行时代码中不再残留旧生产域名。
2. Workers 配置、env、脚本与新域名一致。
3. 公开官网、下载、支付、授权链路全部指向新域名体系。
4. 历史文档中不再把旧域名误写成当前生产地址。
5. 所有验证命令通过，或明确说明不可执行原因。
