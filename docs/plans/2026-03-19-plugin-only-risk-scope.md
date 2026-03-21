# AgentShield Plan - MCP/Skill 风险面收敛（2026-03-19）

## 1. 目标与范围

### 目标
将扫描、监听、风控、修复的默认作用域严格收敛到 **外部扩展风险面**：

- MCP（外部 server / 插件配置）
- Skill（外部技能目录与脚本）

并避免触碰 AI 宿主工具的常规配置项，降低“误改配置导致工具不可用”的风险。

### 范围内
- 扫描输入文件集合：从“通用配置+env”改为“仅 MCP/Skill 风险面”。
- 一键修复目标集合：仅来自 MCP/Skill 风险面，拒绝泛化到宿主常规配置。
- 扫描文案与分类表达：明确是插件风险治理，不误导为“系统全盘配置治理”。

### 范围外
- 不改支付、许可证、商店流程。
- 不改宿主工具本身的正常功能配置（如编辑器 UI/主题/快捷键等）。

## 2. 当下（到 2026-03）公开痛点与风险归因（证据驱动）

高频风险并非“AI 工具 UI 设置”，而是“外部插件执行链”：

1. **Prompt Injection 驱动工具越权执行**  
   - OWASP MCP Top10 将 Contextual Payload Prompt Injection 列为核心风险。  
   - 直接后果：诱导工具调用、越权读取/写入/联网。
2. **不受审计的第三方 MCP Server 供应链风险**  
   - Anthropic 文档明确平台方不审计第三方 MCP server。  
   - 直接后果：恶意/脆弱 server 进入本地执行链。
3. **MCP/插件实现漏洞导致命令注入或数据泄露**  
   - GitHub Advisory 已出现 MCP 生态命令注入与数据暴露相关漏洞。  
   - 直接后果：乱删文件、执行高危命令、泄露密钥。
4. **凭据明文与过宽权限集中出现在插件配置与技能脚本周边**  
   - 官方安全建议普遍要求最小权限、显式审批、来源可验证。

结论：产品应把“主动治理能力”聚焦在 **MCP/Skill 风险面**，不要泛化到宿主常规配置。

## 3. 结构化拆解（先拆后做）

1. 梳理当前扫描输入来源（`collect_config_files`）。
2. 定义“插件风险面文件”判定：
   - 来自检测到的 `tool.mcp_config_paths`
   - 且文件存在、可解析出 MCP server（外部扩展实际生效）
3. 将 `scan_exposed_keys / scan_full / fix_all / vault_scan_exposed_keys` 的输入统一切到该集合。
4. 校正文案：`env_config` 分类语义改为“插件配置权限”。
5. 回归测试与全量验证。

## 4. 执行方案

### A. 新增作用域函数（scan.rs）
- 新增 `collect_plugin_surface_config_files()`（或等价命名）：
  - 仅遍历 `collect_detected_tools()` 的 `mcp_config_paths`
  - 文件必须存在
  - 文件应能提取出 MCP server（`extract_servers_from_file(path)` 非空）
  - 去重并保留平台名

### B. 替换调用路径
- `collect_fix_all_targets`：只用插件风险面集合。
- `scan_exposed_keys`：只扫描插件风险面集合。
- `scan_full`：
  - key_security / env_config 的输入改为插件风险面集合
  - 保留 skill_security（本来就是 Skill 风险）
- `vault_scan_exposed_keys`（vault.rs）：同样改为插件风险面集合。

### C. 文案与分类
- `env_config` 保留 ID（避免前端枚举和兼容风险），但名称与进度文案改为：
  - “插件配置权限”
  - “审计 MCP/Skill 配置权限”

## 5. 验证计划

1. `pnpm run typecheck`
2. `pnpm run lint`
3. `pnpm run test`
4. `pnpm run build`
5. `cd src-tauri && cargo test commands::scan::tests -- --nocapture`
6. `cd src-tauri && cargo test commands::vault -- --nocapture`

## 6. 反向审查（第 1 轮：假设/依赖/冲突）

- [x] 是否会漏掉“真正有风险的宿主配置”？  
  结论：目标就是只治理外部插件风险；宿主常规配置移出自动治理范围是有意设计。
- [x] 是否破坏现有分类 ID 兼容？  
  结论：保留 `env_config` ID，仅改语义文案。
- [x] 是否与 OpenClaw 专区范围冲突？  
  结论：不冲突，OpenClaw 仍走 MCP/Skill 路径。

## 7. 反向审查（第 2 轮：失败路径/安全/回滚）

- [x] 可能漏扫未被检测到的 MCP 文件？  
  控制：只信任“检测到且可解析”的活跃插件配置，避免误扫宿主普通配置。
- [x] 可能导致分数波动/历史数据不连续？  
  控制：分类 ID 不变，告知语义收敛。
- [x] 修复目标误收敛导致用户感知“修复变少”？  
  控制：产品文案明确“仅修复会造成真实损失的插件风险项”。

## 8. 完成标准

- 自动修复目标中不再出现宿主常规配置文件。
- 密钥扫描默认只针对 MCP/Skill 风险面配置。
- 扫描分类文案明确插件风险治理边界。
- 全量测试通过。

## 9. 官方/权威来源（访问日期：2026-03-19）

1. OpenAI Agent Builder Safety（工具调用风险与审批策略）  
   https://platform.openai.com/docs/guides/agent-builder-safety
2. MCP 官方 Security Best Practices  
   https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices
3. Anthropic Claude Code Security（第三方 MCP server 不由平台审计）  
   https://docs.anthropic.com/id/docs/claude-code/security
4. OWASP MCP Top10 - Prompt Injection via Contextual Payloads  
   https://owasp.org/www-project-mcp-top-10/2025/MCP06-2025%E2%80%93Prompt-InjectionviaContextual-Payloads
5. GitHub Advisory（MCP 生态命令注入）  
   https://github.com/advisories/GHSA-6jx8-rcjx-vmwf
6. GitHub Advisory（MCP 生态敏感数据暴露）  
   https://github.com/advisories/GHSA-gmx5-crwh-6vxg
