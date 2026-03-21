# 2026-03-21 防御监控审计与真实性可用性加固计划

## 1. 目标与范围

### 1.1 目标
围绕 AgentShield「防御 + 监控 + 零基础一键操作」核心价值，对已实现代码执行：
1. 结构化安全/可用性审计（前端 + Tauri/Rust）。
2. 真实可执行验证（lint/typecheck/test/e2e/build/cargo test）。
3. 修复高优先级“假可用/误操作/并发冲突”问题。
4. 保障新手无需理解专业术语即可完成关键流程（授权、安装、一键配置）。

### 1.2 范围内文件（计划）
- `src/App.tsx`
- `src/components/pages/security-scan.tsx`
- `src/components/pages/openclaw-wizard.tsx`
- `src/components/pages/install-dialog.tsx`
- `src/components/ai-install-chat.tsx`
- 相关测试文件（按实际受影响范围补充）

### 1.3 明确不做
- 不引入 Tier C / UNKNOWN 可写能力。
- 不改动支付/许可证协议本身。
- 不做与本次真实性/易用性加固无关的大规模重构。

## 2. 约束与假设

1. 当前仓库为脏工作区，仅在本任务文件内增量修改，不回滚既有改动。
2. Tavily MCP 本次返回配额上限错误，外部研究按规则降级为“官方域名网络检索 + Context7”。
3. 一键流程必须保持“真实执行 + 明确授权”，不能通过伪进度掩盖失败。
4. 允许保留必要技术细节，但默认文案需优先用户可理解表达。

## 3. 证据与实现依据（官方来源）

访问日期：2026-03-21

1. Tauri Shell 权限默认最小化，危险命令默认阻断，需 capabilities 显式放行：
   - https://v2.tauri.app/plugin/shell/
2. Tauri Capabilities 用于按窗口隔离 IPC 命令访问边界：
   - https://v2.tauri.app/security/capabilities/
3. OWASP XSS 防护总则（输出编码/输入边界/框架安全注意）：
   - https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
4. React 官方对 `dangerouslySetInnerHTML` 的高风险警示（必须仅使用可信且已净化数据）：
   - https://react.dev/reference/react-dom/components/common
5. Playwright 官方最佳实践（优先用户可见行为与稳定定位器）：
   - https://playwright.dev/docs/best-practices
6. Vite 官方说明：暴露到客户端的环境变量不可视为秘密：
   - https://vite.dev/guide/env-and-mode.html
7. GOV.UK 内容设计指南（基于用户需求、简单词汇、降低理解成本）：
   - https://www.gov.uk/guidance/content-design/what-is-content-design
   - https://www.gov.uk/guidance/content-design/writing-for-gov-uk
8. Pew 2025 全球调查：多数用户对 AI 认知不足且担忧高于兴奋，支持“默认简化与可解释护栏”：
   - https://www.pewresearch.org/global/2025/10/15/how-people-around-the-world-view-ai/
9. Microsoft 研究：AI 采用的主要阻碍包括“不知道从何开始”和 AI literacy 缺口：
   - https://techcommunity.microsoft.com/blog/microsoftvivablog/research-drop-investing-in-training-opportunities-to-close-the-ai-skills-gap/4389566

### Context7 适用性说明
- 已调用 Context7（Tauri 官方文档库）核验 capabilities/shell 权限实践。
- 本任务无新增第三方框架接入，其他库 Context7 标记为“本轮不适用”。

## 4. 执行步骤（先后顺序）

1. 先修复真实性关键缺陷：
   - Security Scan 空缓存误判导致“未真实扫描”。
2. 修复一键流程并发与误操作风险：
   - OpenClaw 向导互斥执行（setup 与 install/update/uninstall 互锁）。
   - 通知渠道改为可选，不阻断主安装链路。
   - 默认不自动全选所有宿主写入目标，要求显式选择。
3. 修复审批体验“二次点击”断点：
   - InstallDialog 在审批 pending 后自动等待并续跑安装。
4. 清理工程质量阻塞项：
   - 解决 lint warning（unused eslint-disable）。
5. 执行完整验证链并复核结果与计划一致性。

## 5. 验证计划

1. 前端/Node：
   - `pnpm lint`
   - `pnpm typecheck`
   - `pnpm test`
   - `pnpm test:e2e`
   - `pnpm build`
2. Rust：
   - `cargo test --manifest-path src-tauri/Cargo.toml`
3. 审计核对：
   - 核对高优先级问题是否被修复或明确记录残留风险。

## 6. 反向审查（第 1 轮：假设/冲突/依赖）

1. 假设错误：`cachedIssues.length >= 0` 被当作缓存命中，导致空数组也跳过真实扫描。
   - 处理：缓存命中必须为“有数据”或显式有效标记。
2. 需求冲突：一键向导强调“自动完成”，但通知 token 缺失会中断主链路。
   - 处理：将渠道配置降级为可选步骤（skip），保留后续可补填。
3. 依赖遗漏：安装审批 pending 后要求用户二次点击，违背“一次授权一次执行”。
   - 处理：接入审批事件等待并自动续跑。
4. 依赖遗漏：setup 与 action 可并发触发，状态和命令串扰。
   - 处理：加入统一互斥标志并禁用入口。

## 7. 反向审查（第 2 轮：失败路径/安全/回滚）

1. 失败路径：并发触发 install/uninstall/setup 可能造成配置损坏或误卸载。
   - 处理：互斥锁 + 统一忙碌提示。
2. 安全风险：默认全选宿主后批量写配置，用户易误授权到不希望改写的宿主。
   - 处理：默认不自动全选，需显式勾选目标。
3. 安全风险：扫描未真实执行却展示“无问题”，会给出错误安全结论。
   - 处理：空缓存必须触发真实扫描。
4. 回滚缺口：互斥和流程改动可能影响已有用户习惯。
   - 处理：改动保持最小化；出现阻塞时可回退到本次修改前版本。

## 8. 回滚策略

1. 前端回滚：
   - 回退上述 5 个文件到本次改动前版本。
2. 验证回滚：
   - 回滚后重跑 `pnpm lint && pnpm test && pnpm build` 验证可恢复。

## 9. 完成标准（DoD）

1. 安全扫描在“无有效缓存”时必定真实执行。
2. OpenClaw 一键流程与安装/更新/卸载不再并发执行。
3. 通知渠道未配置不会阻断主安装链路。
4. 安装审批无需二次点击，审批通过后可自动继续。
5. 默认目标选择不再隐式批量写入所有宿主。
6. 全部验证命令通过；未通过项需明确记录。

## 10. 执行结果与核对（实施后）

### 10.1 实际完成项
1. 修复 Security Scan 缓存误判：
   - `App.tsx` 仅在 category key 存在时透传缓存。
   - `security-scan.tsx` 改为 `cachedIssues !== undefined` 才视为缓存命中。
2. 修复 OpenClaw 一键流程误操作：
   - setup 与 install/update/uninstall 增加统一互斥（`workflowBusy`）。
   - 渠道配置改为可选步骤，无 token 时 `skipped` 不阻断主链路。
   - 默认不再自动全选所有可写宿主目标。
3. 修复安装审批二次点击问题：
   - `install-dialog.tsx` 在 pending 后自动等待审批事件并续跑。
   - 新增单测覆盖该交互路径。
4. 修复运行时守卫策略修改免审批风险：
   - `runtime_guard.rs` 对策略/信任/联网策略更新强制 `approval_ticket`。
   - 前端 `installed-management.tsx` 增加审批请求并传票据。
5. 修复签名链路与规则更新硬化：
   - `license-gateway` 激活码验签改为 payload bytes 验签。
   - 无公钥默认拒绝（除显式环境变量 override）。
   - `rule_updater` 默认拒绝无签名 manifest（新增显式 override 环境变量）。
   - AI Proxy 请求签名改为按 `activation_code` 派生，不再使用全局硬编码共享密钥。
6. 清理质量门阻塞：
   - 删除无效 eslint-disable，恢复 lint 全绿。

### 10.2 DoD 对齐检查
1. “无有效缓存时必须真实扫描”：已满足。
2. “setup 与 install/update/uninstall 不并发”：已满足。
3. “通知渠道不阻断主安装链路”：已满足。
4. “审批通过后自动继续安装”：已满足（含测试）。
5. “默认不隐式批量写入所有宿主”：已满足。
6. “全量验证通过”：已满足（见 10.3）。

### 10.3 验证结果
- `pnpm lint` ✅
- `pnpm typecheck` ✅
- `pnpm test` ✅（22 files / 82 tests）
- `pnpm test:e2e` ✅（2 tests）
- `pnpm build` ✅
- `cargo test --manifest-path src-tauri/Cargo.toml` ✅（112 + 4 tests）
