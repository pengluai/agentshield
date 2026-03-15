use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::process::Command;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use walkdir::{DirEntry, WalkDir};

const CACHE_MAX_AGE: Duration = Duration::from_secs(15 * 60);
const SKILL_CONTAINER_NAMES: &[&str] = &["skills"];
const SKILL_MANIFEST_NAMES: &[&str] = &["SKILL.md", "skill.md"];
const MCP_CONFIG_NAMES: &[&str] = &[
    ".mcp.json",
    "mcp.json",
    "mcp_config.json",
    "claude_desktop_config.json",
    "config.toml",
    "config.yaml",
    "config.yml",
    "settings.json",
    "config.json",
    "gateway.json",
    "cline_mcp_settings.json",
];
const HIGH_CONFIDENCE_MCP_CONFIG_NAMES: &[&str] = &[
    ".mcp.json",
    "mcp.json",
    "mcp_config.json",
    "claude_desktop_config.json",
    "cline_mcp_settings.json",
];
const MCP_SIGNATURE_MARKERS: &[&str] = &[
    "\"mcpservers\"",
    "\"mcp_servers\"",
    "\"context_servers\"",
    "\"mcp\"",
    "mcpservers:",
    "mcp_servers:",
    "context_servers:",
    "[mcp_servers.",
    "mcp.servers",
];
const AI_TOOL_SCAN_ROOTS: &[&str] = &[
    "Applications",
    ".agents",
    ".openclaw",
    ".claude",
    ".cursor",
    ".codex",
    ".codex-openclaw",
    ".gemini",
    ".qwen",
    ".kiro",
    ".trae",
    ".qoder",
    ".kilocode",
    ".commandcode",
    ".yuanbao",
    ".workbuddy",
    ".codebuddy",
    ".doubao",
    ".kimi",
    ".tongyi",
    ".coze",
    ".vscode",
    ".windsurf",
    ".codeium/windsurf",
    ".continue",
    ".aider",
    ".roo",
    ".cline",
    ".zed",
    ".config/openclaw",
    ".config/gemini",
    ".config/zed",
    "Library/Application Support/Claude",
    "Library/Application Support/Codex",
    "Library/Application Support/Kiro/User",
    "Library/Application Support/OpenAI",
    "Library/Application Support/Tencent",
    "Library/Application Support/ByteDance",
    "Library/Application Support/Alibaba",
    "Library/Application Support/com.openai.atlas",
    "Library/Application Support/Code/User",
    "Library/Application Support/Cursor/User",
    "Library/Application Support/Trae/User",
    "Library/Application Support/Windsurf/User",
    "Library/Application Support/OpenClaw",
    "AppData/Roaming/openclaw",
    "AppData/Local/openclaw",
    "AppData/Roaming/Code/User",
    "AppData/Roaming/Cursor/User",
    "AppData/Roaming/Windsurf/User",
    "AppData/Local/Windsurf/User",
];
const AI_HOME_LEVEL_FILES: &[&str] = &[
    ".claude.json",
    ".codebuddy.json",
    ".mcp.json",
    "mcp.json",
    "mcp_config.json",
    ".aider.conf.yml",
    ".aider.conf.yaml",
];
const SKIP_DIR_NAMES: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "vendor",
    "vendor_imports",
    "target",
    "dist",
    "build",
    ".next",
    ".nuxt",
    "coverage",
    ".cache",
    "cache",
    "caches",
    ".trash",
    "trash",
    "__pycache__",
    ".venv",
    "venv",
    ".tox",
    ".mypy_cache",
    ".pytest_cache",
    "deriveddata",
    "browser_recordings",
    "html_artifacts",
    "sessions",
    "sqlite",
    "daemon",
    "playground",
    "annotations",
    "implicit",
    "brain",
];
const ROOT_LEVEL_SYSTEM_DIRS: &[&str] = &[
    "system",
    "bin",
    "sbin",
    "proc",
    "dev",
    "cores",
    "private",
    "tmp",
    "windows",
    "$recycle.bin",
    "programdata",
];
const AI_PATH_MARKERS: &[&str] = &[
    "openclaw",
    "cursor",
    "claude",
    "codex",
    "kiro",
    "windsurf",
    "codeium",
    "trae",
    "gemini",
    "continue",
    "aider",
    "cline",
    "roo",
    "zed",
    "vscode",
    "visual studio code",
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
    "元宝",
    "豆包",
    "通义",
    "文心",
    "智谱",
    "扣子",
    "agents",
];

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct DiscoverySnapshot {
    pub generated_at: String,
    pub scan_roots: Vec<String>,
    pub config_files: Vec<String>,
    pub env_files: Vec<String>,
    pub skill_roots: Vec<String>,
    pub watch_roots: Vec<String>,
}

fn home_dir() -> Option<PathBuf> {
    dirs::home_dir()
}

fn data_dir() -> PathBuf {
    home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".agentshield")
}

fn cache_path() -> PathBuf {
    data_dir().join("discovery-cache.json")
}

fn ensure_data_dir() -> Result<(), String> {
    fs::create_dir_all(data_dir())
        .map_err(|error| format!("Failed to create discovery cache dir: {error}"))
}

fn path_exists(path: &Path) -> bool {
    fs::metadata(path).is_ok()
}

fn canonicalish(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn normalized_path(path: &Path) -> String {
    canonicalish(path).replace('\\', "/").to_lowercase()
}

fn normalized_path_string(path: &str) -> String {
    path.replace('\\', "/").to_lowercase()
}

fn is_env_file_name(name: &str) -> bool {
    name == ".env" || name.starts_with(".env.")
}

fn is_candidate_config_name(name: &str) -> bool {
    MCP_CONFIG_NAMES.contains(&name)
}

fn looks_like_ai_tool_path(path: &Path) -> bool {
    let normalized = normalized_path(path);
    AI_PATH_MARKERS
        .iter()
        .any(|marker| normalized.contains(marker))
}

fn is_continue_mcp_file(path: &Path) -> bool {
    let Some(parent) = path.parent() else {
        return false;
    };
    let Some(parent_name) = parent.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    if parent_name != "mcpServers" {
        return false;
    }

    matches!(
        path.extension().and_then(|value| value.to_str()),
        Some("yaml" | "yml" | "json")
    )
}

fn is_high_confidence_mcp_config_name(name: &str) -> bool {
    HIGH_CONFIDENCE_MCP_CONFIG_NAMES.contains(&name)
}

fn has_mcp_signature_markers(content: &str) -> bool {
    let lower = content.to_lowercase();
    MCP_SIGNATURE_MARKERS
        .iter()
        .any(|marker| lower.contains(marker))
}

fn file_has_mcp_signature(path: &Path) -> bool {
    let Ok(content) = fs::read_to_string(path) else {
        return false;
    };
    if content.len() < 3 {
        return false;
    }
    has_mcp_signature_markers(&content)
}

fn is_ai_risk_config_candidate(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    if is_continue_mcp_file(path) {
        return true;
    }
    if AI_HOME_LEVEL_FILES.contains(&name) {
        if is_high_confidence_mcp_config_name(name) {
            return true;
        }
        return file_has_mcp_signature(path);
    }
    if !is_candidate_config_name(name) {
        return false;
    }
    if is_high_confidence_mcp_config_name(name) {
        return true;
    }
    file_has_mcp_signature(path)
}

fn has_skill_manifest(path: &Path) -> bool {
    SKILL_MANIFEST_NAMES
        .iter()
        .any(|name| path.join(name).is_file())
}

fn is_ai_risk_skill_root(path: &Path) -> bool {
    path.is_dir() && (has_skill_manifest(path) || looks_like_ai_tool_path(path))
}

fn is_ai_risk_signature_path(path: &Path) -> bool {
    if path.is_file() {
        return is_ai_risk_config_candidate(path);
    }
    if path.is_dir() {
        return is_ai_risk_skill_root(path);
    }
    false
}

fn normalize_dir_name(entry: &DirEntry) -> String {
    entry.file_name().to_string_lossy().to_lowercase()
}

fn should_descend(entry: &DirEntry) -> bool {
    if entry.depth() == 0 {
        return true;
    }

    if entry.file_type().is_symlink() {
        return false;
    }

    if !entry.file_type().is_dir() {
        return true;
    }

    let name = normalize_dir_name(entry);
    if SKIP_DIR_NAMES.contains(&name.as_str()) {
        return false;
    }

    if entry.depth() == 1 && ROOT_LEVEL_SYSTEM_DIRS.contains(&name.as_str()) {
        return false;
    }

    let path = entry.path().to_string_lossy().to_lowercase();
    if path.contains("/.agentshield/") || path.contains("\\.agentshield\\") {
        return false;
    }

    true
}

struct ScanTarget {
    path: PathBuf,
    max_depth: usize,
}

fn build_ai_scan_targets_for_home(home: &Path) -> Vec<ScanTarget> {
    let mut seen = HashSet::new();
    let mut targets = Vec::new();

    let mut push = |path: PathBuf, max_depth: usize| {
        if !path_exists(&path) {
            return;
        }
        let key = normalized_path(&path);
        if seen.insert(key) {
            targets.push(ScanTarget { path, max_depth });
        }
    };

    push(home.to_path_buf(), 1);

    for relative in AI_TOOL_SCAN_ROOTS {
        push(home.join(relative), 6);
    }

    if let Ok(entries) = fs::read_dir(home) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if !name.starts_with('.') {
                continue;
            }
            if name == ".agentshield" || name == ".cache" || name == ".trash" {
                continue;
            }
            if AI_PATH_MARKERS.iter().any(|marker| name.contains(marker))
                || name.ends_with("code")
                || name.contains("mcp")
            {
                push(path, 6);
            }
        }
    }

    let app_support = home.join("Library/Application Support");
    if app_support.is_dir() {
        if let Ok(entries) = fs::read_dir(&app_support) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().to_lowercase();
                if AI_PATH_MARKERS.iter().any(|marker| name.contains(marker))
                    || name.contains("openai")
                {
                    push(path, 6);
                }
            }
        }
    }

    targets
}

fn build_ai_scan_targets(home: &Path) -> Vec<ScanTarget> {
    build_ai_scan_targets_for_home(home)
}

fn is_supported_home_level_path(path: &str, home: &Path) -> bool {
    let home_prefix = format!("{}/", normalized_path(home));
    let normalized = normalized_path_string(path);
    let Some(remainder) = normalized.strip_prefix(&home_prefix) else {
        return false;
    };

    if remainder.contains('/') {
        return false;
    }

    AI_HOME_LEVEL_FILES.contains(&remainder)
}

fn build_allowed_root_prefixes_for_home(home: &Path) -> Vec<String> {
    build_ai_scan_targets_for_home(home)
        .into_iter()
        .filter(|target| target.path != home)
        .map(|target| normalized_path(&target.path))
        .collect()
}

fn is_allowed_snapshot_path(path: &str, home: &Path, allowed_roots: &[String]) -> bool {
    let normalized = normalized_path_string(path);
    let path_obj = Path::new(path);
    allowed_roots
        .iter()
        .any(|root| normalized == *root || normalized.starts_with(&format!("{root}/")))
        || is_supported_home_level_path(path, home)
        // Keep non-standard install paths when the file/dir itself has MCP/Skill signatures.
        || is_ai_risk_signature_path(path_obj)
        // For directories (e.g. watch roots), keep known AI host ecosystems.
        || (path_obj.is_dir() && looks_like_ai_tool_path(path_obj))
}

fn sort_and_dedup(entries: &mut Vec<String>) {
    entries.sort();
    entries.dedup();
}

fn sanitize_snapshot_for_home(mut snapshot: DiscoverySnapshot, home: &Path) -> DiscoverySnapshot {
    let allowed_roots = build_allowed_root_prefixes_for_home(home);
    let scan_targets = build_ai_scan_targets_for_home(home);

    snapshot.scan_roots = scan_targets
        .iter()
        .map(|target| canonicalish(&target.path))
        .collect();
    snapshot.config_files.retain(|path| {
        is_allowed_snapshot_path(path, home, &allowed_roots)
            && is_ai_risk_config_candidate(Path::new(path))
    });
    snapshot.env_files.retain(|path| {
        let path_obj = Path::new(path);
        let Some(name) = path_obj.file_name().and_then(|value| value.to_str()) else {
            return false;
        };
        is_allowed_snapshot_path(path, home, &allowed_roots)
            && is_env_file_name(name)
            && looks_like_ai_tool_path(path_obj)
    });
    snapshot.skill_roots.retain(|path| {
        is_allowed_snapshot_path(path, home, &allowed_roots)
            && is_ai_risk_skill_root(Path::new(path))
    });
    snapshot.watch_roots.clear();

    // Ensure watch roots always include directories that contain retained MCP/env files
    // and skill roots, including non-standard custom paths that passed signature checks.
    for path in snapshot
        .config_files
        .iter()
        .chain(snapshot.env_files.iter())
    {
        if let Some(parent) = Path::new(path).parent() {
            snapshot.watch_roots.push(canonicalish(parent));
        }
    }
    for skill_root in &snapshot.skill_roots {
        snapshot.watch_roots.push(skill_root.clone());
        if let Some(parent) = Path::new(skill_root).parent() {
            snapshot.watch_roots.push(canonicalish(parent));
        }
    }

    sort_and_dedup(&mut snapshot.scan_roots);
    sort_and_dedup(&mut snapshot.config_files);
    sort_and_dedup(&mut snapshot.env_files);
    sort_and_dedup(&mut snapshot.skill_roots);
    sort_and_dedup(&mut snapshot.watch_roots);

    snapshot
}

fn sanitize_snapshot(snapshot: DiscoverySnapshot) -> DiscoverySnapshot {
    let Some(home) = home_dir() else {
        return snapshot;
    };

    sanitize_snapshot_for_home(snapshot, &home)
}

fn walk_root(
    root: &Path,
    max_depth: usize,
    config_files: &mut HashSet<String>,
    env_files: &mut HashSet<String>,
    skill_roots: &mut HashSet<String>,
    watch_roots: &mut HashSet<String>,
) {
    let iter = WalkDir::new(root)
        .follow_links(false)
        .same_file_system(true)
        .max_depth(max_depth)
        .into_iter()
        .filter_entry(should_descend);

    for entry in iter.filter_map(Result::ok) {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if entry.file_type().is_file() {
            if (is_candidate_config_name(&name) || is_continue_mcp_file(path))
                && is_ai_risk_config_candidate(path)
            {
                let file = canonicalish(path);
                config_files.insert(file.clone());
                if let Some(parent) = path.parent() {
                    watch_roots.insert(canonicalish(parent));
                }
            } else if is_env_file_name(&name) {
                if !looks_like_ai_tool_path(path) {
                    continue;
                }
                let file = canonicalish(path);
                env_files.insert(file.clone());
                if let Some(parent) = path.parent() {
                    watch_roots.insert(canonicalish(parent));
                }
            }
            continue;
        }

        if !entry.file_type().is_dir() {
            continue;
        }

        if let Some(parent) = path
            .parent()
            .and_then(|value| value.file_name())
            .and_then(|value| value.to_str())
        {
            if SKILL_CONTAINER_NAMES.contains(&parent)
                && !name.starts_with('.')
                && is_ai_risk_skill_root(path)
            {
                skill_roots.insert(canonicalish(path));
                watch_roots.insert(canonicalish(path));
                if let Some(container) = path.parent() {
                    watch_roots.insert(canonicalish(container));
                }
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn spotlight_query(query: &str, limit: usize) -> Vec<PathBuf> {
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
        .collect()
}

#[cfg(target_os = "macos")]
fn augment_snapshot_with_spotlight(
    config_files: &mut HashSet<String>,
    skill_roots: &mut HashSet<String>,
    watch_roots: &mut HashSet<String>,
) {
    let mut config_names = HashSet::new();
    for name in MCP_CONFIG_NAMES {
        config_names.insert(*name);
    }
    for name in AI_HOME_LEVEL_FILES {
        config_names.insert(*name);
    }

    for config_name in config_names {
        let query = format!("kMDItemFSName == '{config_name}'");
        for candidate in spotlight_query(&query, 2000) {
            if !candidate.is_file() || !is_ai_risk_config_candidate(&candidate) {
                continue;
            }
            let file = canonicalish(&candidate);
            if config_files.insert(file.clone()) {
                if let Some(parent) = candidate.parent() {
                    watch_roots.insert(canonicalish(parent));
                }
            }
        }
    }

    for skills_dir in spotlight_query("kMDItemFSName == 'skills'", 1200) {
        if !skills_dir.is_dir() {
            continue;
        }
        let Ok(entries) = fs::read_dir(&skills_dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            if !is_ai_risk_skill_root(&path) {
                continue;
            }
            skill_roots.insert(canonicalish(&path));
            watch_roots.insert(canonicalish(&path));
            watch_roots.insert(canonicalish(&skills_dir));
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn augment_snapshot_with_spotlight(
    _config_files: &mut HashSet<String>,
    _skill_roots: &mut HashSet<String>,
    _watch_roots: &mut HashSet<String>,
) {
}

fn discover_snapshot() -> DiscoverySnapshot {
    let Some(home) = home_dir() else {
        return DiscoverySnapshot::default();
    };

    let targets = build_ai_scan_targets(&home);
    let mut config_files = HashSet::new();
    let mut env_files = HashSet::new();
    let mut skill_roots = HashSet::new();
    let mut watch_roots = HashSet::new();

    for target in &targets {
        walk_root(
            &target.path,
            target.max_depth,
            &mut config_files,
            &mut env_files,
            &mut skill_roots,
            &mut watch_roots,
        );
    }
    augment_snapshot_with_spotlight(&mut config_files, &mut skill_roots, &mut watch_roots);

    let snapshot = DiscoverySnapshot {
        generated_at: Utc::now().to_rfc3339(),
        scan_roots: targets
            .iter()
            .map(|target| canonicalish(&target.path))
            .collect(),
        config_files: config_files.into_iter().collect(),
        env_files: env_files.into_iter().collect(),
        skill_roots: skill_roots.into_iter().collect(),
        watch_roots: watch_roots.into_iter().collect(),
    };

    sanitize_snapshot(snapshot)
}

fn save_snapshot(snapshot: &DiscoverySnapshot) -> Result<(), String> {
    ensure_data_dir()?;
    let serialized = serde_json::to_string_pretty(snapshot)
        .map_err(|error| format!("Failed to serialize discovery snapshot: {error}"))?;
    fs::write(cache_path(), serialized)
        .map_err(|error| format!("Failed to write discovery snapshot: {error}"))
}

fn snapshot_is_fresh(snapshot: &DiscoverySnapshot) -> bool {
    let Ok(parsed) = DateTime::parse_from_rfc3339(&snapshot.generated_at) else {
        return false;
    };
    let age = Utc::now().signed_duration_since(parsed.with_timezone(&Utc));
    age.to_std()
        .map(|value| value <= CACHE_MAX_AGE)
        .unwrap_or(false)
}

pub fn load_discovery_snapshot() -> Option<DiscoverySnapshot> {
    let content = fs::read_to_string(cache_path()).ok()?;
    let snapshot = serde_json::from_str(&content).ok()?;
    Some(sanitize_snapshot(snapshot))
}

pub fn refresh_discovery_snapshot(force: bool) -> DiscoverySnapshot {
    if !force {
        if let Some(snapshot) = load_discovery_snapshot() {
            if snapshot_is_fresh(&snapshot) {
                return snapshot;
            }
        }
    }

    let snapshot = discover_snapshot();
    let _ = save_snapshot(&snapshot);
    snapshot
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_home(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "agentshield-discovery-{label}-{}",
            uuid::Uuid::new_v4()
        ))
    }

    #[test]
    fn sanitize_snapshot_drops_generic_user_folders() {
        let base = temp_home("drop-generic");
        let home = base.join("home");
        let codex_config = home.join(".codex/config.toml");
        let downloads_settings = home.join("Downloads/project/settings.json");
        fs::create_dir_all(codex_config.parent().expect("codex parent"))
            .expect("create codex parent");
        fs::create_dir_all(downloads_settings.parent().expect("downloads parent"))
            .expect("create downloads parent");
        fs::write(
            &codex_config,
            "[mcp_servers.demo]\ncommand = \"npx\"\nargs = [\"-y\", \"demo\"]\n",
        )
        .expect("write codex config");
        fs::write(&downloads_settings, "{\"theme\":\"dark\"}").expect("write downloads settings");

        let snapshot = DiscoverySnapshot {
            generated_at: Utc::now().to_rfc3339(),
            scan_roots: vec![],
            config_files: vec![
                canonicalish(&codex_config),
                canonicalish(&downloads_settings),
            ],
            env_files: vec![],
            skill_roots: vec![],
            watch_roots: vec![canonicalish(&home.join("Downloads/project"))],
        };

        let sanitized = sanitize_snapshot_for_home(snapshot, &home);

        assert!(sanitized
            .config_files
            .contains(&canonicalish(&codex_config)));
        assert!(!sanitized
            .config_files
            .contains(&canonicalish(&downloads_settings)));
        assert!(!sanitized
            .watch_roots
            .contains(&canonicalish(&home.join("Downloads/project"))));

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn supported_home_level_file_is_kept() {
        let base = temp_home("home-level");
        let home = base.join("home");
        let claude_json = home.join(".claude.json");
        fs::create_dir_all(&home).expect("create home dir");
        fs::write(
            &claude_json,
            "{\"mcpServers\":{\"demo\":{\"command\":\"npx\"}}}",
        )
        .expect("write claude json");

        let snapshot = DiscoverySnapshot {
            generated_at: Utc::now().to_rfc3339(),
            scan_roots: vec![],
            config_files: vec![canonicalish(&claude_json)],
            env_files: vec![canonicalish(&home.join(".env"))],
            skill_roots: vec![],
            watch_roots: vec![canonicalish(&home)],
        };

        let sanitized = sanitize_snapshot_for_home(snapshot, &home);

        assert!(sanitized.config_files.contains(&canonicalish(&claude_json)));
        assert!(!sanitized
            .env_files
            .contains(&canonicalish(&home.join(".env"))));
        assert!(sanitized.watch_roots.contains(&canonicalish(&home)));

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn sanitize_snapshot_keeps_supported_kiro_cursor_and_windsurf_roots() {
        let base_dir = temp_home("known-roots");
        let home = base_dir.join("home");
        let kiro_root = home.join(".kiro/settings");
        let windsurf_root = home.join(".codeium/windsurf");
        let cursor_root = home.join("Library/Application Support/Cursor/User");
        fs::create_dir_all(&kiro_root).expect("create kiro root");
        fs::create_dir_all(&windsurf_root).expect("create windsurf root");
        fs::create_dir_all(&cursor_root).expect("create cursor root");

        let kiro_config = kiro_root.join("mcp.json");
        let windsurf_config = windsurf_root.join("mcp_config.json");
        let cursor_config = cursor_root.join("settings.json");
        fs::write(&kiro_config, "{\"mcpServers\":{\"demo\":{}}}").expect("write kiro config");
        fs::write(&windsurf_config, "{\"mcpServers\":{\"demo\":{}}}")
            .expect("write windsurf config");
        fs::write(&cursor_config, "{\"mcpServers\":{\"demo\":{}}}").expect("write cursor config");

        let snapshot = DiscoverySnapshot {
            generated_at: Utc::now().to_rfc3339(),
            scan_roots: vec![],
            config_files: vec![
                canonicalish(&kiro_config),
                canonicalish(&windsurf_config),
                canonicalish(&cursor_config),
            ],
            env_files: vec![],
            skill_roots: vec![],
            watch_roots: vec![
                canonicalish(&kiro_root),
                canonicalish(&windsurf_root),
                canonicalish(&cursor_root),
            ],
        };

        let sanitized = sanitize_snapshot_for_home(snapshot, &home);

        assert!(sanitized.config_files.contains(&canonicalish(&kiro_config)));
        assert!(sanitized
            .config_files
            .contains(&canonicalish(&windsurf_config)));
        assert!(sanitized
            .config_files
            .contains(&canonicalish(&cursor_config)));
        assert!(sanitized.watch_roots.contains(&canonicalish(&kiro_root)));
        assert!(sanitized
            .watch_roots
            .contains(&canonicalish(&windsurf_root)));
        assert!(sanitized.watch_roots.contains(&canonicalish(&cursor_root)));

        let _ = fs::remove_dir_all(&base_dir);
    }

    #[test]
    fn sanitize_snapshot_keeps_custom_path_with_mcp_signature() {
        let base = temp_home("custom-mcp");
        let home = base.join("home");
        let custom_config = home.join("Projects/demo-host/settings.json");
        fs::create_dir_all(custom_config.parent().expect("custom parent")).expect("create parent");
        fs::write(
            &custom_config,
            "{\"mcpServers\":{\"demo\":{\"command\":\"npx\",\"args\":[\"-y\",\"demo\"]}}}",
        )
        .expect("write custom config");

        let snapshot = DiscoverySnapshot {
            generated_at: Utc::now().to_rfc3339(),
            scan_roots: vec![],
            config_files: vec![canonicalish(&custom_config)],
            env_files: vec![],
            skill_roots: vec![],
            watch_roots: vec![],
        };

        let sanitized = sanitize_snapshot_for_home(snapshot, &home);
        let parent = canonicalish(custom_config.parent().expect("parent"));
        assert!(sanitized
            .config_files
            .contains(&canonicalish(&custom_config)));
        assert!(sanitized.watch_roots.contains(&parent));

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn sanitize_snapshot_drops_custom_path_without_mcp_signature() {
        let base = temp_home("custom-generic");
        let home = base.join("home");
        let generic_settings = home.join("Projects/demo-host/settings.json");
        fs::create_dir_all(generic_settings.parent().expect("generic parent"))
            .expect("create parent");
        fs::write(&generic_settings, "{\"theme\":\"light\"}").expect("write generic settings");

        let snapshot = DiscoverySnapshot {
            generated_at: Utc::now().to_rfc3339(),
            scan_roots: vec![],
            config_files: vec![canonicalish(&generic_settings)],
            env_files: vec![],
            skill_roots: vec![],
            watch_roots: vec![],
        };

        let sanitized = sanitize_snapshot_for_home(snapshot, &home);
        assert!(!sanitized
            .config_files
            .contains(&canonicalish(&generic_settings)));

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn sanitize_snapshot_keeps_custom_skill_root_with_manifest() {
        let base = temp_home("custom-skill");
        let home = base.join("home");
        let skill_root = home.join("Tools/my-agent/skills/demo-skill");
        fs::create_dir_all(&skill_root).expect("create skill root");
        fs::write(skill_root.join("SKILL.md"), "# Demo Skill").expect("write skill manifest");

        let snapshot = DiscoverySnapshot {
            generated_at: Utc::now().to_rfc3339(),
            scan_roots: vec![],
            config_files: vec![],
            env_files: vec![],
            skill_roots: vec![canonicalish(&skill_root)],
            watch_roots: vec![],
        };

        let sanitized = sanitize_snapshot_for_home(snapshot, &home);
        assert!(sanitized.skill_roots.contains(&canonicalish(&skill_root)));
        assert!(sanitized.watch_roots.contains(&canonicalish(&skill_root)));

        let _ = fs::remove_dir_all(&base);
    }
}
