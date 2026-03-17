# AgentShield 官网落地页与 Creem 官网地址执行记录
日期：2026-03-16

## 1. 目标

为 `Creem -> Balance -> Payout Account -> Business Details` 中的 `Product Website URL` 准备一个真实可访问的产品官网地址，并确保页面包含：

1. 产品说明
2. 下载入口
3. 购买入口
4. 隐私政策
5. 服务条款
6. 退款政策
7. 联系方式

## 2. 官方依据

### Creem

1. `Payout Account` 开通流程：
   - Business Details
   - KYC / KYB Verification
   - Payout Account Setup
   - Review by Creem Team
   - Live Payments Enabled
2. `Product Website URL` 在后台引导中明确要求：
   - 必须是 live website
   - 必须是 own domain
   - 不接受 `*.vercel.app`
   - 不接受 `*.netlify.app`
   - 不接受 IP 地址

参考：

1. <https://docs.creem.io/merchant-of-record/finance/payout-accounts>
2. 后台 `Balance -> Payout Account -> Start Setup` 实际页面提示

### Cloudflare

Cloudflare 官方推荐的最小静态站部署方式：

1. 使用 `wrangler.jsonc`
2. 配置 `assets.directory`
3. 直接 `wrangler deploy`

参考：

1. Context7 / Cloudflare Workers 官方文档：Static Assets / deploy guidance

## 3. 本次实际完成内容

已在仓库新增独立静态官网目录：

- `workers/storefront/wrangler.jsonc`
- `workers/storefront/site/index.html`
- `workers/storefront/site/styles.css`
- `workers/storefront/site/app.js`
- `workers/storefront/site/privacy.html`
- `workers/storefront/site/terms.html`
- `workers/storefront/site/refund.html`
- `workers/storefront/site/eula.html`

页面内容包含：

1. 双语首页（中文 / English）
2. 产品能力说明
3. 试用与激活码流程
4. 3 个 Creem 购买入口
5. GitHub Release 下载入口
6. 隐私 / 条款 / 退款 / EULA 页面
7. 联系邮箱

## 4. 公网预览地址

已成功部署到 Cloudflare Workers 静态站：

- <https://agentshield-storefront.pengluailll.workers.dev>

公网验证结果：

1. 首页 `200 OK`
2. `/privacy` `200 OK`
3. `/terms` `200 OK`
4. `/refund` `200 OK`
5. `/eula` `200 OK`

## 5. 当前真实阻塞项

### 阻塞项 A：GitHub 仓库地址不能作为 Creem 官网地址

原因：

1. GitHub 仓库页不是产品官网
2. Creem 当前引导明确要求 `own domain`
3. 仅有 `github.com/...` 或 `workers.dev` 预览地址，严格来说都不等于“你的自定义域名官网”

### 阻塞项 B：Creem 仍未开通 Live Payments

实际检查到支付链接当前返回：

- `Live payments are not enabled for your account`
- `Account Verification Required`

说明当前状态是：

1. 商品已创建
2. 支付链接已生成
3. 但正式收款仍未启用
4. 需要继续完成 `Payout Account` / `KYC/KYB` / 收款账户绑定 / 审核

## 6. 下一步最稳方案

### 方案 A：最佳正式方案

把官网挂到你自己的域名，例如：

- `https://agentshield.51silu.com`
- `https://shield.51silu.com`
- `https://download.51silu.com`

然后把这个正式域名填入 `Creem Product Website URL`。

### 方案 B：当前阶段可先用于内容确认

先用下面这个预览地址确认官网内容是否满意：

- <https://agentshield-storefront.pengluailll.workers.dev>

确认后，再接入自定义域名。

## 7. 结论

本次已经完成了“官网内容与公网预览”的部分。  
当前还不能算 Creem 正式收款全部完成，原因不是官网没做，而是：

1. 还没挂到你的自定义域名
2. Creem 的 `Live Payments` 还没启用

也就是说：

- 官网预览：已完成
- 官网正式域名：待接入
- Creem 正式收款：待完成 Payout / KYC / 审核
