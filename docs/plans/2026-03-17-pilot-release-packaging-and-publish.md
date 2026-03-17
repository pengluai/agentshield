# 任务方案文档：Pilot 打包校验与发布（2026-03-17）

## 1. 目标与范围

目标：
- 完成 AgentShield 当前版本的发布前门禁校验。
- 执行本地打包并核对产物完整性与摘要。
- 输出可直接执行的 GitHub 发布命令链路（workflow + 资产归档上传）。

范围：
- 仓库：`/Users/luheng/Downloads/ai01/agentshield`
- 脚本链路：`release:github:ready`、`release:github:bundle`、`release:pilot:curate`

非范围：
- 不改业务功能逻辑。
- 不直接在本机伪造 Windows 构建产物。

## 2. 约束与假设

约束：
- 必须先通过质量门禁，再进行打包与发布。
- 发布以跨平台资产为目标，Windows 资产由 GitHub Actions 提供。

假设：
- 当前仓库已具备必要依赖（pnpm/rust/tauri）并可本地构建 macOS 产物。
- `gh` 已登录并具备对应仓库发布权限。

## 3. Skill 与 MCP 调用记录

- Sequential Thinking MCP：任务拆解与双轮反向审查。
- Tavily MCP：尝试检索发布最佳实践（本次因配额限制失败，已记录）。
- Context7 MCP：核对 Tauri v2 setup/async 初始化与官方文档实践。

## 4. 官方参考（访问日期：2026-03-17）

1. Tauri v2 文档（setup/async init）  
   https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/learn/splashscreen.mdx

2. GitHub Releases 文档  
   https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository

3. GitHub Actions 上传产物文档  
   https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-what-your-workflow-does/storing-and-sharing-data-from-a-workflow

## 5. 执行步骤

1. 读取发布脚本与工作流，确认标准发布路径和环境变量依赖。
2. 执行发布前门禁：`pnpm run release:github:ready`。
3. 执行本地打包：`pnpm run release:github:bundle`。
4. 校验 bundle 目录产物与 SHA256 摘要。
5. 产出“一键发布命令”（触发 workflow + curate 上传）。

## 6. 反向审查（施工前）

### 反向审查第 1 轮

问题：
- 只做本地打包是否可视为“全平台发布完成”？

结论：
- 不可。Windows 资产需要 CI workflow 构建；本地打包只能覆盖当前平台校验。

### 反向审查第 2 轮

问题：
- 哪些环节最可能导致“看似打包成功，实际不可发布”？

结论：
- `pnpm audit`/Playwright smoke/签名环境变量缺失是主要阻断点，必须以 gate 结果为准，不跳步。

## 7. 验证计划

1. 发布前门禁命令退出码为 0。
2. 本地打包命令退出码为 0，且生成 `src-tauri/target/release/bundle`。
3. 产物命名、体积、sha256 可读且与当前版本一致。
4. 输出可直接执行的 GitHub 命令链路（含参数模板）。

## 8. 回滚与应急

1. 如 gate 失败：停止发布，仅修复失败项后重跑 gate。
2. 如本地打包失败：保留日志，不上传产物，按失败点修复。
3. 如 CI 产物缺失：重新触发 workflow，不手工拼接跨平台资产。
