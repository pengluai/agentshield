# 2026-03-20 macOS 分发切换方案（修复版购买链路）

- 日期：2026-03-20
- 负责人：Codex
- 范围：官网下载链路对应的 macOS 安装包更新

## 1. Objective & Scope

### Objective
将已包含“购买链接硬修复”的 macOS 桌面包发布到当前官方下载链路，避免用户继续下载到旧包。

### Scope
1. 构建最新 macOS release DMG。
2. 覆盖 GitHub release `agentshield-pilot-v1.0.1` 的 macOS 资产（同名替换）。
3. 验证 storefront `/download/macos` 可下载并返回正确文件名。

Out of scope:
1. Windows 新包重建（当前环境非 Windows 构建环境）。
2. 版本号升级与新 tag 推广（本次走最小风险热修复）。

## 2. Skill & MCP Routing

- Skill：无专门“GitHub release 运维”技能，采用通用执行。
- MCP：Sequential Thinking 已执行，用于发布路径和验证标准拆解。
- Tavily/Context7：本任务为仓库内发布运维，不涉及新增第三方实现细节；沿用上一阶段已核验的 Creem 官方依据。

## 3. Assumptions & Constraints

### Assumptions
1. `gh` 已登录且对 `pengluai/agentshield-downloads` 有 release 上传权限。
2. storefront 下载仍绑定 `agentshield-pilot-v1.0.1` + `AgentShield-pilot-1.0.1-macos-arm64.dmg`。

### Constraints
1. 不暴露任何 secret。
2. 不修改现有下载 URL 路径，避免额外回归。
3. 保持可快速回滚（重新上传旧 DMG 即可）。

## 4. Execution Plan

1. 构建 release DMG（`pnpm tauri build`）。
2. 将产物复制为 release 资产目标文件名：`AgentShield-pilot-1.0.1-macos-arm64.dmg`。
3. 使用 `gh release upload ... --clobber` 覆盖同名资产。
4. 校验 release 资产列表中该文件更新时间与 size 已变化。
5. 请求 storefront 下载路由并验证 HTTP 状态、重定向、`content-disposition` 文件名。

## 5. Validation Plan

1. 构建成功：存在 `src-tauri/target/release/bundle/dmg/AgentShield_1.0.1_aarch64.dmg`。
2. Release 资产更新成功：`gh release view` 可见目标资产更新。
3. 下载链路可用：
   - `https://agentshield-storefront.pengluailll.workers.dev/download/macos` 返回可下载内容。
   - 文件名为 `AgentShield-pilot-1.0.1-macos-arm64.dmg`。

## 6. Reverse Review Pass 1

关注：假设错误 / 依赖遗漏 / 需求冲突

1. 风险：只替换 release 资产但未重新部署 storefront。
   - 结论：不需要重新部署，storefront 通过 GitHub release URL 读取同名资产。
2. 风险：替换后文件名不一致导致下载名异常。
   - 处理：上传时使用与现有绑定一致的资产文件名。
3. 风险：发布权限不足。
   - 处理：先 `gh auth status`，失败即停止。

## 7. Reverse Review Pass 2

关注：失败路径 / 安全风险 / 回滚缺口

1. 失败路径：上传中断导致资产残缺。
   - 处理：用 `gh release view` 复核资产状态，必要时重传。
2. 安全风险：误上传包含 secret 的文件。
   - 处理：仅上传 DMG 二进制，不上传 env/日志。
3. 回滚缺口：新包异常如何撤回。
   - 处理：保留旧 DMG 本地备份，支持同名 `--clobber` 回滚。

## 8. Completion Criteria

1. 官网下载入口返回更新后的 macOS 安装包。
2. 新包已包含本次购买修复逻辑。
3. 全流程命令输出可复现，且无 secret 泄露。

## 9. Sources

- 本阶段无新增第三方实现研究；沿用上一阶段已记录官方来源：
  - https://docs.creem.io/llms-full.txt （2026-03-20）

## 10. Post-implementation Reconciliation

### 10.1 实际执行
1. 执行 `pnpm tauri build`，产出 release DMG：
   - `src-tauri/target/release/bundle/dmg/AgentShield_1.0.1_aarch64.dmg`
2. 将产物复制为当前线上绑定文件名：
   - `AgentShield-pilot-1.0.1-macos-arm64.dmg`
   - `AgentShield-macos-arm64.dmg`
3. 执行 `gh release upload agentshield-pilot-v1.0.1 ... --clobber` 覆盖同名资产。

### 10.2 验证结果
1. `gh release view` 显示 macOS 两个 DMG 资产已更新：
   - `updatedAt=2026-03-20T05:26:05Z`
   - `digest=sha256:2254c07e18669eb9117e4b0b95f6de9b9c954a747a6624610f32687cbd4b4418`
2. `curl -I https://agentshield-storefront.../download/macos` 返回：
   - `HTTP/2 200`
   - `content-disposition: attachment; filename=\"AgentShield-pilot-1.0.1-macos-arm64.dmg\"`
3. 通过 storefront 下载的文件哈希为：
   - `2254c07e18669eb9117e4b0b95f6de9b9c954a747a6624610f32687cbd4b4418`
   - 与新 release DMG 一致。

### 10.3 对齐结论
1. 官网下载入口已切换到包含购买修复逻辑的新 macOS 包。
2. 下载路由、文件名、资产路径均保持不变，无需额外前端路由变更。
3. 未修改 secrets，Windows 资产保持原状（本次范围外）。
