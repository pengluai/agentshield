# 19 - 商用发布前 OpenClaw / MCP / Skill 生态专项审查报告

更新日期: 2026-03-11  
适用范围: AgentShield `macOS` / `Windows`  
审查对象: `OpenClaw`、本机 AI 工具中的 `MCP` / `Skill`、GitHub 分发桌面版  
结论状态: **No-Go（暂不建议面向零基础付费用户公开售卖）**

## 1. 执行摘要

这轮审查不是泛泛“代码过一遍”，而是按照你定义的商用目标反推：

- 用户是零基础用户；
- 产品只聚焦 `OpenClaw + MCP + Skill` 生态；
- 用户付费的核心理由是省时间、少踩坑、少授权误判、少手动排查；
- 产品必须在用户**真正看懂风险**的前提下完成扫描、安装、升级、卸载、修复、授权；
- 你希望面向 `Windows + macOS`，通过 `GitHub` 分发，免费版可用，付费版省时间；
- 你强调的核心风险是：**越权删文件、越权发网、越权删邮件、泄露密钥、未经明确授权执行危险动作。**

基于外部公开证据、项目现状、真实测试结果，本项目当前结论是：

1. **可以说自己已经具备“本机 AI 工具 / MCP / Skill 发现、静态风险扫描、受控启动、外联 allowlist 监控、OpenClaw 安装/更新/卸载”的雏形能力。**
2. **不能说自己已经解决“OpenClaw / MCP / Skill 在未明确授权下删除文件、删邮件、导出密钥、提交网页/支付”等高危动作问题。**
3. **不能说自己已经适合卖给零基础用户。**
4. **如果现在发售，最先暴露的问题不是 UI，而是“产品承诺大于真实能力”。**

因此，当前最合理的对外定位不是“零风险 AI 本地防护已成熟”，而是：

> AgentShield 已具备 OpenClaw / MCP / Skill 生态的本地发现、静态审查、受控启动与运行时外联守卫能力，适合技术试点；距离面向零基础付费用户公开售卖，仍缺动作级授权、跨平台真实发现、商业化许可证闭环与实机验收。

## 2. 审查范围与非范围

### 2.1 本次审查范围

- 本机 AI 工具发现：`Codex`、`Cursor`、`Claude Code/Desktop`、`Windsurf`、`Zed`、`Trae`、`Gemini CLI`、`OpenClaw` 等；
- 本机 `MCP` 配置发现与风险分析；
- 本机 `Skill` 目录发现与恶意模式静态扫描；
- `OpenClaw` 的安装 / 更新 / 卸载 / 官方安全审计接入；
- 运行时守卫对 `MCP / Skill` 的受控启动、网络 allowlist、阻断与审计；
- 许可证 / 试用 / 激活逻辑；
- `Windows / macOS` GitHub 分发前的 repo-local gate；
- 浏览器壳 smoke 与桌面壳能力边界。

### 2.2 明确不在本次范围

- 系统级防病毒；
- 对任意本机程序的通用行为拦截；
- 内核级文件系统过滤、邮件客户端 hook、浏览器 hook；
- 非 `OpenClaw / MCP / Skill` 生态应用的安全防护。

## 3. 审查方法

### 3.1 使用的 skill / MCP / 工具

- `technical-architecture-writer`：把商用审查收口为可执行结论与交付 gate；
- `security-threat-model`：按资产、边界、攻击路径审视核心安全承诺；
- `playwright`：按真实用户路径核对关键页面与按钮；
- `Sequential Thinking MCP`：先定范围、后定威胁、再做优先级；
- `Tavily MCP`：检索 2025-2026 的最新漏洞、事件、官方文档与分发约束；
- `Context7 MCP`：核对 `Tauri v2` 与 `MCP` 官方文档边界；
- 本地命令与测试：`pnpm`、`cargo`、现有 Playwright e2e。

### 3.2 本地验证结果

截至 2026-03-11，本地 repo-local gate 结果如下：

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm typecheck` | 通过 | 前端类型检查正常 |
| `pnpm lint` | 通过 | 已恢复可执行 |
| `pnpm test` | 通过 | `19` 个测试文件，`62` 个测试通过 |
| `cargo test` | 通过 | `43` 个 Rust 测试通过 |
| `pnpm build` | 通过 | 产物可构建，存在 chunk size 警告 |
| `pnpm test:e2e` | **失败** | 浏览器壳关键降级流程仍有 1 条失败 |
| `pnpm tauri info` | 部分通过 | CLI、Rust、Node 正常；`Xcode` 未安装，不满足 macOS public release |

### 3.3 真实流程复核说明

- `Playwright MCP` 受本机现有 Chrome 会话影响，无法稳定拉起浏览器进程；
- 因此改用仓库自带 `Playwright e2e` 和本地构建/测试结果做真实交互验证；
- 失败快照显示浏览器壳点击首页 `Scan` 后，仍落入通用失败态，而不是“预览模式提示”。

## 4. 已验证的外部风险基线

### 4.1 OpenClaw 当前已公开/已验证风险主题

| 编号 | 风险主题 | 2026-03-11 审查结论 | 对 AgentShield 的意义 |
| --- | --- | --- | --- |
| E-01 | 本地 OpenClaw 被恶意网站劫持 | **已被公开验证** | 必须检测 `gateway` 暴露面、本地 WS/HTTP 边界、浏览器来源风险 |
| E-02 | 恶意 Skills 供应链 | **已被公开验证** | 不能只做“商店列表”，必须做来源、哈希、权限与静态恶意模式复核 |
| E-03 | Prompt injection / 非可信内容污染 | **已被 MCP 官方与安全研究反复确认** | 不能只做组件级信任，必须做输入来源级 trust/taint |
| E-04 | OpenClaw 误执行删除类动作 | **有公开事故与舆情记录** | 必须把审批下沉到动作级，而不是只在启动时审批 |
| E-05 | GitHub 分发桌面应用的签名/更新链要求 | **官方边界明确** | 面向普通消费者公开售卖前，必须补签名、公证、updater key |

### 4.2 与本项目直接相关的外部证据

1. **OpenClaw 本地劫持 / 网站接管**
   - Oasis Security 公开披露 OpenClaw 被恶意网站接管的漏洞，并建议升级到 `2026.2.25+`；
   - SecurityWeek、Dark Reading 均有转述与二次报道；
   - 这证明“只要用户打开网页就可能让本地 agent 出手”的担忧不是假设。

2. **MCP 官方安全边界**
   - MCP 官方安全最佳实践明确提到：
     - prompt injection；
     - session hijacking；
     - SSRF；
     - local MCP server compromise；
     - scope minimization；
     - user consent / OAuth 边界；
   - 这和你要卖的“用户授权、解释风险、少踩坑”是正相关需求，不是附加项。

3. **恶意 Skill / ClawHub 供应链**
   - 2026 年已有公开研究指向大量恶意 `ClawHub` skills；
   - 部分报道指向凭据窃取、恶意命令、投毒式 social engineering；
   - 这要求 AgentShield 不能只按“名称/热度”信任 Skill。

4. **OpenClaw 官方安全文档**
   - OpenClaw 官方文档已经明确在讲：
     - command authorization；
     - sandboxing；
     - read-only mode；
     - browser SSRF policy；
     - per-agent access profiles；
     - `openclaw security audit`；
   - 这意味着 AgentShield 的产品承诺应该与官方安全模型对齐，而不是绕过它。

### 4.3 对用户提供漏洞截图的处理结论

用户提供的图片分辨率不足以做逐行可靠 OCR，因此本次没有逐条转录每一行 `CVE` / 条目。  
但图中所表达的高频风险类别——浏览器劫持、供应链恶意 Skill、危险命令执行、越权文件/密钥访问——**已经通过外部公开来源得到独立验证**，因此整改方向可以成立。

## 5. 当前项目真实能力基线

### 5.1 已具备、可以继续迭代的真实能力

1. **本机 AI 工具与 MCP 配置发现**
   - 已支持扫描多个宿主 AI 工具的 MCP 配置；
   - 已支持 `Codex` TOML 与多种 JSON/YAML 配置格式；
   - 已支持扫描用户安装的 Skill 目录。

2. **静态风险识别**
   - 能识别一部分危险命令模式、HTTP 明文连接、弱权限配置；
   - 能对 Skill 目录做模式匹配，识别 `child_process`、`exec`、`subprocess`、`fs.rm`、`nodemailer`、`.ssh/id_rsa` 等高风险片段；
   - 能扫描暴露的 API keys / env keys。

3. **运行时守卫**
   - 能登记组件、记录信任态；
   - 能对 `blocked / quarantined` 组件运行时进行 kill；
   - 能对 `restricted + allowlist` 的外联行为做观测与阻断；
   - 能对未审批的手动组件首次外联做审批。

4. **OpenClaw 管理**
   - 后端命令真实执行 `install/update/uninstall`；
   - 集成了 `openclaw security audit`；
   - 能列出 OpenClaw skills / mcps。

5. **基本质量门**
   - 前后端单测、构建可通过；
   - 浏览器壳 smoke 有基线。

### 5.2 当前能力的真实边界

当前系统本质上是：

> “本机 `MCP / Skill` 配置发现 + 静态启发式扫描 + 受控启动 + 网络外联守卫 + OpenClaw 管理”

而不是：

> “对 OpenClaw / MCP / Skill 的所有危险动作做精确预览与强制授权的完整执行控制平面”

这个区别决定了是否适合卖给零基础用户。

## 6. 与商用目标的核心差距

### 6.1 P0 - 动作级风险控制缺失（最关键发布阻塞）

你的核心售卖承诺是：

- 未经授权不删文件；
- 未经授权不删邮件；
- 未经授权不发敏感信息；
- 未经授权不导出密钥；
- 用户一眼看懂这次动作要做什么。

但当前实现里，运行时审批和运行时处置**主要只覆盖两类事件**：

- `launch`
- `external_connection`

当前并没有真实落地这些动作级审批：

- `file_delete`
- `bulk_file_modify`
- `credential_export`
- `email_send`
- `email_delete_or_archive`
- `browser_submit`
- `payment_submit`

这意味着：

- 你现在能拦“它要联网了”；
- 但还不能拦“它要删 248 封邮件了”；
- 也不能拦“它要改 17 个文件了”；
- 更不能拦“它准备把哪个 key 发到哪儿”。

**结论：这是当前最大发布阻塞。**

### 6.2 P0 - 商业化许可证闭环不成立

当前许可证逻辑是本地文件驱动：

- 许可证和试用都写在 `~/.agentshield/license.json`；
- `trial` 是否已使用，取决于这个本地文件是否还在；
- `deactivate_license()` 会直接删除整个许可证文件；
- 激活码不绑定设备、不校验 seat、不支持撤销；
- 当前实现还是 **30 天试用**，与你现在要求的 **14 天试用** 不一致。

这会产生三个直接商业问题：

1. 用户删除本地文件即可重开试用；
2. 激活码可以跨机器转移使用；
3. 无法支撑月付 / 年付订阅的续费、停用、撤销。

**结论：当前许可证实现只能用于技术试点，不能用于正式商业收费。**

### 6.3 P0 - Windows“先扫出本机 AI 软件”不可靠

你要求产品先扫描本机有哪些 AI 软件。  
但当前 `ToolDef.app_paths` 基本只写了 macOS 的 `/Applications/*.app`。

结果是：

- `Cursor`、`Claude Desktop`、`Windsurf`、`Trae`、`Zed`、`OpenClaw` 这类 GUI 工具；
- 在 Windows 上如果还没生成配置目录、也没有 CLI；
- 很可能**不会被识别为“本机已安装 AI 工具”**。

这会直接伤害零基础用户第一步体验：  
“我明明装了，为什么它说没发现？”

**结论：跨平台真实发现能力尚未达到你的售卖标准。**

### 6.4 P1 - 浏览器壳关键降级仍未收口

当前 repo-local e2e 仍有 1 条失败：

- 浏览器壳下点击首页 `Scan`；
- 预期应该进入“Preview Mode Notice”；
- 实际仍显示通用失败态 `Fix Failed`。

这虽然不影响桌面壳核心能力，但会导致：

- 浏览器壳 smoke 不稳定；
- 发布 gate 无法全绿；
- 演示、截图、文档录屏时暴露“说是降级，实际像故障”。

### 6.5 P1 - 付费方案与用户要求不一致

你当前要求是：

- 免费版可用；
- 免费体验期 `14 天`；
- 激活码激活；
- 支持 `月付` / `年付`；
- GitHub 分发，不上商店。

但当前 UI / 后端更接近：

- `30 天试用`；
- 年付文案；
- 无真实月付 checkout；
- 无订阅状态同步；
- 无后端 license service；
- 无 webhook / receipt / revocation / seat 管理。

这不是“产品细节没完善”，而是**收费闭环尚未建立**。

### 6.6 P1 - 恶意 Skill / MCP 检测仍是启发式，不足以支撑“零风险”营销

现有检测做得不差，但本质仍是：

- pattern-based；
- depth 限制；
- 首个命中即返回；
- 不能真正理解执行路径；
- 不能证明“未命中就安全”。

因此当前适合对外表述为：

> “帮助发现高风险 Skill / MCP 并减少误装误信”

而不适合表述为：

> “确保没有任何风险”

## 7. 代码级高优先级发现

### 7.1 许可证与试用可被本地重置

- 证据：
  - `src-tauri/src/commands/license.rs`
  - 试用完全依赖本地 `license.json`
  - `deactivate_license()` 直接删除文件
- 影响：
  - 试用限制可被轻易绕过；
  - 激活状态可被本地篡改/迁移绕过运营约束；
  - 不适合正式收费。

### 7.2 运行时守卫还不是动作级防护

- 证据：
  - `src-tauri/src/commands/runtime_guard.rs`
  - 审批元数据分支只覆盖 `launch` 和 `external_connection`
  - `enforce_policy()` 核心只围绕 `blocked/quarantined` 与网络外联
- 影响：
  - 还不能兑现“未经授权不删文件 / 不删邮件 / 不导出密钥”。

### 7.3 Windows 生态发现有明显漏检风险

- 证据：
  - `src-tauri/src/commands/scan.rs`
  - `ToolDef.app_paths` 基本只写 macOS `.app`
  - `detect_tool()` 对 GUI Host 的 Windows 安装路径没有完整探测
- 影响：
  - 先扫宿主 AI 工具这一步不稳定；
  - 零基础用户首屏认知会被破坏。

## 8. 按商用目标给出的发布结论

### 8.1 现在可以卖什么

如果你今天必须给少量熟悉 AI 工具的技术用户试点，可以卖的是：

- OpenClaw / MCP / Skill 本地发现；
- 静态风险扫描；
- OpenClaw 安装 / 更新 / 卸载；
- 运行时受控启动；
- 未授权外联阻断；
- key 暴露扫描；
- 官方 `openclaw security audit` 结果整合。

这适合定位为：

> 技术试点 / 安全助手 / 风险可视化与受控启动工具

### 8.2 现在不能卖什么

现在不能面向零基础用户承诺：

- “未经授权绝不会删你文件 / 邮件”；
- “一键修复后就没有风险”；
- “已经覆盖 Win/mac 所有主流 AI 宿主”；
- “月付 / 年付 / 14 天试用 / 激活码体系已经完整可用”；
- “任何 Skill / MCP 都能判断是否恶意”。

### 8.3 当前推荐结论

- **公开付费发售：No-Go**
- **技术试点 / GitHub 免费分发：可做，但必须收紧宣传口径**

## 9. 必须在开卖前完成的整改

### 9.1 P0（开卖前必须完成）

1. **动作级授权中心**
   - 落地 `file_delete / bulk_file_modify / credential_export / email_send / email_delete_or_archive / browser_submit / payment_submit`；
   - 每次展示目标对象、数量、影响范围、是否可回退。

2. **商业化许可证服务**
   - 设备绑定或至少设备指纹；
   - 14 天试用；
   - 激活码校验服务；
   - 订阅态同步；
   - seat / revoke / refund / grace period 设计。

3. **Windows 宿主发现补全**
   - `Program Files` / `AppData` / 常见安装位置的 GUI 宿主探测；
   - 干净 Windows 11 实机回归。

4. **对外承诺收口**
   - 页面文案、官网文案、README、商店文案全部只说真实能力。

### 9.2 P1（首批付费用户前应完成）

1. 修掉浏览器壳 `Fix Failed` 降级误态；
2. OpenClaw 专项加固向导落地；
3. Skill / MCP 来源、哈希、权限 diff 可视化；
4. 付费方案支持月付 / 年付的真实购买链；
5. Win/mac 两套干净机回归清单全部执行。

### 9.3 P2（发布后持续增强）

1. taint / 非可信输入隔离；
2. 更强的 Skill 语义审查；
3. 签名、信誉、AIBOM / SBOM、供应链信誉评分；
4. 更细的零基础用户解释层。

## 10. 建议的对外表述

### 10.1 当前可用表述

> AgentShield 面向 OpenClaw、Codex、Cursor 等 AI 工具的 MCP / Skill 生态，帮助用户发现本机配置、扫描高风险组件、受控启动组件，并拦截未授权外联行为。

### 10.2 当前禁止表述

> 零风险使用所有 AI 产品  
> 自动防止一切删文件 / 删邮件 / 泄露密钥行为  
> 所有 AI 宿主和所有 Skill / MCP 都已完全覆盖  
> 已支持完整商用订阅与正式发布链

## 11. 下一阶段执行顺序

### 阶段 A：先把“卖点”和“真实能力”对齐

1. 收口商业承诺；
2. 把试用与许可证改成真实可运营；
3. 把 14 天、月付、年付写实。

### 阶段 B：补真正的安全核心

1. 动作级审批；
2. taint / prompt injection 来源链；
3. OpenClaw 删除/发送/导出类动作的高危预览。

### 阶段 C：补平台与交付闭环

1. Windows 宿主发现；
2. 公证 / 签名 / updater；
3. 干净机回归。

## 12. 参考来源

以下为本次审查实际采用的外部来源；除特别说明外，检索日期均为 **2026-03-11**：

1. Oasis Security - OpenClaw website hijack / local takeover  
   <https://www.oasis.security/blog/openclaw-vulnerability>

2. SecurityWeek - OpenClaw vulnerability allowed malicious websites to hijack AI agents  
   <https://www.securityweek.com/openclaw-vulnerability-allowed-malicious-websites-to-hijack-ai-agents/>

3. Dark Reading - Critical OpenClaw vulnerability exposes AI agent risks  
   <https://www.darkreading.com/application-security/critical-openclaw-vulnerability-ai-agent-risks>

4. OpenClaw Docs - Gateway security  
   <https://docs.openclaw.ai/gateway/security>

5. OpenClaw Docs - CLI security / `openclaw security audit`  
   <https://docs.openclaw.ai/cli/security>

6. OpenClaw Docs - Configuration reference  
   <https://docs.openclaw.ai/gateway/configuration-reference>

7. MCP official security best practices  
   <https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices>

8. MCP specification / authorization security considerations  
   <https://github.com/modelcontextprotocol/specification>

9. Palo Alto Unit 42 - New prompt injection attack vectors through MCP sampling  
   <https://unit42.paloaltonetworks.com/model-context-protocol-attack-vectors/>

10. The Hacker News - Researchers find malicious ClawHub skills  
    <https://thehackernews.com/2026/02/researchers-find-341-malicious-clawhub.html>

11. OECD AI incident record - OpenClaw deleted emails incident  
    <https://oecd.ai/en/incidents/2026-02-23-d55b>

12. Tauri v2 Updater docs  
    <https://v2.tauri.app/plugin/updater/>

13. Tauri v2 macOS code signing docs  
    <https://v2.tauri.app/distribute/sign/macos/>

14. 项目内基线文档  
    - `docs/specs/13-GA交付与签名验收基线.md`
    - `docs/specs/14-干净机实机回归清单.md`
    - `docs/specs/17-基于真实用户痛点的MCP与Skill高风险防护整改方案.md`
    - `docs/specs/18-浏览器壳兼容与关键用户流修复方案.md`
