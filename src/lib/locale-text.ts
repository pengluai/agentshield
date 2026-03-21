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

  // scan.rs — security scan issue titles (partial match for dynamic format! strings)
  ['配置文件权限过宽，其他账户可读取', 'Config file permissions too loose — other accounts can read it'],
  ['通过命令行运行程序', 'runs programs via command line'],
  ['数据传输未加密', 'data transfer is unencrypted'],
  ['启动参数存在安全隐患', 'startup arguments have security risks'],
  ['发现未加密的 API 密钥', 'Unencrypted API keys found'],
  ['MCP 配置含明文密钥', 'MCP config contains plaintext keys'],
  ['指向非标准路径', 'points to a non-standard path'],
  ['可能存在安全风险', 'may have security risks'],
  ['正在运行，已纳入实时盯防', 'is running — added to real-time monitoring'],
  ['检查通过', 'check passed'],
  ['未发现 MCP 配置风险', 'no MCP config risks found'],
  ['无法执行 OpenClaw 官方安全审计', 'Unable to run OpenClaw official security audit'],

  // scan.rs — security scan issue descriptions
  ['配置文件的访问权限设置过于宽松，电脑上的其他用户也能读取其中的内容。建议收紧权限，只允许你自己访问。', 'Config file permissions are too loose — other users on this computer can read its contents. Tighten permissions to allow only your account.'],
  ['该插件会通过命令行运行程序，如果被恶意利用，可能在你不知情的情况下执行危险操作。', 'This plugin runs programs via command line. If exploited, it could execute dangerous operations without your knowledge.'],
  ['该插件使用了不加密的 HTTP 连接', 'This plugin uses an unencrypted HTTP connection'],
  ['建议升级为 HTTPS 以防止数据被窃听或篡改', 'Recommend upgrading to HTTPS to prevent data interception or tampering'],
  ['在配置文件中发现了未加密保存的 API 密钥', 'Unencrypted API keys found in config file'],
  ['这意味着任何能访问你电脑的人都能看到这些密钥。建议将密钥迁移到密钥保险库中加密保存。', 'Anyone with access to your computer can see these keys. Move them to the Key Vault for encrypted storage.'],
  ['建议运行完整扫描以检查 MCP 配置安全性。', 'Run a full scan to check MCP configuration security.'],
  ['这类技能可以直接运行系统命令，可能绕过你的理解范围执行脚本、下载程序或批量改写配置。', 'This skill can run system commands — it could execute scripts, download programs, or modify configs without your understanding.'],
  ['这类技能具备删改本地文件能力，可能误删项目代码、文档、配置或其他重要资料。', 'This skill can modify or delete local files — it could accidentally remove your code, documents, or important data.'],
  ['这类技能可能把文件、表单数据、上下文或凭据上传到外部服务，存在敏感信息外发风险。', 'This skill may upload files, form data, or credentials to external services — risk of sensitive data leakage.'],
  ['这类技能会读取环境变量、钥匙串或密钥文件，来源不明时存在 API Key、令牌和账户凭据泄露风险。', 'This skill reads environment variables, keychains, or key files — unknown sources risk leaking API keys and credentials.'],
  ['当前命中了高危恶意模式，建议立即停用并核对来源。', 'Matched a high-risk malicious pattern — recommend disabling immediately and verifying the source.'],

  // scan.rs — scan progress steps
  ['检测 AI 工具与配置入口', 'Detecting AI tools and config entries'],
  ['分析 MCP 配置与命令风险', 'Analyzing MCP config and command risks'],
  ['扫描密钥暴露与配置权限', 'Scanning key exposure and config permissions'],
  ['检查运行中进程与 Skill 安全', 'Checking running processes and skill security'],
  ['汇总结果', 'Summarizing results'],
  ['发现 MCP 配置文件', 'MCP config files found'],

  // runtime_guard.rs — event titles
  ['已拦下可疑删除动作', 'Blocked suspicious delete action'],
  ['已拦下可疑命令执行', 'Blocked suspicious command execution'],
  ['已拦下可疑批量文件操作', 'Blocked suspicious bulk file operation'],
  ['已拦下可疑邮件发送', 'Blocked suspicious email send'],
  ['已拦下可疑支付操作', 'Blocked suspicious payment action'],
  ['已拦下可疑浏览器提交', 'Blocked suspicious browser submission'],
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
