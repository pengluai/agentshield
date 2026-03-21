# 2026-03-21 域名对齐与 Legacy 鉴权下线金丝雀 Runbook 方案

## 1. 目标与范围
- 目标1：完成文档域名对齐收尾，避免用户在购买/激活/安装链路中看到过期入口。
- 目标2：产出可执行的 `ALLOW_LEGACY_AUTH` 下线金丝雀方案，确保可灰度、可观测、可快速回滚。
- 范围：`docs/` 下文档与 runbook；不修改线上业务逻辑代码（仅文档治理）。

## 2. 约束与假设
- 假设：当前线上真实域名为 `https://app.51silu.com` 与 `https://api.51silu.com`；AI Proxy 仍使用 `https://agentshield-ai-proxy.pengluailll.workers.dev`（已在生产验证）。
- 约束：保留历史文档语义，不抹除“旧域名切换记录”，但需明确标注“历史/已弃用”。
- 约束：必须基于官方最佳实践给出灰度与回滚步骤。

## 3. 执行步骤
1. 扫描 `docs/` 中旧域名残留，区分“当前指南”与“历史记录”。
2. 修改会误导当前操作的域名引用；历史记录保留但显式标注“旧域名”。
3. 新增 runbook：`docs/runbooks/2026-03-21-ai-proxy-legacy-auth-canary-decommission.md`。
4. runbook 包含：灰度批次、观测指标阈值、失败触发器、`wrangler` 回滚命令、回滚后验证。
5. 执行文档校验（关键词扫描、关键文件复核），并在本计划文档补充实施结果。

## 4. 验证方案
- 校验1：`rg` 扫描是否还存在未标注的旧域名主入口。
- 校验2：runbook 命令可执行性检查（命令语法/参数与官方文档一致）。
- 校验3：关键路径一致性（购买 -> 激活 -> `/client/proxy-token` -> AI Proxy）。

## 5. 风险、回滚与完成标准
- 风险：文档误改历史事实导致审计不可追溯。
- 缓解：仅最小改动，历史文档用“历史域名”标签，不做事实删除。
- 回滚：所有文档改动可通过 Git 单提交回滚。
- 完成标准：
  - 旧域名不再作为“当前可用入口”出现；
  - legacy 下线 runbook 可直接执行；
  - 验证记录齐全并可复核。

## 6. 官方来源（含日期）
- Cloudflare Workers - Gradual Deployments（访问日期：2026-03-21）
  - https://developers.cloudflare.com/workers/configuration/versions-and-deployments/gradual-deployments/
- Cloudflare Workers - Wrangler Commands（`versions list` / `rollback`，访问日期：2026-03-21）
  - https://developers.cloudflare.com/workers/wrangler/commands/general/
- Cloudflare Workers - Configuration Best Practices（访问日期：2026-03-21）
  - https://developers.cloudflare.com/workers/wrangler/configuration/

## 7. 反向审查（第1轮：假设/冲突/依赖）
- 检查点1：AI Proxy 是否已经切到 `api.51silu.com`？
  - 结论：否。当前仍以 workers.dev 作为真实线上地址，文档不可错误改写。
- 检查点2：是否需要修改代码才能下线 legacy？
  - 结论：不需要。已有 `ALLOW_LEGACY_AUTH` 开关，可通过发布流程控制。
- 检查点3：是否存在依赖遗漏？
  - 结论：需要补充“观测指标与阈值”与“回滚演练步骤”。

## 8. 反向审查（第2轮：失败路径/安全/回滚）
- 失败路径1：关闭 legacy 后，旧客户端仍走 legacy 头，导致大量 401。
  - 对策：0% 新版本预检 + 小流量批次 + 阈值触发自动回退。
- 安全风险1：长期保留 legacy 增加伪造头攻击面。
  - 对策：设定下线窗口与最终强制关闭时间点。
- 回滚缺口1：仅回滚 Worker 版本但未回看监控，可能误判恢复。
  - 对策：runbook 强制包含“回滚后 15 分钟监控确认清单”。

## 9. 实施结果与校验记录
- 文档域名对齐：
  - 已将剩余旧入口引用显式标注为“历史旧域名”，避免误导为当前可用入口。
  - 结果文件：`docs/plans/2026-03-20-domain-cutover-old-domain-sweep.md`。
- Runbook 交付：
  - 已新增 `docs/runbooks/2026-03-21-ai-proxy-legacy-auth-canary-decommission.md`。
  - 包含 0% 预检、5/25/50/100 分批、阈值触发、回滚命令、回滚后验证。
- 独立审查（子代理）修正闭环：
  - 已修复“Step 2 缺少 0% 可执行命令”的高风险项。
  - 已补充 Wrangler 版本检查与关键命令 `--name`，降低误操作风险。
- 可执行校验：
  - `pnpm lint` 通过（2026-03-21）。
  - `rg` 扫描确认旧域名仅作为“历史标注”保留，不再作为当前入口说明。
  - 真实线上全链路回归通过（run_id: `qa_1774097469156`）：
    - `checkout.completed` 签名 webhook -> 发证成功；
    - replay 去重成功；
    - `/client/licenses/verify` 返回 `active`；
    - `/client/proxy-token` 成功发 token；
    - 无效激活码返回 `400`（非伪成功）；
    - `/client/proxy-token` 速率限制触发 `429`；
    - AI Proxy bearer `quota/chat` 均 `200`；
    - legacy 签名请求在当前模式可用（`200`）。
  - 发布门禁检查：
    - `public-sale-gate.sh` 在本机因“签名凭据与 `src-tauri/tauri.release.json` 缺失”失败；
    - 该项属于“安装包签名发布前置条件”，非支付/激活/授权业务逻辑故障。
