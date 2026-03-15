# Deep Research Report 2

更新日期: 2026-03-12  
状态: 生效中（用于产品边界与文案依据）

## 1. 研究目标

围绕 AgentShield 的真实定位做外部事实对齐：

1. 只防护含 MCP/Skill 的 AI 工具链，不做通用杀毒。
2. 面向零基础用户，默认后果导向文案，不让用户读专业术语才可理解风险。
3. 免费/付费边界以“是否省时省力、是否自动化”区分。

## 2. 方法与来源

执行顺序：结构化拆解 -> 外部检索 -> 官方实现校验。

- 外部检索：Tavily（2026-03-12）
- 官方实现：Context7（Tauri v2 capability/permission/shell open）
- 本地真值：`src/`、`src-tauri/src/`、`docs/specs/10~24`

## 3. 核心结论

1. MCP/Skill 生态的风险主题仍集中在：
   - 未授权动作执行
   - 本地代理暴露面
   - 供应链（来源、更新、能力漂移）
2. 对零基础用户最有效的策略是：
   - 默认先拦住
   - 显示“最差后果”
   - 把技术字段放入“查看详情”
3. 商业化最小闭环可行路径是：
   - 14 天试用 + 激活码
   - 免费手动处理，付费一键自动化

## 4. 当前仍需持续验证项

1. 跨宿主高危动作信号覆盖率（邮箱、支付、网页提交）需要持续扩展。
2. 商店托管安装覆盖率需要持续提升，降低手动来源条目。
3. 支付网关仍需从“最小闭环”提升到“生产运维闭环”。

## 5. 参考（含日期）

1. MCP 官方安全教程与授权指南（检索日期 2026-03-12）  
   - https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices  
   - https://modelcontextprotocol.io/docs/tutorials/security/authorization
2. Tauri v2 权限与插件文档（Context7 检索日期 2026-03-12）  
   - https://github.com/tauri-apps/tauri-docs
3. 本仓库专项文档（更新日期见各文档）  
   - `docs/specs/17~24`
