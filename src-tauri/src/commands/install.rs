use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use crate::commands::license;
use crate::commands::platform::{
    npm_command, openclaw_command, openclaw_config_candidates, preferred_openclaw_config_dir,
};
use crate::commands::runtime_guard;
use crate::commands::scan::detect_ai_tools;
use crate::types::scan::SystemReport;

#[derive(Default)]
struct OpenClawProbe {
    installed: bool,
    version: Option<String>,
}

fn parse_version_output(raw: &str) -> Option<String> {
    raw.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.to_string())
}

fn normalize_openclaw_version(raw: String) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return raw;
    }
    if trimmed.to_ascii_lowercase().starts_with("openclaw") {
        trimmed.to_string()
    } else {
        format!("OpenClaw {trimmed}")
    }
}

#[cfg(windows)]
fn apply_no_window_flag(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn apply_no_window_flag(_command: &mut Command) {}

fn command_output(mut command: Command) -> std::io::Result<Output> {
    apply_no_window_flag(&mut command);
    command.output()
}

async fn command_output_async(command: Command) -> Result<Output, String> {
    tokio::task::spawn_blocking(move || command_output(command))
        .await
        .map_err(|error| format!("Command execution task failed: {error}"))?
        .map_err(|error| format!("Command execution failed: {error}"))
}

fn read_version_from_binary(binary: &Path) -> Option<String> {
    let mut command = Command::new(binary);
    command.arg("--version");
    let output = command_output(command).ok()?;
    parse_version_output(&String::from_utf8_lossy(&output.stdout)).map(normalize_openclaw_version)
}

fn read_version_from_default_openclaw_command() -> Option<String> {
    let mut command = Command::new(openclaw_command());
    command.arg("--version");
    if let Ok(output) = command_output(command) {
        if let Some(version) = parse_version_output(&String::from_utf8_lossy(&output.stdout)) {
            return Some(normalize_openclaw_version(version));
        }
    }

    // Fallback: run through login shell to pick up user PATH (node, npm, etc.)
    #[cfg(target_os = "macos")]
    {
        for shell in ["/bin/zsh", "/bin/bash", "/bin/sh"] {
            let mut command = Command::new(shell);
            command.args(["-lc", "openclaw --version 2>/dev/null"]);
            if let Ok(output) = command_output(command) {
                if let Some(version) =
                    parse_version_output(&String::from_utf8_lossy(&output.stdout))
                {
                    return Some(normalize_openclaw_version(version));
                }
            }
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn resolve_openclaw_from_login_shell() -> Option<PathBuf> {
    for shell in ["/bin/zsh", "/bin/bash", "/bin/sh"] {
        let mut command = Command::new(shell);
        command.args(["-lc", "command -v openclaw 2>/dev/null"]);
        let output = match command_output(command) {
            Ok(output) => output,
            Err(_) => continue,
        };
        if !output.status.success() {
            continue;
        }
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let candidate = stdout
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())?;
        let path = PathBuf::from(candidate);
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

#[cfg(not(target_os = "macos"))]
fn resolve_openclaw_from_login_shell() -> Option<PathBuf> {
    None
}

fn openclaw_candidate_paths(home: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(path_env) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_env) {
            candidates.push(dir.join(openclaw_command()));
            if !cfg!(windows) {
                candidates.push(dir.join("openclaw"));
            }
        }
    }

    if let Some(login_shell_bin) = resolve_openclaw_from_login_shell() {
        candidates.push(login_shell_bin);
    }

    let home_candidates = [
        home.join(".npm-global/bin/openclaw"),
        home.join(".local/bin/openclaw"),
        home.join(".bun/bin/openclaw"),
        home.join(".openclaw/bin/openclaw"),
        home.join("Library/pnpm/openclaw"),
        #[cfg(windows)]
        home.join("AppData/Roaming/npm/openclaw"),
        #[cfg(windows)]
        home.join("AppData/Roaming/npm/openclaw.cmd"),
        #[cfg(windows)]
        home.join("AppData/Roaming/npm/openclaw.exe"),
    ];
    for candidate in home_candidates {
        candidates.push(candidate);
    }

    if let Some(appdata) = std::env::var_os("APPDATA") {
        let candidate = PathBuf::from(appdata).join("npm").join("openclaw.cmd");
        if candidate.is_absolute() {
            candidates.push(candidate);
        }
    }

    let mut deduped = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for candidate in candidates {
        let key = candidate.to_string_lossy().to_ascii_lowercase();
        if seen.insert(key) {
            deduped.push(candidate);
        }
    }
    deduped
}

fn resolve_openclaw_binary(home: &Path) -> Option<PathBuf> {
    if let Ok(path) = which::which("openclaw") {
        return Some(path);
    }
    if cfg!(windows) {
        if let Ok(path) = which::which("openclaw.cmd") {
            return Some(path);
        }
    }

    openclaw_candidate_paths(home)
        .into_iter()
        .find(|candidate| candidate.is_file())
}

fn config_hints_openclaw_installed(home: &Path) -> bool {
    openclaw_config_candidates(home).into_iter().any(|dir| {
        dir.join("config.json").exists()
            || dir.join("gateway.json").exists()
            || dir.join("skills").is_dir()
            || dir.join("channels").is_dir()
    })
}

fn npm_reports_openclaw_installed() -> Option<String> {
    // Guard: skip if npm is not installed to avoid spawning cmd.exe windows on Windows
    if which::which("npm").is_err() && !crate::commands::ai_orchestrator::win_fallback_which("npm") {
        return None;
    }
    let mut command = Command::new(npm_command());
    command.args(["ls", "-g", "openclaw", "--depth=0", "--json"]);
    let output = command_output(command).ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim().is_empty() {
        return None;
    }

    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&stdout) {
        if let Some(version) = json
            .get("dependencies")
            .and_then(|v| v.get("openclaw"))
            .and_then(|v| v.get("version"))
            .and_then(|v| v.as_str())
        {
            return Some(normalize_openclaw_version(version.to_string()));
        }
    }

    stdout
        .lines()
        .find_map(|line| {
            line.split_once("openclaw@")
                .map(|(_, version)| version.trim())
        })
        .filter(|version| !version.is_empty())
        .map(|version| normalize_openclaw_version(version.to_string()))
}

fn probe_openclaw(home: &Path) -> OpenClawProbe {
    let binary_path = resolve_openclaw_binary(home);
    let npm_version = npm_reports_openclaw_installed();
    let version = binary_path
        .as_ref()
        .and_then(|path| read_version_from_binary(path))
        .or_else(read_version_from_default_openclaw_command)
        .or(npm_version.clone());
    let config_hint_installed = config_hints_openclaw_installed(home);
    let installed = binary_path.is_some() || npm_version.is_some() || config_hint_installed;

    OpenClawProbe { installed, version }
}

fn license_allows_one_click_automation(plan: &str, status: &str) -> bool {
    matches!(plan, "trial" | "pro" | "enterprise") && status == "active"
}

async fn require_one_click_automation(operation: &str) -> Result<(), String> {
    let info = license::check_license_status().await?;
    if license_allows_one_click_automation(&info.plan, &info.status) {
        return Ok(());
    }

    let hint = match (info.plan.as_str(), info.status.as_str()) {
        ("trial", "expired") => format!(
            "14 天试用已结束。免费版仅支持手动{operation}，一键{operation}需要完整版激活码。请前往「升级 Pro」输入激活码。"
        ),
        ("pro" | "enterprise", "expired") => format!(
            "Pro 许可证已过期。一键{operation}需要有效的许可证。请前往「升级 Pro」续费或输入新的激活码。"
        ),
        ("pro" | "enterprise", "suspended" | "cancelled") => format!(
            "许可证已被暂停。请前往「升级 Pro」重新激活或联系客服。"
        ),
        ("free", _) => format!(
            "当前为免费版，一键{operation}需要 Pro 许可证。请前往「升级 Pro」开始试用或输入激活码。"
        ),
        _ => format!(
            "当前许可证状态（{}/{}）不支持一键{operation}。请前往「升级 Pro」激活许可证。",
            info.plan, info.status
        ),
    };
    Err(hint)
}

// ── OpenClaw Status ──────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct OpenClawStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub config_dir: Option<String>,
    pub node_installed: bool,
    pub npm_installed: bool,
    pub skills_count: u32,
    pub mcps_count: u32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct OpenClawSkillInfo {
    pub name: String,
    pub path: String,
    pub has_skill_md: bool,
    pub file_count: u32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct OpenClawMcpInfo {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
}

#[tauri::command]
pub async fn get_openclaw_status() -> Result<OpenClawStatus, String> {
    let node_installed = which::which("node").is_ok() || crate::commands::ai_orchestrator::win_fallback_which("node");
    let npm_installed = which::which("npm").is_ok() || crate::commands::ai_orchestrator::win_fallback_which("npm");

    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let probe_home = home.clone();
    let probe = tokio::task::spawn_blocking(move || probe_openclaw(&probe_home))
        .await
        .map_err(|error| format!("Failed to probe OpenClaw status: {error}"))?;
    let installed = probe.installed;
    let version = probe.version.clone();
    let config_dir = preferred_openclaw_config_dir(&home);
    let config_dir_str = if config_dir.exists() {
        Some(config_dir.to_string_lossy().to_string())
    } else {
        None
    };

    // Count skills — only from OpenClaw's own directory
    let skills_dir = config_dir.join("skills");
    let skills_count = if skills_dir.is_dir() {
        std::fs::read_dir(&skills_dir)
            .map(|entries| entries.flatten().filter(|e| e.path().is_dir()).count() as u32)
            .unwrap_or(0)
    } else {
        0
    };

    // Count MCPs from openclaw config
    let gateway_config = config_dir.join("config.json");
    let mcps_count = if gateway_config.exists() {
        if let Ok(content) = std::fs::read_to_string(&gateway_config) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                json.get("mcpServers")
                    .or(json.get("mcp_servers"))
                    .and_then(|v| v.as_object())
                    .map(|m| m.len() as u32)
                    .unwrap_or(0)
            } else {
                0
            }
        } else {
            0
        }
    } else {
        0
    };

    Ok(OpenClawStatus {
        installed,
        version,
        config_dir: config_dir_str,
        node_installed,
        npm_installed,
        skills_count,
        mcps_count,
    })
}

#[tauri::command]
pub async fn get_openclaw_skills() -> Result<Vec<OpenClawSkillInfo>, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let mut skills = Vec::new();

    let skill_dirs: Vec<_> = openclaw_config_candidates(&home)
        .into_iter()
        .map(|dir| dir.join("skills"))
        .collect();
    let canonical_skill_roots: Vec<PathBuf> = skill_dirs
        .iter()
        .filter_map(|root| std::fs::canonicalize(root).ok())
        .collect();

    for base_dir in &skill_dirs {
        if !base_dir.is_dir() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(base_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();
                // Skip hidden dirs
                if name.starts_with('.') {
                    continue;
                }

                // Resolve the final path and only keep OpenClaw-owned skill roots.
                // This prevents unrelated host skills from leaking into OpenClaw UI.
                let resolved = std::fs::canonicalize(&path).unwrap_or(path.clone());
                let belongs_to_openclaw = canonical_skill_roots
                    .iter()
                    .any(|root| resolved.starts_with(root));
                if !belongs_to_openclaw {
                    continue;
                }

                // Only include directories (skills are dirs)
                if !resolved.is_dir() {
                    continue;
                }

                let has_skill_md =
                    resolved.join("SKILL.md").exists() || resolved.join("skill.md").exists();

                let file_count = std::fs::read_dir(&resolved)
                    .map(|e| e.flatten().count() as u32)
                    .unwrap_or(0);

                skills.push(OpenClawSkillInfo {
                    name,
                    path: path.to_string_lossy().to_string(),
                    has_skill_md,
                    file_count,
                });
            }
        }
    }

    // Deduplicate by name
    skills.sort_by(|a, b| a.name.cmp(&b.name));
    skills.dedup_by(|a, b| a.name == b.name);

    Ok(skills)
}

#[tauri::command]
pub async fn get_openclaw_mcps() -> Result<Vec<OpenClawMcpInfo>, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let mut mcps = Vec::new();

    let config_paths: Vec<_> = openclaw_config_candidates(&home)
        .into_iter()
        .flat_map(|dir| [dir.join("config.json"), dir.join("gateway.json")])
        .collect();

    for config_path in &config_paths {
        if !config_path.exists() {
            continue;
        }
        if let Ok(content) = std::fs::read_to_string(config_path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                let servers = json
                    .get("mcpServers")
                    .or(json.get("mcp_servers"))
                    .and_then(|v| v.as_object());
                if let Some(servers) = servers {
                    for (name, config) in servers {
                        let command = config
                            .get("command")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown")
                            .to_string();
                        let args = config
                            .get("args")
                            .and_then(|v| v.as_array())
                            .map(|arr| {
                                arr.iter()
                                    .filter_map(|a| a.as_str())
                                    .map(String::from)
                                    .collect()
                            })
                            .unwrap_or_default();
                        mcps.push(OpenClawMcpInfo {
                            name: name.clone(),
                            command,
                            args,
                        });
                    }
                }
            }
        }
    }

    Ok(mcps)
}

#[tauri::command]
pub async fn install_openclaw_cmd(approval_ticket: Option<String>) -> Result<String, String> {
    require_one_click_automation("安装 OpenClaw").await?;
    // Check Node.js first (with Windows fallback for stale PATH)
    if which::which("node").is_err() && !crate::commands::ai_orchestrator::win_fallback_which("node") {
        return Err("请先安装 Node.js (https://nodejs.org)".to_string());
    }

    let install_targets = vec!["npm install -g openclaw@latest".to_string()];
    runtime_guard::require_action_approval_ticket(
        approval_ticket.as_deref(),
        "agentshield:openclaw",
        "shell_exec",
        &install_targets,
        "user_requested_install",
    )?;

    let mut install_command = Command::new(npm_command());
    install_command.args(["install", "-g", "openclaw@latest"]);
    let output = command_output_async(install_command)
        .await
        .map_err(|error| format!("无法运行 npm: {error}"))?;

    if output.status.success() {
        let mut version_command = Command::new(openclaw_command());
        version_command.arg("--version");
        let version = command_output_async(version_command)
            .await
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|v| v.trim().to_string())
            .unwrap_or_else(|| "已安装".to_string());
        Ok(format!("OpenClaw {} 安装成功", version))
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

/// Remove "openclaw" (and variants) from an MCP config file.
/// Handles TOML, YAML, and JSON formats based on file extension.
/// Returns the config file path if it was modified.
fn clean_openclaw_from_mcp_config(config_path: &std::path::Path) -> Option<String> {
    if !config_path.exists() {
        return None;
    }
    let content = std::fs::read_to_string(config_path).ok()?;

    let is_toml = config_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("toml"))
        .unwrap_or(false);

    let is_yaml = config_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| matches!(e.to_ascii_lowercase().as_str(), "yaml" | "yml"))
        .unwrap_or(false);

    // Backup before modification
    let backup = config_path.with_extension(format!(
        "{}.bak",
        config_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("cfg")
    ));
    let _ = std::fs::copy(config_path, &backup);

    if is_toml {
        let mut doc: toml::Value = content.parse().ok()?;
        let mut modified = false;
        if let Some(table) = doc
            .get_mut("mcp_servers")
            .and_then(|v| v.as_table_mut())
        {
            let to_remove: Vec<String> = table
                .keys()
                .filter(|k| k.to_lowercase().contains("openclaw"))
                .cloned()
                .collect();
            for k in &to_remove {
                table.remove(k);
                modified = true;
            }
        }
        if modified {
            let pretty = toml::to_string_pretty(&doc).ok()?;
            std::fs::write(config_path, pretty).ok()?;
            return Some(config_path.to_string_lossy().to_string());
        }
        return None;
    }

    if is_yaml {
        let yaml: serde_yaml::Value = serde_yaml::from_str(&content).ok()?;
        let mut json: serde_json::Value = serde_json::to_value(yaml).ok()?;
        let modified = remove_openclaw_keys_from_json(&mut json);
        if modified {
            let yaml_out: serde_yaml::Value = serde_json::from_value(json).ok()?;
            let pretty = serde_yaml::to_string(&yaml_out).ok()?;
            std::fs::write(config_path, pretty).ok()?;
            return Some(config_path.to_string_lossy().to_string());
        }
        return None;
    }

    // Default: JSON
    let mut json: serde_json::Value = serde_json::from_str(&content).ok()?;
    let modified = remove_openclaw_keys_from_json(&mut json);
    if modified {
        let pretty = serde_json::to_string_pretty(&json).ok()?;
        std::fs::write(config_path, pretty).ok()?;
        return Some(config_path.to_string_lossy().to_string());
    }
    None
}

/// Remove all openclaw-related keys from JSON mcpServers / mcp_servers objects.
fn remove_openclaw_keys_from_json(json: &mut serde_json::Value) -> bool {
    let mut modified = false;
    for key in &["mcpServers", "mcp_servers"] {
        if let Some(servers) = json.get_mut(*key).and_then(|v| v.as_object_mut()) {
            if servers.remove("openclaw").is_some() {
                modified = true;
            }
            let to_remove: Vec<String> = servers
                .keys()
                .filter(|k| k.to_lowercase().contains("openclaw"))
                .cloned()
                .collect();
            for k in to_remove {
                servers.remove(&k);
                modified = true;
            }
        }
    }
    modified
}

/// Dynamically find all MCP config files on the system (cross-platform).
fn discover_mcp_config_paths() -> Vec<std::path::PathBuf> {
    let mut paths = Vec::new();
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return paths,
    };

    // ── Phase 1: Dotfile configs (same on all OSes) ──
    let dotfile_configs = [
        ".cursor/mcp.json",
        ".vscode/mcp.json",
        ".claude/mcp.json",
        ".claude.json",
        ".windsurf/mcp.json",
        ".trae/mcp.json",
        ".codex/config.toml",
        ".codeium/windsurf/mcp_config.json",
        ".continue/config.json",
        ".aider/mcp.json",
        ".gemini/settings.json",
        ".gemini/antigravity/mcp_config.json",
    ];
    for rel in &dotfile_configs {
        let p = home.join(rel);
        if p.exists() {
            paths.push(p);
        }
    }

    // ── Phase 2: OS-specific app data dirs ──
    #[cfg(target_os = "macos")]
    {
        let app_support = home.join("Library/Application Support");
        let mac_configs = [
            "Claude/claude_desktop_config.json",
            "Code/User/settings.json",
            "Cursor/User/globalStorage/cursor.mcp/mcp.json",
            "Windsurf/User/settings.json",
            "Trae/User/settings.json",
        ];
        for rel in &mac_configs {
            let p = app_support.join(rel);
            if p.exists() {
                paths.push(p);
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Windows: %APPDATA% and %LOCALAPPDATA%
        let appdata_dirs = [home.join("AppData/Roaming"), home.join("AppData/Local")];
        let win_configs = [
            "Claude/claude_desktop_config.json",
            "Code/User/settings.json",
            "Cursor/User/globalStorage/cursor.mcp/mcp.json",
            "Windsurf/User/settings.json",
            "Trae/User/settings.json",
        ];
        for base in &appdata_dirs {
            for rel in &win_configs {
                let p = base.join(rel);
                if p.exists() {
                    paths.push(p);
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Linux: XDG_CONFIG_HOME (~/.config)
        let xdg_config = std::env::var("XDG_CONFIG_HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| home.join(".config"));
        let linux_configs = [
            "Claude/claude_desktop_config.json",
            "Code/User/settings.json",
            "Cursor/User/settings.json",
        ];
        for rel in &linux_configs {
            let p = xdg_config.join(rel);
            if p.exists() {
                paths.push(p);
            }
        }
    }

    // ── Phase 3: Smart scan — find any remaining configs with "openclaw" in home dotdirs ──
    if let Ok(entries) = std::fs::read_dir(&home) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with('.') {
                continue;
            }
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            // Skip dirs we already covered
            if [
                ".", "..", ".Trash", ".cache", ".local", ".npm", ".nvm", ".cargo",
            ]
            .contains(&name.as_str())
            {
                continue;
            }
            // Look for mcp*.json or *config*.json up to depth 2
            scan_for_json_configs(&dir, &mut paths, 0, 2);
        }
    }

    // Deduplicate
    paths.sort();
    paths.dedup();
    paths
}

/// Recursively scan for JSON config files that may contain MCP configs
fn scan_for_json_configs(
    dir: &std::path::Path,
    paths: &mut Vec<std::path::PathBuf>,
    depth: u8,
    max_depth: u8,
) {
    if depth >= max_depth {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if p.is_file() && name.ends_with(".json") {
            let name_lower = name.to_lowercase();
            if name_lower.contains("mcp")
                || name_lower.contains("config")
                || name_lower.contains("settings")
            {
                // Quick check if it contains "openclaw" before adding
                if let Ok(content) = std::fs::read_to_string(&p) {
                    if content.to_lowercase().contains("openclaw") && !paths.contains(&p) {
                        paths.push(p);
                    }
                }
            }
        } else if p.is_dir() && !name.starts_with('.') {
            let skip = [
                "node_modules",
                "cache",
                "Cache",
                "logs",
                "extensions",
                "CachedData",
            ];
            if !skip.contains(&name.as_str()) {
                scan_for_json_configs(&p, paths, depth + 1, max_depth);
            }
        }
    }
}

async fn uninstall_openclaw_impl(
    approval_ticket: Option<String>,
    require_approval_ticket: bool,
) -> Result<String, String> {
    require_one_click_automation("卸载 OpenClaw").await?;
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    if require_approval_ticket {
        let uninstall_targets = vec!["OpenClaw local installation".to_string()];
        runtime_guard::require_action_approval_ticket(
            approval_ticket.as_deref(),
            "agentshield:openclaw",
            "file_delete",
            &uninstall_targets,
            "user_requested_uninstall",
        )?;
    }
    let mut report: Vec<String> = Vec::new();

    // ── 1. Stop running OpenClaw processes ──
    #[cfg(unix)]
    {
        let mut command = Command::new("pkill");
        command.args(["-f", "openclaw"]);
        let _ = command_output_async(command).await;
    }
    #[cfg(windows)]
    {
        let mut kill_image = Command::new("taskkill");
        kill_image.args(["/F", "/IM", "openclaw.exe"]);
        let _ = command_output_async(kill_image).await;

        let mut kill_window = Command::new("taskkill");
        kill_window.args(["/F", "/FI", "WINDOWTITLE eq openclaw*"]);
        let _ = command_output_async(kill_window).await;
    }
    report.push("✓ 已停止 OpenClaw 进程".to_string());

    // ── 2. Remove the binary (supports GUI PATH fallback detection) ──
    if let Some(bin_path) = resolve_openclaw_binary(&home) {
        let p = bin_path.to_string_lossy().to_string();
        match std::fs::remove_file(&bin_path) {
            Ok(_) => report.push(format!("✓ 已删除 {}", p)),
            Err(e) => report.push(format!("✗ 无法删除 {}: {}", p, e)),
        }
    }
    // Also check common paths that `which` might miss
    let extra_bin_paths = [
        home.join(".npm-global/bin/openclaw"),
        home.join(".local/bin/openclaw"),
        home.join(".openclaw/bin/openclaw"),
        #[cfg(windows)]
        home.join("AppData/Local/openclaw/openclaw.exe"),
        #[cfg(windows)]
        home.join("AppData/Roaming/npm/openclaw"),
        #[cfg(windows)]
        home.join("AppData/Roaming/npm/openclaw.cmd"),
    ];
    for bp in &extra_bin_paths {
        if bp.exists() && std::fs::remove_file(bp).is_ok() {
            report.push(format!("✓ 已删除 {}", bp.to_string_lossy()));
        }
    }

    // ── 3. npm uninstall global packages ──
    for pkg in &["openclaw", "openclaw-mcp", "@openclaw/cli"] {
        let mut command = Command::new(npm_command());
        command.args(["uninstall", "-g", pkg]);
        let output = command_output_async(command).await;
        if let Ok(o) = output {
            if o.status.success() {
                report.push(format!("✓ npm uninstall -g {} 完成", pkg));
            }
        }
    }

    // ── 4. Remove config directories ──
    let config_dirs = openclaw_config_candidates(&home);
    for dir in &config_dirs {
        if dir.exists() {
            match std::fs::remove_dir_all(dir) {
                Ok(_) => report.push(format!("✓ 已删除 {}", dir.to_string_lossy())),
                Err(e) => report.push(format!("✗ 无法删除 {}: {}", dir.to_string_lossy(), e)),
            }
        }
    }

    // ── 5. Remove OS-specific services ──
    #[cfg(target_os = "macos")]
    {
        let launch_agents = home.join("Library/LaunchAgents");
        if launch_agents.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&launch_agents) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.to_lowercase().contains("openclaw") {
                        let p = entry.path();
                        let mut command = Command::new("launchctl");
                        command.args(["unload", &p.to_string_lossy()]);
                        let _ = command_output_async(command).await;
                        match std::fs::remove_file(&p) {
                            Ok(_) => report.push(format!("✓ 已删除服务 {}", name)),
                            Err(e) => report.push(format!("✗ 无法删除 {}: {}", name, e)),
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Remove Windows scheduled tasks / services
        let mut delete_task = Command::new("schtasks");
        delete_task.args(["/Delete", "/TN", "OpenClaw", "/F"]);
        let _ = command_output_async(delete_task).await;

        let mut delete_service = Command::new("sc");
        delete_service.args(["delete", "openclaw"]);
        let _ = command_output_async(delete_service).await;
    }

    #[cfg(target_os = "linux")]
    {
        // Remove systemd user service
        let systemd_dir = home.join(".config/systemd/user");
        if systemd_dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&systemd_dir) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.to_lowercase().contains("openclaw") {
                        let mut stop_command = Command::new("systemctl");
                        stop_command.args(["--user", "stop", &name]);
                        let _ = command_output_async(stop_command).await;

                        let mut disable_command = Command::new("systemctl");
                        disable_command.args(["--user", "disable", &name]);
                        let _ = command_output_async(disable_command).await;
                        let _ = std::fs::remove_file(entry.path());
                        report.push(format!("✓ 已删除 systemd 服务 {}", name));
                    }
                }
            }
        }
    }

    // ── 6. Smart scan & clean OpenClaw MCP entries from ALL platform configs ──
    let mcp_configs = discover_mcp_config_paths();
    for config in &mcp_configs {
        if let Some(cleaned) = clean_openclaw_from_mcp_config(config) {
            report.push(format!("✓ 已清理 MCP 配置: {}", cleaned));
        }
    }

    if report.is_empty() {
        return Err("未找到 OpenClaw 相关文件".to_string());
    }

    Ok(report.join("\n"))
}

#[tauri::command]
pub async fn uninstall_openclaw_cmd(approval_ticket: Option<String>) -> Result<String, String> {
    uninstall_openclaw_impl(approval_ticket, true).await
}

pub(crate) async fn uninstall_openclaw_for_global_cleanup() -> Result<String, String> {
    uninstall_openclaw_impl(None, false).await
}

#[tauri::command]
pub async fn update_openclaw_cmd(approval_ticket: Option<String>) -> Result<String, String> {
    require_one_click_automation("升级 OpenClaw").await?;
    let update_targets = vec!["npm install -g openclaw@latest".to_string()];
    runtime_guard::require_action_approval_ticket(
        approval_ticket.as_deref(),
        "agentshield:openclaw",
        "shell_exec",
        &update_targets,
        "user_requested_update",
    )?;

    let mut update_command = Command::new(npm_command());
    update_command.args(["install", "-g", "openclaw@latest"]);
    let output = command_output_async(update_command)
        .await
        .map_err(|error| format!("无法运行 npm: {error}"))?;

    if output.status.success() {
        let mut version_command = Command::new(openclaw_command());
        version_command.arg("--version");
        let version = command_output_async(version_command)
            .await
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|v| v.trim().to_string())
            .unwrap_or_else(|| "已更新".to_string());
        Ok(format!("OpenClaw 已更新至 {}", version))
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

/// Check the latest available OpenClaw version from npm registry.
/// Returns the latest version string, or the current installed version if check fails.
#[tauri::command]
pub async fn check_openclaw_latest_version() -> Result<String, String> {
    // Guard: skip npm call if npm is not installed to avoid spawning cmd.exe windows on Windows
    let npm_available = which::which("npm").is_ok() || crate::commands::ai_orchestrator::win_fallback_which("npm");

    let output = if npm_available {
        // Try `npm view openclaw version` to get latest from registry
        let mut view_command = Command::new(npm_command());
        view_command.args(["view", "openclaw", "version"]);
        command_output_async(view_command).await
    } else {
        Err("npm not installed".to_string())
    };

    if let Ok(o) = output {
        if o.status.success() {
            let version = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if !version.is_empty() {
                return Ok(version);
            }
        }
    }

    // If npm check fails, return local installed version if available
    if let Some(home) = dirs::home_dir() {
        let probe = tokio::task::spawn_blocking(move || probe_openclaw(&home))
            .await
            .map_err(|error| format!("Failed to probe local OpenClaw version: {error}"))?;
        if let Some(version) = probe.version {
            return Ok(version);
        }
    } else if let Some(version) = tokio::task::spawn_blocking(read_version_from_default_openclaw_command)
        .await
        .ok()
        .flatten()
    {
        return Ok(version);
    }

    // Fallback: no version info available
    Err("Cannot determine latest version".to_string())
}

// ── Legacy commands (still registered) ──────────────────────────────

#[tauri::command]
pub async fn detect_system() -> Result<SystemReport, String> {
    let node_installed = which::which("node").is_ok();
    let node_version = if node_installed {
        let mut command = Command::new("node");
        command.arg("--version");
        command_output_async(command)
            .await
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|v| v.trim().to_string())
    } else {
        None
    };

    let npm_installed = which::which("npm").is_ok();
    let docker_installed = which::which("docker").is_ok();
    let git_installed = which::which("git").is_ok();

    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let probe = tokio::task::spawn_blocking(move || probe_openclaw(&home))
        .await
        .map_err(|error| format!("Failed to inspect OpenClaw installation: {error}"))?;
    let openclaw_installed = probe.installed;
    let openclaw_version = probe.version;

    let detected_ai_tools = detect_ai_tools().await.unwrap_or_default();

    Ok(SystemReport {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        node_installed,
        node_version,
        npm_installed,
        docker_installed,
        openclaw_installed,
        openclaw_version,
        git_installed,
        detected_ai_tools,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_openclaw_version_keeps_or_adds_prefix() {
        assert_eq!(
            normalize_openclaw_version("2026.3.8".to_string()),
            "OpenClaw 2026.3.8"
        );
        assert_eq!(
            normalize_openclaw_version("OpenClaw 2026.3.8".to_string()),
            "OpenClaw 2026.3.8"
        );
    }

    #[test]
    fn candidate_paths_include_home_npm_global_bin() {
        let home = PathBuf::from("/tmp/agentshield-openclaw-home");
        let candidates = openclaw_candidate_paths(&home);
        let found = candidates.iter().any(|path| {
            path.to_string_lossy()
                .replace('\\', "/")
                .contains(".npm-global/bin/openclaw")
        });
        assert!(found, "expected ~/.npm-global/bin/openclaw candidate");
    }

    #[test]
    fn probe_reports_installed_when_binary_is_discoverable() {
        let has_openclaw_binary = Command::new("sh")
            .args(["-lc", "command -v openclaw >/dev/null 2>&1"])
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        let Some(home) = dirs::home_dir() else {
            return;
        };
        let probe = probe_openclaw(&home);

        if has_openclaw_binary {
            assert!(
                probe.installed,
                "probe should mark installed when command -v openclaw succeeds"
            );
        }
    }
}
