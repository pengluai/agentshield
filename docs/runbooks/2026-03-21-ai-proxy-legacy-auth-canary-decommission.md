# AI Proxy Legacy 鉴权下线金丝雀 Runbook（2026-03-21）

## 1. 目标
- 将 `ALLOW_LEGACY_AUTH` 从 `1` 平滑切换到 `0`，逐步淘汰 legacy header 鉴权。
- 在不影响真实付费用户购买/激活/调用链路的前提下，降低伪造 legacy 头的攻击面。
- 整个过程保证可灰度、可观测、可一键回滚。

## 2. 适用范围
- Worker：`agentshield-ai-proxy`。
- 相关链路：`/client/proxy-token` -> AI Proxy `Bearer` 调用。
- 非范围：License Gateway 支付与发码逻辑（本 runbook 不改该逻辑）。

## 3. 官方依据（访问日期：2026-03-21）
- Gradual deployments（官方建议逐步放量并监控后再全量）  
  https://developers.cloudflare.com/workers/configuration/versions-and-deployments/gradual-deployments/
- Rollbacks / Wrangler rollback（官方回滚机制）  
  https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/  
  https://developers.cloudflare.com/workers/wrangler/commands/general/
- Wrangler versions/deployments 命令  
  https://developers.cloudflare.com/workers/wrangler/commands/general/

## 4. 前置条件
1. 已在代码中保留 `ALLOW_LEGACY_AUTH` 开关（当前默认 `1`）。
2. 已有 bearer 鉴权路径验证通过（`/v1/quota`、`/v1/chat/completions`）。
3. 值班人可访问 Cloudflare 控制台与 `wrangler`，可在 5 分钟内执行回滚。
4. 已准备观测面板（最少包含：2xx/4xx/5xx、401 比例、延迟、异常日志量）。
5. `wrangler` 版本满足 `versions/deployments/rollback` 命令可用（执行前检查）：
```bash
npx wrangler --version
```

## 5. 灰度发布步骤

### Step 0: 记录基线（Legacy 仍开启）
1. 连续观察 15 分钟：
   - AI Proxy `5xx` 比例
   - `401` 比例
   - `/v1/chat/completions` 成功率
2. 记录当前稳定版本 ID：
```bash
cd workers/ai-proxy
npx wrangler versions list --name agentshield-ai-proxy
npx wrangler deployments list --name agentshield-ai-proxy
```
3. 手工记录当前 active deployment 中的版本 ID（作为后续 `OLD_VERSION_ID` 回滚锚点）。

### Step 1: 生成新版本（仅关闭 legacy）
1. 将生产配置中的 `ALLOW_LEGACY_AUTH` 设为 `0`，并发布新版本。
2. 上传新版本（不立即全量）：
```bash
cd workers/ai-proxy
npx wrangler versions upload --name agentshield-ai-proxy
npx wrangler versions list --name agentshield-ai-proxy
```

### Step 2: 0% 预检 + 指定版本验证
1. 使用 `versions deploy` 保持新版本 `0%`，旧版本 `100%`：
```bash
cd workers/ai-proxy
npx wrangler versions deploy <NEW_VERSION_ID>@0 <OLD_VERSION_ID>@100 --name agentshield-ai-proxy --message "legacy-off precheck 0%"
npx wrangler deployments list --name agentshield-ai-proxy
```
2. 用版本覆盖头验证新版本行为（只对测试请求生效）：
```bash
curl -s https://agentshield-ai-proxy.pengluailll.workers.dev/v1/quota \
  -H 'Authorization: Bearer <VALID_TOKEN>' \
  -H 'Cloudflare-Workers-Version-Overrides: agentshield-ai-proxy="<NEW_VERSION_ID>"'
```
3. 预期：
   - bearer 请求返回 `200`；
   - legacy 头请求返回 `401`。

### Step 3: 金丝雀放量
按以下批次推进，每批至少观察 15 分钟：
1. `5%` 新版本 + `95%` 旧版本
2. `25%` 新版本 + `75%` 旧版本
3. `50%` 新版本 + `50%` 旧版本
4. `100%` 新版本

示例命令（替换版本 ID）：
```bash
npx wrangler versions deploy <NEW_VERSION_ID>@5 <OLD_VERSION_ID>@95 --name agentshield-ai-proxy --message "legacy-off canary 5%"
npx wrangler versions deploy <NEW_VERSION_ID>@25 <OLD_VERSION_ID>@75 --name agentshield-ai-proxy --message "legacy-off canary 25%"
npx wrangler versions deploy <NEW_VERSION_ID>@50 <OLD_VERSION_ID>@50 --name agentshield-ai-proxy --message "legacy-off canary 50%"
npx wrangler versions deploy <NEW_VERSION_ID>@100 --name agentshield-ai-proxy --message "legacy-off full rollout"
```

## 6. 监控阈值与停止条件
- 任一批次命中以下任意条件，立即停止推进并回滚：
1. `5xx` 比例较基线上升超过 `0.5%` 且持续 5 分钟。
2. `401` 比例较基线上升超过 `2%` 且持续 5 分钟。
3. `/v1/chat/completions` 成功率低于 `99%` 持续 5 分钟。
4. 用户侧出现“已激活但无法调用 AI”工单明显增多（人工阈值：15 分钟内 >= 3 单）。

## 7. 回滚流程（必须演练）
1. 获取上一稳定版本 ID（来自 `wrangler versions list`）。
2. 执行回滚：
```bash
cd workers/ai-proxy
npx wrangler rollback <OLD_VERSION_ID> --name agentshield-ai-proxy --message "rollback legacy-off canary failure"
```
3. 回滚后 15 分钟验证清单：
   - bearer 请求恢复 `200`；
   - legacy 头请求在当前策略下恢复预期；
   - `5xx` 与 `401` 回到基线附近；
   - 支付后激活用户可正常拿 token 并调用 AI。

## 8. 回滚后与全量后验收

### 回滚后验收命令
```bash
# bearer 成功路径
curl -i https://agentshield-ai-proxy.pengluailll.workers.dev/v1/quota \
  -H "Authorization: Bearer <VALID_TOKEN>"

# legacy 路径（用于确认开关状态）
# 注意：当前签名格式为 X-Signature: <unix_ts>-<nonce>-<base64url(hmac_sha256)>
# payload = "<LICENSE_ID><unix_ts><nonce>"，HMAC key = activation_code
node <<'NODE'
const crypto = require('crypto');
const licenseId = '<LICENSE_ID>';
const activationCode = '<ACTIVATION_CODE>';
const ts = Math.floor(Date.now() / 1000);
const nonce = crypto.randomBytes(8).toString('hex');
const payload = `${licenseId}${ts}${nonce}`;
const mac = crypto.createHmac('sha256', Buffer.from(activationCode, 'utf8')).update(payload).digest();
const signature = `${ts}-${nonce}-${Buffer.from(mac).toString('base64url')}`;
console.log(signature);
NODE

curl -i https://agentshield-ai-proxy.pengluailll.workers.dev/v1/quota \
  -H "X-License-ID: <LICENSE_ID>" \
  -H "X-Activation-Code: <ACTIVATION_CODE>" \
  -H "X-Signature: <SIGNATURE_FROM_NODE>"
```

### 全量后验收（100% 新版本）
1. 真实激活用户走 `/client/proxy-token` 获取 bearer 后调用成功。
2. 旧客户端若仍发送 legacy 头，返回明确 `401` 与迁移提示。
3. 观察 24 小时无异常后，进入“移除 legacy 代码路径”变更流程。

## 9. 风险与备注
- `wrangler rollback` 是“立即生效”的生产级操作，执行前必须再次核对目标版本 ID。
- 若你本机 Wrangler 版本支持，可在上述关键命令后追加 `--yes` 跳过交互确认。
- 若后续引入新自定义域名，runbook 中 `workers.dev` 验证 URL 需同步更新。
- 建议在发布通知中明确告知：升级后仅支持 bearer 鉴权，用户无需理解术语，只需完成“授权/激活”即可自动生效。
