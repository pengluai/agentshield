import { isEnglishLocale } from '@/constants/i18n';

const CJK_REGEX = /[\u3400-\u9FFF]/;

export function containsCjk(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  return CJK_REGEX.test(value);
}

export function localizedDynamicText(value: string, englishFallback: string): string {
  if (!isEnglishLocale) {
    return value;
  }
  if (containsCjk(value)) {
    return englishFallback;
  }
  return value;
}

/**
 * Bidirectional translation table: [Chinese, English].
 * Used to translate text in either direction based on the current locale.
 */
const BILINGUAL_TABLE: Array<[string, string]> = [
  // store.rs review_notes
  ['已通过 AgentShield 的 OpenClaw 兼容性与安装路径复核', 'Passed AgentShield OpenClaw compatibility and install path review'],
  ['内置目录条目，可扫描和审查，但尚未列入 OpenClaw 专区', 'Built-in catalog entry, scannable and reviewable, but not yet listed in OpenClaw section'],
  ['来自 MCP Registry 的实时目录数据，尚未经过 AgentShield 人工复核', 'Live catalog data from MCP Registry, not yet manually reviewed by AgentShield'],
  // runtime_guard.rs notification titles
  ['已拦下未允许的联网地址', 'Blocked unauthorized network address'],
  ['发现未允许的联网地址，但未能自动暂停', 'Unauthorized network address detected, but auto-suspend failed'],
  // Scan notification body
  ['安全扫描已完成，请立即查看并处理高风险项目。', 'Security scan completed. Please review and handle critical issues now.'],
  // runtime_guard.rs notification descriptions (partial matches)
  ['想连接', 'tried to connect to'],
  ['但这个地址不在你已允许的名单里', 'but this address is not on your allowed list'],
  ['AgentShield 已先暂停这次运行，等你决定是否放行', 'AgentShield has suspended this run, waiting for your approval'],
  ['AgentShield 已弹出授权确认，但这次没能自动暂停进程，请你先手动结束它', 'AgentShield prompted for authorization, but could not auto-suspend the process. Please stop it manually'],
  // Generic notification texts
  ['安全通知', 'Security notification'],
  ['发现安全事件，请查看详情。', 'A security event was detected. Please review details.'],
  ['发现高风险安全事件，请立即查看。', 'A critical security event requires your review.'],
];

/**
 * Bidirectional translation for backend/stored text.
 * When English locale: Chinese → English.
 * When Chinese locale: English → Chinese.
 */
export function translateBackendText(value: string): string {
  if (isEnglishLocale) {
    // CN → EN
    if (!containsCjk(value)) return value; // already English
    // Dynamic: "发现 N 个高风险安全问题"
    const critCn = value.match(/发现 (\d+) 个高风险安全问题/);
    if (critCn) return `${critCn[1]} critical security issues detected`;
    // Static exact match
    for (const [cn, en] of BILINGUAL_TABLE) {
      if (value === cn) return en;
    }
    // Partial replacement
    let result = value;
    for (const [cn, en] of BILINGUAL_TABLE) {
      if (result.includes(cn)) result = result.replace(cn, en);
    }
    return result;
  } else {
    // EN → CN
    if (containsCjk(value)) return value; // already Chinese
    // Dynamic: "N critical security issues detected"
    const critEn = value.match(/^(\d+) critical security issues? detected$/);
    if (critEn) return `发现 ${critEn[1]} 个高风险安全问题`;
    // Static exact match
    for (const [cn, en] of BILINGUAL_TABLE) {
      if (value === en) return cn;
    }
    // No match — return as-is
    return value;
  }
}
