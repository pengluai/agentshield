# 2026-03-21 语言一致性（中/英）全面审计与修复方案

## 1. 目标与范围
- 目标：彻底修复“选中文却出现英文、选英文却出现中文”的混杂显示问题。
- 范围：`src/` 前端可见界面，重点覆盖：
  - `Security Scan` / `Smart Guard` 首页与详情页
  - 风险卡片、详情面板、按钮、底栏提示、空状态
  - 动态扫描文案（后端返回 title/description/semantic 文本）
- 非目标：本次不改业务判定逻辑（风险识别规则、修复动作逻辑）；仅改文案本地化一致性。

## 2. 约束与假设
- 约束：必须保证语言切换后同一界面同一时刻只显示该语言。
- 约束：不引入破坏性重构；优先最小改动与现有 `t/tr/localizedDynamicText/translateBackendText` 管线对齐。
- 假设：当前语言来源由 `settingsStore.language` + `constants/i18n.ts` 统一驱动。

## 3. 官方最佳实践依据（访问日期：2026-03-21）
- i18next Best Practices（避免字符串拼接与不必要插值）
  - https://www.i18next.com/principles/best-practices
- i18next Fallback（缺失 key 的回退行为）
  - https://www.i18next.com/principles/fallback
- react-i18next（组件内统一使用翻译函数与消息描述）
  - https://github.com/i18next/react-i18next

> 备注：Tavily MCP 本次不可用（配额限制），已按规则切换为 Context7 + 官方文档来源。

## 4. 执行步骤
1. 审计：全仓扫描 `src/` 中文/英文硬编码与未走翻译管线的动态文本。
2. 定位：区分三类问题：
   - 静态文案硬编码；
   - 动态文本（后端文本）未做双向翻译；
   - fallback 文案语言不随 locale 切换。
3. 修复：
   - 静态文案统一迁移到 `t/tr`；
   - 动态文本统一走 `localizedDynamicText + translateBackendText`；
   - 风险分类、组件标签、空状态、按钮等统一走 locale 映射。
4. 验证：
   - 单元测试 + 关键页面交互验证（zh/en 各跑一轮）；
   - 文案扫描脚本复查（确保无遗漏硬编码）。
5. 交付：输出“修复清单 + 覆盖范围 + 残余风险（如有）”。

## 5. 验证方案
- 必跑：`pnpm lint`、`pnpm typecheck`、`pnpm test`。
- 针对性：
  - `security-scan` 页面在 `zh-CN` / `en-US` 下截图与关键节点文本断言。
  - 后端动态标题/描述在两种语言下均无混杂。
- 复查：`rg` 扫描 `src/components/pages` 内的硬编码 CJK/English 文案。

## 6. 风险与回滚
- 风险1：动态翻译表不全导致英文模式出现中文残留。
  - 缓解：补充映射并为“未知文本”提供语言一致 fallback。
- 风险2：过度替换导致含义偏差。
  - 缓解：优先最小改动；对高风险提示保留原语义。
- 回滚：按本次改动文件集合回滚（git restore 指定文件）。

## 7. 完成标准
- 选中文：全界面仅中文（术语名词如产品名除外）。
- 选英文：全界面仅英文（术语名词如产品名除外）。
- `Security Scan` 全流程（首页、分类详情、空状态、底栏）不再出现中英混杂。
- 自动化检查通过。

## 8. 反向审查（第1轮：假设/冲突/依赖）
- 假设挑战：是否只是单页面问题？
  - 结论：不是。动态后端文本和本地静态文案都可能混杂。
- 依赖遗漏：是否存在 locale 变更后缓存未刷新？
  - 结论：需重点检查使用 `isEnglishLocale` 的模块是否在切换时刷新。
- 冲突检查：是否有“中文文案 + 英文 fallback”硬编码共存？
  - 结论：有，需统一 fallback 策略。

## 9. 反向审查（第2轮：失败路径/安全/回滚）
- 失败路径1：翻译函数只处理 CJK，不处理英文回中文，导致中文模式残留英文。
  - 对策：补全双向映射与统一入口函数。
- 失败路径2：风险分类卡/标签文案直接写死英文，切中文后仍英文。
  - 对策：全量改为 `tr/t`。
- 回滚缺口：一次性改动过多难定位回归。
  - 对策：按页面模块分批提交验证（scan -> smart-guard -> 其他页面）。

## 10. 实施结果（已完成）
- 核心翻译引擎：
  - `src/lib/locale-text.ts` 改为双向动态本地化：
    - `localizedDynamicText` 支持中<->英双向兜底；
    - `translateBackendText` 增加 EN->ZH 局部替换能力；
    - 补充运行时/启动/OpenClaw 常见动态文案映射。
- 安全扫描链路：
  - `src/components/pages/security-scan.tsx`
    - 修复 `skill` 组件标签本地化；
    - 扫描进度标签改为双向本地化；
    - `cachedIssues` 与实时扫描 `issues` 在语言切换时统一重本地化；
    - 分类标题 `categoryTitle` 渲染时翻译；
    - 多处 fallback 改为双语 `tr(...)`。
- 智能守护首页：
  - `src/components/pages/smart-guard-home.tsx`
    - 进度标签双向本地化；
    - 修复 `fix-all` 错误提示直接透传；
    - 扫描结果卡片不再缓存语言相关 `message`，避免切语言残留旧文案。
- 结果卡片渲染层：
  - `src/components/glassmorphic-card.tsx`
    - `headline/detail/actionLabel` 渲染时统一走动态本地化。
- 设置页：
  - `src/components/pages/settings-page.tsx`
    - 修复多个 `useMemo` 语言切换依赖缺失；
    - 启动时间线 status/step/summary 本地化；
    - 保护事件标题与描述改为动态本地化；
    - AI 连接测试/语义状态消息本地化；
    - about 页英文硬编码改为双语。
- 安装与已安装管理：
  - `src/components/pages/install-dialog.tsx`
    - 目标列表分隔符按语言显示（EN `, ` / ZH `、`）；
    - 目标状态标签在语言切换时重算（effect 依赖加入语言）；
    - 安装结果/异常信息动态本地化。
  - `src/components/pages/installed-management.tsx`
    - 更新原因与运行时事件标题/描述 fallback 改为双语；
    - 透传原因改为动态本地化。
- OpenClaw：
  - `src/components/pages/openclaw-wizard.tsx`
    - 后端文案本地化统一改走双向动态管线；
    - 选中渠道信息在语言切换时重算。
- App 入口层：
  - `src/App.tsx`
    - `CARD_TITLES` 改为动态函数，修复切语言后分类标题残留；
    - 启动时间线记录改为 `tr(...)` 双语写入；
    - 运行时通知标题/描述发送前做动态本地化。

## 11. 验证结果（2026-03-21）
- 自动化校验全部通过：
  - `pnpm -s lint` ✅
  - `pnpm -s typecheck` ✅
  - `pnpm -s test` ✅（`22` 个测试文件、`82` 个测试通过）
- 子代理复核：
  - Agent `Curie`：最终复核结论“无 S1 级混语问题”；
  - Agent `Dalton`：补齐最后一处 `install-dialog` 语言依赖后，最终复核结论“无”。

## 12. 交付前对齐结论
- 与目标对齐：
  - 选中文 -> 页面关键文案统一中文；
  - 选英文 -> 页面关键文案统一英文；
  - `Smart Guard` / `Security Scan` / `Settings` / `Install Dialog` / `Installed Management` / `OpenClaw` 已覆盖修复。
- 与约束对齐：
  - 未改业务判定逻辑，仅修复 i18n 与显示一致性；
  - 改动后通过 lint/typecheck/test，满足交付门槛。
