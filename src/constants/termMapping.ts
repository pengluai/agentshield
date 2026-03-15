/**
 * Term Mapping: Maps technical MCP/agent terms to user-friendly names
 * Used throughout the UI to present approachable language to non-technical users.
 */

export interface TermMapping {
  technical: string;
  friendly: string;
  description: string;
}

export const TERM_MAPPINGS: TermMapping[] = [
  // Core concepts
  { technical: 'MCP Server', friendly: '技能', description: '为 AI 代理提供特定能力的服务模块' },
  { technical: 'MCP Tool', friendly: '动作', description: '技能中可执行的具体操作' },
  { technical: 'MCP Resource', friendly: '数据源', description: '技能可以访问的数据或信息' },
  { technical: 'MCP Prompt', friendly: '提示模板', description: '预定义的 AI 交互模板' },

  // Security terms
  { technical: 'Policy', friendly: '安全策略', description: '定义允许或拦截行为的规则' },
  { technical: 'Rule', friendly: '规则', description: '安全策略中的单条判断条件' },
  { technical: 'Allowlist', friendly: '白名单', description: '明确允许执行的操作列表' },
  { technical: 'Blocklist', friendly: '黑名单', description: '明确禁止执行的操作列表' },
  { technical: 'Sandbox', friendly: '沙盒', description: '隔离的安全执行环境' },
  { technical: 'Permission', friendly: '权限', description: '操作所需的授权级别' },

  // Agent terms
  { technical: 'Agent', friendly: 'AI 代理', description: '可以自主执行任务的 AI 程序' },
  { technical: 'Tool Call', friendly: '工具调用', description: 'AI 代理请求执行的操作' },
  { technical: 'Function Call', friendly: '函数调用', description: 'AI 代理调用的具体功能' },
  { technical: 'Context Window', friendly: '上下文窗口', description: 'AI 代理可处理的信息范围' },
  { technical: 'Token', friendly: '令牌', description: 'AI 处理文本的基本单位' },

  // Platform terms
  { technical: 'Runtime', friendly: '运行环境', description: '技能运行所需的软件环境' },
  { technical: 'Manifest', friendly: '配置清单', description: '技能的描述和配置信息' },
  { technical: 'Endpoint', friendly: '服务地址', description: '技能的网络访问地址' },
  { technical: 'Transport', friendly: '通信方式', description: '技能与 AI 代理的通信协议' },
  { technical: 'stdio', friendly: '本地通信', description: '通过本地进程直接通信' },
  { technical: 'SSE', friendly: '网络推送', description: '通过网络实时推送数据' },
  { technical: 'Streamable HTTP', friendly: '流式网络', description: '通过网络流式传输数据' },

  // Action terms
  { technical: 'Install', friendly: '安装', description: '将技能添加到本地' },
  { technical: 'Uninstall', friendly: '卸载', description: '从本地移除技能' },
  { technical: 'Enable', friendly: '启用', description: '激活技能使其可以被使用' },
  { technical: 'Disable', friendly: '禁用', description: '暂停技能但保留配置' },
  { technical: 'Configure', friendly: '配置', description: '设置技能的运行参数' },

  // Status terms
  { technical: 'Running', friendly: '运行中', description: '技能正在正常运行' },
  { technical: 'Stopped', friendly: '已停止', description: '技能已停止运行' },
  { technical: 'Error', friendly: '异常', description: '技能遇到错误' },
  { technical: 'Pending', friendly: '等待中', description: '操作正在等待执行' },
  { technical: 'Blocked', friendly: '已拦截', description: '操作被安全策略阻止' },
  { technical: 'Allowed', friendly: '已放行', description: '操作通过安全检查' },
];

/** Quick lookup map: technical term -> friendly term */
export const TERM_MAP: Record<string, string> = Object.fromEntries(
  TERM_MAPPINGS.map(({ technical, friendly }) => [technical, friendly])
);

/** Get the friendly name for a technical term, returns original if no mapping found */
export function toFriendlyTerm(technical: string): string {
  return TERM_MAP[technical] ?? technical;
}

/** Get full term info including description */
export function getTermInfo(technical: string): TermMapping | undefined {
  return TERM_MAPPINGS.find((t) => t.technical === technical);
}
