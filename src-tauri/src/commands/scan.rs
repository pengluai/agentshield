use std::ffi::OsString;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use crate::commands::discovery;
use crate::commands::license;
use crate::commands::platform::{
    normalize_path, normalize_path_string, openclaw_command, preferred_openclaw_config_dir,
};
use crate::commands::protection::ProtectionService;
use crate::commands::runtime_guard;
use crate::commands::semantic_guard::{self, SemanticReviewCandidate};
use crate::rule_updater;
use crate::rule_updater::{SkillRiskPattern, SkillScanRuleBundle};
use crate::types::scan::*;
use sysinfo::{ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter, State};
#[cfg(windows)]
use winreg::{enums::*, RegKey, HKEY};

/// Global cancel flag for scan operations
static SCAN_CANCELLED: AtomicBool = AtomicBool::new(false);
const SCAN_PROGRESS_EVENT: &str = "scan-progress";
static CLI_SEARCH_DIRS: OnceLock<Vec<PathBuf>> = OnceLock::new();
const AI_TOOL_PATH_HINTS: &[&str] = &[
    "cursor",
    "kiro",
    "vscode",
    "claude",
    "codex",
    "gemini",
    "trae",
    "windsurf",
    "openclaw",
    "aider",
    "continue",
    "cline",
    "roo",
    "zed",
    "openai",
    "atlas",
    "yuanbao",
    "workbuddy",
    "codebuddy",
    "doubao",
    "kimi",
    "tongyi",
    "qwen",
    "wenxin",
    "chatglm",
    "coze",
];

// ---------------------------------------------------------------------------
// AI tool definitions
// ---------------------------------------------------------------------------

struct ToolDef {
    id: &'static str,
    name: &'static str,
    icon: &'static str,
    app_paths: &'static [&'static str],
    cli_name: Option<&'static str>,
    config_dir: Option<&'static str>,
    #[cfg_attr(not(windows), allow(dead_code))]
    windows: Option<WindowsDetectionHints>,
    /// Multiple possible MCP config file paths (relative to home dir)
    mcp_config_files: &'static [&'static str],
}

#[cfg_attr(not(windows), allow(dead_code))]
struct WindowsDetectionHints {
    display_names: &'static [&'static str],
    executable_names: &'static [&'static str],
    install_subdirs: &'static [&'static str],
    start_menu_terms: &'static [&'static str],
}

const TOOL_DEFS: &[ToolDef] = &[
    ToolDef {
        id: "cursor",
        name: "Cursor",
        icon: "⚡",
        app_paths: &["/Applications/Cursor.app", "~/Applications/Cursor.app"],
        cli_name: None,
        config_dir: Some(".cursor"),
        windows: Some(WindowsDetectionHints {
            display_names: &["Cursor"],
            executable_names: &["Cursor"],
            install_subdirs: &["Cursor"],
            start_menu_terms: &["Cursor"],
        }),
        mcp_config_files: &[
            ".cursor/mcp.json",
            "Library/Application Support/Cursor/User/settings.json",
            "AppData/Roaming/Cursor/User/settings.json",
        ],
    },
    ToolDef {
        id: "kiro",
        name: "Kiro",
        icon: "🪄",
        app_paths: &["/Applications/Kiro.app", "~/Applications/Kiro.app"],
        cli_name: Some("kiro"),
        config_dir: Some(".kiro"),
        windows: Some(WindowsDetectionHints {
            display_names: &["Kiro"],
            executable_names: &["Kiro"],
            install_subdirs: &["Kiro"],
            start_menu_terms: &["Kiro"],
        }),
        mcp_config_files: &[
            ".kiro/settings/mcp.json",
            "Library/Application Support/Kiro/User/settings.json",
            "AppData/Roaming/Kiro/User/settings.json",
        ],
    },
    ToolDef {
        id: "vscode",
        name: "VS Code",
        icon: "💻",
        app_paths: &[
            "/Applications/Visual Studio Code.app",
            "~/Applications/Visual Studio Code.app",
        ],
        cli_name: Some("code"),
        config_dir: Some(".vscode"),
        windows: Some(WindowsDetectionHints {
            display_names: &["Microsoft Visual Studio Code", "Visual Studio Code", "VS Code"],
            executable_names: &["Code"],
            install_subdirs: &["Microsoft VS Code", "VS Code"],
            start_menu_terms: &["Visual Studio Code", "VS Code"],
        }),
        mcp_config_files: &[
            ".vscode/mcp.json",
            "Library/Application Support/Code/User/settings.json",
            "AppData/Roaming/Code/User/settings.json",
        ],
    },
    ToolDef {
        id: "claude_desktop",
        name: "Claude Desktop",
        icon: "🤖",
        app_paths: &["/Applications/Claude.app", "~/Applications/Claude.app"],
        cli_name: None,
        config_dir: None,
        windows: Some(WindowsDetectionHints {
            display_names: &["Claude", "Claude Desktop", "Claude for Desktop"],
            executable_names: &["Claude", "Claude Desktop"],
            install_subdirs: &["Claude", "Claude Desktop"],
            start_menu_terms: &["Claude", "Claude Desktop"],
        }),
        mcp_config_files: &[
            "Library/Application Support/Claude/claude_desktop_config.json",
            "AppData/Roaming/Claude/claude_desktop_config.json",
        ],
    },
    ToolDef {
        id: "windsurf",
        name: "Windsurf",
        icon: "🏄",
        app_paths: &["/Applications/Windsurf.app", "~/Applications/Windsurf.app"],
        cli_name: None,
        config_dir: Some(".windsurf"),
        windows: Some(WindowsDetectionHints {
            display_names: &["Windsurf"],
            executable_names: &["Windsurf"],
            install_subdirs: &["Windsurf"],
            start_menu_terms: &["Windsurf"],
        }),
        mcp_config_files: &[
            ".windsurf/mcp.json",
            ".codeium/windsurf/mcp_config.json",
        ],
    },
    ToolDef {
        id: "claude_code",
        name: "Claude Code",
        icon: "🔧",
        app_paths: &[],
        cli_name: Some("claude"),
        config_dir: Some(".claude"),
        windows: None,
        mcp_config_files: &[
            ".claude.json",
            ".claude/claude.json",
            ".claude/settings.json",
            ".config/claude/settings.json",
        ],
    },
    ToolDef {
        id: "antigravity",
        name: "Antigravity",
        icon: "🚀",
        app_paths: &["/Applications/Antigravity.app", "~/Applications/Antigravity.app"],
        cli_name: None,
        config_dir: Some(".gemini/antigravity"),
        windows: Some(WindowsDetectionHints {
            display_names: &["Antigravity"],
            executable_names: &["Antigravity"],
            install_subdirs: &["Antigravity"],
            start_menu_terms: &["Antigravity"],
        }),
        mcp_config_files: &[
            ".gemini/antigravity/mcp_config.json",
        ],
    },
    ToolDef {
        id: "codex",
        name: "Codex CLI",
        icon: "🧠",
        app_paths: &["/Applications/Codex.app", "~/Applications/Codex.app"],
        cli_name: Some("codex"),
        config_dir: Some(".codex"),
        windows: None,
        mcp_config_files: &[
            // Codex uses TOML — handled specially in scan_installed_mcps
            ".codex/config.toml",
            "Library/Application Support/Codex/config.toml",
            "Library/Application Support/com.openai.atlas/config.toml",
            "AppData/Roaming/Codex/config.toml",
        ],
    },
    ToolDef {
        id: "gemini_cli",
        name: "Gemini CLI",
        icon: "♊",
        app_paths: &[],
        cli_name: Some("gemini"),
        config_dir: Some(".gemini"),
        windows: None,
        mcp_config_files: &[
            ".gemini/settings.json",
            ".config/gemini/settings.json",
        ],
    },
    ToolDef {
        id: "qwen_code",
        name: "Qwen Code",
        icon: "🧭",
        app_paths: &[
            "/Applications/Qwen Code.app",
            "~/Applications/Qwen Code.app",
        ],
        cli_name: Some("qwen"),
        config_dir: Some(".qwen"),
        windows: Some(WindowsDetectionHints {
            display_names: &["Qwen Code", "Qwen"],
            executable_names: &["qwen", "Qwen"],
            install_subdirs: &["qwen-code", "Qwen Code", "Qwen"],
            start_menu_terms: &["Qwen Code", "Qwen"],
        }),
        mcp_config_files: &[
            ".qwen/settings.json",
        ],
    },
    ToolDef {
        id: "kimi_cli",
        name: "Kimi CLI",
        icon: "🌙",
        app_paths: &[],
        cli_name: Some("kimi"),
        config_dir: Some(".kimi"),
        windows: None,
        mcp_config_files: &[
            ".kimi/mcp.json",
        ],
    },
    ToolDef {
        id: "codebuddy",
        name: "CodeBuddy",
        icon: "🧩",
        app_paths: &[
            "/Applications/CodeBuddy.app",
            "~/Applications/CodeBuddy.app",
        ],
        cli_name: Some("codebuddy"),
        config_dir: Some(".codebuddy"),
        windows: Some(WindowsDetectionHints {
            display_names: &["CodeBuddy", "Tencent CodeBuddy"],
            executable_names: &["CodeBuddy", "codebuddy"],
            install_subdirs: &["CodeBuddy", "Tencent CodeBuddy"],
            start_menu_terms: &["CodeBuddy", "Tencent CodeBuddy"],
        }),
        mcp_config_files: &[
            ".codebuddy/.mcp.json",
            ".codebuddy/mcp.json",
            ".codebuddy/settings.json",
            ".codebuddy.json",
        ],
    },
    ToolDef {
        id: "trae",
        name: "Trae",
        icon: "🔥",
        app_paths: &["/Applications/Trae.app", "~/Applications/Trae.app"],
        cli_name: None,
        config_dir: Some(".trae"),
        windows: Some(WindowsDetectionHints {
            display_names: &["Trae"],
            executable_names: &["Trae"],
            install_subdirs: &["Trae"],
            start_menu_terms: &["Trae"],
        }),
        mcp_config_files: &[
            ".trae/mcp.json",
            "Library/Application Support/Trae/User/settings.json",
            "AppData/Roaming/Trae/User/settings.json",
        ],
    },
    ToolDef {
        id: "continue_dev",
        name: "Continue",
        icon: "▶️",
        app_paths: &[],
        cli_name: None,
        config_dir: Some(".continue"),
        windows: None,
        mcp_config_files: &[
            ".continue/config.yaml",
            ".continue/config.yml",
        ],
    },
    ToolDef {
        id: "aider",
        name: "Aider",
        icon: "🤝",
        app_paths: &[],
        cli_name: Some("aider"),
        config_dir: Some(".aider"),
        windows: None,
        mcp_config_files: &[
            ".aider.conf.yml",
            ".aider.conf.yaml",
        ],
    },
    ToolDef {
        id: "zed",
        name: "Zed",
        icon: "⚡",
        app_paths: &["/Applications/Zed.app", "~/Applications/Zed.app"],
        cli_name: Some("zed"),
        config_dir: Some(".config/zed"),
        windows: Some(WindowsDetectionHints {
            display_names: &["Zed"],
            executable_names: &["Zed"],
            install_subdirs: &["Zed"],
            start_menu_terms: &["Zed"],
        }),
        mcp_config_files: &[
            ".config/zed/settings.json",
            ".zed/settings.json",
        ],
    },
    ToolDef {
        id: "cline",
        name: "Cline/Roo",
        icon: "🤖",
        app_paths: &[],
        cli_name: None,
        config_dir: None,
        windows: None,
        mcp_config_files: &[
            "Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
            "Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/cline_mcp_settings.json",
            "AppData/Roaming/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
            "AppData/Roaming/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/cline_mcp_settings.json",
        ],
    },
    ToolDef {
        id: "openclaw",
        name: "OpenClaw",
        icon: "🦀",
        app_paths: &["/Applications/OpenClaw.app", "~/Applications/OpenClaw.app"],
        cli_name: Some("openclaw"),
        config_dir: Some(".openclaw"),
        windows: Some(WindowsDetectionHints {
            display_names: &["OpenClaw"],
            executable_names: &["OpenClaw"],
            install_subdirs: &["OpenClaw"],
            start_menu_terms: &["OpenClaw"],
        }),
        mcp_config_files: &[
            ".openclaw/config.json",
            "Library/Application Support/OpenClaw/config.json",
            "AppData/Roaming/openclaw/config.json",
            ".config/openclaw/config.json",
        ],
    },
];

// ---------------------------------------------------------------------------
// Key scanning patterns
// ---------------------------------------------------------------------------

const KEY_PATTERNS: &[(&str, &str)] = &[
    ("sk-", "OpenAI / Generic"),
    ("sk-ant-", "Anthropic"),
    ("key-", "Generic API Key"),
    ("ghp_", "GitHub PAT"),
    ("ghu_", "GitHub User Token"),
    ("glpat-", "GitLab PAT"),
    ("xoxb-", "Slack Bot Token"),
    ("xoxp-", "Slack User Token"),
    ("AKIA", "AWS Access Key"),
];

const ENV_VAR_PATTERNS: &[(&str, &str)] = &[
    ("OPENAI_API_KEY", "OpenAI"),
    ("ANTHROPIC_API_KEY", "Anthropic"),
    ("CLAUDE_API_KEY", "Anthropic"),
    ("GOOGLE_API_KEY", "Google"),
    ("GEMINI_API_KEY", "Google Gemini"),
    ("AWS_SECRET_ACCESS_KEY", "AWS"),
    ("AWS_ACCESS_KEY_ID", "AWS"),
    ("GITHUB_TOKEN", "GitHub"),
    ("STRIPE_SECRET_KEY", "Stripe"),
    ("SLACK_TOKEN", "Slack"),
    ("DISCORD_TOKEN", "Discord"),
    ("HUGGINGFACE_TOKEN", "HuggingFace"),
    ("HF_TOKEN", "HuggingFace"),
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

pub(crate) fn home_dir() -> Option<PathBuf> {
    dirs::home_dir()
}

fn expand_path(raw: &str) -> Option<PathBuf> {
    if raw.starts_with("~/") || raw.starts_with("~\\") {
        home_dir().map(|h| h.join(&raw[2..]))
    } else {
        Some(PathBuf::from(raw))
    }
}

pub(crate) fn path_exists(p: &PathBuf) -> bool {
    fs::metadata(p).is_ok()
}

#[derive(Clone, Debug)]
struct InstallEvidence {
    source: &'static str,
    path: Option<String>,
    host_confidence: u8,
    detected: bool,
    host_detected: bool,
}

#[derive(Default)]
struct MergedDetection {
    detected: bool,
    host_detected: bool,
    detection_sources: Vec<String>,
    path: Option<String>,
}

fn install_evidence(
    source: &'static str,
    path: Option<String>,
    host_confidence: u8,
    host_detected: bool,
) -> InstallEvidence {
    InstallEvidence {
        source,
        path,
        host_confidence,
        detected: true,
        host_detected,
    }
}

#[cfg(any(windows, test))]
#[allow(dead_code)]
fn normalize_tool_match_token(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .replace(".exe", "")
        .replace(['-', '_', ' '], "")
}

#[cfg(any(windows, test))]
#[allow(dead_code)]
fn matches_tool_alias(value: &str, aliases: &[&str]) -> bool {
    let normalized_value = normalize_tool_match_token(value);
    aliases.iter().any(|alias| {
        let normalized_alias = normalize_tool_match_token(alias);
        normalized_value == normalized_alias || normalized_value.contains(&normalized_alias)
    })
}

#[cfg(any(windows, test))]
fn ensure_windows_executable_name(executable_name: &str) -> String {
    if executable_name.to_ascii_lowercase().ends_with(".exe") {
        executable_name.to_string()
    } else {
        format!("{executable_name}.exe")
    }
}

#[cfg(any(windows, test))]
fn parse_windows_executable_reference(raw: &str) -> Option<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let lower = trimmed.to_ascii_lowercase();
    if let Some(exe_index) = lower.find(".exe") {
        let candidate = trimmed[..exe_index + 4]
            .trim()
            .trim_matches('"')
            .trim_end_matches(',')
            .trim();
        if !candidate.is_empty() {
            return Some(PathBuf::from(candidate));
        }
    }

    let candidate = trimmed.trim_matches('"').trim();
    if candidate.is_empty() {
        None
    } else {
        Some(PathBuf::from(candidate))
    }
}

fn merge_install_evidence(mut evidence: Vec<InstallEvidence>) -> MergedDetection {
    evidence.retain(|item| item.detected);
    if evidence.is_empty() {
        return MergedDetection::default();
    }

    evidence.sort_by(|left, right| {
        right
            .host_confidence
            .cmp(&left.host_confidence)
            .then_with(|| right.host_detected.cmp(&left.host_detected))
    });

    let mut merged = MergedDetection {
        detected: true,
        host_detected: evidence.iter().any(|item| item.host_detected),
        detection_sources: Vec::new(),
        path: None,
    };

    for item in evidence {
        if merged.path.is_none() {
            merged.path = item.path.clone();
        }

        if !merged
            .detection_sources
            .iter()
            .any(|source| source == item.source)
        {
            merged.detection_sources.push(item.source.to_string());
        }
    }

    merged
}

#[cfg(target_os = "macos")]
fn sanitize_spotlight_query_term(value: &str) -> Option<String> {
    let sanitized = value
        .chars()
        .filter(|char| {
            char.is_ascii_alphanumeric() || matches!(char, '.' | '_' | '-' | ' ' | '+')
        })
        .collect::<String>()
        .trim()
        .to_string();
    if sanitized.is_empty() {
        None
    } else {
        Some(sanitized)
    }
}

#[cfg(target_os = "macos")]
fn spotlight_find_macos_apps(bundle_name: &str, limit: usize) -> Vec<PathBuf> {
    let Some(bundle_name) = sanitize_spotlight_query_term(bundle_name) else {
        return Vec::new();
    };
    let query = format!(
        "kMDItemFSName == '{bundle_name}' && kMDItemContentType == 'com.apple.application-bundle'"
    );
    let output = match Command::new("mdfind").arg(query).output() {
        Ok(result) if result.status.success() => result,
        _ => return Vec::new(),
    };

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(limit)
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
        .collect()
}

#[cfg(not(target_os = "macos"))]
fn spotlight_find_macos_apps(_bundle_name: &str, _limit: usize) -> Vec<PathBuf> {
    Vec::new()
}

fn collect_macos_app_evidence(def: &ToolDef) -> Vec<InstallEvidence> {
    let mut evidence = Vec::new();
    let mut seen_paths = std::collections::HashSet::new();

    for raw in def.app_paths {
        let bundle_name = std::path::Path::new(raw)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string();

        if let Some(path) = expand_path(raw) {
            if path_exists(&path) {
                let path_str = path.to_string_lossy().to_string();
                if seen_paths.insert(path_str.clone()) {
                    evidence.push(install_evidence("app", Some(path_str), 100, true));
                }
            }
        }

        for path in spotlight_find_macos_apps(&bundle_name, 12) {
            let path_str = path.to_string_lossy().to_string();
            if seen_paths.insert(path_str.clone()) {
                evidence.push(install_evidence("app_spotlight", Some(path_str), 88, true));
            }
        }
    }

    evidence
}

fn split_path_entries(value: &str) -> Vec<PathBuf> {
    #[cfg(windows)]
    let separator = ';';
    #[cfg(not(windows))]
    let separator = ':';

    value
        .split(separator)
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(PathBuf::from)
        .collect()
}

fn looks_like_ai_host_path(path: &Path) -> bool {
    let normalized = normalize_path(path);
    AI_TOOL_PATH_HINTS
        .iter()
        .any(|hint| normalized.contains(hint))
}

fn is_executable_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        fs::metadata(path)
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn default_cli_search_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/opt/homebrew/sbin"),
        PathBuf::from("/Applications/Codex.app/Contents/Resources"),
        PathBuf::from("/Applications/Claude.app/Contents/Resources"),
    ];

    #[cfg(windows)]
    {
        dirs.push(PathBuf::from(r"C:\Program Files\nodejs"));
        dirs.push(PathBuf::from(r"C:\Program Files\OpenClaw"));
        dirs.push(PathBuf::from(r"C:\Program Files\Git\bin"));
        dirs.push(PathBuf::from(r"C:\Windows\System32"));
    }

    if let Some(home) = home_dir() {
        let home_dirs = [
            ".local/bin",
            ".npm-global/bin",
            ".cargo/bin",
            ".bun/bin",
            "Library/pnpm",
            ".yarn/bin",
            "AppData/Roaming/npm",
            "AppData/Local/Microsoft/WindowsApps",
        ];
        for relative in home_dirs {
            dirs.push(home.join(relative));
        }
    }

    #[cfg(windows)]
    {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            dirs.push(PathBuf::from(appdata).join("npm"));
        }
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            let local_app_path = PathBuf::from(local_app_data);
            dirs.push(local_app_path.join("Microsoft/WindowsApps"));
            dirs.push(local_app_path.join("Programs"));
        }
    }

    dirs
}

#[cfg(target_os = "macos")]
fn resolve_login_shell_path_entries() -> Vec<PathBuf> {
    for shell in ["/bin/zsh", "/bin/bash", "/bin/sh"] {
        let output = match Command::new(shell)
            .args(["-lc", "printf \"%s\" \"$PATH\""])
            .output()
        {
            Ok(result) if result.status.success() => result,
            _ => continue,
        };
        let stdout = String::from_utf8_lossy(&output.stdout);
        let dirs = split_path_entries(stdout.trim());
        if !dirs.is_empty() {
            return dirs;
        }
    }
    Vec::new()
}

#[cfg(not(target_os = "macos"))]
fn resolve_login_shell_path_entries() -> Vec<PathBuf> {
    Vec::new()
}

fn collect_cli_search_dirs() -> &'static Vec<PathBuf> {
    CLI_SEARCH_DIRS.get_or_init(|| {
        let mut dirs = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut push_dir = |candidate: PathBuf| {
            if candidate.as_os_str().is_empty() {
                return;
            }
            let normalized = normalize_path(&candidate);
            if !seen.insert(normalized) {
                return;
            }
            dirs.push(candidate);
        };

        if let Ok(path_env) = std::env::var("PATH") {
            for candidate in split_path_entries(&path_env) {
                push_dir(candidate);
            }
        }

        for candidate in default_cli_search_dirs() {
            push_dir(candidate);
        }

        for candidate in resolve_login_shell_path_entries() {
            push_dir(candidate);
        }

        dirs
    })
}

#[cfg(target_os = "macos")]
fn spotlight_find_cli_binaries(cli_name: &str, limit: usize) -> Vec<PathBuf> {
    let Some(cli_name) = sanitize_spotlight_query_term(cli_name) else {
        return Vec::new();
    };

    let query = format!("kMDItemFSName == '{cli_name}'");
    let output = match Command::new("mdfind").arg(query).output() {
        Ok(result) if result.status.success() => result,
        _ => return Vec::new(),
    };

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(limit)
        .map(PathBuf::from)
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name == cli_name)
                .unwrap_or(false)
                && is_executable_file(path)
                && looks_like_ai_host_path(path)
        })
        .collect()
}

#[cfg(not(target_os = "macos"))]
fn spotlight_find_cli_binaries(_cli_name: &str, _limit: usize) -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(target_os = "macos")]
fn resolve_cli_from_login_shell(cli_name: &str) -> Option<PathBuf> {
    if !cli_name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return None;
    }
    let lookup = format!("command -v {cli_name} 2>/dev/null");
    for shell in ["/bin/zsh", "/bin/bash", "/bin/sh"] {
        let output = match Command::new(shell).args(["-lc", &lookup]).output() {
            Ok(result) if result.status.success() => result,
            _ => continue,
        };
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let candidate = stdout.lines().next().map(str::trim).unwrap_or_default();
        if candidate.is_empty() {
            continue;
        }
        let path = PathBuf::from(candidate);
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

#[cfg(not(target_os = "macos"))]
fn resolve_cli_from_login_shell(_cli_name: &str) -> Option<PathBuf> {
    None
}

fn collect_cli_evidence(def: &ToolDef) -> Vec<InstallEvidence> {
    let mut evidence = Vec::new();

    if let Some(cli) = def.cli_name {
        let mut seen_paths = std::collections::HashSet::new();
        let mut push_evidence = |source: &'static str, path: PathBuf, confidence: u8| {
            if !path.is_file() {
                return;
            }
            let normalized = normalize_path(&path);
            if !seen_paths.insert(normalized) {
                return;
            }
            evidence.push(install_evidence(
                source,
                Some(path.to_string_lossy().to_string()),
                confidence,
                true,
            ));
        };

        if let Ok(path) = which::which(cli) {
            push_evidence("cli", path, 95);
        }

        for dir in collect_cli_search_dirs().iter() {
            push_evidence("cli_path_search", dir.join(cli), 90);
            #[cfg(windows)]
            push_evidence("cli_path_search", dir.join(format!("{cli}.exe")), 90);
        }

        for path in spotlight_find_cli_binaries(cli, 120) {
            push_evidence("cli_spotlight", path, 88);
        }

        if let Some(path) = resolve_cli_from_login_shell(cli) {
            push_evidence("cli_login_shell", path, 93);
        }
    }

    evidence
}

fn collect_config_dir_evidence(def: &ToolDef, home: Option<&PathBuf>) -> Vec<InstallEvidence> {
    let mut evidence = Vec::new();

    if let (Some(home), Some(config_dir)) = (home, def.config_dir) {
        let config_path = home.join(config_dir);
        if path_exists(&config_path) {
            evidence.push(install_evidence(
                "config_dir",
                Some(config_path.to_string_lossy().to_string()),
                40,
                false,
            ));
        }
    }

    evidence
}

fn collect_mcp_config_evidence(
    def: &ToolDef,
    home: Option<&PathBuf>,
) -> (bool, Vec<String>, Vec<InstallEvidence>) {
    let mut has_mcp = false;
    let mut mcp_paths: Vec<String> = Vec::new();
    let mut evidence = Vec::new();

    if let Some(home) = home {
        for relative_path in def.mcp_config_files {
            let path = home.join(relative_path);
            if path_exists(&path) {
                has_mcp = true;
                let path_str = path.to_string_lossy().to_string();
                mcp_paths.push(path_str.clone());
                evidence.push(install_evidence("mcp_config", Some(path_str), 35, false));
            }
        }
    }

    (has_mcp, mcp_paths, evidence)
}

#[cfg(windows)]
fn windows_env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name).map(PathBuf::from)
}

#[cfg(windows)]
fn windows_install_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for env_name in ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(path) = windows_env_path(env_name) {
            roots.push(path);
        }
    }
    if let Some(local_app_data) = windows_env_path("LOCALAPPDATA") {
        roots.push(local_app_data.join("Programs"));
    }
    roots
}

#[cfg(windows)]
fn windows_start_menu_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(app_data) = windows_env_path("APPDATA") {
        roots.push(
            app_data
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs"),
        );
    }
    if let Some(all_users_profile) = windows_env_path("ALLUSERSPROFILE") {
        roots.push(
            all_users_profile
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs"),
        );
    }
    roots
}

#[cfg(windows)]
fn registry_roots() -> [(HKEY, &'static str); 2] {
    [
        (
            HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\App Paths",
        ),
        (
            HKEY_LOCAL_MACHINE,
            r"Software\Microsoft\Windows\CurrentVersion\App Paths",
        ),
    ]
}

#[cfg(windows)]
fn uninstall_registry_roots() -> [(HKEY, &'static str); 3] {
    [
        (
            HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
        (
            HKEY_LOCAL_MACHINE,
            r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
        (
            HKEY_LOCAL_MACHINE,
            r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
    ]
}

#[cfg(windows)]
fn read_registry_string(key: &RegKey, name: &str) -> Option<String> {
    key.get_value::<String, _>(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(any(windows, test))]
fn resolve_install_location_candidate(
    install_location: &str,
    executable_names: &[&str],
) -> Option<PathBuf> {
    let candidate = parse_windows_executable_reference(install_location)?;
    if candidate.is_file() {
        return Some(candidate);
    }

    if candidate.is_dir() {
        for executable_name in executable_names {
            let executable_path = candidate.join(ensure_windows_executable_name(executable_name));
            if executable_path.is_file() {
                return Some(executable_path);
            }
        }
    }

    None
}

#[cfg(windows)]
fn collect_windows_app_paths_evidence(hints: &WindowsDetectionHints) -> Vec<InstallEvidence> {
    let mut evidence = Vec::new();

    for executable_name in hints.executable_names {
        let executable_name = ensure_windows_executable_name(executable_name);
        for (hive, root_path) in registry_roots() {
            let root_key = RegKey::predef(hive);
            let key_path = format!(r"{root_path}\{executable_name}");
            let Ok(subkey) = root_key.open_subkey_with_flags(&key_path, KEY_READ) else {
                continue;
            };
            let Some(path) = read_registry_string(&subkey, "").and_then(|value| {
                parse_windows_executable_reference(&value).filter(|candidate| candidate.is_file())
            }) else {
                continue;
            };

            evidence.push(install_evidence(
                "app_paths_registry",
                Some(path.to_string_lossy().to_string()),
                90,
                true,
            ));
        }
    }

    evidence
}

#[cfg(windows)]
fn collect_windows_uninstall_evidence(hints: &WindowsDetectionHints) -> Vec<InstallEvidence> {
    let mut evidence = Vec::new();

    for (hive, root_path) in uninstall_registry_roots() {
        let root_key = RegKey::predef(hive);
        let Ok(uninstall_root) = root_key.open_subkey_with_flags(root_path, KEY_READ) else {
            continue;
        };

        for subkey_name in uninstall_root.enum_keys().flatten() {
            let Ok(subkey) = uninstall_root.open_subkey_with_flags(&subkey_name, KEY_READ) else {
                continue;
            };
            let Some(display_name) = read_registry_string(&subkey, "DisplayName") else {
                continue;
            };
            if !matches_tool_alias(&display_name, hints.display_names) {
                continue;
            }

            let install_location_path =
                read_registry_string(&subkey, "InstallLocation").and_then(|value| {
                    resolve_install_location_candidate(&value, hints.executable_names)
                });
            let display_icon_path = read_registry_string(&subkey, "DisplayIcon")
                .and_then(|value| parse_windows_executable_reference(&value))
                .filter(|path| path.is_file());

            let Some(path) = install_location_path.or(display_icon_path) else {
                continue;
            };

            evidence.push(install_evidence(
                "uninstall_registry",
                Some(path.to_string_lossy().to_string()),
                85,
                true,
            ));
        }
    }

    evidence
}

#[cfg(windows)]
fn collect_windows_install_dir_evidence(hints: &WindowsDetectionHints) -> Vec<InstallEvidence> {
    let mut evidence = Vec::new();

    for root in windows_install_roots() {
        for install_subdir in hints.install_subdirs {
            for executable_name in hints.executable_names {
                let candidate = root
                    .join(install_subdir)
                    .join(ensure_windows_executable_name(executable_name));
                if candidate.is_file() {
                    evidence.push(install_evidence(
                        "install_dir",
                        Some(candidate.to_string_lossy().to_string()),
                        80,
                        true,
                    ));
                }
            }
        }
    }

    evidence
}

#[cfg(windows)]
fn collect_windows_start_menu_evidence(hints: &WindowsDetectionHints) -> Vec<InstallEvidence> {
    let mut evidence = Vec::new();

    for root in windows_start_menu_roots() {
        if !root.is_dir() {
            continue;
        }

        for entry in walkdir::WalkDir::new(&root)
            .max_depth(3)
            .into_iter()
            .filter_map(Result::ok)
        {
            if !entry.file_type().is_file() {
                continue;
            }
            if entry
                .path()
                .extension()
                .and_then(|extension| extension.to_str())
                .map(|extension| !extension.eq_ignore_ascii_case("lnk"))
                .unwrap_or(true)
            {
                continue;
            }

            let Some(file_name) = entry.path().file_stem().and_then(|value| value.to_str()) else {
                continue;
            };
            if !matches_tool_alias(file_name, hints.start_menu_terms) {
                continue;
            }

            evidence.push(install_evidence(
                "start_menu",
                Some(entry.path().to_string_lossy().to_string()),
                25,
                false,
            ));
            break;
        }
    }

    evidence
}

#[cfg(windows)]
fn collect_windows_install_evidence(def: &ToolDef) -> Vec<InstallEvidence> {
    let Some(hints) = def.windows.as_ref() else {
        return Vec::new();
    };

    let mut evidence = Vec::new();
    evidence.extend(collect_windows_app_paths_evidence(hints));
    evidence.extend(collect_windows_uninstall_evidence(hints));
    evidence.extend(collect_windows_install_dir_evidence(hints));
    evidence.extend(collect_windows_start_menu_evidence(hints));
    evidence
}

#[cfg(not(windows))]
fn collect_windows_install_evidence(_: &ToolDef) -> Vec<InstallEvidence> {
    Vec::new()
}

fn progress_in_range(start: u8, end: u8, completed: usize, total: usize) -> u8 {
    if total == 0 {
        return end;
    }

    let span = end.saturating_sub(start) as f32;
    let ratio = (completed as f32 / total as f32).clamp(0.0, 1.0);
    (start as f32 + span * ratio).round() as u8
}

fn emit_scan_item_progress(
    app: &AppHandle,
    phase_id: &str,
    base_label: &str,
    detail: impl AsRef<str>,
    progress_window: (u8, u8),
    counts: (usize, usize),
) {
    let (start, end) = progress_window;
    let (completed, total) = counts;
    let detail = detail.as_ref().trim();
    let label = if detail.is_empty() {
        base_label.to_string()
    } else {
        format!("{base_label} · {detail}")
    };

    emit_scan_progress(
        app,
        phase_id,
        &label,
        progress_in_range(start, end, completed, total),
        "running",
    );
}

fn license_allows_batch_fix(plan: &str, status: &str) -> bool {
    matches!(plan, "trial" | "pro" | "enterprise") && status == "active"
}

#[cfg(windows)]
#[derive(serde::Deserialize)]
pub(crate) struct WindowsPermissionFixResult {
    pub path: String,
    pub success: bool,
    pub error: Option<String>,
}

#[cfg(windows)]
fn escape_powershell_single_quote(value: &str) -> String {
    value.replace('\'', "''")
}

#[cfg(windows)]
fn parse_windows_permission_fix_results(
    result_path: &std::path::Path,
) -> Result<Vec<WindowsPermissionFixResult>, String> {
    let content = fs::read_to_string(result_path).map_err(|e| {
        format!(
            "无法读取 Windows 权限修复结果: {} ({})",
            result_path.display(),
            e
        )
    })?;
    let content = content.trim_start_matches('\u{feff}').trim();

    serde_json::from_str::<Vec<WindowsPermissionFixResult>>(content)
        .or_else(|_| {
            serde_json::from_str::<WindowsPermissionFixResult>(content).map(|result| vec![result])
        })
        .map_err(|e| format!("无法解析 Windows 权限修复结果: {}", e))
}

#[cfg(windows)]
fn windows_acl_has_broad_access(file_path: &PathBuf) -> bool {
    let escaped_path = escape_powershell_single_quote(&file_path.to_string_lossy());
    let script = format!(
        concat!(
            "$ErrorActionPreference='Stop';",
            "$acl = Get-Acl -LiteralPath '{}';",
            "if ($acl.Sddl -match '\\((?:A|OA);;[^)]*;;;(?:WD|BU|AU)\\)') {{ 'broad' }} else {{ 'tight' }}"
        ),
        escaped_path
    );

    match std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
    {
        Ok(output) if output.status.success() => {
            String::from_utf8_lossy(&output.stdout).contains("broad")
        }
        _ => false,
    }
}

#[cfg(windows)]
pub(crate) fn run_windows_permission_fix(
    paths: &[String],
    elevate: bool,
) -> Result<Vec<WindowsPermissionFixResult>, String> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }

    let temp_dir = std::env::temp_dir();
    let input_path = temp_dir.join(format!(
        "agentshield-fix-input-{}.json",
        uuid::Uuid::new_v4()
    ));
    let result_path = temp_dir.join(format!(
        "agentshield-fix-result-{}.json",
        uuid::Uuid::new_v4()
    ));
    let script_path = temp_dir.join(format!(
        "agentshield-fix-script-{}.ps1",
        uuid::Uuid::new_v4()
    ));

    let script = r#"
param(
    [Parameter(Mandatory = $true)][string]$InputPath,
    [Parameter(Mandatory = $true)][string]$ResultPath
)

$ErrorActionPreference = 'Stop'
$targets = Get-Content -LiteralPath $InputPath -Raw | ConvertFrom-Json
if ($null -eq $targets) {
    $targets = @()
} elseif ($targets -isnot [System.Array]) {
    $targets = @($targets)
}

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
$adminSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')
$inherit = [System.Security.AccessControl.InheritanceFlags]::None
$propagate = [System.Security.AccessControl.PropagationFlags]::None
$allow = [System.Security.AccessControl.AccessControlType]::Allow
$fullControl = [System.Security.AccessControl.FileSystemRights]::FullControl

$results = foreach ($path in $targets) {
    try {
        if (-not (Test-Path -LiteralPath $path)) {
            throw "path not found"
        }

        $acl = New-Object System.Security.AccessControl.FileSecurity
        $acl.SetOwner($currentUser)
        $acl.SetAccessRuleProtection($true, $false)

        foreach ($sid in @($currentUser, $systemSid, $adminSid)) {
            $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
                $sid,
                $fullControl,
                $inherit,
                $propagate,
                $allow
            )
            [void]$acl.AddAccessRule($rule)
        }

        Set-Acl -LiteralPath $path -AclObject $acl
        [PSCustomObject]@{ path = $path; success = $true; error = $null }
    } catch {
        [PSCustomObject]@{ path = $path; success = $false; error = $_.Exception.Message }
    }
}

$results | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ResultPath -Encoding UTF8
if ($results | Where-Object { -not $_.success }) {
    exit 1
}

exit 0
"#;

    let write_result = (|| -> Result<(), String> {
        let payload = serde_json::to_string(paths)
            .map_err(|e| format!("无法序列化 Windows 权限修复任务: {}", e))?;
        fs::write(&input_path, payload)
            .map_err(|e| format!("无法写入 Windows 权限修复输入文件: {}", e))?;
        fs::write(&script_path, script)
            .map_err(|e| format!("无法写入 Windows 权限修复脚本: {}", e))?;
        Ok(())
    })();

    if let Err(err) = write_result {
        let _ = fs::remove_file(&input_path);
        let _ = fs::remove_file(&result_path);
        let _ = fs::remove_file(&script_path);
        return Err(err);
    }

    let command_result = if elevate {
        let wrapper = format!(
            concat!(
                "$ErrorActionPreference='Stop';",
                "try {{ ",
                "$proc = Start-Process -FilePath 'powershell' -Verb RunAs ",
                "-ArgumentList @(",
                "'-NoProfile','-ExecutionPolicy','Bypass','-File','{}','-InputPath','{}','-ResultPath','{}'",
                ") -Wait -PassThru; ",
                "exit $proc.ExitCode ",
                "}} catch {{ ",
                "Write-Error $_.Exception.Message; ",
                "exit 1 ",
                "}}"
            ),
            escape_powershell_single_quote(&script_path.to_string_lossy()),
            escape_powershell_single_quote(&input_path.to_string_lossy()),
            escape_powershell_single_quote(&result_path.to_string_lossy())
        );

        std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &wrapper])
            .output()
            .map_err(|e| format!("无法启动 Windows 管理员权限修复: {}", e))
    } else {
        std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                &script_path.to_string_lossy(),
                "-InputPath",
                &input_path.to_string_lossy(),
                "-ResultPath",
                &result_path.to_string_lossy(),
            ])
            .output()
            .map_err(|e| format!("无法启动 Windows 权限修复: {}", e))
    };

    let parsed_results = parse_windows_permission_fix_results(&result_path);
    let cleanup = || {
        let _ = fs::remove_file(&input_path);
        let _ = fs::remove_file(&result_path);
        let _ = fs::remove_file(&script_path);
    };

    match command_result {
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);

            let results = match parsed_results {
                Ok(results) => results,
                Err(err) if output.status.success() => {
                    cleanup();
                    return Err(err);
                }
                Err(err) => {
                    let combined = format!("{} {}", stderr.trim(), stdout.trim());
                    cleanup();
                    if combined.contains("canceled")
                        || combined.contains("cancelled")
                        || combined.contains("1223")
                    {
                        return Err("用户取消了 Windows 管理员授权".to_string());
                    }
                    return Err(format!("Windows 权限修复失败: {}", err));
                }
            };

            if !output.status.success() && elevate {
                let combined = format!("{} {}", stderr.trim(), stdout.trim());
                if combined.contains("canceled")
                    || combined.contains("cancelled")
                    || combined.contains("1223")
                {
                    cleanup();
                    return Err("用户取消了 Windows 管理员授权".to_string());
                }
            }

            cleanup();
            Ok(results)
        }
        Err(err) => {
            cleanup();
            Err(err)
        }
    }
}

pub(crate) fn is_env_file_name(name: &str) -> bool {
    name == ".env" || name.starts_with(".env.")
}

fn detect_tool(def: &ToolDef) -> DetectedTool {
    let home = home_dir();
    let mut evidence = Vec::new();
    evidence.extend(collect_macos_app_evidence(def));
    evidence.extend(collect_cli_evidence(def));
    evidence.extend(collect_windows_install_evidence(def));
    evidence.extend(collect_config_dir_evidence(def, home.as_ref()));

    let (has_mcp, mcp_paths, mcp_evidence) = collect_mcp_config_evidence(def, home.as_ref());
    evidence.extend(mcp_evidence);

    let merged = merge_install_evidence(evidence);
    let install_target_ready = merged.host_detected || has_mcp;

    let mut tool = DetectedTool {
        id: def.id.to_string(),
        name: def.name.to_string(),
        icon: def.icon.to_string(),
        detected: merged.detected,
        host_detected: merged.host_detected,
        install_target_ready,
        detection_sources: merged.detection_sources,
        path: merged.path,
        version: None,
        has_mcp_config: has_mcp,
        mcp_config_path: mcp_paths.first().cloned(),
        mcp_config_paths: mcp_paths,
        host_confidence: HostConfidence::default(),
        risk_surface: ToolRiskSurface::default(),
        management_capability: ManagementCapability::default(),
        source_tier: SourceTier::default(),
        evidence_items: vec![],
    };
    refresh_detected_tool_contract(&mut tool);
    tool
}

fn run_detect_tools() -> Vec<DetectedTool> {
    let mut tools: Vec<DetectedTool> = TOOL_DEFS.iter().map(detect_tool).collect();
    refresh_detected_tool_contracts(&mut tools);
    tools
}

#[derive(Default, Clone)]
struct ToolRiskSignal {
    has_mcp: bool,
    has_skill: bool,
    has_exec_signal: bool,
    has_secret_signal: bool,
    evidence_items: Vec<ToolEvidenceItem>,
}

fn push_unique_evidence_item(items: &mut Vec<ToolEvidenceItem>, item: ToolEvidenceItem) {
    if items.iter().any(|existing| {
        existing.evidence_type == item.evidence_type
            && existing.path == item.path
            && existing.detail == item.detail
    }) {
        return;
    }
    items.push(item);
}

fn source_tier_for_tool(tool_id: &str) -> SourceTier {
    match tool_id {
        "continue_dev" | "zed" => SourceTier::B,
        id if is_supported_tool_id(id) => SourceTier::A,
        _ => SourceTier::C,
    }
}

fn infer_has_skill_surface(tool: &DetectedTool) -> bool {
    if tool
        .detection_sources
        .iter()
        .any(|source| source.contains("skill"))
    {
        return true;
    }

    tool.path
        .as_ref()
        .map(|path| {
            let normalized = normalize_path_string(path);
            normalized.contains("/skills/") || normalized.ends_with("/skills")
        })
        .unwrap_or(false)
}

fn infer_management_capability(
    tool: &DetectedTool,
    has_mcp_surface: bool,
    has_skill_surface: bool,
) -> ManagementCapability {
    // OneClick is available for any tool with a writable MCP config in a supported format,
    // not limited to TOOL_DEFS. This enables dynamic discovery tools to be managed too.
    let has_writable_config = tool.mcp_config_paths.iter().any(|p| {
        let path = std::path::Path::new(p);
        let format_ok = matches!(
            path.extension().and_then(|e| e.to_str()),
            Some("json" | "yaml" | "yml" | "toml")
        );
        format_ok && path.exists() && !path.metadata().map(|m| m.permissions().readonly()).unwrap_or(true)
    });
    if tool.install_target_ready && has_writable_config {
        ManagementCapability::OneClick
    } else if has_mcp_surface || has_skill_surface {
        ManagementCapability::Manual
    } else {
        ManagementCapability::DetectOnly
    }
}

fn infer_host_confidence(
    tool: &DetectedTool,
    has_mcp_surface: bool,
    has_skill_surface: bool,
) -> HostConfidence {
    if tool.host_detected {
        HostConfidence::High
    } else if has_mcp_surface || has_skill_surface {
        HostConfidence::Medium
    } else {
        HostConfidence::Low
    }
}

fn build_tool_evidence_items(
    tool: &DetectedTool,
    has_skill_surface: bool,
) -> Vec<ToolEvidenceItem> {
    let mut items: Vec<ToolEvidenceItem> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    let push_item = |items: &mut Vec<ToolEvidenceItem>,
                     seen: &mut std::collections::HashSet<String>,
                     evidence_type: &str,
                     path: String,
                     detail: Option<String>| {
        if path.trim().is_empty() {
            return;
        }
        let key = format!(
            "{}::{}::{}",
            evidence_type,
            path,
            detail.clone().unwrap_or_default()
        );
        if !seen.insert(key) {
            return;
        }
        items.push(ToolEvidenceItem {
            evidence_type: evidence_type.to_string(),
            path,
            detail,
        });
    };

    for path in &tool.mcp_config_paths {
        push_item(&mut items, &mut seen, "mcp_config", path.clone(), None);
    }

    if has_skill_surface {
        if let Some(path) = tool.path.clone() {
            push_item(&mut items, &mut seen, "skill_root", path, None);
        }
    }

    for source in &tool.detection_sources {
        let source_label = source.trim().to_string();
        let path = if source_label.is_empty() {
            tool.path.clone().unwrap_or_default()
        } else {
            source_label
        };
        push_item(
            &mut items,
            &mut seen,
            "detection_source",
            path,
            tool.path.clone(),
        );
    }

    if items.is_empty() {
        if let Some(path) = tool.path.clone() {
            push_item(&mut items, &mut seen, "path_hint", path, None);
        }
    }

    items
}

fn refresh_detected_tool_contract(tool: &mut DetectedTool) {
    let has_mcp_surface = tool.has_mcp_config
        || !tool.mcp_config_paths.is_empty()
        || tool.mcp_config_path.is_some()
        || tool.risk_surface.has_mcp;
    let has_skill_surface = infer_has_skill_surface(tool) || tool.risk_surface.has_skill;
    let has_exec_signal = tool.risk_surface.has_exec_signal;
    let has_secret_signal = tool.risk_surface.has_secret_signal;

    tool.management_capability =
        infer_management_capability(tool, has_mcp_surface, has_skill_surface);
    tool.host_confidence = infer_host_confidence(tool, has_mcp_surface, has_skill_surface);
    tool.source_tier = source_tier_for_tool(&tool.id);
    let baseline_items = build_tool_evidence_items(tool, has_skill_surface);
    for item in baseline_items {
        push_unique_evidence_item(&mut tool.evidence_items, item);
    }
    tool.risk_surface = ToolRiskSurface {
        has_mcp: has_mcp_surface,
        has_skill: has_skill_surface,
        has_exec_signal,
        has_secret_signal,
        evidence_count: tool.evidence_items.len() as u32,
    };
}

fn refresh_detected_tool_contracts(tools: &mut [DetectedTool]) {
    for tool in tools.iter_mut() {
        refresh_detected_tool_contract(tool);
    }
}

fn add_signal_evidence(
    signal: &mut ToolRiskSignal,
    evidence_type: &str,
    path: String,
    detail: Option<String>,
) {
    push_unique_evidence_item(
        &mut signal.evidence_items,
        ToolEvidenceItem {
            evidence_type: evidence_type.to_string(),
            path,
            detail,
        },
    );
}

fn marker_hit(content: &str, markers: &[&str]) -> bool {
    markers.iter().any(|marker| content.contains(marker))
}

fn analyze_config_file_for_risk(path: &PathBuf, signal: &mut ToolRiskSignal) {
    let content = match fs::read_to_string(path) {
        Ok(value) => value,
        Err(_) => return,
    };
    let lower = content.to_lowercase();
    let path_str = path.to_string_lossy().to_string();

    let has_mcp_key = marker_hit(
        &lower,
        &[
            "mcpservers",
            "mcp_servers",
            "context_servers",
            "\"mcp\"",
            "[mcp_servers.",
            "mcp.servers",
        ],
    );
    if has_mcp_key {
        signal.has_mcp = true;
        add_signal_evidence(
            signal,
            "mcp_key",
            path_str.clone(),
            Some("mcp key markers".to_string()),
        );
    }

    let has_exec_key = marker_hit(
        &lower,
        &[
            "\"command\"",
            "command =",
            "\"args\"",
            "args =",
            "\"url\"",
            "url =",
        ],
    ) || marker_hit(
        &lower,
        &[
            "npx",
            "uvx",
            "pnpx",
            "node ",
            "python",
            "bash",
            "powershell",
            "cmd /c",
        ],
    );
    if has_exec_key {
        signal.has_exec_signal = true;
        add_signal_evidence(
            signal,
            "exec_signal",
            path_str.clone(),
            Some("command/args/url markers".to_string()),
        );
    }

    let has_secret_key = marker_hit(&lower, &["\"env\"", "env =", "\"headers\"", "headers ="])
        || (marker_hit(
            &lower,
            &["token", "api_key", "apikey", "secret", "password"],
        ) && marker_hit(&lower, &["authorization", "bearer", "env", "header"]));
    if has_secret_key {
        signal.has_secret_signal = true;
        add_signal_evidence(
            signal,
            "secret_signal",
            path_str.clone(),
            Some("env/header/secret markers".to_string()),
        );
    }

    let servers = extract_servers_from_file(path);
    if !servers.is_empty() {
        signal.has_mcp = true;
        add_signal_evidence(
            signal,
            "mcp_server_entry",
            path_str,
            Some(format!("{} server entries", servers.len())),
        );
        if servers.iter().any(|server| {
            let command = server.command.to_lowercase();
            !command.is_empty() && command != "unknown" && command != "skill"
        }) {
            signal.has_exec_signal = true;
        }
    }
}

fn collect_snapshot_risk_signals(
    snapshot: &discovery::DiscoverySnapshot,
) -> std::collections::HashMap<String, ToolRiskSignal> {
    let mut signals: std::collections::HashMap<String, ToolRiskSignal> =
        std::collections::HashMap::new();

    for config_file in &snapshot.config_files {
        let path = PathBuf::from(config_file);
        if !path_exists(&path) {
            continue;
        }
        let (tool_id, _tool_name, _icon) = identify_tool_from_path(config_file);
        // Accept any tool ID — dynamic discovery collects risk signals for all tools.

        let signal = signals.entry(tool_id).or_default();
        signal.has_mcp = true;
        add_signal_evidence(signal, "mcp_config", config_file.clone(), None);
        analyze_config_file_for_risk(&path, signal);
    }

    for skill_root in &snapshot.skill_roots {
        let path = PathBuf::from(skill_root);
        if !path_exists(&path) {
            continue;
        }
        let identity_path = resolve_discovery_identity_path(&path, "deep_discovery_skill", false);
        let (tool_id, _tool_name, _icon) =
            identify_tool_from_path(&identity_path.to_string_lossy());
        // Accept any tool ID — dynamic discovery collects risk signals for all tools.
        let signal = signals.entry(tool_id).or_default();
        signal.has_skill = true;
        add_signal_evidence(signal, "skill_root", skill_root.clone(), None);

        let skill_manifest = path.join("SKILL.md");
        if path_exists(&skill_manifest) {
            add_signal_evidence(
                signal,
                "skill_manifest",
                skill_manifest.to_string_lossy().to_string(),
                None,
            );
        }
    }

    signals
}

fn apply_snapshot_risk_signals(
    tools: &mut [DetectedTool],
    snapshot: &discovery::DiscoverySnapshot,
) {
    let signals = collect_snapshot_risk_signals(snapshot);
    if signals.is_empty() {
        return;
    }

    for tool in tools.iter_mut() {
        let Some(signal) = signals.get(&tool.id) else {
            continue;
        };
        tool.risk_surface.has_mcp |= signal.has_mcp;
        tool.risk_surface.has_skill |= signal.has_skill;
        tool.risk_surface.has_exec_signal |= signal.has_exec_signal;
        tool.risk_surface.has_secret_signal |= signal.has_secret_signal;
        for item in &signal.evidence_items {
            push_unique_evidence_item(&mut tool.evidence_items, item.clone());
        }
        refresh_detected_tool_contract(tool);
    }
}

fn push_unique_string(values: &mut Vec<String>, value: String) {
    if !values.iter().any(|existing| existing == &value) {
        values.push(value);
    }
}

fn merge_detected_tool_entry(target: &mut DetectedTool, incoming: DetectedTool) {
    target.detected |= incoming.detected;
    target.host_detected |= incoming.host_detected;
    target.install_target_ready |= incoming.install_target_ready;

    if target.path.is_none() {
        target.path = incoming.path.clone();
    }
    if target.version.is_none() {
        target.version = incoming.version.clone();
    }

    target.has_mcp_config |= incoming.has_mcp_config;
    if target.mcp_config_path.is_none() {
        target.mcp_config_path = incoming.mcp_config_path.clone();
    }

    for source in incoming.detection_sources {
        push_unique_string(&mut target.detection_sources, source);
    }
    for config_path in incoming.mcp_config_paths {
        push_unique_string(&mut target.mcp_config_paths, config_path);
    }

    refresh_detected_tool_contract(target);
}

fn build_discovered_tool_from_path(
    path: &Path,
    source: &str,
    has_mcp_config: bool,
) -> DetectedTool {
    let path_str = path.to_string_lossy().to_string();
    let identity_path = resolve_discovery_identity_path(path, source, has_mcp_config);
    let (id, name, icon) = identify_tool_from_path(&identity_path.to_string_lossy());
    let mut tool = DetectedTool {
        id,
        name,
        icon,
        detected: true,
        host_detected: false,
        install_target_ready: false,
        detection_sources: vec![source.to_string()],
        path: Some(path_str.clone()),
        version: None,
        has_mcp_config,
        mcp_config_path: has_mcp_config.then(|| path_str.clone()),
        mcp_config_paths: if has_mcp_config {
            vec![path_str]
        } else {
            vec![]
        },
        host_confidence: HostConfidence::default(),
        risk_surface: ToolRiskSurface::default(),
        management_capability: ManagementCapability::default(),
        source_tier: SourceTier::default(),
        evidence_items: vec![],
    };
    refresh_detected_tool_contract(&mut tool);
    tool
}

fn resolve_discovery_identity_path(path: &Path, source: &str, has_mcp_config: bool) -> PathBuf {
    let is_skills_container = path
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("skills"))
        .unwrap_or(false);

    // deep_discovery_skill provides paths like ".../skills/<skill-name>".
    // We want to map those to host root (".../<host>") instead of each skill name.
    if source.contains("skill") {
        if is_skills_container {
            return path.parent().unwrap_or(path).to_path_buf();
        }
        if let Some(parent) = path.parent() {
            let parent_is_skills = parent
                .file_name()
                .and_then(|value| value.to_str())
                .map(|value| value.eq_ignore_ascii_case("skills"))
                .unwrap_or(false);
            if parent_is_skills {
                return parent.parent().unwrap_or(parent).to_path_buf();
            }
        }
    }

    if !has_mcp_config && is_skills_container {
        return path.parent().unwrap_or(path).to_path_buf();
    }

    path.to_path_buf()
}

fn merge_discovery_snapshot_tools(
    tools: &mut Vec<DetectedTool>,
    snapshot: &discovery::DiscoverySnapshot,
) {
    let mut index_by_id: std::collections::HashMap<String, usize> = tools
        .iter()
        .enumerate()
        .map(|(index, tool)| (tool.id.clone(), index))
        .collect();

    for config_file in &snapshot.config_files {
        let path = PathBuf::from(config_file);
        if !path_exists(&path) {
            continue;
        }
        let discovered = build_discovered_tool_from_path(&path, "deep_discovery_config", true);
        // Accept any tool ID — dynamic discovery should find ALL tools with MCP/Skill.
        if let Some(index) = index_by_id.get(&discovered.id).copied() {
            merge_detected_tool_entry(&mut tools[index], discovered);
        } else {
            index_by_id.insert(discovered.id.clone(), tools.len());
            tools.push(discovered);
        }
    }

    for skill_root in &snapshot.skill_roots {
        let path = PathBuf::from(skill_root);
        if !path_exists(&path) {
            continue;
        }
        let discovered = build_discovered_tool_from_path(&path, "deep_discovery_skill", false);
        if let Some(index) = index_by_id.get(&discovered.id).copied() {
            merge_detected_tool_entry(&mut tools[index], discovered);
        } else {
            index_by_id.insert(discovered.id.clone(), tools.len());
            tools.push(discovered);
        }
    }

    for tool in tools.iter_mut() {
        tool.detection_sources.sort();
        tool.detection_sources.dedup();
        tool.mcp_config_paths.sort();
        tool.mcp_config_paths.dedup();
        refresh_detected_tool_contract(tool);
    }
}

#[cfg(target_os = "macos")]
fn discover_generic_macos_ai_app_hosts() -> Vec<DetectedTool> {
    let mut discovered = Vec::new();
    let mut seen_paths = std::collections::HashSet::new();
    let markers = [
        "openclaw",
        "cursor",
        "claude",
        "codex",
        "kiro",
        "windsurf",
        "trae",
        "gemini",
        "aider",
        "continue",
        "zed",
        "yuanbao",
        "元宝",
        "workbuddy",
        "codebuddy",
        "doubao",
        "豆包",
        "kimi",
        "tongyi",
        "通义",
        "qwen",
        "wenxin",
        "文心",
        "chatglm",
        "智谱",
        "coze",
        "扣子",
    ];

    let mut roots = vec![PathBuf::from("/Applications")];
    if let Some(home) = home_dir() {
        roots.push(home.join("Applications"));
    }

    for root in roots {
        if !root.is_dir() {
            continue;
        }
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            if !file_name.to_ascii_lowercase().ends_with(".app") {
                continue;
            }

            let app_name = file_name.trim_end_matches(".app").trim_end_matches(".APP");
            let app_name_lower = app_name.to_lowercase();
            if !markers.iter().any(|marker| app_name_lower.contains(marker)) {
                continue;
            }

            let path_str = path.to_string_lossy().to_string();
            if !seen_paths.insert(path_str.clone()) {
                continue;
            }

            let (tool_id, inferred_name, icon) = identify_tool_from_path(&path_str);
            let display_name = if inferred_name == "Discovered AI Tool" {
                app_name.to_string()
            } else {
                inferred_name
            };

            let mut discovered_tool = DetectedTool {
                id: tool_id.clone(),
                name: display_name,
                icon,
                detected: true,
                host_detected: true,
                install_target_ready: is_supported_tool_id(&tool_id),
                detection_sources: vec!["app_bundle_discovery".to_string()],
                path: Some(path_str),
                version: None,
                has_mcp_config: false,
                mcp_config_path: None,
                mcp_config_paths: vec![],
                host_confidence: HostConfidence::default(),
                risk_surface: ToolRiskSurface::default(),
                management_capability: ManagementCapability::default(),
                source_tier: SourceTier::default(),
                evidence_items: vec![],
            };
            refresh_detected_tool_contract(&mut discovered_tool);
            discovered.push(discovered_tool);
        }
    }

    discovered
}

#[cfg(not(target_os = "macos"))]
fn discover_generic_macos_ai_app_hosts() -> Vec<DetectedTool> {
    Vec::new()
}

fn merge_additional_detected_tools(tools: &mut Vec<DetectedTool>, additional: Vec<DetectedTool>) {
    let mut index_by_id: std::collections::HashMap<String, usize> = tools
        .iter()
        .enumerate()
        .map(|(index, tool)| (tool.id.clone(), index))
        .collect();

    for discovered in additional {
        if let Some(index) = index_by_id.get(&discovered.id).copied() {
            merge_detected_tool_entry(&mut tools[index], discovered);
        } else {
            index_by_id.insert(discovered.id.clone(), tools.len());
            tools.push(discovered);
        }
    }
}

fn enrich_detected_tools(tools: &mut Vec<DetectedTool>, snapshot: &discovery::DiscoverySnapshot) {
    merge_discovery_snapshot_tools(tools, snapshot);
    let additional_hosts = discover_generic_macos_ai_app_hosts();
    merge_additional_detected_tools(tools, additional_hosts);
    apply_snapshot_risk_signals(tools, snapshot);
}

fn collect_detected_tools_from_snapshot(
    snapshot: &discovery::DiscoverySnapshot,
) -> Vec<DetectedTool> {
    let mut tools = run_detect_tools();
    enrich_detected_tools(&mut tools, snapshot);
    refresh_detected_tool_contracts(&mut tools);
    tools
}

fn collect_detected_tools() -> Vec<DetectedTool> {
    let snapshot = discovery::refresh_discovery_snapshot(false);
    collect_detected_tools_from_snapshot(&snapshot)
}

fn is_supported_tool_id(tool_id: &str) -> bool {
    TOOL_DEFS.iter().any(|def| def.id == tool_id)
}

fn is_sensitive_host_tool_id(tool_id: &str) -> bool {
    matches!(
        tool_id,
        "codex"
            | "cursor"
            | "kiro"
            | "vscode"
            | "windsurf"
            | "zed"
            | "claude_desktop"
            | "claude_code"
            | "trae"
            | "gemini_cli"
            | "qwen_code"
            | "kimi_cli"
            | "codebuddy"
            | "antigravity"
            | "openclaw"
    )
}

fn normalize_runtime_token(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .trim_end_matches(".exe")
        .to_string()
}

fn executable_basename(path: &std::path::Path) -> Option<String> {
    path.file_stem()
        .or_else(|| path.file_name())
        .map(|value| normalize_runtime_token(&value.to_string_lossy()))
}

fn command_basename(cmd: &[OsString]) -> Option<String> {
    cmd.first()
        .map(std::path::Path::new)
        .and_then(executable_basename)
}

fn process_in_app_bundle(exe: Option<&std::path::Path>, bundle_name: &str) -> bool {
    let bundle_segment = format!("/{bundle_name}.app/").to_lowercase();
    exe.map(|path| {
        path.to_string_lossy()
            .to_lowercase()
            .contains(&bundle_segment)
    })
    .unwrap_or(false)
}

fn process_matches_runtime_tool(
    process_name: &str,
    exe: Option<&std::path::Path>,
    cmd: &[OsString],
    tool_id: &str,
) -> bool {
    let normalized_name = normalize_runtime_token(process_name);
    let exe_name = exe.and_then(executable_basename);
    let cmd_name = command_basename(cmd);

    let exact_match = |expected: &str| {
        normalized_name == expected
            || exe_name.as_deref() == Some(expected)
            || cmd_name.as_deref() == Some(expected)
    };

    match tool_id {
        "cursor" => process_in_app_bundle(exe, "Cursor") || exact_match("cursor"),
        "kiro" => process_in_app_bundle(exe, "Kiro") || exact_match("kiro"),
        "vscode" => process_in_app_bundle(exe, "Visual Studio Code") || exact_match("code"),
        "windsurf" => process_in_app_bundle(exe, "Windsurf") || exact_match("windsurf"),
        "zed" => process_in_app_bundle(exe, "Zed") || exact_match("zed"),
        "claude_desktop" => process_in_app_bundle(exe, "Claude"),
        "claude_code" => exact_match("claude"),
        "codex" => exact_match("codex"),
        "gemini_cli" => exact_match("gemini"),
        "qwen_code" => {
            process_in_app_bundle(exe, "Qwen Code")
                || exact_match("qwen")
                || exact_match("qwen-code")
        }
        "kimi_cli" => exact_match("kimi"),
        "codebuddy" => process_in_app_bundle(exe, "CodeBuddy") || exact_match("codebuddy"),
        "trae" => process_in_app_bundle(exe, "Trae") || exact_match("trae"),
        "antigravity" => process_in_app_bundle(exe, "Antigravity") || exact_match("antigravity"),
        "openclaw" => process_in_app_bundle(exe, "OpenClaw") || exact_match("openclaw"),
        _ => false,
    }
}

fn running_host_tool_ids() -> std::collections::HashSet<String> {
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);

    let mut active = std::collections::HashSet::new();
    for process in system.processes().values() {
        let name = process.name().to_string_lossy();
        let exe = process.exe();
        let cmd = process.cmd();

        let runtime_tool_ids = [
            "codex",
            "cursor",
            "kiro",
            "vscode",
            "windsurf",
            "zed",
            "claude_desktop",
            "claude_code",
            "trae",
            "gemini_cli",
            "qwen_code",
            "kimi_cli",
            "codebuddy",
            "antigravity",
            "openclaw",
        ];

        for tool_id in runtime_tool_ids {
            if process_matches_runtime_tool(&name, exe, cmd, tool_id) {
                active.insert(tool_id.to_string());
            }
        }
    }

    active
}

#[allow(dead_code)]
fn deferred_host_config_paths(
    detected_tools: &[DetectedTool],
    active_host_ids: &std::collections::HashSet<String>,
) -> std::collections::HashSet<String> {
    detected_tools
        .iter()
        .filter(|tool| {
            tool.host_detected
                && is_sensitive_host_tool_id(&tool.id)
                && active_host_ids.contains(&tool.id)
        })
        .flat_map(|tool| tool.mcp_config_paths.iter().cloned())
        .map(|path| normalize_path_string(&path))
        .collect()
}

fn is_deferred_scan_path(
    path: &std::path::Path,
    deferred_paths: &std::collections::HashSet<String>,
) -> bool {
    deferred_paths.contains(&normalize_path(path))
}

fn mask_value(val: &str) -> String {
    let chars: Vec<char> = val.chars().collect();
    if chars.len() <= 8 {
        return "*".repeat(chars.len());
    }
    let prefix: String = chars.iter().take(4).collect();
    let suffix: String = chars
        .iter()
        .rev()
        .take(4)
        .copied()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("{prefix}...{suffix}")
}

pub fn scan_file_for_keys(file_path: &PathBuf, platform: &str) -> Vec<ExposedKey> {
    let mut keys = Vec::new();
    let content = match fs::read_to_string(file_path) {
        Ok(c) => c,
        Err(_) => return keys,
    };
    let fp = file_path.to_string_lossy().to_string();

    // Scan for key prefixes in the content
    for (pattern, service) in KEY_PATTERNS {
        // Walk through finding occurrences of the pattern
        let mut start = 0;
        while let Some(idx) = content[start..].find(pattern) {
            let abs_idx = start + idx;
            // Extract the token: take contiguous alphanumeric/dash/underscore chars
            let token_start = abs_idx;
            let token_end = content[token_start..]
                .find(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_')
                .map(|i| token_start + i)
                .unwrap_or(content.len());
            let token = &content[token_start..token_end];
            // Only count if the token is reasonably long (looks like a real key)
            if token.len() >= 12 {
                keys.push(ExposedKey {
                    id: uuid::Uuid::new_v4().to_string(),
                    key_pattern: pattern.to_string(),
                    file_path: fp.clone(),
                    platform: platform.to_string(),
                    service: service.to_string(),
                    masked_value: mask_value(token),
                });
            }
            start = token_end;
        }
    }

    // Scan for env var patterns like OPENAI_API_KEY=...
    for (var_name, service) in ENV_VAR_PATTERNS {
        // Look for patterns like VAR_NAME=value or "VAR_NAME": "value"
        for search in &[
            format!("{}=", var_name),
            format!("\"{}\": \"", var_name),
            format!("\"{}\":\"", var_name),
        ] {
            let mut start = 0;
            while let Some(idx) = content[start..].find(search.as_str()) {
                let abs_idx = start + idx + search.len();
                if abs_idx < content.len() {
                    // Extract value until quote, newline, or whitespace
                    let val_end = content[abs_idx..]
                        .find(['"', '\'', '\n', '\r'])
                        .map(|i| abs_idx + i)
                        .unwrap_or(content.len());
                    let val = content[abs_idx..val_end].trim();
                    if !val.is_empty() && val.len() >= 8 {
                        keys.push(ExposedKey {
                            id: uuid::Uuid::new_v4().to_string(),
                            key_pattern: var_name.to_string(),
                            file_path: fp.clone(),
                            platform: platform.to_string(),
                            service: service.to_string(),
                            masked_value: mask_value(val),
                        });
                    }
                }
                start = start + idx + search.len();
            }
        }
    }

    keys
}

pub(crate) fn check_file_permissions(file_path: &PathBuf) -> Option<SecurityIssue> {
    if let Ok(metadata) = fs::metadata(file_path) {
        #[cfg(unix)]
        {
            let mode = metadata.permissions().mode();
            // Check if world-readable (others have read permission)
            if mode & 0o004 != 0 {
                return Some(SecurityIssue {
                    id: uuid::Uuid::new_v4().to_string(),
                    severity: "medium".to_string(),
                    title: "配置文件权限过宽，其他账户可读取".to_string(),
                    description: "配置文件的访问权限设置过于宽松，电脑上的其他用户也能读取其中的内容。建议收紧权限，只允许你自己访问。".to_string(),
                    auto_fixable: true,
                    pro_required: false,
                    file_path: Some(file_path.to_string_lossy().to_string()),
                    semantic_review: None,
                });
            }
        }

        #[cfg(windows)]
        {
            let _ = metadata;
            if windows_acl_has_broad_access(file_path) {
                return Some(SecurityIssue {
                    id: uuid::Uuid::new_v4().to_string(),
                    severity: "medium".to_string(),
                    title: "配置文件权限过宽，其他账户可读取".to_string(),
                    description: "该配置文件在 Windows 上对 Everyone、Users 或 Authenticated Users 暴露了访问权限。建议收紧 ACL，只保留当前用户、SYSTEM 与 Administrators。".to_string(),
                    auto_fixable: true,
                    pro_required: false,
                    file_path: Some(file_path.to_string_lossy().to_string()),
                    semantic_review: None,
                });
            }
        }
    }
    None
}

fn collect_fix_all_targets() -> Vec<String> {
    let mut targets = collect_config_files()
        .into_iter()
        .filter_map(|(path, _platform)| check_file_permissions(&path).map(|_| path))
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<_>>();
    targets.sort();
    targets.dedup();
    targets
}

pub fn collect_config_files() -> Vec<(PathBuf, String)> {
    let snapshot = discovery::refresh_discovery_snapshot(false);
    let mut files: Vec<(PathBuf, String)> = Vec::new();
    let mut seen_paths = std::collections::HashSet::new();

    for raw_path in snapshot
        .config_files
        .iter()
        .chain(snapshot.env_files.iter())
    {
        let path = PathBuf::from(raw_path);
        if !path_exists(&path) {
            continue;
        }

        let key = path.to_string_lossy().to_string();
        if !seen_paths.insert(key) {
            continue;
        }

        let platform = if path
            .file_name()
            .and_then(|name| name.to_str())
            .map(is_env_file_name)
            .unwrap_or(false)
        {
            "环境变量".to_string()
        } else {
            let (_, tool_name, _) = identify_tool_from_path(&path.to_string_lossy());
            tool_name
        };
        files.push((path, platform));
    }
    files
}

// ---------------------------------------------------------------------------
// Skill risk checker
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum SkillRiskLevel {
    Suspicious,
    Malicious,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum SkillRiskCapability {
    CommandExecution,
    NetworkAccess,
    FileMutation,
    EmailSending,
    EmailMutation,
    BrowserSubmission,
    PaymentExecution,
    SensitiveDataExfiltration,
    CredentialsAccess,
}

impl SkillRiskCapability {
    pub(crate) fn label(&self) -> &'static str {
        match self {
            Self::CommandExecution => "命令执行",
            Self::NetworkAccess => "网络访问",
            Self::FileMutation => "删改本地文件",
            Self::EmailSending => "发送邮件",
            Self::EmailMutation => "删改邮件",
            Self::BrowserSubmission => "自动网页提交",
            Self::PaymentExecution => "支付或转账",
            Self::SensitiveDataExfiltration => "敏感信息外发",
            Self::CredentialsAccess => "凭据读取",
        }
    }

    pub(crate) fn beginner_risk_hint(&self) -> &'static str {
        match self {
            Self::CommandExecution => {
                "这类技能可以直接运行系统命令，可能绕过你的理解范围执行脚本、下载程序或批量改写配置。"
            }
            Self::NetworkAccess => {
                "这类技能会主动访问外部网络，来源不明时可能把你的上下文、文件内容或会话信息发到未知服务器。"
            }
            Self::FileMutation => {
                "这类技能具备删改本地文件能力，可能误删项目代码、文档、配置或其他重要资料。"
            }
            Self::EmailSending => {
                "这类技能可以代你发送邮件或消息，如果提示不清晰，可能把本地信息发给外部收件人。"
            }
            Self::EmailMutation => {
                "这类技能可以删除、归档或批量移动邮件，来源不明时可能造成误删邮件或破坏邮件记录。"
            }
            Self::BrowserSubmission => {
                "这类技能会自动点击确认按钮或提交网页表单，可能在你没完全看懂时替你完成敏感操作。"
            }
            Self::PaymentExecution => {
                "这类技能包含支付、结账或转账相关逻辑，必须确认来源、触发条件和金额范围后才能放行。"
            }
            Self::SensitiveDataExfiltration => {
                "这类技能可能把文件、表单数据、上下文或凭据上传到外部服务，存在敏感信息外发风险。"
            }
            Self::CredentialsAccess => {
                "这类技能会读取环境变量、钥匙串或密钥文件，来源不明时存在 API Key、令牌和账户凭据泄露风险。"
            }
        }
    }

    pub(crate) fn requires_explicit_approval(&self) -> bool {
        !matches!(self, Self::NetworkAccess)
    }
}

fn capability_from_rule(value: &str) -> Option<SkillRiskCapability> {
    match value {
        "command_execution" => Some(SkillRiskCapability::CommandExecution),
        "network_access" => Some(SkillRiskCapability::NetworkAccess),
        "file_mutation" => Some(SkillRiskCapability::FileMutation),
        "email_sending" => Some(SkillRiskCapability::EmailSending),
        "email_mutation" => Some(SkillRiskCapability::EmailMutation),
        "browser_submission" => Some(SkillRiskCapability::BrowserSubmission),
        "payment_execution" => Some(SkillRiskCapability::PaymentExecution),
        "sensitive_data_exfiltration" => Some(SkillRiskCapability::SensitiveDataExfiltration),
        "credentials_access" => Some(SkillRiskCapability::CredentialsAccess),
        _ => None,
    }
}

fn skill_risk_severity(risk: &SkillRiskEvidence) -> &'static str {
    if matches!(risk.level, SkillRiskLevel::Malicious)
        || matches!(
            risk.capability,
            SkillRiskCapability::PaymentExecution
                | SkillRiskCapability::SensitiveDataExfiltration
                | SkillRiskCapability::CredentialsAccess
                | SkillRiskCapability::EmailMutation
        )
    {
        "critical"
    } else {
        "medium"
    }
}

fn build_skill_risk_description(platform_name: &str, risk: &SkillRiskEvidence) -> String {
    let mut description = format!(
        "[{}] {}",
        platform_name,
        risk.capability.beginner_risk_hint()
    );
    if risk.capability.requires_explicit_approval() {
        description.push_str(" 启用后应只允许在你明确点头时执行一次。");
    } else {
        description.push_str(" 建议先确认来源、访问域名和用途范围。");
    }
    if matches!(risk.level, SkillRiskLevel::Malicious) {
        description.push_str(" 当前命中了高危恶意模式，建议立即停用并核对来源。");
    } else {
        description.push_str(" 建议在启用前人工复核来源与代码。");
    }
    description
}

fn default_skill_scan_rules() -> SkillScanRuleBundle {
    SkillScanRuleBundle {
        scan_extensions: vec![
            "js".to_string(),
            "ts".to_string(),
            "mjs".to_string(),
            "cjs".to_string(),
            "py".to_string(),
            "sh".to_string(),
            "bash".to_string(),
            "zsh".to_string(),
            "rb".to_string(),
            "pl".to_string(),
            "lua".to_string(),
            "json".to_string(),
            "toml".to_string(),
            "yaml".to_string(),
            "yml".to_string(),
        ],
        suspicious: vec![
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "eval(".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "exec(".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "child_process".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "subprocess".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "os.system(".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "os.popen(".to_string(),
            },
            SkillRiskPattern {
                capability: "network_access".to_string(),
                pattern: "fetch(".to_string(),
            },
            SkillRiskPattern {
                capability: "network_access".to_string(),
                pattern: "xmlhttprequest".to_string(),
            },
            SkillRiskPattern {
                capability: "network_access".to_string(),
                pattern: "require('http')".to_string(),
            },
            SkillRiskPattern {
                capability: "network_access".to_string(),
                pattern: "require(\"http\")".to_string(),
            },
            SkillRiskPattern {
                capability: "network_access".to_string(),
                pattern: "require('net')".to_string(),
            },
            SkillRiskPattern {
                capability: "network_access".to_string(),
                pattern: "require(\"net\")".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "require('child_process')".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "require(\"child_process\")".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "import subprocess".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "import os".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "__import__".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "shell=true".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "powershell".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "cmd.exe".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "/bin/sh".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "/bin/bash".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "base64.decode".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "atob(".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "buffer.from(".to_string(),
            },
            SkillRiskPattern {
                capability: "file_mutation".to_string(),
                pattern: "fs.rm(".to_string(),
            },
            SkillRiskPattern {
                capability: "file_mutation".to_string(),
                pattern: "fs.rmsync(".to_string(),
            },
            SkillRiskPattern {
                capability: "file_mutation".to_string(),
                pattern: "fs.unlink(".to_string(),
            },
            SkillRiskPattern {
                capability: "file_mutation".to_string(),
                pattern: "fs.unlinksync(".to_string(),
            },
            SkillRiskPattern {
                capability: "file_mutation".to_string(),
                pattern: "os.remove(".to_string(),
            },
            SkillRiskPattern {
                capability: "file_mutation".to_string(),
                pattern: "os.unlink(".to_string(),
            },
            SkillRiskPattern {
                capability: "file_mutation".to_string(),
                pattern: "shutil.rmtree(".to_string(),
            },
            SkillRiskPattern {
                capability: "file_mutation".to_string(),
                pattern: "std::fs::remove_file(".to_string(),
            },
            SkillRiskPattern {
                capability: "file_mutation".to_string(),
                pattern: "std::fs::remove_dir_all(".to_string(),
            },
            SkillRiskPattern {
                capability: "file_mutation".to_string(),
                pattern: "remove-item ".to_string(),
            },
            SkillRiskPattern {
                capability: "file_mutation".to_string(),
                pattern: "del /f".to_string(),
            },
            SkillRiskPattern {
                capability: "email_sending".to_string(),
                pattern: "nodemailer".to_string(),
            },
            SkillRiskPattern {
                capability: "email_sending".to_string(),
                pattern: "smtplib".to_string(),
            },
            SkillRiskPattern {
                capability: "email_sending".to_string(),
                pattern: "sendmail(".to_string(),
            },
            SkillRiskPattern {
                capability: "email_sending".to_string(),
                pattern: "mailgun".to_string(),
            },
            SkillRiskPattern {
                capability: "email_sending".to_string(),
                pattern: "sendgrid".to_string(),
            },
            SkillRiskPattern {
                capability: "email_sending".to_string(),
                pattern: "postmark".to_string(),
            },
            SkillRiskPattern {
                capability: "email_sending".to_string(),
                pattern: "tell application \"mail\"".to_string(),
            },
            SkillRiskPattern {
                capability: "email_mutation".to_string(),
                pattern: "gmail.users.messages.delete".to_string(),
            },
            SkillRiskPattern {
                capability: "email_mutation".to_string(),
                pattern: "gmail.users.messages.trash".to_string(),
            },
            SkillRiskPattern {
                capability: "email_mutation".to_string(),
                pattern: "gmail.users.threads.delete".to_string(),
            },
            SkillRiskPattern {
                capability: "email_mutation".to_string(),
                pattern: "gmail.users.threads.trash".to_string(),
            },
            SkillRiskPattern {
                capability: "email_mutation".to_string(),
                pattern: "delete every message".to_string(),
            },
            SkillRiskPattern {
                capability: "browser_submission".to_string(),
                pattern: "form.submit(".to_string(),
            },
            SkillRiskPattern {
                capability: "browser_submission".to_string(),
                pattern: "requestsubmit(".to_string(),
            },
            SkillRiskPattern {
                capability: "browser_submission".to_string(),
                pattern: "button[type=submit]".to_string(),
            },
            SkillRiskPattern {
                capability: "payment_execution".to_string(),
                pattern: "stripe".to_string(),
            },
            SkillRiskPattern {
                capability: "payment_execution".to_string(),
                pattern: "paypal".to_string(),
            },
            SkillRiskPattern {
                capability: "payment_execution".to_string(),
                pattern: "checkout.sessions.create".to_string(),
            },
            SkillRiskPattern {
                capability: "payment_execution".to_string(),
                pattern: "paymentintent".to_string(),
            },
            SkillRiskPattern {
                capability: "payment_execution".to_string(),
                pattern: "alipay".to_string(),
            },
            SkillRiskPattern {
                capability: "payment_execution".to_string(),
                pattern: "wechatpay".to_string(),
            },
            SkillRiskPattern {
                capability: "sensitive_data_exfiltration".to_string(),
                pattern: "multipart/form-data".to_string(),
            },
            SkillRiskPattern {
                capability: "sensitive_data_exfiltration".to_string(),
                pattern: "curl --form".to_string(),
            },
            SkillRiskPattern {
                capability: "sensitive_data_exfiltration".to_string(),
                pattern: "form-data".to_string(),
            },
            SkillRiskPattern {
                capability: "credentials_access".to_string(),
                pattern: ".env".to_string(),
            },
            SkillRiskPattern {
                capability: "credentials_access".to_string(),
                pattern: "process.env.".to_string(),
            },
            SkillRiskPattern {
                capability: "credentials_access".to_string(),
                pattern: "process.env[".to_string(),
            },
            SkillRiskPattern {
                capability: "credentials_access".to_string(),
                pattern: "os.environ[".to_string(),
            },
            SkillRiskPattern {
                capability: "credentials_access".to_string(),
                pattern: "keytar".to_string(),
            },
            SkillRiskPattern {
                capability: "credentials_access".to_string(),
                pattern: "keychain".to_string(),
            },
            SkillRiskPattern {
                capability: "credentials_access".to_string(),
                pattern: "security find-generic-password".to_string(),
            },
        ],
        malicious: vec![
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "| sh".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "| bash".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "sh -c \"curl".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "bash -c \"curl".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "downloadstring(".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "invoke-expression".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "iex(".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "nc -e".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "netcat -e".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "/dev/tcp/".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "reverse_shell".to_string(),
            },
            SkillRiskPattern {
                capability: "command_execution".to_string(),
                pattern: "chmod +x /tmp/".to_string(),
            },
            SkillRiskPattern {
                capability: "file_mutation".to_string(),
                pattern: "rm -rf /".to_string(),
            },
            SkillRiskPattern {
                capability: "file_mutation".to_string(),
                pattern: "sudo rm -rf".to_string(),
            },
            SkillRiskPattern {
                capability: "email_mutation".to_string(),
                pattern: "gmail.users.messages.delete(".to_string(),
            },
            SkillRiskPattern {
                capability: "email_mutation".to_string(),
                pattern: "gmail.users.threads.delete(".to_string(),
            },
            SkillRiskPattern {
                capability: "browser_submission".to_string(),
                pattern: "form.submit()".to_string(),
            },
            SkillRiskPattern {
                capability: "browser_submission".to_string(),
                pattern: "requestsubmit()".to_string(),
            },
            SkillRiskPattern {
                capability: "payment_execution".to_string(),
                pattern: "stripe.charges.create".to_string(),
            },
            SkillRiskPattern {
                capability: "payment_execution".to_string(),
                pattern: "paymentintents.create".to_string(),
            },
            SkillRiskPattern {
                capability: "payment_execution".to_string(),
                pattern: "paypalrestsdk.payment".to_string(),
            },
            SkillRiskPattern {
                capability: "sensitive_data_exfiltration".to_string(),
                pattern: "curl --form @".to_string(),
            },
            SkillRiskPattern {
                capability: "sensitive_data_exfiltration".to_string(),
                pattern: "multipartencoder(".to_string(),
            },
            SkillRiskPattern {
                capability: "credentials_access".to_string(),
                pattern: ".ssh/id_rsa".to_string(),
            },
            SkillRiskPattern {
                capability: "credentials_access".to_string(),
                pattern: ".ssh/id_ed25519".to_string(),
            },
            SkillRiskPattern {
                capability: "credentials_access".to_string(),
                pattern: "authorized_keys".to_string(),
            },
        ],
    }
}

fn load_skill_scan_rules() -> SkillScanRuleBundle {
    rule_updater::get_active_skill_scan_rules().unwrap_or_else(|_| default_skill_scan_rules())
}

#[derive(Clone)]
pub(crate) struct SkillRiskEvidence {
    pub file_path: String,
    pub pattern: String,
    pub snippet: String,
    pub level: SkillRiskLevel,
    pub capability: SkillRiskCapability,
}

fn compact_snippet(value: &str, center: usize) -> String {
    let mut start = center.saturating_sub(120);
    let mut end = value.len().min(center + 180);
    while start > 0 && !value.is_char_boundary(start) {
        start -= 1;
    }
    while end < value.len() && !value.is_char_boundary(end) {
        end += 1;
    }
    value[start..end]
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Check a skill directory for suspicious or malicious code patterns.
pub(crate) fn inspect_skill_for_risks(skill_dir: &PathBuf) -> Option<SkillRiskEvidence> {
    let rules = load_skill_scan_rules();
    let suspicious_patterns: Vec<(SkillRiskCapability, String)> = rules
        .suspicious
        .iter()
        .filter_map(|rule| {
            capability_from_rule(&rule.capability)
                .map(|capability| (capability, rule.pattern.to_lowercase()))
        })
        .collect();
    let malicious_patterns: Vec<(SkillRiskCapability, String)> = rules
        .malicious
        .iter()
        .filter_map(|rule| {
            capability_from_rule(&rule.capability)
                .map(|capability| (capability, rule.pattern.to_lowercase()))
        })
        .collect();
    let scan_extensions: Vec<String> = rules
        .scan_extensions
        .iter()
        .map(|extension| extension.to_lowercase())
        .collect();

    fn scan_recursive(
        dir: &PathBuf,
        malicious: &[(SkillRiskCapability, String)],
        suspicious: &[(SkillRiskCapability, String)],
        extensions: &[String],
        depth: u8,
    ) -> Option<SkillRiskEvidence> {
        if depth > 3 {
            return None;
        }
        let entries = match fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return None,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                // Skip node_modules, .git, etc.
                if name == "node_modules"
                    || name == ".git"
                    || name == "__pycache__"
                    || name == ".venv"
                {
                    continue;
                }
                if let Some(evidence) =
                    scan_recursive(&path, malicious, suspicious, extensions, depth + 1)
                {
                    return Some(evidence);
                }
            } else if path.is_file() {
                let ext = path
                    .extension()
                    .map(|e| e.to_string_lossy().to_lowercase())
                    .unwrap_or_default();
                if !extensions.iter().any(|candidate| candidate == &ext) {
                    continue;
                }
                // Read file (limit to first 50KB to avoid huge files)
                if let Ok(content) = fs::read_to_string(&path) {
                    let check = if content.len() > 50_000 {
                        &content[..50_000]
                    } else {
                        &content
                    };
                    let lower = check.to_lowercase();
                    for (capability, pattern) in malicious {
                        if let Some(index) = lower.find(pattern.as_str()) {
                            return Some(SkillRiskEvidence {
                                file_path: path.to_string_lossy().to_string(),
                                pattern: pattern.to_string(),
                                snippet: compact_snippet(check, index),
                                level: SkillRiskLevel::Malicious,
                                capability: *capability,
                            });
                        }
                    }
                    for (capability, pattern) in suspicious {
                        if let Some(index) = lower.find(pattern.as_str()) {
                            return Some(SkillRiskEvidence {
                                file_path: path.to_string_lossy().to_string(),
                                pattern: pattern.to_string(),
                                snippet: compact_snippet(check, index),
                                level: SkillRiskLevel::Suspicious,
                                capability: *capability,
                            });
                        }
                    }
                }
            }
        }
        None
    }

    scan_recursive(
        skill_dir,
        &malicious_patterns,
        &suspicious_patterns,
        &scan_extensions,
        0,
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct OpenClawSecurityFinding {
    severity: String,
    title: String,
    description: String,
}

fn parse_openclaw_security_audit_output(output: &str) -> Vec<OpenClawSecurityFinding> {
    let relevant = output
        .find("OpenClaw security audit")
        .map(|index| &output[index..])
        .unwrap_or(output);
    let mut findings = Vec::new();
    let mut current_severity: Option<&str> = None;
    let mut current_title: Option<String> = None;
    let mut current_detail: Vec<String> = Vec::new();

    let flush_current = |findings: &mut Vec<OpenClawSecurityFinding>,
                         severity: Option<&str>,
                         title: &mut Option<String>,
                         detail: &mut Vec<String>| {
        if let (Some(severity), Some(title)) = (severity, title.take()) {
            findings.push(OpenClawSecurityFinding {
                severity: severity.to_string(),
                title,
                description: detail.join(" ").trim().to_string(),
            });
        }
        detail.clear();
    };

    for raw_line in relevant.lines() {
        let trimmed = raw_line.trim();
        if trimmed.is_empty()
            || trimmed == "OpenClaw security audit"
            || trimmed.starts_with("Summary:")
            || trimmed.starts_with("Run deeper:")
            || trimmed.starts_with("◇")
            || trimmed.starts_with("│")
            || trimmed.starts_with("├")
            || trimmed.starts_with("╰")
        {
            continue;
        }

        match trimmed {
            "CRITICAL" => {
                flush_current(
                    &mut findings,
                    current_severity,
                    &mut current_title,
                    &mut current_detail,
                );
                current_severity = Some("high");
                continue;
            }
            "WARN" => {
                flush_current(
                    &mut findings,
                    current_severity,
                    &mut current_title,
                    &mut current_detail,
                );
                current_severity = Some("medium");
                continue;
            }
            "INFO" => {
                flush_current(
                    &mut findings,
                    current_severity,
                    &mut current_title,
                    &mut current_detail,
                );
                current_severity = Some("info");
                continue;
            }
            _ => {}
        }

        if current_severity.is_some() && !raw_line.starts_with(' ') && !raw_line.starts_with('\t') {
            flush_current(
                &mut findings,
                current_severity,
                &mut current_title,
                &mut current_detail,
            );
            current_title = Some(trimmed.to_string());
        } else if current_severity.is_some() {
            current_detail.push(trimmed.to_string());
        }
    }

    flush_current(
        &mut findings,
        current_severity,
        &mut current_title,
        &mut current_detail,
    );
    findings
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn detect_ai_tools() -> Result<Vec<DetectedTool>, String> {
    let snapshot = discovery::refresh_discovery_snapshot(true);
    let tools = collect_detected_tools_from_snapshot(&snapshot);
    Ok(tools)
}

#[tauri::command]
pub async fn scan_exposed_keys() -> Result<Vec<ExposedKey>, String> {
    let config_files = collect_config_files();
    let mut all_keys: Vec<ExposedKey> = Vec::new();
    for (path, platform) in &config_files {
        let mut keys = scan_file_for_keys(path, platform);
        all_keys.append(&mut keys);
    }
    Ok(all_keys)
}

fn ensure_scan_not_cancelled() -> Result<(), String> {
    if SCAN_CANCELLED.load(Ordering::SeqCst) {
        return Err("扫描已取消".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn scan_full(
    app: AppHandle,
    protection_service: State<'_, ProtectionService>,
) -> Result<RealScanResult, String> {
    SCAN_CANCELLED.store(false, Ordering::SeqCst);
    ensure_scan_not_cancelled()?;
    emit_scan_progress(&app, "detect_tools", "检测 AI 工具与配置入口", 5, "running");
    let _ = discovery::refresh_discovery_snapshot(true);
    ensure_scan_not_cancelled()?;
    emit_scan_progress(&app, "detect_tools", "刷新本机工具索引", 8, "running");
    let _ = protection_service;
    let detected_tools = collect_detected_tools();
    ensure_scan_not_cancelled()?;
    emit_scan_progress(
        &app,
        "detect_tools",
        "识别本机可用 CLI / IDE",
        10,
        "running",
    );
    let active_host_ids = running_host_tool_ids();
    ensure_scan_not_cancelled()?;
    emit_scan_progress(
        &app,
        "detect_tools",
        "核对当前正在运行的宿主进程",
        11,
        "running",
    );
    let deferred_paths = std::collections::HashSet::new();
    let config_files: Vec<(PathBuf, String)> = collect_config_files()
        .into_iter()
        .filter(|(path, _)| !is_deferred_scan_path(path, &deferred_paths))
        .collect();
    ensure_scan_not_cancelled()?;
    emit_scan_progress(
        &app,
        "detect_tools",
        "检测 AI 工具与配置入口",
        12,
        "completed",
    );

    // Use discovery scanner to get ALL installed MCPs
    let all_mcps = scan_installed_mcps().await.unwrap_or_default();
    ensure_scan_not_cancelled()?;
    let mut semantic_candidates: Vec<SemanticReviewCandidate> = Vec::new();

    // --- Category 1: MCP 安全检查 (per-server risk analysis) ---
    emit_scan_progress(
        &app,
        "mcp_security",
        "分析 MCP 配置与命令风险",
        18,
        "running",
    );
    let mut mcp_issues: Vec<SecurityIssue> = Vec::new();
    let mut mcp_passed: u32 = 0;
    let mcp_targets: Vec<_> = all_mcps
        .iter()
        .filter(|mcp| mcp.command != "skill")
        .collect();
    let mcp_permission_targets: Vec<(String, String)> = detected_tools
        .iter()
        .filter(|tool| tool.detected && tool.has_mcp_config)
        .flat_map(|tool| {
            tool.mcp_config_paths
                .iter()
                .filter(|mcp_path| !deferred_paths.contains(&normalize_path_string(mcp_path)))
                .map(|mcp_path| (tool.name.clone(), mcp_path.clone()))
                .collect::<Vec<_>>()
        })
        .collect();
    let mcp_total = mcp_targets.len() + mcp_permission_targets.len();
    let mut mcp_processed = 0usize;

    for mcp in &mcp_targets {
        ensure_scan_not_cancelled()?;
        let cmd_lower = mcp.command.to_lowercase();

        // HIGH: Shell command injection risk
        if cmd_lower == "sh"
            || cmd_lower == "bash"
            || cmd_lower == "/bin/sh"
            || cmd_lower == "/bin/bash"
            || cmd_lower == "cmd"
        {
            let issue_id = uuid::Uuid::new_v4().to_string();
            mcp_issues.push(SecurityIssue {
                id: issue_id.clone(),
                severity: "high".to_string(),
                title: format!("{} 通过命令行运行程序", mcp.name),
                description: format!(
                    "[{}] 该插件会通过命令行运行程序，如果被恶意利用，可能在你不知情的情况下执行危险操作。",
                    mcp.platform_name
                ),
                auto_fixable: false,
                pro_required: false,
                file_path: Some(mcp.config_path.clone()),
                semantic_review: None,
            });
            semantic_candidates.push(SemanticReviewCandidate {
                issue_id,
                category: "mcp_security".to_string(),
                severity: "high".to_string(),
                title: format!("{} 通过命令行运行程序", mcp.name),
                description: format!(
                    "[{}] 该插件会通过命令行运行程序，如果被恶意利用，可能在你不知情的情况下执行危险操作。",
                    mcp.platform_name
                ),
                file_path: Some(mcp.config_path.clone()),
                evidence: format!(
                    "平台: {}\n命令: {}\n参数: {}\n配置文件: {}",
                    mcp.platform_name,
                    mcp.command,
                    mcp.args.join(" "),
                    mcp.config_path
                ),
            });
            continue;
        }

        // MEDIUM: HTTP (not HTTPS) remote server
        if cmd_lower.starts_with("http://") {
            let issue_id = uuid::Uuid::new_v4().to_string();
            mcp_issues.push(SecurityIssue {
                id: issue_id.clone(),
                severity: "medium".to_string(),
                title: format!("{} 数据传输未加密", mcp.name),
                description: format!(
                    "[{}] 该插件使用未加密的 HTTP 连接（而非安全的 HTTPS），你的数据在传输过程中可能被他人窃取。",
                    mcp.platform_name
                ),
                auto_fixable: false,
                pro_required: false,
                file_path: Some(mcp.config_path.clone()),
                semantic_review: None,
            });
            semantic_candidates.push(SemanticReviewCandidate {
                issue_id,
                category: "mcp_security".to_string(),
                severity: "medium".to_string(),
                title: format!("{} 数据传输未加密", mcp.name),
                description: format!(
                    "[{}] 该插件使用未加密的 HTTP 连接（而非安全的 HTTPS），你的数据在传输过程中可能被他人窃取。",
                    mcp.platform_name
                ),
                file_path: Some(mcp.config_path.clone()),
                evidence: format!(
                    "平台: {}\n远程地址: {}\n参数: {}\n配置文件: {}",
                    mcp.platform_name,
                    mcp.command,
                    mcp.args.join(" "),
                    mcp.config_path
                ),
            });
            continue;
        }

        // INFO: HTTPS remote server (generally safe)
        if cmd_lower.starts_with("https://") {
            mcp_passed += 1;
            continue;
        }

        // Check args for suspicious patterns
        let args_str = mcp.args.join(" ").to_lowercase();
        if args_str.contains("eval")
            || args_str.contains("--unsafe")
            || args_str.contains("--no-verify")
        {
            let issue_id = uuid::Uuid::new_v4().to_string();
            mcp_issues.push(SecurityIssue {
                id: issue_id.clone(),
                severity: "medium".to_string(),
                title: format!("{} 启动参数存在安全隐患", mcp.name),
                description: format!(
                    "[{}] 该插件的启动配置包含可能降低安全性的参数，建议检查是否有必要保留这些设置。",
                    mcp.platform_name
                ),
                auto_fixable: false,
                pro_required: false,
                file_path: Some(mcp.config_path.clone()),
                semantic_review: None,
            });
            semantic_candidates.push(SemanticReviewCandidate {
                issue_id,
                category: "mcp_security".to_string(),
                severity: "medium".to_string(),
                title: format!("{} 启动参数存在安全隐患", mcp.name),
                description: format!(
                    "[{}] 该插件的启动配置包含可能降低安全性的参数，建议检查是否有必要保留这些设置。",
                    mcp.platform_name
                ),
                file_path: Some(mcp.config_path.clone()),
                evidence: format!(
                    "平台: {}\n命令: {}\n启动参数: {}\n配置文件: {}",
                    mcp.platform_name,
                    mcp.command,
                    mcp.args.join(" "),
                    mcp.config_path
                ),
            });
        } else {
            mcp_passed += 1;
        }

        mcp_processed += 1;
        emit_scan_item_progress(
            &app,
            "mcp_security",
            "分析 MCP 配置与命令风险",
            &mcp.name,
            (18, 32),
            (mcp_processed, mcp_total),
        );
    }

    // Check MCP config file permissions
    for (tool_name, mcp_path) in &mcp_permission_targets {
        ensure_scan_not_cancelled()?;
        let p = PathBuf::from(mcp_path);
        if let Some(issue) = check_file_permissions(&p) {
            mcp_issues.push(issue);
        }

        mcp_processed += 1;
        emit_scan_item_progress(
            &app,
            "mcp_security",
            "分析 MCP 配置与命令风险",
            format!("{tool_name} 配置权限"),
            (18, 32),
            (mcp_processed, mcp_total),
        );
    }
    emit_scan_progress(
        &app,
        "mcp_security",
        "分析 MCP 配置与命令风险",
        32,
        "completed",
    );

    // --- Category 2: 密钥安全 ---
    emit_scan_progress(
        &app,
        "key_security",
        "扫描明文密钥与凭据暴露",
        38,
        "running",
    );
    let mut key_issues: Vec<SecurityIssue> = Vec::new();
    let mut key_passed: u32 = 0;
    let mut all_exposed_keys: Vec<ExposedKey> = Vec::new();
    let key_targets = config_files.len()
        + detected_tools
            .iter()
            .map(|tool| {
                tool.mcp_config_paths
                    .iter()
                    .filter(|mcp_path| !deferred_paths.contains(&normalize_path_string(mcp_path)))
                    .count()
            })
            .sum::<usize>();
    let mut key_processed = 0usize;

    for (path, platform) in &config_files {
        ensure_scan_not_cancelled()?;
        let keys = scan_file_for_keys(path, platform);
        if keys.is_empty() {
            key_passed += 1;
        } else {
            key_issues.push(SecurityIssue {
                id: uuid::Uuid::new_v4().to_string(),
                severity: "high".to_string(),
                title: "发现未加密的 API 密钥".to_string(),
                description: format!(
                    "在配置文件中发现了未加密保存的 API 密钥（共 {} 个）。这意味着任何能访问你电脑的人都能看到这些密钥。建议将密钥迁移到密钥保险库中加密保存。",
                    keys.len()
                ),
                auto_fixable: false,
                pro_required: false,
                file_path: Some(path.to_string_lossy().to_string()),
                semantic_review: None,
            });
            all_exposed_keys.extend(keys);
        }

        key_processed += 1;
        emit_scan_item_progress(
            &app,
            "key_security",
            "扫描明文密钥与凭据暴露",
            path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("配置文件"),
            (38, 52),
            (key_processed, key_targets),
        );
    }

    // Also scan MCP config files for exposed keys
    for tool in &detected_tools {
        ensure_scan_not_cancelled()?;
        if tool.detected {
            for mcp_path in &tool.mcp_config_paths {
                ensure_scan_not_cancelled()?;
                if deferred_paths.contains(&normalize_path_string(mcp_path)) {
                    continue;
                }
                let p = PathBuf::from(mcp_path);
                if path_exists(&p) {
                    let keys = scan_file_for_keys(&p, &tool.name);
                    if !keys.is_empty() {
                        key_issues.push(SecurityIssue {
                            id: uuid::Uuid::new_v4().to_string(),
                            severity: "high".to_string(),
                            title: format!("{} MCP 配置含明文密钥", tool.name),
                            description: format!(
                                "在 {} 中发现 {} 个明文 API 密钥，存在泄露风险。",
                                mcp_path,
                                keys.len()
                            ),
                            auto_fixable: false,
                            pro_required: false,
                            file_path: Some(mcp_path.clone()),
                            semantic_review: None,
                        });
                        all_exposed_keys.extend(keys);
                    } else {
                        key_passed += 1;
                    }
                }

                key_processed += 1;
                emit_scan_item_progress(
                    &app,
                    "key_security",
                    "扫描明文密钥与凭据暴露",
                    format!("{} 配置", tool.name),
                    (38, 52),
                    (key_processed, key_targets),
                );
            }
        }
    }
    emit_scan_progress(
        &app,
        "key_security",
        "扫描明文密钥与凭据暴露",
        52,
        "completed",
    );

    // --- Category 3: Skill 安全检查 ---
    emit_scan_progress(
        &app,
        "skill_security",
        "检查 Skill 目录与可执行风险",
        58,
        "running",
    );
    let mut skill_issues: Vec<SecurityIssue> = Vec::new();
    let mut skill_passed: u32 = 0;
    let skill_targets: Vec<_> = all_mcps
        .iter()
        .filter(|mcp| mcp.command == "skill")
        .collect();
    let skill_total = skill_targets.len();
    let mut skill_processed = 0usize;

    for mcp in &skill_targets {
        ensure_scan_not_cancelled()?;
        let skill_path = PathBuf::from(&mcp.config_path);

        // Check if skill is a symlink pointing to unknown location
        if skill_path.is_symlink() {
            if let Ok(target) = fs::read_link(&skill_path) {
                let target_str = target.to_string_lossy().to_string();
                let target_match = normalize_path_string(&target_str);
                if !target_match.contains(".agents/skills") && !target_match.contains("/skills/") {
                    let issue_id = uuid::Uuid::new_v4().to_string();
                    skill_issues.push(SecurityIssue {
                        id: issue_id.clone(),
                        severity: "medium".to_string(),
                        title: format!("Skill \"{}\" 指向非标准路径", mcp.name),
                        description: format!(
                            "[{}] Skill 链接指向 {}，非标准 skills 目录，请确认来源。",
                            mcp.platform_name, target_str
                        ),
                        auto_fixable: false,
                        pro_required: false,
                        file_path: Some(mcp.config_path.clone()),
                        semantic_review: None,
                    });
                    semantic_candidates.push(SemanticReviewCandidate {
                        issue_id,
                        category: "skill_security".to_string(),
                        severity: "medium".to_string(),
                        title: format!("Skill \"{}\" 指向非标准路径", mcp.name),
                        description: format!(
                            "[{}] Skill 链接指向 {}，非标准 skills 目录，请确认来源。",
                            mcp.platform_name, target_str
                        ),
                        file_path: Some(mcp.config_path.clone()),
                        evidence: format!(
                            "平台: {}\nSkill 路径: {}\n链接目标: {}",
                            mcp.platform_name, mcp.config_path, target_str
                        ),
                    });
                    continue;
                }
            }
        }

        // Check skill dir for suspicious files
        if skill_path.is_dir() {
            if let Some(risk) = inspect_skill_for_risks(&skill_path) {
                let issue_id = uuid::Uuid::new_v4().to_string();
                let capability_label = risk.capability.label();
                let severity = skill_risk_severity(&risk).to_string();
                let description = build_skill_risk_description(&mcp.platform_name, &risk);
                skill_issues.push(SecurityIssue {
                    id: issue_id.clone(),
                    severity: severity.clone(),
                    title: format!("Skill \"{}\" 可能存在安全风险", mcp.name),
                    description: description.clone(),
                    auto_fixable: false,
                    pro_required: false,
                    file_path: Some(mcp.config_path.clone()),
                    semantic_review: None,
                });
                semantic_candidates.push(SemanticReviewCandidate {
                    issue_id,
                    category: "skill_security".to_string(),
                    severity,
                    title: format!("Skill \"{}\" 可能存在安全风险", mcp.name),
                    description,
                    file_path: Some(mcp.config_path.clone()),
                    evidence: format!(
                        "平台: {}\nSkill 路径: {}\n敏感能力: {}\n命中模式: {}\n命中文件: {}\n代码片段: {}",
                        mcp.platform_name,
                        mcp.config_path,
                        capability_label,
                        risk.pattern,
                        risk.file_path,
                        risk.snippet
                    ),
                });
            } else {
                skill_passed += 1;
            }
        } else {
            skill_passed += 1;
        }

        skill_processed += 1;
        emit_scan_item_progress(
            &app,
            "skill_security",
            "检查 Skill 目录与可执行风险",
            &mcp.name,
            (58, 72),
            (skill_processed, skill_total),
        );
    }
    emit_scan_progress(
        &app,
        "skill_security",
        "检查 Skill 目录与可执行风险",
        72,
        "completed",
    );

    // --- Category 4: 环境配置 ---
    emit_scan_progress(&app, "env_config", "审计环境文件与权限配置", 76, "running");
    let mut env_issues: Vec<SecurityIssue> = Vec::new();
    let mut env_passed: u32 = 0;
    let env_total = config_files.len();
    let mut env_processed = 0usize;

    for (path, _platform) in &config_files {
        ensure_scan_not_cancelled()?;
        if let Some(issue) = check_file_permissions(path) {
            env_issues.push(issue);
        } else {
            env_passed += 1;
        }

        env_processed += 1;
        emit_scan_item_progress(
            &app,
            "env_config",
            "审计环境文件与权限配置",
            path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("环境文件"),
            (76, 86),
            (env_processed, env_total),
        );
    }
    emit_scan_progress(
        &app,
        "env_config",
        "审计环境文件与权限配置",
        86,
        "completed",
    );

    // --- Category 5: 系统防护 ---
    emit_scan_progress(
        &app,
        "system_protection",
        "核对 AI 工具运行态治理",
        90,
        "running",
    );
    let mut sys_issues: Vec<SecurityIssue> = Vec::new();
    let mut sys_passed: u32 = 0;
    let active_tools: Vec<_> = detected_tools
        .iter()
        .filter(|tool| {
            tool.host_detected
                && is_sensitive_host_tool_id(&tool.id)
                && active_host_ids.contains(&tool.id)
        })
        .collect();
    let detected_count = detected_tools.iter().filter(|t| t.detected).count();
    let sys_total = active_tools.len() + 2;
    let mut sys_processed = 0usize;

    for tool in active_tools {
        ensure_scan_not_cancelled()?;
        sys_issues.push(SecurityIssue {
            id: uuid::Uuid::new_v4().to_string(),
            severity: "info".to_string(),
            title: format!("{} 正在运行，已纳入实时盯防", tool.name),
            description: format!(
                "AgentShield 已在不影响运行状态的前提下读取 {} 的配置，并持续盯防其高危操作。",
                tool.name
            ),
            auto_fixable: false,
            pro_required: false,
            file_path: tool.mcp_config_path.clone(),
            semantic_review: None,
        });

        sys_processed += 1;
        emit_scan_item_progress(
            &app,
            "system_protection",
            "核对 AI 工具运行态治理",
            &tool.name,
            (90, 95),
            (sys_processed, sys_total),
        );
    }

    let openclaw_installed = detected_tools
        .iter()
        .any(|tool| tool.id == "openclaw" && tool.detected);
    if openclaw_installed {
        ensure_scan_not_cancelled()?;
        let audit_output = Command::new(openclaw_command())
            .args(["security", "audit"])
            .output();

        match audit_output {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                let combined = format!("{}\n{}", stdout, stderr);
                let findings = parse_openclaw_security_audit_output(&combined);
                let audit_path = home_dir().map(|home| {
                    preferred_openclaw_config_dir(&home)
                        .join("config.json")
                        .to_string_lossy()
                        .to_string()
                });

                if findings.is_empty() {
                    sys_passed += 1;
                } else {
                    for finding in findings {
                        ensure_scan_not_cancelled()?;
                        sys_issues.push(SecurityIssue {
                            id: uuid::Uuid::new_v4().to_string(),
                            severity: finding.severity.clone(),
                            title: format!("OpenClaw 安全审计: {}", finding.title),
                            description: finding.description,
                            auto_fixable: false,
                            pro_required: false,
                            file_path: audit_path.clone(),
                            semantic_review: None,
                        });
                    }
                }
            }
            Err(error) => {
                sys_issues.push(SecurityIssue {
                    id: uuid::Uuid::new_v4().to_string(),
                    severity: "medium".to_string(),
                    title: "无法执行 OpenClaw 官方安全审计".to_string(),
                    description: format!(
                        "检测到本机已安装 OpenClaw，但执行 `openclaw security audit` 失败：{}",
                        error
                    ),
                    auto_fixable: false,
                    pro_required: false,
                    file_path: None,
                    semantic_review: None,
                });
            }
        }
    } else {
        sys_passed += 1;
    }
    sys_processed += 1;
    emit_scan_item_progress(
        &app,
        "system_protection",
        "核对 AI 工具运行态治理",
        "OpenClaw 官方安全审计",
        (90, 95),
        (sys_processed, sys_total),
    );

    // Check detected tool count
    sys_passed += detected_count as u32;
    sys_processed += 1;
    emit_scan_item_progress(
        &app,
        "system_protection",
        "核对 AI 工具运行态治理",
        format!("已识别 {detected_count} 个宿主工具"),
        (90, 95),
        (sys_processed, sys_total),
    );
    emit_scan_progress(
        &app,
        "system_protection",
        "核对 AI 工具运行态治理",
        95,
        "completed",
    );

    // Build categories
    let mut categories = vec![
        ScanCategory {
            id: "mcp_security".to_string(),
            name: "MCP 安全检查".to_string(),
            issue_count: mcp_issues.len() as u32,
            issues: mcp_issues,
            passed_count: mcp_passed,
        },
        ScanCategory {
            id: "key_security".to_string(),
            name: "密钥安全".to_string(),
            issue_count: key_issues.len() as u32,
            issues: key_issues,
            passed_count: key_passed,
        },
        ScanCategory {
            id: "skill_security".to_string(),
            name: "Skill 安全检查".to_string(),
            issue_count: skill_issues.len() as u32,
            issues: skill_issues,
            passed_count: skill_passed,
        },
        ScanCategory {
            id: "env_config".to_string(),
            name: "环境配置".to_string(),
            issue_count: env_issues.len() as u32,
            issues: env_issues,
            passed_count: env_passed,
        },
        ScanCategory {
            id: "system_protection".to_string(),
            name: "AI 工具运行态治理".to_string(),
            issue_count: sys_issues.len() as u32,
            issues: sys_issues,
            passed_count: sys_passed,
        },
    ];

    ensure_scan_not_cancelled()?;
    emit_scan_progress(&app, "semantic_review", "执行高级语义复核", 97, "running");
    ensure_scan_not_cancelled()?;
    let semantic_result = semantic_guard::review_candidates(semantic_candidates).await;
    for issue in categories
        .iter_mut()
        .flat_map(|category| category.issues.iter_mut())
    {
        ensure_scan_not_cancelled()?;
        if let Some(review) = semantic_result.reviews.get(&issue.id) {
            if review.verdict == "escalate" && issue.severity != "high" {
                issue.severity = "high".to_string();
            }
            issue.semantic_review = Some(review.clone());
        }
    }
    emit_scan_progress(&app, "semantic_review", "执行高级语义复核", 99, "completed");

    let total_issues: u32 = categories.iter().map(|c| c.issue_count).sum();
    let total_passed: u32 = categories.iter().map(|c| c.passed_count).sum();

    // Calculate score using a weighted formula that scales gracefully
    // Score = passed / (passed + weighted_issues) * 100
    // This ensures score is always between 0-100 and never hits 0 unless everything fails
    let high_count = categories
        .iter()
        .flat_map(|c| &c.issues)
        .filter(|i| i.severity == "high")
        .count() as f64;
    let medium_count = categories
        .iter()
        .flat_map(|c| &c.issues)
        .filter(|i| i.severity == "medium")
        .count() as f64;
    let info_count = categories
        .iter()
        .flat_map(|c| &c.issues)
        .filter(|i| i.severity == "info")
        .count() as f64;

    let weighted_issues = high_count * 3.0 + medium_count * 1.5 + info_count * 0.5;
    let passed = total_passed as f64;

    let score = if total_passed + total_issues == 0 || weighted_issues == 0.0 {
        100u32
    } else {
        // Score = passed / (passed + weighted_issues) * 100, minimum 10 if there are any passes
        let raw = (passed / (passed + weighted_issues)) * 100.0;
        let s = raw.round() as u32;
        if total_passed > 0 && s < 10 {
            10
        } else {
            s
        }
    };

    // Persist as last scan report
    let all_issues: Vec<SecurityIssue> = categories.iter().flat_map(|c| c.issues.clone()).collect();
    let all_passed: Vec<PassedItem> = categories
        .iter()
        .flat_map(|c| {
            (0..c.passed_count).map(|i| PassedItem {
                id: format!("{}-passed-{}", c.id, i),
                title: format!("{} 检查通过", c.name),
            })
        })
        .collect();
    save_last_scan_report(&ScanReport {
        id: uuid::Uuid::new_v4().to_string(),
        started_at: chrono::Utc::now().to_rfc3339(),
        completed_at: Some(chrono::Utc::now().to_rfc3339()),
        scan_type: ScanType::Full,
        total_items: total_issues + categories.iter().map(|c| c.passed_count).sum::<u32>(),
        completed_items: total_issues + categories.iter().map(|c| c.passed_count).sum::<u32>(),
        score,
        issues: all_issues,
        passed: all_passed,
    });

    emit_scan_progress(&app, "completed", "安全扫描完成", 100, "completed");

    Ok(RealScanResult {
        detected_tools,
        categories,
        exposed_keys: all_exposed_keys,
        score,
        total_issues,
        semantic_guard: semantic_result.summary,
    })
}

fn emit_scan_progress(app: &AppHandle, phase_id: &str, label: &str, progress: u8, status: &str) {
    let _ = app.emit(
        SCAN_PROGRESS_EVENT,
        ScanProgressEvent {
            phase_id: phase_id.to_string(),
            label: label.to_string(),
            progress,
            status: status.to_string(),
        },
    );
}

#[tauri::command]
pub async fn reveal_path_in_finder(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let target = if p.is_file() {
        // Reveal the parent directory and select the file
        p.to_string_lossy().to_string()
    } else if p.is_dir() {
        p.to_string_lossy().to_string()
    } else {
        return Err(format!("路径不存在: {}", path));
    };

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&target)
            .spawn()
            .map_err(|e| format!("无法打开 Finder: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", target))
            .spawn()
            .map_err(|e| format!("无法打开资源管理器: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(
                p.parent()
                    .map(|pp| pp.to_string_lossy().to_string())
                    .unwrap_or(target),
            )
            .spawn()
            .map_err(|e| format!("无法打开文件管理器: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn scan_quick() -> Result<ScanReport, String> {
    // Quick scan: just detect tools and count issues briefly
    let tools = collect_detected_tools();
    let detected_count = tools.iter().filter(|t| t.detected).count() as u32;
    let mcp_count = tools.iter().filter(|t| t.has_mcp_config).count() as u32;

    let mut issues = Vec::new();
    if mcp_count > 0 {
        issues.push(SecurityIssue {
            id: uuid::Uuid::new_v4().to_string(),
            severity: "info".to_string(),
            title: format!("发现 {} 个 MCP 配置文件", mcp_count),
            description: "建议运行完整扫描以检查 MCP 配置安全性。".to_string(),
            auto_fixable: false,
            pro_required: false,
            file_path: None,
            semantic_review: None,
        });
    }

    let passed: Vec<PassedItem> = tools
        .iter()
        .filter(|t| t.detected && !t.has_mcp_config)
        .map(|t| PassedItem {
            id: t.id.clone(),
            title: format!("{} 未发现 MCP 配置风险", t.name),
        })
        .collect();

    Ok(ScanReport {
        id: uuid::Uuid::new_v4().to_string(),
        started_at: chrono::Utc::now().to_rfc3339(),
        completed_at: Some(chrono::Utc::now().to_rfc3339()),
        scan_type: ScanType::QuickCheck,
        total_items: detected_count + mcp_count,
        completed_items: detected_count + mcp_count,
        score: if issues.is_empty() { 100 } else { 85 },
        issues,
        passed,
    })
}

#[tauri::command]
pub async fn scan_cancel() -> Result<(), String> {
    SCAN_CANCELLED.store(true, Ordering::SeqCst);
    Ok(())
}

/// Persist the last scan report to disk
fn save_last_scan_report(report: &ScanReport) {
    if let Some(home) = dirs::home_dir() {
        let data_dir = home.join(".agentshield");
        let _ = fs::create_dir_all(&data_dir);
        let path = data_dir.join("last_scan.json");
        if let Ok(json) = serde_json::to_string_pretty(report) {
            let _ = fs::write(&path, json);
        }
    }
}

#[tauri::command]
pub async fn get_last_scan_report() -> Result<Option<ScanReport>, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let path = home.join(".agentshield").join("last_scan.json");
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let report: ScanReport = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(Some(report))
}

/// Fix a single security issue by its file_path.
/// Currently supports: fixing file permissions to 600 (owner read/write only).
#[tauri::command]
pub async fn fix_issue(issue_id: String, file_path: Option<String>) -> Result<bool, String> {
    let _ = issue_id; // ID used for tracking; actual fix is based on file_path

    if let Some(path_str) = file_path {
        let path = PathBuf::from(&path_str);
        if !path_exists(&path) {
            return Err(format!("文件不存在: {}", path_str));
        }

        // Fix file permissions to 600 (owner read/write only)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = fs::Permissions::from_mode(0o600);
            fs::set_permissions(&path, perms).map_err(|error| {
                format!(
                    "无法自动收紧 {} 的权限。为避免应用自行申请管理员权限，请手动执行 chmod 600 或在系统设置里收紧权限。原始错误: {}",
                    path_str, error
                )
            })?;

            if check_file_permissions(&path).is_some() {
                return Err(
                    "权限修复命令已执行，但文件权限仍未收紧。该路径可能受系统保护，需要手动处理。"
                        .to_string(),
                );
            }
        }

        #[cfg(windows)]
        {
            let results = run_windows_permission_fix(&[path_str.clone()], false)?;
            let fixed_without_uac = results
                .first()
                .map(|result| result.success)
                .unwrap_or(false)
                && check_file_permissions(&path).is_none();

            if !fixed_without_uac {
                let detail = results
                    .first()
                    .and_then(|result| result.error.clone())
                    .unwrap_or_else(|| "ACL 仍然没有收紧".to_string());
                return Err(format!(
                    "Windows 权限未能自动修复。为避免应用自行请求管理员权限，请手动调整 ACL 或文件所有权: {}",
                    detail
                ));
            }
        }

        Ok(true)
    } else {
        Err("未提供文件路径，无法修复".to_string())
    }
}

/// Fix all auto-fixable issues by re-scanning and fixing each.
#[tauri::command]
pub async fn fix_all(
    action_targets: Vec<String>,
    approval_ticket: Option<String>,
) -> Result<u32, String> {
    let license_info = license::check_license_status().await?;
    if !license_allows_batch_fix(&license_info.plan, &license_info.status) {
        return Err("一键修复全部仅向 Pro 或试用版开放，免费版请逐项处理。".to_string());
    }

    let actual_targets = collect_fix_all_targets();
    if actual_targets.is_empty() {
        return Ok(0);
    }

    let mut requested_targets = action_targets
        .into_iter()
        .map(|target| target.trim().to_string())
        .filter(|target| !target.is_empty())
        .collect::<Vec<_>>();
    requested_targets.sort();
    requested_targets.dedup();

    if requested_targets != actual_targets {
        return Err("自动修复目标已变化，请重新扫描并再次确认修复。".to_string());
    }

    runtime_guard::require_action_approval_ticket(
        approval_ticket.as_deref(),
        "agentshield:scan:auto-fix",
        "bulk_file_modify",
        &actual_targets,
        "user_requested_fix_all",
    )?;

    let config_files = collect_config_files();
    let mut fixed_count: u32 = 0;
    let mut manual_paths: Vec<String> = Vec::new();

    for (path, _platform) in &config_files {
        if let Some(_issue) = check_file_permissions(path) {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let perms = fs::Permissions::from_mode(0o600);
                if fs::set_permissions(path, perms).is_ok()
                    && check_file_permissions(path).is_none()
                {
                    fixed_count += 1;
                } else {
                    manual_paths.push(path.to_string_lossy().to_string());
                }
            }
            #[cfg(windows)]
            {
                let path_str = path.to_string_lossy().to_string();
                let results = run_windows_permission_fix(&[path_str.clone()], false)?;
                let fixed_without_uac = results
                    .first()
                    .map(|result| result.success)
                    .unwrap_or(false)
                    && check_file_permissions(path).is_none();

                if fixed_without_uac {
                    fixed_count += 1;
                } else {
                    manual_paths.push(path_str);
                }
            }
        }
    }

    if !manual_paths.is_empty() {
        return Err(format!(
            "以下文件需要你手动收紧权限；应用不会再自动请求管理员/UAC 权限: {}",
            manual_paths.join("；")
        ));
    }

    Ok(fixed_count)
}

// ---------------------------------------------------------------------------
// Scan installed MCPs from all detected platforms' config files
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct InstalledMcpServer {
    pub id: String,
    pub name: String,
    pub platform_id: String,
    pub platform_name: String,
    pub command: String,
    pub args: Vec<String>,
    pub config_path: String,
    pub safety_level: String,
}

fn push_installed_server(
    server_name: &str,
    server_config: &serde_json::Value,
    tool_id: &str,
    tool_name: &str,
    config_path: &str,
    servers: &mut Vec<InstalledMcpServer>,
    seen_ids: &mut std::collections::HashSet<String>,
) {
    let sid = format!("{}:{}", tool_id, server_name);
    if seen_ids.contains(&sid) {
        return;
    }
    seen_ids.insert(sid.clone());

    let command = server_config
        .get("command")
        .and_then(|v| v.as_str())
        .or_else(|| server_config.get("url").and_then(|v| v.as_str()))
        .unwrap_or("unknown")
        .to_string();
    let args: Vec<String> = server_config
        .get("args")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|a| a.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    servers.push(InstalledMcpServer {
        id: sid,
        name: server_name.to_string(),
        platform_id: tool_id.to_string(),
        platform_name: tool_name.to_string(),
        command,
        args,
        config_path: config_path.to_string(),
        safety_level: "unverified".to_string(),
    });
}

/// Extract MCP servers from a JSON config, trying multiple key formats
fn extract_mcp_servers_from_json(
    json: &serde_json::Value,
    tool_id: &str,
    tool_name: &str,
    config_path: &str,
    servers: &mut Vec<InstalledMcpServer>,
    seen_ids: &mut std::collections::HashSet<String>,
) {
    // Try standard keys: mcpServers, mcp_servers, servers
    let mcp_obj = json
        .get("mcpServers")
        .or_else(|| json.get("mcp_servers"))
        .or_else(|| json.get("servers"));

    if let Some(obj) = mcp_obj {
        if let Some(map) = obj.as_object() {
            for (server_name, server_config) in map {
                push_installed_server(
                    server_name,
                    server_config,
                    tool_id,
                    tool_name,
                    config_path,
                    servers,
                    seen_ids,
                );
            }
        }
    }

    // VS Code settings.json: "mcp" key with "servers" sub-object
    if let Some(mcp_wrapper) = json.get("mcp") {
        if let Some(inner_servers) = mcp_wrapper.get("servers") {
            if let Some(map) = inner_servers.as_object() {
                for (server_name, server_config) in map {
                    push_installed_server(
                        server_name,
                        server_config,
                        tool_id,
                        tool_name,
                        config_path,
                        servers,
                        seen_ids,
                    );
                }
            }
        }
    }

    // Zed settings.json: "context_servers" object
    if let Some(context_servers) = json
        .get("context_servers")
        .and_then(|value| value.as_object())
    {
        for (server_name, server_config) in context_servers {
            push_installed_server(
                server_name,
                server_config,
                tool_id,
                tool_name,
                config_path,
                servers,
                seen_ids,
            );
        }
    }

    // Claude Code .claude.json / settings.json: "projects" with nested mcpServers
    if let Some(projects) = json.get("projects") {
        if let Some(proj_map) = projects.as_object() {
            for (_proj_key, proj_val) in proj_map {
                extract_mcp_servers_from_json(
                    proj_val,
                    tool_id,
                    tool_name,
                    config_path,
                    servers,
                    seen_ids,
                );
            }
        }
    }
}

fn extract_mcp_servers_from_yaml(
    content: &str,
    tool_id: &str,
    tool_name: &str,
    config_path: &str,
    file_path: &std::path::Path,
    servers: &mut Vec<InstalledMcpServer>,
    seen_ids: &mut std::collections::HashSet<String>,
) {
    let yaml_value: serde_yaml::Value = match serde_yaml::from_str(content) {
        Ok(value) => value,
        Err(_) => return,
    };
    let json_value = match serde_json::to_value(&yaml_value) {
        Ok(value) => value,
        Err(_) => return,
    };

    extract_mcp_servers_from_json(
        &json_value,
        tool_id,
        tool_name,
        config_path,
        servers,
        seen_ids,
    );

    if let Some(mcp_servers) = json_value
        .get("mcpServers")
        .and_then(|value| value.as_array())
    {
        for server in mcp_servers {
            let server_name = server
                .get("name")
                .and_then(|value| value.as_str())
                .or_else(|| server.get("id").and_then(|value| value.as_str()));
            if let Some(server_name) = server_name {
                push_installed_server(
                    server_name,
                    server,
                    tool_id,
                    tool_name,
                    config_path,
                    servers,
                    seen_ids,
                );
            }
        }
    }

    if file_path
        .parent()
        .and_then(|value| value.file_name())
        .and_then(|value| value.to_str())
        == Some("mcpServers")
    {
        let server_name = json_value
            .get("name")
            .and_then(|value| value.as_str())
            .map(ToString::to_string)
            .unwrap_or_else(|| {
                file_path
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .unwrap_or("unnamed-server")
                    .to_string()
            });
        push_installed_server(
            &server_name,
            &json_value,
            tool_id,
            tool_name,
            config_path,
            servers,
            seen_ids,
        );
    }
}

/// Extract MCP servers from a TOML config (used by Codex CLI)
fn extract_mcp_servers_from_toml(
    content: &str,
    tool_id: &str,
    tool_name: &str,
    config_path: &str,
    servers: &mut Vec<InstalledMcpServer>,
    seen_ids: &mut std::collections::HashSet<String>,
) {
    let table: toml::Table = match content.parse() {
        Ok(v) => v,
        Err(_) => return,
    };

    // Codex uses [mcp_servers.name] sections
    let mcp_obj = table.get("mcp_servers");
    if let Some(map) = mcp_obj.and_then(|value| value.as_table()) {
        for (server_name, server_config) in map {
            let sid = format!("{}:{}", tool_id, server_name);
            if seen_ids.contains(&sid) {
                continue;
            }
            seen_ids.insert(sid.clone());

            let command = server_config
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let url = server_config
                .get("url")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let args: Vec<String> = server_config
                .get("args")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|a| a.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();

            let display_command = if !command.is_empty() {
                command.clone()
            } else if !url.is_empty() {
                url.clone()
            } else {
                "unknown".to_string()
            };

            servers.push(InstalledMcpServer {
                id: sid,
                name: server_name.clone(),
                platform_id: tool_id.to_string(),
                platform_name: tool_name.to_string(),
                command: display_command,
                args,
                config_path: config_path.to_string(),
                safety_level: "unverified".to_string(),
            });
        }
    }
}

/// Scan for skills directories and add them as entries
fn scan_skills_dir(
    tool_id: &str,
    tool_name: &str,
    skills_dir: &PathBuf,
    servers: &mut Vec<InstalledMcpServer>,
    seen_ids: &mut std::collections::HashSet<String>,
) {
    if let Ok(entries) = fs::read_dir(skills_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            // Skip hidden dirs and system dirs
            if name.starts_with('.') || name == "node_modules" {
                continue;
            }
            let sid = format!("{}:skill:{}", tool_id, name);
            if seen_ids.contains(&sid) {
                continue;
            }
            seen_ids.insert(sid.clone());

            servers.push(InstalledMcpServer {
                id: sid,
                name: format!("{} (skill)", name),
                platform_id: tool_id.to_string(),
                platform_name: tool_name.to_string(),
                command: "skill".to_string(),
                args: vec![],
                config_path: entry.path().to_string_lossy().to_string(),
                safety_level: "unverified".to_string(),
            });
        }
    }
}

fn register_skill_root(
    tool_id: &str,
    tool_name: &str,
    skill_root: &std::path::Path,
    servers: &mut Vec<InstalledMcpServer>,
    seen_ids: &mut std::collections::HashSet<String>,
) {
    // Accept any tool ID — dynamic discovery should register skills from all tools.

    let name = skill_root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("unknown-skill")
        .to_string();
    if name.starts_with('.') {
        return;
    }

    let sid = format!("{}:skill:{}", tool_id, name);
    if seen_ids.contains(&sid) {
        return;
    }
    seen_ids.insert(sid.clone());

    servers.push(InstalledMcpServer {
        id: sid,
        name: format!("{} (skill)", name),
        platform_id: tool_id.to_string(),
        platform_name: tool_name.to_string(),
        command: "skill".to_string(),
        args: vec![],
        config_path: skill_root.to_string_lossy().to_string(),
        safety_level: "unverified".to_string(),
    });
}

// ---------------------------------------------------------------------------
// Discovery-based full scan: find MCP configs & skills inside supported AI
// host directories only. This intentionally does not sweep generic user
// folders like Desktop / Downloads / Documents.
// ---------------------------------------------------------------------------

/// MCP config file names to search for
pub(crate) const MCP_CONFIG_NAMES: &[&str] = &[
    ".mcp.json",
    "mcp.json",
    "mcp_config.json",
    "claude_desktop_config.json",
    "config.toml",
    "config.yaml",
    "config.yml",
    "settings.json",
    "cline_mcp_settings.json",
];

fn short_path_hash(value: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    value.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

fn sanitize_tool_slug(raw: &str) -> String {
    let mut output = String::new();
    let mut previous_was_separator = false;

    for ch in raw.chars() {
        let lowered = ch.to_ascii_lowercase();
        if lowered.is_ascii_alphanumeric() {
            output.push(lowered);
            previous_was_separator = false;
        } else if !previous_was_separator {
            output.push('_');
            previous_was_separator = true;
        }
    }

    output.trim_matches('_').to_string()
}

fn slug_to_title(slug: &str) -> String {
    let words: Vec<String> = slug
        .split('_')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect();

    if words.is_empty() {
        "Discovered AI Tool".to_string()
    } else {
        words.join(" ")
    }
}

fn derive_unknown_tool_identity(path: &str) -> (String, String, String) {
    let normalized = normalize_path_string(path);
    let external_markers: [(&str, &str, &str); 19] = [
        ("yuanbao", "tencent_yuanbao", "Tencent Yuanbao"),
        ("腾讯元宝", "tencent_yuanbao", "Tencent Yuanbao"),
        ("workbuddy", "tencent_workbuddy", "Tencent WorkBuddy"),
        ("codebuddy", "tencent_codebuddy", "Tencent CodeBuddy"),
        ("ima", "tencent_ima", "Tencent ima"),
        ("doubao", "doubao", "Doubao"),
        ("豆包", "doubao", "Doubao"),
        ("kimi", "kimi", "Kimi"),
        ("moonshot", "kimi", "Kimi"),
        ("tongyi", "tongyi", "Tongyi"),
        ("通义", "tongyi", "Tongyi"),
        ("qwen", "qwen", "Tongyi Qwen"),
        ("wenxin", "wenxin", "Baidu Wenxin"),
        ("文心", "wenxin", "Baidu Wenxin"),
        ("chatglm", "chatglm", "ChatGLM"),
        ("智谱", "chatglm", "ChatGLM"),
        ("coze", "coze", "Coze"),
        ("扣子", "coze", "Coze"),
        ("hunyuan", "tencent_hunyuan", "Tencent Hunyuan"),
    ];
    for (marker, slug, display_name) in external_markers {
        if normalized.contains(marker) {
            return (
                format!("unknown_ai_tool_{slug}"),
                display_name.to_string(),
                "🧩".to_string(),
            );
        }
    }

    let ignored_segments = [
        "users",
        "user",
        "library",
        "application support",
        "applications",
        "appdata",
        "roaming",
        "local",
        "config",
        "settings",
        "mcp",
        "mcpservers",
        "skills",
        "json",
        "yaml",
        "yml",
        "toml",
    ];
    let candidate = normalized
        .split('/')
        .rev()
        .map(|segment| segment.trim())
        .filter(|segment| !segment.is_empty())
        .map(|segment| segment.trim_start_matches('.'))
        .map(|segment| {
            segment
                .trim_end_matches(".json")
                .trim_end_matches(".yaml")
                .trim_end_matches(".yml")
                .trim_end_matches(".toml")
                .trim_end_matches(".app")
        })
        .find(|segment| !ignored_segments.contains(segment));

    let slug = candidate.map(sanitize_tool_slug).unwrap_or_default();
    if !slug.is_empty() {
        return (
            format!("unknown_ai_tool_{slug}"),
            format!("{} (Detected)", slug_to_title(&slug)),
            "🧩".to_string(),
        );
    }

    let hash = short_path_hash(&normalized);
    let short_hash = &hash[..8.min(hash.len())];
    (
        format!("unknown_ai_tool_{short_hash}"),
        format!("Discovered #{}", &short_hash[..4.min(short_hash.len())]),
        "🧩".to_string(),
    )
}

/// Path patterns → tool identification
fn identify_tool_from_path(path: &str) -> (String, String, String) {
    let lower = normalize_path_string(path);
    // (tool_id, tool_name, icon)
    if lower.contains("cursor") {
        ("cursor".into(), "Cursor".into(), "⚡".into())
    } else if lower.contains("kiro") || lower.contains(".kiro/settings/mcp") {
        ("kiro".into(), "Kiro".into(), "🪄".into())
    } else if lower.contains("visual studio code")
        || lower.contains("/code/")
        || lower.contains(".vscode")
    {
        ("vscode".into(), "VS Code".into(), "💻".into())
    } else if lower.contains("claude_desktop") || lower.contains("/claude/claude_desktop") {
        (
            "claude_desktop".into(),
            "Claude Desktop".into(),
            "🤖".into(),
        )
    } else if lower.contains(".claude") {
        ("claude_code".into(), "Claude Code".into(), "🔧".into())
    } else if lower.contains("windsurf") || lower.contains("codeium/windsurf") {
        ("windsurf".into(), "Windsurf".into(), "🏄".into())
    } else if lower.contains("antigravity") || (lower.contains(".gemini/antigravity")) {
        ("antigravity".into(), "Antigravity".into(), "🚀".into())
    } else if lower.contains("codex")
        || lower.contains(".codex")
        || lower.contains("openai.atlas")
        || lower.contains("/atlas/")
    {
        ("codex".into(), "Codex CLI".into(), "🧠".into())
    } else if lower.contains("qwen code")
        || lower.contains("qwen-code")
        || lower.contains("qwencode")
        || lower.contains(".qwen")
    {
        ("qwen_code".into(), "Qwen Code".into(), "🧭".into())
    } else if lower.contains(".kimi")
        || lower.contains("kimi-cli")
        || lower.contains("kimi code")
        || lower.contains("moonshot")
    {
        ("kimi_cli".into(), "Kimi CLI".into(), "🌙".into())
    } else if lower.contains(".codebuddy")
        || lower.contains("tencent codebuddy")
        || lower.contains("codebuddy")
    {
        ("codebuddy".into(), "CodeBuddy".into(), "🧩".into())
    } else if lower.contains("gemini") || lower.contains(".gemini") {
        ("gemini_cli".into(), "Gemini CLI".into(), "♊".into())
    } else if lower.contains("trae") || lower.contains(".trae") {
        ("trae".into(), "Trae".into(), "🔥".into())
    } else if lower.contains("continue") {
        ("continue_dev".into(), "Continue".into(), "▶️".into())
    } else if lower.contains("aider") {
        ("aider".into(), "Aider".into(), "🤝".into())
    } else if lower.contains("copilot") {
        ("copilot".into(), "GitHub Copilot".into(), "🐙".into())
    } else if lower.contains("zed") {
        ("zed".into(), "Zed".into(), "⚡".into())
    } else if lower.contains("cline") || lower.contains("roo") {
        ("cline".into(), "Cline/Roo".into(), "🤖".into())
    } else if lower.contains("openclaw") {
        ("openclaw".into(), "OpenClaw".into(), "🦀".into())
    } else {
        derive_unknown_tool_identity(path)
    }
}

pub(crate) fn is_known_mcp_config_path(path: &std::path::Path) -> bool {
    let path_str = normalize_path(path);
    let file_name = path_str.rsplit('/').next().unwrap_or("");
    if file_name == ".claude.json" {
        return true;
    }
    if path_str.rsplit('/').nth(1) == Some("mcpservers") {
        return matches!(file_name.rsplit('.').next(), Some("yaml" | "yml" | "json"));
    }

    MCP_CONFIG_NAMES.contains(&file_name)
}

/// Try to parse a file as an MCP config and extract servers
fn try_extract_from_file(
    file_path: &PathBuf,
    servers: &mut Vec<InstalledMcpServer>,
    seen_ids: &mut std::collections::HashSet<String>,
) -> bool {
    let path_str = file_path.to_string_lossy().to_string();
    let content = match fs::read_to_string(file_path) {
        Ok(c) => c,
        Err(_) => return false,
    };

    if content.len() < 3 {
        return false; // Empty or trivial file
    }

    let (tool_id, tool_name, _icon) = identify_tool_from_path(&path_str);
    // Accept any tool ID — dynamic discovery should not be limited to TOOL_DEFS.
    // Unknown tools get an auto-generated ID from identify_tool_from_path().
    let mut found = false;

    // TOML files
    if path_str.ends_with(".toml") {
        let before = servers.len();
        extract_mcp_servers_from_toml(&content, &tool_id, &tool_name, &path_str, servers, seen_ids);
        found = servers.len() > before;
        return found;
    }

    if matches!(
        file_path.extension().and_then(|value| value.to_str()),
        Some("yaml" | "yml")
    ) {
        let before = servers.len();
        extract_mcp_servers_from_yaml(
            &content, &tool_id, &tool_name, &path_str, file_path, servers, seen_ids,
        );
        found = servers.len() > before;
        return found;
    }

    // JSON files
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
        let before = servers.len();
        extract_mcp_servers_from_json(&json, &tool_id, &tool_name, &path_str, servers, seen_ids);
        found = servers.len() > before;
    }

    found
}

pub(crate) fn extract_servers_from_file(file_path: &PathBuf) -> Vec<InstalledMcpServer> {
    let mut servers = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();
    let _ = try_extract_from_file(file_path, &mut servers, &mut seen_ids);
    servers
}

/// Scan a directory (depth 1-2) for MCP config files
fn scan_dir_for_mcp_configs(
    base_dir: &PathBuf,
    servers: &mut Vec<InstalledMcpServer>,
    seen_ids: &mut std::collections::HashSet<String>,
    seen_paths: &mut std::collections::HashSet<String>,
    max_depth: u8,
    deferred_paths: &std::collections::HashSet<String>,
) {
    let entries = match fs::read_dir(base_dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip irrelevant directories
        if name == "node_modules"
            || name == ".git"
            || name == ".Trash"
            || name == "Library"
            || name == "Music"
            || name == "Movies"
            || name == "Pictures"
            || name == "Photos"
            || name == "Desktop"
            || name == "Documents"
            || name == "Downloads"
            || name == "Public"
            || name == "vendor_imports"
            || name == "sessions"
            || name == "shell_snapshots"
            || name == "sqlite"
            || name == "conversations"
            || name == "brain"
            || name == "extensions"
            || name == "annotations"
            || name == "implicit"
            || name == "playground"
            || name == "daemon"
            || name == "scratch"
            || name == "browser_recordings"
            || name == "html_artifacts"
        {
            continue;
        }

        if path.is_file() {
            // Check if this is an MCP config file
            let is_mcp_config = is_known_mcp_config_path(&path);
            if is_mcp_config {
                let ps = path.to_string_lossy().to_string();
                if !seen_paths.contains(&ps) && !is_deferred_scan_path(&path, deferred_paths) {
                    seen_paths.insert(ps);
                    try_extract_from_file(&path, servers, seen_ids);
                }
            }
        } else if path.is_dir() && max_depth > 0 {
            // Recurse into subdirectories (limited depth)
            scan_dir_for_mcp_configs(
                &path,
                servers,
                seen_ids,
                seen_paths,
                max_depth - 1,
                deferred_paths,
            );
        }
    }
}

/// Scan a skills directory and add entries (only top-level, skip vendor/system)
fn scan_skills_in_dir(
    base_dir: &std::path::Path,
    servers: &mut Vec<InstalledMcpServer>,
    seen_ids: &mut std::collections::HashSet<String>,
) {
    // Look for "skills" subdirectory
    let skills_dir = if base_dir.ends_with("skills") {
        base_dir.to_path_buf()
    } else {
        base_dir.join("skills")
    };

    if !path_exists(&skills_dir) {
        return;
    }

    // Skip vendor/cache skills directories — only scan user-installed skills
    let path_str = skills_dir.to_string_lossy().to_string();
    if path_str.contains("vendor_imports") || path_str.contains("node_modules") {
        return;
    }

    let (tool_id, tool_name, _) = identify_tool_from_path(&path_str);
    // Accept any tool ID — dynamic discovery includes unknown AI tools.
    scan_skills_dir(&tool_id, &tool_name, &skills_dir, servers, seen_ids);
}

#[tauri::command]
fn scan_installed_mcps_internal(
    deferred_paths: &std::collections::HashSet<String>,
) -> Result<Vec<InstalledMcpServer>, String> {
    let mut servers: Vec<InstalledMcpServer> = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();
    let mut seen_paths = std::collections::HashSet::new();
    let snapshot = discovery::refresh_discovery_snapshot(true);

    let home = match home_dir() {
        Some(h) => h,
        None => return Ok(servers),
    };

    // ── Phase 0: Use cached deep discovery results first ─────────────
    for config_path_str in &snapshot.config_files {
        if seen_paths.contains(config_path_str) {
            continue;
        }
        let config_path = PathBuf::from(config_path_str);
        if path_exists(&config_path) && !is_deferred_scan_path(&config_path, deferred_paths) {
            seen_paths.insert(config_path_str.clone());
            try_extract_from_file(&config_path, &mut servers, &mut seen_ids);
        }
    }
    for skill_root_str in &snapshot.skill_roots {
        let skill_root = PathBuf::from(skill_root_str);
        if !path_exists(&skill_root) {
            continue;
        }
        let (tool_id, tool_name, _) = identify_tool_from_path(skill_root_str);
        register_skill_root(
            &tool_id,
            &tool_name,
            &skill_root,
            &mut servers,
            &mut seen_ids,
        );
    }

    // ── Phase 1: Scan home directory dotfiles (depth 2) ──────────────
    // Finds: .cursor/mcp.json, .kiro/settings/mcp.json, .claude.json,
    //        .codex/config.toml, .windsurf/mcp.json, .trae/mcp.json,
    //        .gemini/antigravity/mcp_config.json, etc.
    if let Ok(entries) = fs::read_dir(&home) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let path = entry.path();

            // Check dotfiles that are actual config files (e.g. ~/.claude.json)
            if path.is_file()
                && name.starts_with('.')
                && (name.ends_with(".json") || name.ends_with(".toml"))
            {
                let ps = path.to_string_lossy().to_string();
                if !seen_paths.contains(&ps) && !is_deferred_scan_path(&path, deferred_paths) {
                    seen_paths.insert(ps);
                    try_extract_from_file(&path, &mut servers, &mut seen_ids);
                }
            }

            // Check dotdirs for MCP configs and skills
            if path.is_dir() && name.starts_with('.') {
                // Skip irrelevant dotdirs
                if name == ".Trash"
                    || name == ".git"
                    || name == ".npm"
                    || name == ".cache"
                    || name == ".local"
                    || name == ".docker"
                    || name == ".ssh"
                    || name == ".cargo"
                    || name == ".rustup"
                    || name == ".nvm"
                    || name == ".oh-my-zsh"
                    || name == ".zsh_sessions"
                {
                    continue;
                }
                scan_dir_for_mcp_configs(
                    &path,
                    &mut servers,
                    &mut seen_ids,
                    &mut seen_paths,
                    2,
                    deferred_paths,
                );
                scan_skills_in_dir(&path, &mut servers, &mut seen_ids);
            }
        }
    }

    // ── Phase 2: Scan Application Support / AppData (depth 2) ────────
    // macOS: ~/Library/Application Support/Claude/, ~/Library/Application Support/Code/
    // Windows: %APPDATA%, %LOCALAPPDATA%
    // Linux: ~/.config/
    let app_support_dirs: Vec<PathBuf> = vec![
        home.join("Library/Application Support"), // macOS
        home.join(".config"),                     // Linux/XDG
        home.join("AppData/Roaming"),             // Windows
        home.join("AppData/Local"),               // Windows
    ];

    // Directories to skip entirely (system/cache/media — never contain MCP configs)
    const APP_SUPPORT_SKIP: &[&str] = &[
        "caches", "cache", "logs", "crashreporter", "webkit", "safari",
        "diagnostics", "group containers", "containers", "keychains",
        "addressbook", "calendars", "mail", "messages", "photos",
        "callhistory", "siri", "spotlight", "assistantservices",
        "knowledge", "apple", "icloud", "mobilesync",
        "google chrome", "firefox", "microsoft", "adobe",
        "dock", "com.apple", "systemextensions",
    ];

    for app_dir in &app_support_dirs {
        if !path_exists(app_dir) {
            continue;
        }
        if let Ok(entries) = fs::read_dir(app_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    let lower = name.to_lowercase();
                    // Skip known non-AI system directories for performance
                    if APP_SUPPORT_SKIP.iter().any(|skip| lower.starts_with(skip)) {
                        continue;
                    }
                    // Scan ALL remaining directories — any app could have MCP/Skill configs
                    scan_dir_for_mcp_configs(
                        &path,
                        &mut servers,
                        &mut seen_ids,
                        &mut seen_paths,
                        1,
                        deferred_paths,
                    );
                    scan_skills_in_dir(&path, &mut servers, &mut seen_ids);
                }
            }
        }
    }

    // ── Phase 3: Also use TOOL_DEFS hardcoded paths as fallback ──────
    // Ensures we don't miss configs in non-standard locations
    let tools = collect_detected_tools();
    for tool in &tools {
        if !tool.detected {
            continue;
        }
        for mcp_path_str in &tool.mcp_config_paths {
            if seen_paths.contains(mcp_path_str) {
                continue;
            }
            let mcp_path = PathBuf::from(mcp_path_str);
            if path_exists(&mcp_path) && !is_deferred_scan_path(&mcp_path, deferred_paths) {
                seen_paths.insert(mcp_path_str.clone());
                try_extract_from_file(&mcp_path, &mut servers, &mut seen_ids);
            }
        }
    }

    Ok(servers)
}

#[tauri::command]
pub async fn scan_installed_mcps() -> Result<Vec<InstalledMcpServer>, String> {
    let deferred_paths = std::collections::HashSet::new();
    scan_installed_mcps_internal(&deferred_paths)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use std::path::PathBuf;

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "agentshield-scan-{}-{}",
            name,
            uuid::Uuid::new_v4()
        ))
    }

    #[cfg(unix)]
    #[test]
    fn check_file_permissions_uses_plain_language_title() {
        use std::os::unix::fs::PermissionsExt;

        let file_path = temp_path("perm-check-title");
        fs::write(&file_path, "demo").expect("write file");
        fs::set_permissions(&file_path, fs::Permissions::from_mode(0o644))
            .expect("set world-readable permissions");

        let issue = check_file_permissions(&file_path).expect("expected permission issue");
        assert_eq!(issue.title, "配置文件权限过宽，其他账户可读取");
        assert!(issue.auto_fixable);

        let _ = fs::remove_file(file_path);
    }

    #[test]
    fn identifies_windows_tool_paths_and_known_configs() {
        let (tool_id, tool_name, _) =
            identify_tool_from_path(r"C:\Users\demo\AppData\Roaming\Code\User\settings.json");
        assert_eq!(tool_id, "vscode");
        assert_eq!(tool_name, "VS Code");

        let (tool_id, tool_name, _) =
            identify_tool_from_path("/Users/demo/.kiro/settings/mcp.json");
        assert_eq!(tool_id, "kiro");
        assert_eq!(tool_name, "Kiro");

        assert!(is_known_mcp_config_path(Path::new(
            r"C:\Users\demo\.codex\config.toml"
        )));
        assert!(is_known_mcp_config_path(Path::new(
            r"C:\Users\demo\AppData\Roaming\Code\User\settings.json"
        )));
    }

    #[test]
    fn merge_discovery_snapshot_tools_keeps_unknown_hosts_and_merges_known_configs() {
        let base = temp_path("discovery-tools");
        let cursor_config = base.join(".cursor/mcp.json");
        let custom_config = base.join(".myhost/mcp.json");
        let custom_skill_root = base.join(".myhost/skills");
        fs::create_dir_all(cursor_config.parent().expect("cursor parent"))
            .expect("cursor parent dir");
        fs::create_dir_all(custom_config.parent().expect("custom parent"))
            .expect("custom parent dir");
        fs::create_dir_all(&custom_skill_root).expect("skill root dir");
        fs::write(&cursor_config, "{\"mcpServers\":{}}").expect("write cursor config");
        fs::write(&custom_config, "{\"mcpServers\":{}}").expect("write custom config");

        let snapshot = discovery::DiscoverySnapshot {
            generated_at: "2026-03-11T00:00:00Z".to_string(),
            scan_roots: vec![],
            config_files: vec![
                cursor_config.to_string_lossy().to_string(),
                custom_config.to_string_lossy().to_string(),
            ],
            env_files: vec![],
            skill_roots: vec![custom_skill_root.to_string_lossy().to_string()],
            watch_roots: vec![],
        };

        let mut tools = run_detect_tools();
        merge_discovery_snapshot_tools(&mut tools, &snapshot);

        let cursor = tools
            .iter()
            .find(|tool| tool.id == "cursor")
            .expect("cursor tool");
        assert!(cursor.has_mcp_config);
        assert!(cursor
            .mcp_config_paths
            .iter()
            .any(|path| path == &cursor_config.to_string_lossy()));

        let unknown_tools: Vec<_> = tools
            .iter()
            .filter(|tool| tool.id.starts_with("unknown_ai_tool_"))
            .collect();
        assert!(
            !unknown_tools.is_empty(),
            "expected at least one unknown host discovered from snapshot"
        );
        assert!(unknown_tools.iter().any(|tool| {
            tool.mcp_config_paths
                .iter()
                .any(|path| path == &custom_config.to_string_lossy())
        }));

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn snapshot_risk_signals_mark_unknown_host_as_manual_with_exec_and_secret_flags() {
        let base = temp_path("risk-signals");
        let custom_config = base.join(".myhost/mcp.json");
        let custom_skill_root = base.join(".myhost/skills/demo-skill");
        fs::create_dir_all(custom_config.parent().expect("custom parent"))
            .expect("custom parent dir");
        fs::create_dir_all(&custom_skill_root).expect("skill root dir");
        fs::write(
            &custom_config,
            r#"{"mcpServers":{"demo":{"command":"npx","args":["-y","demo-server"],"env":{"DEMO_API_KEY":"abc"}}}}"#,
        )
        .expect("write custom config");
        fs::write(custom_skill_root.join("SKILL.md"), "# Demo Skill")
            .expect("write skill manifest");

        let snapshot = discovery::DiscoverySnapshot {
            generated_at: "2026-03-14T00:00:00Z".to_string(),
            scan_roots: vec![],
            config_files: vec![custom_config.to_string_lossy().to_string()],
            env_files: vec![],
            skill_roots: vec![custom_skill_root.to_string_lossy().to_string()],
            watch_roots: vec![],
        };

        let mut tools = run_detect_tools();
        merge_discovery_snapshot_tools(&mut tools, &snapshot);
        apply_snapshot_risk_signals(&mut tools, &snapshot);

        let unknown_tool = tools
            .iter()
            .find(|tool| tool.id == "unknown_ai_tool_myhost")
            .expect("unknown myhost tool");
        assert!(unknown_tool.risk_surface.has_mcp);
        assert!(unknown_tool.risk_surface.has_skill);
        assert!(unknown_tool.risk_surface.has_exec_signal);
        assert!(unknown_tool.risk_surface.has_secret_signal);
        assert_eq!(
            unknown_tool.management_capability,
            ManagementCapability::Manual
        );
        assert_eq!(unknown_tool.host_confidence, HostConfidence::Medium);
        assert!(unknown_tool
            .evidence_items
            .iter()
            .any(|item| item.evidence_type == "secret_signal"));

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn identify_tool_from_path_maps_yuanbao_to_custom_host() {
        let (tool_id, tool_name, _icon) = identify_tool_from_path("/Applications/腾讯元宝.app");
        assert_eq!(tool_id, "unknown_ai_tool_tencent_yuanbao");
        assert_eq!(tool_name, "Tencent Yuanbao");
    }

    #[test]
    fn identify_tool_from_path_maps_qwen_kimi_and_codebuddy() {
        let (qwen_id, qwen_name, _) = identify_tool_from_path("/Users/demo/.qwen/settings.json");
        assert_eq!(qwen_id, "qwen_code");
        assert_eq!(qwen_name, "Qwen Code");

        let (kimi_id, kimi_name, _) = identify_tool_from_path("/Users/demo/.kimi/mcp.json");
        assert_eq!(kimi_id, "kimi_cli");
        assert_eq!(kimi_name, "Kimi CLI");

        let (codebuddy_id, codebuddy_name, _) =
            identify_tool_from_path("/Users/demo/.codebuddy/.mcp.json");
        assert_eq!(codebuddy_id, "codebuddy");
        assert_eq!(codebuddy_name, "CodeBuddy");
    }

    #[test]
    fn parses_windows_executable_reference_with_icon_suffix() {
        let parsed = parse_windows_executable_reference(
            r#""C:\Users\demo\AppData\Local\Programs\OpenClaw\OpenClaw.exe",0"#,
        )
        .expect("parse executable reference");

        assert_eq!(
            parsed,
            PathBuf::from(r"C:\Users\demo\AppData\Local\Programs\OpenClaw\OpenClaw.exe")
        );
    }

    #[test]
    fn merged_evidence_prefers_strong_host_signal_over_start_menu() {
        let merged = merge_install_evidence(vec![
            install_evidence(
                "start_menu",
                Some(r"C:\Users\demo\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\OpenClaw.lnk".to_string()),
                25,
                false,
            ),
            install_evidence(
                "install_dir",
                Some(r"C:\Users\demo\AppData\Local\Programs\OpenClaw\OpenClaw.exe".to_string()),
                80,
                true,
            ),
            install_evidence(
                "config_dir",
                Some(r"C:\Users\demo\.openclaw".to_string()),
                40,
                false,
            ),
        ]);

        assert!(merged.detected);
        assert!(merged.host_detected);
        assert_eq!(
            merged.path.as_deref(),
            Some(r"C:\Users\demo\AppData\Local\Programs\OpenClaw\OpenClaw.exe")
        );
        assert_eq!(
            merged.detection_sources,
            vec![
                "install_dir".to_string(),
                "config_dir".to_string(),
                "start_menu".to_string()
            ]
        );
    }

    #[test]
    fn resolves_install_location_candidate_from_directory() {
        let base_dir = temp_path("windows-install-location");
        let install_dir = base_dir.join("OpenClaw");
        fs::create_dir_all(&install_dir).expect("create install dir");
        let executable = install_dir.join("OpenClaw.exe");
        fs::write(&executable, "binary").expect("write executable");

        let resolved = resolve_install_location_candidate(
            install_dir.to_string_lossy().as_ref(),
            &["OpenClaw"],
        )
        .expect("resolve install location");

        assert_eq!(resolved, executable);

        let _ = fs::remove_dir_all(&base_dir);
    }

    #[test]
    fn extracts_mcp_servers_from_codex_toml() {
        let base_dir = temp_path("codex-toml");
        let config_dir = base_dir.join(".codex");
        let config_path = config_dir.join("config.toml");
        fs::create_dir_all(&config_dir).expect("create config dir");
        fs::write(
            &config_path,
            "[mcp_servers.wechat_oa]\ncommand = \"sh\"\nargs = [\"-lc\", \"npx -y wechat-official-account-mcp mcp\"]\n",
        )
        .expect("write config");

        let servers = extract_servers_from_file(&config_path);

        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].platform_id, "codex");
        assert_eq!(servers[0].name, "wechat_oa");
        assert_eq!(servers[0].command, "sh");
        assert_eq!(
            servers[0].args,
            vec!["-lc", "npx -y wechat-official-account-mcp mcp"]
        );

        let _ = fs::remove_dir_all(&base_dir);
    }

    #[test]
    fn deferred_host_config_paths_only_include_active_sensitive_hosts() {
        let detected_tools = vec![
            DetectedTool {
                id: "codex".to_string(),
                name: "Codex CLI".to_string(),
                icon: "🧠".to_string(),
                detected: true,
                host_detected: true,
                install_target_ready: true,
                detection_sources: vec!["cli".to_string()],
                path: None,
                version: None,
                has_mcp_config: true,
                mcp_config_path: Some("/Users/demo/.codex/config.toml".to_string()),
                mcp_config_paths: vec!["/Users/demo/.codex/config.toml".to_string()],
                host_confidence: HostConfidence::High,
                risk_surface: ToolRiskSurface {
                    has_mcp: true,
                    has_skill: false,
                    has_exec_signal: false,
                    has_secret_signal: false,
                    evidence_count: 1,
                },
                management_capability: ManagementCapability::OneClick,
                source_tier: SourceTier::A,
                evidence_items: vec![],
            },
            DetectedTool {
                id: "openclaw".to_string(),
                name: "OpenClaw".to_string(),
                icon: "🦀".to_string(),
                detected: true,
                host_detected: true,
                install_target_ready: true,
                detection_sources: vec!["cli".to_string()],
                path: None,
                version: None,
                has_mcp_config: true,
                mcp_config_path: Some("/Users/demo/.openclaw/config.json".to_string()),
                mcp_config_paths: vec!["/Users/demo/.openclaw/config.json".to_string()],
                host_confidence: HostConfidence::High,
                risk_surface: ToolRiskSurface {
                    has_mcp: true,
                    has_skill: false,
                    has_exec_signal: false,
                    has_secret_signal: false,
                    evidence_count: 1,
                },
                management_capability: ManagementCapability::OneClick,
                source_tier: SourceTier::A,
                evidence_items: vec![],
            },
        ];
        let active = std::collections::HashSet::from(["codex".to_string()]);

        let deferred = deferred_host_config_paths(&detected_tools, &active);

        assert!(deferred.contains("/users/demo/.codex/config.toml"));
        assert!(!deferred.contains("/users/demo/.openclaw/config.json"));
    }

    #[test]
    fn process_matcher_ignores_cursor_system_service_false_positive() {
        let exe = Path::new(
            "/System/Library/PrivateFrameworks/TextInputUIMacHelper.framework/Versions/A/XPCServices/CursorUIViewService.xpc/Contents/MacOS/CursorUIViewService",
        );
        let cmd = vec![OsString::from(exe)];

        assert!(!process_matches_runtime_tool(
            "CursorUIViewService",
            Some(exe),
            &cmd,
            "cursor",
        ));
    }

    #[test]
    fn process_matcher_accepts_app_bundle_helpers_and_exact_cli_binaries() {
        let antigravity_exe = Path::new(
            "/Applications/Antigravity.app/Contents/Frameworks/Antigravity Helper (Renderer).app/Contents/MacOS/Antigravity Helper (Renderer)",
        );
        let antigravity_cmd = vec![OsString::from(antigravity_exe)];
        assert!(process_matches_runtime_tool(
            "Antigravity Helper (Renderer)",
            Some(antigravity_exe),
            &antigravity_cmd,
            "antigravity",
        ));

        let claude_exe = Path::new("/usr/local/bin/claude");
        let claude_cmd = vec![OsString::from(claude_exe)];
        assert!(process_matches_runtime_tool(
            "claude",
            Some(claude_exe),
            &claude_cmd,
            "claude_code",
        ));
    }

    #[test]
    fn inspect_skill_for_risks_detects_file_mutation_capability() {
        let _guard = crate::rule_updater::TEST_RULES_ENV_LOCK
            .lock()
            .expect("rules env lock");
        let root = std::env::temp_dir().join(format!(
            "agentshield-skill-risk-file-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("create skill dir");
        fs::write(
            root.join("index.js"),
            "import fs from 'fs'; fs.rmSync('/tmp/demo', { recursive: true, force: true });",
        )
        .expect("write skill file");

        let evidence = inspect_skill_for_risks(&root).expect("expected evidence");
        assert_eq!(evidence.level, SkillRiskLevel::Suspicious);
        assert_eq!(evidence.capability, SkillRiskCapability::FileMutation);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn inspect_skill_for_risks_detects_email_capability() {
        let _guard = crate::rule_updater::TEST_RULES_ENV_LOCK
            .lock()
            .expect("rules env lock");
        let root = std::env::temp_dir().join(format!(
            "agentshield-skill-risk-email-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("create skill dir");
        fs::write(
            root.join("mailer.py"),
            "import smtplib\nsmtp = smtplib.SMTP('smtp.example.com', 587)\n",
        )
        .expect("write skill file");

        let evidence = inspect_skill_for_risks(&root).expect("expected evidence");
        assert_eq!(evidence.level, SkillRiskLevel::Suspicious);
        assert_eq!(evidence.capability, SkillRiskCapability::EmailSending);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn inspect_skill_for_risks_reads_applied_rule_bundle() {
        let _guard = crate::rule_updater::TEST_RULES_ENV_LOCK
            .lock()
            .expect("rules env lock");
        use crate::rule_updater::{
            RuleBundle, RuleBundleMeta, SkillRiskPattern, SkillScanRuleBundle,
        };
        use sha2::{Digest, Sha256};

        let rules_dir = std::env::temp_dir().join(format!(
            "agentshield-skill-risk-rules-{}",
            uuid::Uuid::new_v4()
        ));
        let skill_dir = std::env::temp_dir().join(format!(
            "agentshield-skill-risk-custom-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&rules_dir).expect("create rules dir");
        fs::create_dir_all(&skill_dir).expect("create skill dir");
        std::env::set_var("AGENTSHIELD_RULES_DIR", &rules_dir);

        let bundle = RuleBundle {
            version: "2099.01.01.1".to_string(),
            published_at: "2099-01-01T00:00:00Z".to_string(),
            skill_scan: SkillScanRuleBundle {
                scan_extensions: vec!["js".to_string()],
                suspicious: vec![],
                malicious: vec![SkillRiskPattern {
                    capability: "file_mutation".to_string(),
                    pattern: "wipe_everything(".to_string(),
                }],
            },
        };
        let bundle_json = serde_json::to_string_pretty(&bundle).expect("serialize custom bundle");
        let mut hasher = Sha256::new();
        hasher.update(bundle_json.as_bytes());
        let checksum = hasher
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let meta = RuleBundleMeta {
            source: "test".to_string(),
            version: bundle.version.clone(),
            published_at: bundle.published_at.clone(),
            applied_at: "2099-01-01T00:00:00Z".to_string(),
            checksum_sha256: checksum,
        };

        fs::write(rules_dir.join("skill-risk-rules.json"), bundle_json)
            .expect("write custom bundle");
        fs::write(
            rules_dir.join("skill-risk-rules.meta.json"),
            serde_json::to_string_pretty(&meta).expect("serialize meta"),
        )
        .expect("write custom metadata");
        fs::write(skill_dir.join("index.js"), "wipe_everything('/tmp/demo')")
            .expect("write skill file");

        let evidence = inspect_skill_for_risks(&skill_dir).expect("expected evidence");
        assert_eq!(evidence.level, SkillRiskLevel::Malicious);
        assert_eq!(evidence.capability, SkillRiskCapability::FileMutation);
        assert_eq!(evidence.pattern, "wipe_everything(");

        std::env::remove_var("AGENTSHIELD_RULES_DIR");
        let _ = fs::remove_dir_all(rules_dir);
        let _ = fs::remove_dir_all(skill_dir);
    }

    #[test]
    fn inspect_skill_for_risks_detects_payment_execution_capability() {
        let _guard = crate::rule_updater::TEST_RULES_ENV_LOCK
            .lock()
            .expect("rules env lock");
        let root = std::env::temp_dir().join(format!(
            "agentshield-skill-risk-payment-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("create skill dir");
        fs::write(
            root.join("checkout.js"),
            "import Stripe from 'stripe'; stripe.paymentIntents.create({ amount: 100, currency: 'usd' });",
        )
        .expect("write skill file");

        let evidence = inspect_skill_for_risks(&root).expect("expected evidence");
        assert_eq!(evidence.level, SkillRiskLevel::Malicious);
        assert_eq!(evidence.capability, SkillRiskCapability::PaymentExecution);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn parses_openclaw_security_audit_output() {
        let findings = parse_openclaw_security_audit_output(
            r#"
OpenClaw security audit
Summary: 1 critical · 1 warn · 1 info

CRITICAL
gateway.loopback_no_auth Gateway auth missing on loopback
  gateway.bind is loopback but no gateway auth secret is configured.
  Fix: Set gateway.auth.

WARN
fs.state_dir.perms_readable State dir is readable by others
  /Users/demo/.openclaw mode=755; consider restricting to 700.

INFO
summary.attack_surface Attack surface summary
  browser control: enabled
"#,
        );

        assert_eq!(findings.len(), 3);
        assert_eq!(findings[0].severity, "high");
        assert!(findings[0].title.contains("gateway.loopback_no_auth"));
        assert_eq!(findings[1].severity, "medium");
        assert_eq!(findings[2].severity, "info");
    }
}
