# Security Scan 归属可视化 + Step3 主操作置顶改造方案

Date: 2026-03-19
Status: planned
Scope:
- `/src/components/pages/security-scan.tsx`
- `/src/types/domain.ts`
- `/src/components/pages/installed-management.tsx`
- `/workers/storefront/site/index.html`
Out of scope:
- Rust 扫描引擎规则本身（仅消费当前输出）
- 支付/许可证后端逻辑

## 1) 目标与范围
1. 在“恶意插件风险 / 安全扫描详情”中，明确显示每条风险属于哪个 AI 工具，并展示是 `Skill` 还是 `MCP`。
2. `Security Scan` 页面提供显眼的一键修复入口（Pro），即使当前“可自动修复=0”也给出下一步（跳转到已安装管理手动/半自动处理）。
3. “已安装管理”右侧第 3 步把核心操作（检查更新/升级/卸载）上移到顶部可见区，避免用户必须滚动到底部才看到。
4. 官网 macOS 下载提示改为“先说明系统设置里的 Open Anyway 路径”，与真实安装体验一致。

## 2) 现状审计（基于代码）
- `security-scan.tsx` 目前通过 `extractPlatform()` 从标题/描述/路径做关键词推断，列表项只显示标题和描述，归属信息不够直观。
- `Security Scan` 底栏的一键修复按钮仅在 `fixableCount > 0` 时显示，导致用户常见“看不到一键修复”。
- `InstalledItemDetail` 的更新/卸载操作位于详情底部 `mt-8` 区域，长内容场景下需要滚动很久。
- 官网 `index.html` 已包含 Gatekeeper 说明，但“系统设置 > 隐私与安全性 > 仍要打开”仍是次级分支，优先级不够高。

## 3) 官方依据（2026-03-19 访问）
1. MCP Client Concepts（官方）
   - https://modelcontextprotocol.io/docs/learn/client-concepts
   - 关键点：MCP client（各 AI 工具）连接多个 server，连接与能力由客户端侧配置决定。=> 前端应显示“风险归属到哪个宿主工具”。
2. Apple Support（官方）
   - https://support.apple.com/en-us/102445
   - 关键点：被拦截应用可在 `System Settings > Privacy & Security` 通过 `Open Anyway` 放行。=> 官网安装弹窗应把该路径清晰前置。
3. Tauri macOS Signing（官方）
   - https://tauri.app/distribute/sign/macos/
   - 关键点：建议进行签名/公证，减少 Gatekeeper 阻断。=> 站点文案需说明“未公证场景”的系统放行路径，避免错误预期。
4. Microsoft List-Details Pattern（官方）
   - https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/list-details
   - 关键点：左列表 + 右详情的主从关系，详情面板应直接承载上下文操作。=> Step3 顶部应直接可操作。
5. Microsoft Button Guidance（官方）
   - https://design.learn.microsoft.com/components/button.html
   - 关键点：主要动作使用明确主按钮层级，避免关键操作被埋在低可见区域。

## 4) MCP/Skill 执行说明（环境能力）
- Sequential Thinking MCP：当前环境无可用入口（`sequential-thinking not found`），使用结构化计划 + 双轮反向审查替代。
- Tavily MCP：当前环境无可用入口（`tavily not found`），使用官方站点直连检索替代。
- Context7 MCP：当前环境无可用入口（`context7 not found`），本次不涉及新框架 API 接入，标记为不适用。

## 5) 实施方案
1. 扩展 `SecurityIssue` 前端模型（仅前端）：
   - 新增 `hostName`、`componentType`、`componentName`、`ownershipLabel`（显示文案）。
2. 在 `mapRustIssue()` 中补齐归属解析：
   - 优先从描述中的 `[平台名]` 抽取宿主；
   - 解析标题提取组件类型（Skill/MCP）与组件名；
   - 保留现有关键词推断作为兜底。
3. 改造安全扫描中栏卡片与右侧详情：
   - 列表项新增一行“所属工具 + 组件类型 + 组件名”标签；
   - 详情页在标题下方增加“归属信息卡”，零基础可直接理解“哪个工具里的哪个扩展有问题”。
4. 调整 Security Scan 底栏操作逻辑：
   - 始终显示 Pro 一键修复按钮；
   - `fixableCount === 0` 时点击给出明确下一步：引导到“已安装管理”继续处理（通过回调导航）。
5. 改造 `InstalledItemDetail`：
   - 新增“置顶主操作区”（sticky），包含：检查更新、升级（有更新时）、卸载；
   - 保留底部二级操作/说明，避免信息丢失。
6. 官网弹窗文案微调：
   - 强化“Open Anyway”路径为核心流程；
   - 兼容中英文并保持现有布局不改。

## 6) 反向审查（施工前）
### 反向审查第 1 轮：假设/依赖/冲突
- 风险：仅靠标题解析可能误判组件类型。
- 处置：采用“描述方括号 + 标题模式 + 路径关键词”三层解析，无法确定时明确标注“待确认”。
- 风险：始终显示“一键修复”可能被理解为一定可自动修。
- 处置：按钮文案与点击反馈明确“当前无自动修复项，已引导到已安装管理继续处理”。

### 反向审查第 2 轮：失败路径/安全/回滚
- 失败路径：新增字段导致现有测试断言失效。
- 处置：同步更新 `security-scan` 与 `installed-management` 测试；先跑局部再跑全量。
- 安全风险：仅 UI 文案与导航，不新增提权命令；无额外系统权限面。
- 回滚：文件级回滚，按模块撤销（scan UI / installed UI / storefront 文案互不耦合）。

## 7) 验证方案
1. `pnpm run lint`
2. `pnpm run typecheck`
3. `pnpm exec vitest run src/components/pages/__tests__/security-scan.test.tsx`
4. `pnpm exec vitest run src/components/pages/__tests__/installed-management.test.tsx`
5. `pnpm run test`
6. `pnpm run build`
7. 启动 `tauri dev` 手工冒烟：
   - 恶意插件风险卡是否显示“所属 AI 工具 + Skill/MCP”；
   - Security Scan 是否始终可见一键修复入口；
   - Step3 右栏是否无需下滑即可见核心按钮。

## 8) 风险与回滚
- 风险等级：中（涉及两个核心页面结构）
- 回滚路径：
  - 回滚 `security-scan.tsx` 的新增字段显示与按钮逻辑；
  - 回滚 `installed-management.tsx` 的 sticky 操作区；
  - 保留其他功能不受影响。

## 9) 完成标准
- 安全扫描每条风险都能清晰显示“属于哪个 AI 工具 + 是 Skill 还是 MCP（或配置）”。
- Pro 用户在 Security Scan 页面始终看到一键修复入口。
- 已安装管理 Step3 右栏核心按钮首屏可见。
- 官网 macOS 安装提示与真实 Gatekeeper 路径一致。
- 所有验证命令通过。
