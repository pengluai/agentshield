# 2026-03-20 Pro「IDE式自动安装引导」功能评估与落地方案

日期：2026-03-20  
状态：研究结论（可进入产品立项）  
作者：Codex

## 1. 目标与范围

### 1.1 目标
评估是否应在 AgentShield Pro 中增加“像 IDE 一样的 OpenClaw 自动安装与引导能力”，核心体验为：

1. 用户用自然语言说需求。
2. 系统自动完成可自动化步骤（安装、配置、联机检测、写配置）。
3. 需要用户授权/扫码的步骤，给出逐步引导并在完成后继续自动化。
4. 支持模型接入（重点 MiniMax 2.7）。
5. 支持聊天渠道接入（重点 Telegram / WhatsApp）。

### 1.2 范围
本次仅输出“是否值得做 + 如何做”的方案，不直接改代码。

### 1.3 非目标

1. 不实现 WhatsApp Business Cloud API 全链路商家注册后台。
2. 不新增跨平台驱动级自动点击器（绕过系统授权提示）。
3. 不把不可自动化步骤伪装成“全自动”。

## 2. 约束与假设

### 2.1 约束

1. 用户设备权限提示（macOS Gatekeeper、Windows UAC）必须由用户确认，不能后台静默绕过。
2. Telegram/WhatsApp 的登录与配对包含人工步骤（扫码、授权、配对批准）。
3. 不能暴露密钥；敏感值必须继续走 keyring/secret ref。

### 2.2 假设

1. 目标人群以“非重度命令行用户”为主，愿意点“下一步/允许”，但不愿手工查文档。
2. Pro 用户愿意为“省时、省坑、少报错”付费，不仅为扫描本身付费。
3. 你的产品定位允许“半自动 + 强引导”作为 Pro 核心价值，而非“100% 无人值守”。

## 3. 结构化拆解（Sequential Thinking 等价）

说明：当前环境没有可用的 `mcp__sequential-thinking__process_thought` 工具，以下为等价结构化拆解。

### 3.1 问题定义

1. 当前安装和渠道接入存在“最后一公里”摩擦。
2. 用户对命令、配置、权限术语不敏感，期望“自然语言 + 向导化”。

### 3.2 目标用户

1. 新手开发者/独立开发者（第一次接触 OpenClaw）。
2. 有明确自动化诉求但不愿手工维护配置的人群。

### 3.3 价值主张

1. 从“会扫描”升级到“会落地”。
2. Pro 价值可感知（每一步都能看到自动化成果）。

### 3.4 范围边界

1. 自动化：安装、onboard、MCP 注入、权限加固、配置写入、状态验证。
2. 人工确认：系统权限弹窗、二维码扫描、账号授权、支付/商户级验证。

### 3.5 发布策略

1. 先做“可完成率提升”再做“无人值守程度提升”。
2. 先强化 OpenClaw 现有向导，再扩展自然语言编排。

## 4. 外部与仓库事实依据（官方优先）

访问日期：2026-03-20（除链接页面自身标注外）

### 4.1 OpenClaw 已有能力（官方）

1. `openclaw onboard` 本身是推荐安装路径，并覆盖 Model/Auth、Channels、Daemon、Health Check、Skills。  
来源：<https://docs.openclaw.ai/start/wizard>
2. 安装脚本可处理 Node 检测、安装和 onboarding。  
来源：<https://docs.openclaw.ai/install>
3. 向导流程支持 `--non-interactive`，并通过 RPC 暴露 `wizard.start / wizard.next / wizard.status`，可由客户端渲染步骤而不重写逻辑。  
来源：<https://docs.openclaw.ai/reference/wizard>, <https://docs.openclaw.ai/experiments/onboarding-config-protocol>

### 4.2 渠道接入自动化边界（官方）

1. WhatsApp 接入步骤包含 `openclaw channels login --channel whatsapp` + 二维码绑定。  
来源：<https://docs.openclaw.ai/channels/whatsapp>
2. OpenClaw CLI 明确 `channels login` 是交互式登录，当前重点是 WhatsApp Web 登录流。  
来源：<https://docs.openclaw.ai/cli/channels>
3. Telegram Bot 侧是 BotFather token 配置流，不是 WhatsApp 式扫码登录。  
来源：<https://docs.openclaw.ai/channels/telegram>, <https://core.telegram.org/bots/tutorial>
4. Telegram QR 登录协议要求“由已登录客户端扫码并接受登录 token”。  
来源：<https://core.telegram.org/api/qr-login>, <https://core.telegram.org/tdlib/docs/classtd_1_1td__api_1_1internal_link_type_qr_code_authentication.html>

### 4.3 WhatsApp 官方业务 API（Meta）边界

1. Cloud API 官方路径需要 Meta business 资产、WABA、business phone number。  
来源：<https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api>
2. Cloud API 需要 `whatsapp_business_management` 与 `whatsapp_business_messaging` 权限。  
来源：同上
3. Phone Number 注册步骤要求设置 6 位 pin，两步验证是 Cloud API 使用要求之一。  
来源：同上
4. Embedded Signup 后号码需要在窗口期内注册（文档写明 14 天）。  
来源：同上

### 4.4 MiniMax 与模型接入（官方）

1. MiniMax API 概览文档显示文本模型包含 `MiniMax-M2.7` 系列。  
来源：<https://platform.minimax.io/docs/api-reference/api-overview>
2. 文档同时给出 Anthropic-compatible（推荐）与 OpenAI-compatible 两种接入方式。  
来源：同上
3. OpenClaw 官方 MiniMax provider 文档默认模型为 `MiniMax-M2.7`，并给出 `api.minimax.io`/`api.minimaxi.com` 路径与配置示例。  
来源：<https://docs.openclaw.ai/providers/minimax>

### 4.5 系统授权不可绕过（官方）

1. macOS 对外部应用首次打开有 Gatekeeper 审批与 `Open Anyway` 流程。  
来源：<https://support.apple.com/en-us/102445>
2. Windows UAC 对需要管理员权限的操作要求用户 consent/credential elevation prompt。  
来源：<https://learn.microsoft.com/en-us/windows/security/application-security/application-control/user-account-control/how-it-works>

## 5. 仓库现状核对（与需求匹配）

### 5.1 已有接近能力（可复用）

1. 现有 OpenClaw Wizard 已有 7 步自动化链路：`check_node -> install_openclaw -> run_onboard -> setup_mcp -> harden_permissions -> configure_channel -> verify_install`。  
代码：`src/components/pages/openclaw-wizard.tsx`
2. 已有 Pro/Trial 门控，一键安装与配置属于付费自动化范围。  
代码：`src-tauri/src/commands/ai_orchestrator.rs`
3. 后端已支持 provider=`minimax`，默认模型 `MiniMax-M2.7`，并有连接测试/失败诊断。  
代码：`src-tauri/src/commands/ai_orchestrator.rs`

### 5.2 与你需求的差距

1. 当前“自然语言驱动”的编排还偏弱，更多是固定步骤按钮流。
2. 当前渠道配置以 token 类渠道为主；WhatsApp QR 接入未在 AgentShield UI 做“完整图形化引导闭环”。
3. 还缺“分步骤可恢复执行”（用户扫码后自动续跑）和“渠道接入诊断面板”。

## 6. 结论：这个功能值不值得进 Pro

结论：**值得加入，而且应作为 Pro 核心卖点之一，但必须定义为“最大化自动化 + 必要人工确认”而非“绝对全自动”。**

### 6.1 值得做的原因

1. 与现有底座契合：你已有 60%~75% 能力，边际开发成本可控。
2. 用户价值直观：减少命令行和配置心智负担，降低流失。
3. 商业价值明确：与免费版“手动模式”形成强区分。

### 6.2 不应承诺的部分

1. 不承诺绕过系统授权弹窗。
2. 不承诺免扫码接入 WhatsApp/Telegram 个人登录流程。
3. 不承诺替用户完成 Meta 商业资产审核类步骤。

## 7. 方案设计（Pro 版本）

## 7.1 产品定位文案建议

“像 IDE 一样的安装体验：自动完成可自动化步骤，遇到系统授权/扫码时给你逐步引导，完成后自动继续。”

### 7.2 功能拆分

1. **NL 编排层**：用户输入“帮我装 OpenClaw 并接 Telegram/WhatsApp + MiniMax”。
2. **执行引擎层**：映射到已存在步骤 API（含审批票据）。
3. **人工节点层**：扫码/授权步骤提供可视化指导 + 状态轮询 + 一键继续。
4. **复盘层**：生成“安装报告 + 可重放脚本 + 故障建议”。

### 7.3 自动化可达边界（务实版）

1. 可自动：环境检测、安装、onboard、配置写入、权限加固、服务状态验证。
2. 半自动：打开 Telegram/BotFather 页面、打开 WhatsApp 链接设备页、等待扫码并继续。
3. 必须人工：系统权限确认、扫码确认、账号授权、商户合规验证。

## 8. 实施计划（Step-by-step）

### Phase 1（1-2 周）：把现有向导升级为“可恢复自动流”

1. 增加“人工节点卡片”：显示当前要做什么（例如“请在手机 WhatsApp 扫码”）。
2. 增加“自动续跑”：检测到状态变化后自动进入下一步。
3. 增加“失败分层提示”：环境错误、权限错误、渠道错误、模型错误分开处理。

### Phase 2（1-2 周）：自然语言编排入口

1. 新增 `intent -> setup plan` 解析（例：只装 Telegram，不装 WhatsApp）。
2. 将用户自然语言映射为步骤图，执行前展示预览与风险。
3. 增加“审批提示统一文案”（告诉用户为何需要允许）。

### Phase 3（1-2 周）：渠道闭环与 Pro 打磨

1. WhatsApp 引导增强：扫码后自动校验 `pairing` 状态并给出 approve 指引。
2. Telegram 引导增强：BotFather token 获取与 `allowFrom` 配置检查。
3. 增加“安装完成度评分”和“一键修复建议”。

## 9. 验证计划

上线前最少验证：

1. `lint/typecheck/test/build` 全通过。
2. 新装机器完成率（从点击开始到可发送首条消息）>= 85%。
3. 首次安装平均耗时下降 >= 30%（对照手动流程）。
4. 关键路径失败可恢复率 >= 90%（扫码中断、权限拒绝后重试）。
5. 敏感信息校验：token 仅以 secret ref/keyring 存储，不落明文。

## 10. 反向审查（两轮）

## 第 1 轮：假设错误 / 需求冲突 / 依赖遗漏

1. 误区：把“IDE 式”理解成“后台静默安装一切”。  
纠正：应是“自动 + 明确人工节点”。
2. 误区：假设 Telegram/WhatsApp 接入路径一致。  
纠正：Telegram 常见是 Bot token；WhatsApp 常见是 QR Web 会话或 Cloud API 商业流程。
3. 漏项：未区分 OpenClaw 渠道（个人 IM）和 Meta Cloud API（商业消息）两条路线。  
纠正：产品里要先让用户选择“个人助手模式 / 商业客服模式”。

## 第 2 轮：失败路径 / 安全风险 / 回滚缺口

1. 失败路径：扫码后会话过期导致流程卡死。  
补救：设置超时+重试+“重新生成扫码步骤”。
2. 安全风险：错误地把 token 写入明文配置。  
补救：统一 keyring/secret ref，禁止日志打印明文。
3. 回滚缺口：自动注入配置后用户想恢复。  
补救：每次改写前自动备份，提供“一键回滚到上一个稳定快照”。

## 11. 风险与回滚

### 11.1 主要风险

1. 过度承诺“全自动”导致预期崩盘。
2. 渠道接入差异化太强导致流程分叉复杂。
3. 新手用户在 BotFather / WhatsApp pairing 节点停滞。

### 11.2 回滚策略

1. Feature flag 控制：先灰度给 Pro 内测用户。
2. 保留现有“手动模式 + 官方文档跳转”作为兜底。
3. 引导流程异常时自动降级为“分步手动 + 自动检测续跑”。

## 12. 完成标准（Definition of Done）

1. 产品层：用户可以一句话触发安装编排，并看到清晰步骤。
2. 体验层：人工节点均有图文引导与完成后续跑。
3. 工程层：核心检查全绿，失败可恢复、配置可回滚、密钥不泄漏。
4. 商业层：Pro 转化与完成率可观测，并有基线对照数据。

## 13. Context7 适用性

本任务是产品能力评估与跨平台流程设计，不依赖某个前端/后端框架 API 细节实现，**Context7 当前不适用**。

## 14. 来源清单（官方/一手，含日期）

1. OpenClaw Onboarding (CLI): <https://docs.openclaw.ai/start/wizard>（访问：2026-03-20）
2. OpenClaw Install: <https://docs.openclaw.ai/install>（访问：2026-03-20）
3. OpenClaw Wizard Reference: <https://docs.openclaw.ai/reference/wizard>（访问：2026-03-20）
4. OpenClaw Onboarding Config Protocol: <https://docs.openclaw.ai/experiments/onboarding-config-protocol>（访问：2026-03-20）
5. OpenClaw WhatsApp Channel: <https://docs.openclaw.ai/channels/whatsapp>（访问：2026-03-20）
6. OpenClaw Telegram Channel: <https://docs.openclaw.ai/channels/telegram>（访问：2026-03-20）
7. OpenClaw CLI Channels: <https://docs.openclaw.ai/cli/channels>（访问：2026-03-20）
8. OpenClaw MiniMax Provider: <https://docs.openclaw.ai/providers/minimax>（访问：2026-03-20）
9. Telegram Bot Tutorial: <https://core.telegram.org/bots/tutorial>（访问：2026-03-20）
10. Telegram QR Login: <https://core.telegram.org/api/qr-login>（访问：2026-03-20）
11. Telegram TDLib QR Auth: <https://core.telegram.org/tdlib/docs/classtd_1_1td__api_1_1internal_link_type_qr_code_authentication.html>（访问：2026-03-20）
12. Meta WhatsApp Cloud API（Meta 官方 Postman 文档）: <https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api>（访问：2026-03-20）
13. MiniMax API Overview: <https://platform.minimax.io/docs/api-reference/api-overview>（访问：2026-03-20）
14. MiniMax x OpenClaw Guide: <https://platform.minimax.io/docs/token-plan/openclaw>（访问：2026-03-20）
15. Apple Gatekeeper/Open Anyway: <https://support.apple.com/en-us/102445>（访问：2026-03-20）
16. Microsoft UAC how it works: <https://learn.microsoft.com/en-us/windows/security/application-security/application-control/user-account-control/how-it-works>（访问：2026-03-20）
