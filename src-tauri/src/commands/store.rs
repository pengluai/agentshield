use crate::commands::builtin_catalog::{self, CatalogEntry};
use crate::commands::license;
use crate::commands::platform::{normalize_path_string, npm_command};
use crate::commands::runtime_guard;
use crate::commands::scan::detect_ai_tools;
use crate::commands::scan::InstalledMcpServer;
use crate::types::scan::ManagementCapability;
use crate::types::store::{InstallResult, InstalledItem, StoreCatalogItem, UpdateResult};
use semver::Version;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

use crate::commands::platform::normalize_path;

// ---------------------------------------------------------------------------
// Catalog cache singleton
// ---------------------------------------------------------------------------

static CATALOG_CACHE: Mutex<Option<Vec<StoreCatalogItem>>> = Mutex::new(None);
static GLOBAL_CLEANUP_PLAN_CACHE: OnceLock<Mutex<HashMap<String, GlobalCleanupPreview>>> =
    OnceLock::new();
static GLOBAL_CLEANUP_REPORT_CACHE: OnceLock<Mutex<Option<GlobalCleanupReport>>> = OnceLock::new();

const ALL_PLATFORMS: &[&str] = &[
    "cursor",
    "kiro",
    "claude_desktop",
    "claude_code",
    "vscode",
    "windsurf",
    "antigravity",
    "codex",
    "qwen_code",
    "kimi_cli",
    "codebuddy",
    "gemini_cli",
    "trae",
    "continue_dev",
    "zed",
    "openclaw",
];
const STRATEGY_BUILTIN_NPM: &str = "builtin_npm";
const STRATEGY_REGISTRY_NPM: &str = "registry_npm";
const STRATEGY_REGISTRY_REMOTE: &str = "registry_remote";
const STRATEGY_REGISTRY_REMOTE_AUTH: &str = "registry_remote_auth";
const STRATEGY_UNSUPPORTED_SKILL: &str = "unsupported_skill";
const STRATEGY_UNSUPPORTED_REGISTRY: &str = "unsupported_registry";

fn global_cleanup_plan_cache() -> &'static Mutex<HashMap<String, GlobalCleanupPreview>> {
    GLOBAL_CLEANUP_PLAN_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn global_cleanup_report_cache() -> &'static Mutex<Option<GlobalCleanupReport>> {
    GLOBAL_CLEANUP_REPORT_CACHE.get_or_init(|| Mutex::new(None))
}

fn license_allows_one_click_automation(plan: &str, status: &str) -> bool {
    matches!(plan, "trial" | "pro" | "enterprise") && status == "active"
}

async fn require_one_click_automation(operation: &str) -> Result<(), String> {
    let info = license::check_license_status().await?;
    if license_allows_one_click_automation(&info.plan, &info.status) {
        return Ok(());
    }

    Err(format!(
        "14 天试用已结束。免费版仅支持手动{}，一键{}需要完整版激活码。",
        operation, operation
    ))
}

#[derive(Serialize, Deserialize, Clone)]
pub struct InstallTargetPath {
    pub platform: String,
    pub config_path: String,
    pub exists: bool,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Hash, Debug)]
#[serde(rename_all = "snake_case")]
pub enum GlobalCleanupDependencyManager {
    NpmGlobal,
    PipPackage,
    WingetPackage,
    ChocoPackage,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GlobalCleanupDependencyTask {
    pub manager: GlobalCleanupDependencyManager,
    pub identifier: String,
    pub command_preview: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GlobalCleanupComponentPlan {
    pub item_id: String,
    pub platform: String,
    pub platform_name: String,
    pub component_type: String,
    pub config_path: String,
    pub command: String,
    pub args: Vec<String>,
    pub management_capability: ManagementCapability,
    pub auto_cleanup_supported: bool,
    pub dependency_tasks: Vec<GlobalCleanupDependencyTask>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GlobalCleanupPreview {
    pub plan_id: String,
    pub generated_at: String,
    pub scope_platforms: Vec<String>,
    pub include_dependency_cleanup: bool,
    pub include_openclaw_deep_cleanup: bool,
    pub action_targets: Vec<String>,
    pub component_count: u32,
    pub auto_cleanup_component_count: u32,
    pub manual_only_component_count: u32,
    pub dependency_task_count: u32,
    pub components: Vec<GlobalCleanupComponentPlan>,
    pub dependency_tasks: Vec<GlobalCleanupDependencyTask>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GlobalCleanupActionResult {
    pub action_type: String,
    pub target: String,
    pub status: String,
    pub message: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GlobalCleanupReport {
    pub run_id: String,
    pub plan_id: String,
    pub started_at: String,
    pub completed_at: String,
    #[serde(default)]
    pub backup_dir: Option<String>,
    #[serde(default)]
    pub backup_count: u32,
    pub total_actions: u32,
    pub success_actions: u32,
    pub failed_actions: u32,
    pub skipped_actions: u32,
    pub remaining_components: Vec<String>,
    pub results: Vec<GlobalCleanupActionResult>,
}

fn builtin_item(entry: &CatalogEntry) -> StoreCatalogItem {
    let installable = entry.item_type == "mcp";
    StoreCatalogItem {
        id: entry.id.to_string(),
        name: entry.name.to_string(),
        description: entry.description.to_string(),
        safety_level: entry.safety_level.to_string(),
        compatible_platforms: ALL_PLATFORMS.iter().map(|s| s.to_string()).collect(),
        rating: entry.rating,
        install_count: entry.install_count,
        featured: entry.featured,
        icon: entry.icon.to_string(),
        source_url: String::new(),
        item_type: entry.item_type.to_string(),
        category: entry.category.to_string(),
        installable,
        install_strategy: if installable {
            STRATEGY_BUILTIN_NPM.to_string()
        } else {
            STRATEGY_UNSUPPORTED_SKILL.to_string()
        },
        install_identifier: if installable {
            entry.npx_pkg.to_string()
        } else {
            String::new()
        },
        install_version: String::new(),
        registry_name: String::new(),
        requires_auth: false,
        auth_headers: vec![],
        openclaw_ready: entry.featured,
        review_status: if entry.featured {
            "reviewed".to_string()
        } else {
            "catalog".to_string()
        },
        review_notes: if entry.featured {
            "已通过 AgentShield 的 OpenClaw 兼容性与安装路径复核".to_string()
        } else {
            "内置目录条目，可扫描和审查，但尚未列入 OpenClaw 专区".to_string()
        },
    }
}

fn builtin_catalog() -> Vec<StoreCatalogItem> {
    builtin_catalog::all_builtin_entries()
        .iter()
        .map(|e| builtin_item(e))
        .collect()
}

fn find_builtin_entry(item_id: &str) -> Option<&'static CatalogEntry> {
    builtin_catalog::all_builtin_entries()
        .into_iter()
        .find(|e| e.id == item_id)
}

// ---------------------------------------------------------------------------
// Registry API types
// ---------------------------------------------------------------------------

const REGISTRY_URL: &str = "https://registry.modelcontextprotocol.io/v0.1/servers";
const CACHE_MAX_AGE_SECS: u64 = 24 * 60 * 60; // 24 hours

#[derive(Deserialize)]
struct RegistryResponse {
    #[serde(default)]
    servers: Vec<RegistryServerRecord>,
}

#[derive(Deserialize)]
struct RegistryServerRecord {
    server: RegistryServer,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryServer {
    #[serde(default)]
    name: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    version: String,
    #[serde(default)]
    website_url: String,
    #[serde(default)]
    repository: Option<RegistryRepository>,
    #[serde(default)]
    packages: Vec<RegistryPackage>,
    #[serde(default)]
    remotes: Vec<RegistryRemote>,
}

#[derive(Deserialize)]
struct RegistryRepository {
    #[serde(default)]
    url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryPackage {
    #[serde(default)]
    registry_type: String,
    #[serde(default)]
    identifier: String,
    #[serde(default)]
    version: String,
    #[serde(default)]
    transport: Option<RegistryTransport>,
}

#[derive(Deserialize)]
struct RegistryTransport {
    #[serde(rename = "type", default)]
    kind: String,
}

#[derive(Deserialize)]
struct RegistryRemote {
    #[serde(rename = "type", default)]
    kind: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    headers: Vec<RegistryRemoteHeader>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryRemoteHeader {
    #[serde(default, alias = "key", alias = "header", alias = "field")]
    name: String,
    #[serde(default)]
    is_required: bool,
}

fn required_remote_header_names(remote: &RegistryRemote) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for header in &remote.headers {
        if !header.is_required {
            continue;
        }

        let name = header.name.trim();
        if name.is_empty() {
            continue;
        }

        if seen.insert(name.to_ascii_lowercase()) {
            names.push(name.to_string());
        }
    }

    names
}

// ---------------------------------------------------------------------------
// Disk cache helpers (~/.agentshield/catalog-cache.json)
// ---------------------------------------------------------------------------

fn catalog_cache_path() -> PathBuf {
    let mut p = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push(".agentshield");
    p.push("catalog-cache.json");
    p
}

fn save_catalog_cache(items: &[StoreCatalogItem]) -> Result<(), String> {
    let path = catalog_cache_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create cache directory: {e}"))?;
    }
    let data = serde_json::to_string_pretty(items)
        .map_err(|e| format!("Failed to serialize catalog cache: {e}"))?;
    fs::write(&path, data).map_err(|e| format!("Failed to write catalog cache: {e}"))?;
    Ok(())
}

fn load_catalog_cache() -> Option<Vec<StoreCatalogItem>> {
    let path = catalog_cache_path();
    if !path.exists() {
        return None;
    }
    // Check age
    if let Ok(metadata) = fs::metadata(&path) {
        if let Ok(modified) = metadata.modified() {
            if let Ok(elapsed) = SystemTime::now().duration_since(modified) {
                if elapsed.as_secs() > CACHE_MAX_AGE_SECS {
                    return None; // stale
                }
            }
        }
    }
    let data = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

// ---------------------------------------------------------------------------
// Remote fetch
// ---------------------------------------------------------------------------

async fn fetch_remote_catalog() -> Result<Vec<StoreCatalogItem>, String> {
    let client = reqwest::Client::new();
    let url = format!("{}?limit=100", REGISTRY_URL);
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Registry request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Registry returned status {}", resp.status()));
    }

    // The registry may return either { servers: [...] } or a plain array.
    let body_text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read registry response body: {e}"))?;

    let servers: Vec<RegistryServer> =
        if let Ok(wrapper) = serde_json::from_str::<RegistryResponse>(&body_text) {
            wrapper
                .servers
                .into_iter()
                .map(|record| record.server)
                .collect()
        } else if let Ok(arr) = serde_json::from_str::<Vec<RegistryServerRecord>>(&body_text) {
            arr.into_iter().map(|record| record.server).collect()
        } else {
            return Err("Failed to parse registry response".to_string());
        };

    let items: Vec<StoreCatalogItem> = servers
        .into_iter()
        .map(|s| {
            let short_id = s.name.clone();
            let display_name = if !s.title.trim().is_empty() {
                s.title.clone()
            } else {
                s.name
                    .rsplit('/')
                    .next()
                    .unwrap_or(&s.name)
                    .split('-')
                    .map(|w| {
                        let mut c = w.chars();
                        match c.next() {
                            None => String::new(),
                            Some(first) => first.to_uppercase().to_string() + c.as_str(),
                        }
                    })
                    .collect::<Vec<_>>()
                    .join(" ")
            };

            let source_url = s
                .repository
                .as_ref()
                .map(|repo| repo.url.clone())
                .filter(|url| !url.is_empty())
                .unwrap_or_else(|| s.website_url.clone());

            let npm_package = s.packages.iter().find(|pkg| {
                pkg.registry_type == "npm"
                    && pkg
                        .transport
                        .as_ref()
                        .map(|transport| transport.kind.as_str() == "stdio")
                        .unwrap_or(false)
                    && !pkg.identifier.is_empty()
            });

            let mut remote_without_auth: Option<&RegistryRemote> = None;
            let mut remote_with_auth: Option<(&RegistryRemote, Vec<String>)> = None;
            for remote in &s.remotes {
                let transport_supported = remote.kind == "streamable-http" || remote.kind == "sse";
                if !transport_supported || remote.url.is_empty() {
                    continue;
                }

                let required_headers = required_remote_header_names(remote);
                if required_headers.is_empty() {
                    if remote_without_auth.is_none() {
                        remote_without_auth = Some(remote);
                    }
                } else if remote_with_auth.is_none() {
                    remote_with_auth = Some((remote, required_headers));
                }
            }

            let (
                installable,
                install_strategy,
                install_identifier,
                install_version,
                requires_auth,
                auth_headers,
            ) = if let Some(pkg) = npm_package {
                (
                    true,
                    STRATEGY_REGISTRY_NPM.to_string(),
                    pkg.identifier.clone(),
                    if !pkg.version.is_empty() {
                        pkg.version.clone()
                    } else {
                        s.version.clone()
                    },
                    false,
                    vec![],
                )
            } else if let Some(remote) = remote_without_auth {
                (
                    true,
                    STRATEGY_REGISTRY_REMOTE.to_string(),
                    remote.url.clone(),
                    s.version.clone(),
                    false,
                    vec![],
                )
            } else if let Some((remote, required_headers)) = remote_with_auth {
                (
                    true,
                    STRATEGY_REGISTRY_REMOTE_AUTH.to_string(),
                    remote.url.clone(),
                    s.version.clone(),
                    true,
                    required_headers,
                )
            } else {
                (
                    false,
                    STRATEGY_UNSUPPORTED_REGISTRY.to_string(),
                    String::new(),
                    s.version.clone(),
                    false,
                    vec![],
                )
            };

            StoreCatalogItem {
                id: short_id.clone(),
                name: display_name,
                description: s.description,
                safety_level: "caution".to_string(),
                compatible_platforms: ALL_PLATFORMS.iter().map(|p| p.to_string()).collect(),
                rating: 0.0,
                install_count: 0,
                featured: false,
                icon: "package".to_string(),
                source_url,
                item_type: "mcp".to_string(),
                category: String::new(),
                installable,
                install_strategy,
                install_identifier,
                install_version,
                registry_name: short_id,
                requires_auth,
                auth_headers,
                openclaw_ready: false,
                review_status: "unreviewed".to_string(),
                review_notes: "来自 MCP Registry 的实时目录数据，尚未经过 AgentShield 人工复核"
                    .to_string(),
            }
        })
        .collect();

    Ok(items)
}

// ---------------------------------------------------------------------------
// Three-layer catalog loading: cache -> remote -> fallback
// ---------------------------------------------------------------------------

async fn load_catalog() -> Vec<StoreCatalogItem> {
    // Built-in catalog is always the primary source (128 curated entries)
    let mut items = builtin_catalog();
    let builtin_ids: std::collections::HashSet<String> =
        items.iter().map(|i| i.id.clone()).collect();

    // Try to supplement with remote registry entries (deduplicated)
    let remote = load_catalog_cache().unwrap_or_default();
    if !remote.is_empty() {
        for r in remote {
            if !builtin_ids.contains(&r.id) && !r.name.is_empty() {
                items.push(r);
            }
        }
    } else {
        // Fetch from remote in background — non-blocking, best-effort
        match fetch_remote_catalog().await {
            Ok(remote_items) if !remote_items.is_empty() => {
                let _ = save_catalog_cache(&remote_items);
                for r in remote_items {
                    if !builtin_ids.contains(&r.id) && !r.name.is_empty() {
                        items.push(r);
                    }
                }
            }
            Ok(_) => {
                eprintln!("Registry returned empty catalog");
            }
            Err(e) => {
                eprintln!("Remote catalog fetch failed: {e}");
            }
        }
    }

    items
}

// ---------------------------------------------------------------------------
// Installed-items persistence  (~/.agentshield/installed-items.json)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Default)]
struct InstalledItemsStore {
    items: Vec<InstalledItem>,
}

fn installed_items_path() -> PathBuf {
    let mut p = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push(".agentshield");
    p.push("installed-items.json");
    p
}

fn load_installed_items() -> InstalledItemsStore {
    let path = installed_items_path();
    if !path.exists() {
        return InstalledItemsStore::default();
    }
    let data = fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&data).unwrap_or_default()
}

pub(crate) fn installed_items_snapshot() -> Vec<InstalledItem> {
    load_installed_items().items
}

fn save_installed_items(store: &InstalledItemsStore) -> Result<(), String> {
    let path = installed_items_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {e}"))?;
    }
    let data =
        serde_json::to_string_pretty(store).map_err(|e| format!("Failed to serialize: {e}"))?;
    fs::write(&path, data).map_err(|e| format!("Failed to write installed-items.json: {e}"))?;
    Ok(())
}

fn global_cleanup_report_path() -> PathBuf {
    let mut p = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push(".agentshield");
    p.push("global-cleanup-last.json");
    p
}

fn global_cleanup_backup_dir(run_id: &str) -> PathBuf {
    let mut p = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push(".agentshield");
    p.push("backups");
    p.push(run_id);
    p
}

fn save_global_cleanup_report(report: &GlobalCleanupReport) -> Result<(), String> {
    let path = global_cleanup_report_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {e}"))?;
    }
    let data =
        serde_json::to_string_pretty(report).map_err(|e| format!("Failed to serialize: {e}"))?;
    fs::write(&path, data).map_err(|e| format!("Failed to write global cleanup report: {e}"))?;
    Ok(())
}

fn load_global_cleanup_report() -> Option<GlobalCleanupReport> {
    let path = global_cleanup_report_path();
    if !path.exists() {
        return None;
    }
    let data = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

fn safe_backup_file_label(path: &Path) -> String {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("config");
    let mut label = String::new();
    for ch in file_name.chars() {
        if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' {
            label.push(ch);
        } else {
            label.push('_');
        }
    }
    if label.trim_matches('_').is_empty() {
        "config".to_string()
    } else {
        label
    }
}

fn backup_global_cleanup_configs(
    components: &[GlobalCleanupComponentPlan],
    run_id: &str,
) -> Result<Vec<(String, String)>, String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut config_paths: Vec<PathBuf> = Vec::new();

    for component in components {
        if !component.auto_cleanup_supported || component.component_type == "skill" {
            continue;
        }

        let path = PathBuf::from(&component.config_path);
        if !path.exists() || !path.is_file() {
            continue;
        }

        let normalized = normalize_path_string(&component.config_path);
        if seen.insert(normalized) {
            config_paths.push(path);
        }
    }

    if config_paths.is_empty() {
        return Ok(Vec::new());
    }

    let backup_dir = global_cleanup_backup_dir(run_id);
    fs::create_dir_all(&backup_dir)
        .map_err(|error| format!("无法创建全局清理备份目录: {}", error))?;

    let mut results = Vec::new();
    for (index, source_path) in config_paths.into_iter().enumerate() {
        let mut backup_path = backup_dir.join(format!(
            "{:03}-{}",
            index + 1,
            safe_backup_file_label(&source_path)
        ));
        if backup_path.exists() {
            backup_path = backup_dir.join(format!(
                "{:03}-{}-{}",
                index + 1,
                safe_backup_file_label(&source_path),
                uuid::Uuid::new_v4()
            ));
        }

        fs::copy(&source_path, &backup_path).map_err(|error| {
            format!("无法备份配置 {}: {}", source_path.to_string_lossy(), error)
        })?;

        results.push((
            source_path.to_string_lossy().to_string(),
            backup_path.to_string_lossy().to_string(),
        ));
    }

    Ok(results)
}

fn format_package_spec(package_name: &str, version: Option<&str>) -> String {
    match version.map(str::trim).filter(|value| !value.is_empty()) {
        Some(version) => format!("{package_name}@{version}"),
        None => package_name.to_string(),
    }
}

fn split_package_spec(package_spec: &str) -> (String, Option<String>) {
    if package_spec.is_empty() {
        return (String::new(), None);
    }

    if let Some(stripped) = package_spec.strip_prefix('@') {
        if let Some(version_index) = stripped.rfind('@') {
            let split_at = version_index + 1;
            let package_name = &package_spec[..split_at];
            let version = &package_spec[split_at + 1..];
            if !version.is_empty() {
                return (package_name.to_string(), Some(version.to_string()));
            }
        }
        return (package_spec.to_string(), None);
    }

    if let Some((package_name, version)) = package_spec.rsplit_once('@') {
        if !package_name.is_empty() && !version.is_empty() {
            return (package_name.to_string(), Some(version.to_string()));
        }
    }

    (package_spec.to_string(), None)
}

fn extract_npm_package_from_command(
    command: &str,
    args: &[String],
) -> Option<(String, Option<String>)> {
    let command_name = command.to_lowercase();
    if !command_name.ends_with("npx") && !command_name.ends_with("npx.cmd") {
        return None;
    }

    let package_spec = args.iter().find(|arg| !arg.starts_with('-'))?;
    let (package_name, version) = split_package_spec(package_spec);
    if package_name.is_empty() {
        return None;
    }

    Some((package_name, version))
}

fn is_continue_mcp_server_file(path: &Path) -> bool {
    path.parent()
        .and_then(|value| value.file_name())
        .and_then(|value| value.to_str())
        == Some("mcpServers")
        && matches!(
            path.extension().and_then(|value| value.to_str()),
            Some("yaml" | "yml" | "json")
        )
}

fn is_yaml_config_path(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|value| value.to_str()),
        Some("yaml" | "yml")
    )
}

fn is_zed_settings_path(path: &Path) -> bool {
    let lowered = normalize_path(path);
    lowered.ends_with("zed/settings.json") || lowered.contains("/zed/settings.json")
}

fn parse_semver(version: &str) -> Option<Version> {
    let normalized = version.trim().trim_start_matches('v');
    Version::parse(normalized).ok()
}

async fn resolve_latest_npm_version(package_name: &str) -> Result<String, String> {
    let encoded = urlencoding::encode(package_name);
    let url = format!("https://registry.npmjs.org/{encoded}/latest");
    let response = reqwest::get(&url)
        .await
        .map_err(|error| format!("Failed to query npm registry: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("npm registry returned {}", response.status()));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|error| format!("Failed to parse npm registry response: {error}"))?;

    payload
        .get("version")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or_else(|| format!("npm registry did not return a version for {package_name}"))
}

// ---------------------------------------------------------------------------
// Platform MCP config helpers
// ---------------------------------------------------------------------------

fn get_mcp_config_for_platform_in_home(home: &Path, platform: &str) -> Option<PathBuf> {
    match platform {
        "cursor" => {
            let p = home.join(".cursor").join("mcp.json");
            Some(p)
        }
        "kiro" => Some(home.join(".kiro").join("settings").join("mcp.json")),
        "claude_desktop" => {
            #[cfg(target_os = "macos")]
            {
                let p = home
                    .join("Library")
                    .join("Application Support")
                    .join("Claude")
                    .join("claude_desktop_config.json");
                Some(p)
            }
            #[cfg(target_os = "windows")]
            {
                let appdata = std::env::var("APPDATA").ok()?;
                let p = PathBuf::from(appdata)
                    .join("Claude")
                    .join("claude_desktop_config.json");
                Some(p)
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            {
                let p = home
                    .join(".config")
                    .join("claude")
                    .join("claude_desktop_config.json");
                Some(p)
            }
        }
        "vscode" => {
            #[cfg(target_os = "macos")]
            {
                let p = home
                    .join("Library")
                    .join("Application Support")
                    .join("Code")
                    .join("User")
                    .join("mcp.json");
                Some(p)
            }
            #[cfg(target_os = "windows")]
            {
                let appdata = std::env::var("APPDATA").ok()?;
                let p = PathBuf::from(appdata)
                    .join("Code")
                    .join("User")
                    .join("mcp.json");
                Some(p)
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            {
                let p = home
                    .join(".config")
                    .join("Code")
                    .join("User")
                    .join("mcp.json");
                Some(p)
            }
        }
        "windsurf" => {
            let p = home.join(".windsurf").join("mcp.json");
            Some(p)
        }
        "codex" => Some(home.join(".codex").join("config.toml")),
        "qwen_code" => Some(home.join(".qwen").join("settings.json")),
        "kimi_cli" => Some(home.join(".kimi").join("mcp.json")),
        "codebuddy" => {
            let preferred = [
                home.join(".codebuddy").join(".mcp.json"),
                home.join(".codebuddy").join("mcp.json"),
                home.join(".codebuddy.json"),
            ];
            preferred
                .iter()
                .find(|candidate| candidate.exists())
                .cloned()
                .or_else(|| preferred.first().cloned())
        }
        "gemini_cli" => {
            #[cfg(target_os = "windows")]
            {
                Some(home.join(".gemini").join("settings.json"))
            }
            #[cfg(not(target_os = "windows"))]
            {
                let local = home.join(".gemini").join("settings.json");
                if local.exists() {
                    Some(local)
                } else {
                    Some(home.join(".config").join("gemini").join("settings.json"))
                }
            }
        }
        "claude_code" => Some(home.join(".claude.json")),
        "antigravity" => Some(
            home.join(".gemini")
                .join("antigravity")
                .join("mcp_config.json"),
        ),
        "trae" => {
            #[cfg(target_os = "macos")]
            {
                let app_support = home
                    .join("Library")
                    .join("Application Support")
                    .join("Trae")
                    .join("User")
                    .join("settings.json");
                let local = home.join(".trae").join("mcp.json");
                if local.exists() {
                    Some(local)
                } else {
                    Some(app_support)
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                Some(home.join(".trae").join("mcp.json"))
            }
        }
        "openclaw" => {
            #[cfg(target_os = "macos")]
            {
                Some(
                    home.join("Library")
                        .join("Application Support")
                        .join("OpenClaw")
                        .join("config.json"),
                )
            }
            #[cfg(target_os = "windows")]
            {
                let appdata = std::env::var("APPDATA").ok()?;
                Some(PathBuf::from(appdata).join("openclaw").join("config.json"))
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            {
                Some(home.join(".config").join("openclaw").join("config.json"))
            }
        }
        "continue_dev" => Some(home.join(".continue").join("config.yaml")),
        "zed" => {
            #[cfg(target_os = "windows")]
            {
                let appdata = std::env::var("APPDATA").ok()?;
                Some(PathBuf::from(appdata).join("Zed").join("settings.json"))
            }
            #[cfg(not(target_os = "windows"))]
            {
                Some(home.join(".config").join("zed").join("settings.json"))
            }
        }
        _ => None,
    }
}

pub(crate) fn get_mcp_config_for_platform(platform: &str) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    get_mcp_config_for_platform_in_home(&home, platform)
}

fn install_target_paths_for_platforms(platforms: &[String]) -> Vec<InstallTargetPath> {
    let mut targets = Vec::new();
    for platform in platforms {
        let Some(config_path) = get_mcp_config_for_platform(platform) else {
            continue;
        };
        targets.push(InstallTargetPath {
            platform: platform.clone(),
            exists: config_path.exists(),
            config_path: config_path.to_string_lossy().to_string(),
        });
    }

    targets.sort_by(|left, right| left.platform.cmp(&right.platform));
    targets.dedup_by(|left, right| left.platform == right.platform);
    targets
}

fn install_approval_targets(platforms: &[String]) -> Vec<String> {
    let mut targets: Vec<String> = install_target_paths_for_platforms(platforms)
        .into_iter()
        .map(|target| target.config_path)
        .collect();
    if targets.is_empty() {
        targets = platforms.to_vec();
        targets.sort();
        targets.dedup();
    }
    targets
}

fn capability_allows_one_click(capability: &ManagementCapability) -> bool {
    matches!(capability, ManagementCapability::OneClick)
}

fn capability_block_message(capability: &ManagementCapability, platform: &str) -> String {
    match capability {
        ManagementCapability::Manual => {
            format!("{platform}: 当前宿主仅支持手动治理，暂不支持一键写入")
        }
        ManagementCapability::DetectOnly => {
            format!("{platform}: 当前宿主仅支持检测，无法执行自动写入")
        }
        ManagementCapability::OneClick => format!("{platform}: capability ok"),
    }
}

async fn detected_platform_capabilities() -> std::collections::HashMap<String, ManagementCapability>
{
    detect_ai_tools()
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|tool| (tool.id, tool.management_capability))
        .collect()
}

#[tauri::command]
pub async fn resolve_install_target_paths(
    platforms: Vec<String>,
) -> Result<Vec<InstallTargetPath>, String> {
    Ok(install_target_paths_for_platforms(&platforms))
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create config directory: {error}"))?;
    }
    Ok(())
}

fn server_name_in_value(value: &Value) -> Option<&str> {
    value
        .get("name")
        .and_then(Value::as_str)
        .or_else(|| value.get("id").and_then(Value::as_str))
}

fn remove_server_from_json_container(container: &mut Value, server_id: &str) -> usize {
    if let Some(map) = container.as_object_mut() {
        return usize::from(map.remove(server_id).is_some());
    }

    if let Some(items) = container.as_array_mut() {
        let before = items.len();
        items.retain(|item| server_name_in_value(item) != Some(server_id));
        return before.saturating_sub(items.len());
    }

    0
}

fn remove_server_from_json_value(value: &mut Value, server_id: &str) -> usize {
    let mut removed = 0;

    if let Some(map) = value.as_object_mut() {
        for key in ["mcpServers", "mcp_servers", "servers", "context_servers"] {
            if let Some(inner) = map.get_mut(key) {
                removed += remove_server_from_json_container(inner, server_id);
            }
        }

        if let Some(mcp) = map.get_mut("mcp").and_then(Value::as_object_mut) {
            if let Some(inner) = mcp.get_mut("servers") {
                removed += remove_server_from_json_container(inner, server_id);
            }
        }

        if let Some(projects) = map.get_mut("projects").and_then(Value::as_object_mut) {
            for (_, project_value) in projects.iter_mut() {
                removed += remove_server_from_json_value(project_value, server_id);
            }
        }
    }

    removed
}

fn upsert_server_into_object(
    container: &mut serde_json::Map<String, Value>,
    server_id: &str,
    server_entry: &Value,
) {
    container.insert(server_id.to_string(), server_entry.clone());
}

fn upsert_server_into_array(items: &mut Vec<Value>, server_id: &str, server_entry: &Value) {
    let mut next_entry = server_entry.clone();
    if next_entry.get("name").is_none() {
        if let Some(map) = next_entry.as_object_mut() {
            map.insert("name".to_string(), Value::String(server_id.to_string()));
        }
    }

    if let Some(index) = items
        .iter()
        .position(|item| server_name_in_value(item) == Some(server_id))
    {
        items[index] = next_entry;
    } else {
        items.push(next_entry);
    }
}

fn ensure_json_server_container<'a>(value: &'a mut Value, path: &Path) -> &'a mut Value {
    if !value.is_object() {
        *value = Value::Object(serde_json::Map::new());
    }

    if is_zed_settings_path(path) {
        let root = value.as_object_mut().expect("json object");
        if !root
            .get("context_servers")
            .map(Value::is_object)
            .unwrap_or(false)
        {
            root.insert(
                "context_servers".to_string(),
                Value::Object(serde_json::Map::new()),
            );
        }
        return root.get_mut("context_servers").expect("context_servers");
    }

    if value
        .get("mcpServers")
        .map(|inner| inner.is_object() || inner.is_array())
        .unwrap_or(false)
    {
        return value.get_mut("mcpServers").expect("mcpServers");
    }

    if value
        .get("mcp_servers")
        .map(|inner| inner.is_object() || inner.is_array())
        .unwrap_or(false)
    {
        return value.get_mut("mcp_servers").expect("mcp_servers");
    }

    if value
        .get("servers")
        .map(|inner| inner.is_object() || inner.is_array())
        .unwrap_or(false)
    {
        return value.get_mut("servers").expect("servers");
    }

    if value
        .get("context_servers")
        .map(|inner| inner.is_object() || inner.is_array())
        .unwrap_or(false)
    {
        return value.get_mut("context_servers").expect("context_servers");
    }

    if value
        .get("mcp")
        .and_then(|inner| inner.get("servers"))
        .map(|inner| inner.is_object() || inner.is_array())
        .unwrap_or(false)
    {
        return value
            .get_mut("mcp")
            .and_then(Value::as_object_mut)
            .and_then(|mcp| mcp.get_mut("servers"))
            .expect("mcp.servers");
    }

    let root = value.as_object_mut().expect("json object");
    if path.file_name().and_then(|value| value.to_str()) == Some("settings.json") {
        if !root.get("mcp").map(Value::is_object).unwrap_or(false) {
            root.insert("mcp".to_string(), Value::Object(serde_json::Map::new()));
        }
        let mcp = root
            .get_mut("mcp")
            .and_then(Value::as_object_mut)
            .expect("mcp settings object");
        if !mcp.get("servers").map(Value::is_object).unwrap_or(false) {
            mcp.insert("servers".to_string(), Value::Object(serde_json::Map::new()));
        }
        return mcp.get_mut("servers").expect("new mcp.servers");
    }

    root.insert(
        "mcpServers".to_string(),
        Value::Object(serde_json::Map::new()),
    );
    root.get_mut("mcpServers").expect("new mcpServers")
}

fn upsert_server_into_json_value(
    value: &mut Value,
    path: &Path,
    server_id: &str,
    server_entry: &Value,
) {
    let container = ensure_json_server_container(value, path);
    if let Some(map) = container.as_object_mut() {
        upsert_server_into_object(map, server_id, server_entry);
    } else if let Some(items) = container.as_array_mut() {
        upsert_server_into_array(items, server_id, server_entry);
    } else {
        *container = Value::Object(serde_json::Map::new());
        if let Some(map) = container.as_object_mut() {
            upsert_server_into_object(map, server_id, server_entry);
        }
    }
}

fn read_json_config(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(Value::Object(serde_json::Map::new()));
    }

    let content =
        fs::read_to_string(path).map_err(|error| format!("Failed to read config file: {error}"))?;
    if content.trim().is_empty() {
        return Ok(Value::Object(serde_json::Map::new()));
    }

    let normalized = content.trim_start_matches('\u{feff}');
    serde_json::from_str(normalized)
        .map_err(|error| format!("Failed to parse JSON config: {error}"))
}

fn write_json_config(path: &Path, value: &Value) -> Result<(), String> {
    ensure_parent_dir(path)?;
    let content = serde_json::to_string_pretty(value)
        .map_err(|error| format!("Failed to serialize JSON config: {error}"))?;
    fs::write(path, content).map_err(|error| format!("Failed to write config file: {error}"))
}

fn read_yaml_as_json(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(Value::Object(serde_json::Map::new()));
    }

    let content =
        fs::read_to_string(path).map_err(|error| format!("Failed to read YAML config: {error}"))?;
    if content.trim().is_empty() {
        return Ok(Value::Object(serde_json::Map::new()));
    }

    let yaml_value: serde_yaml::Value = serde_yaml::from_str(&content)
        .map_err(|error| format!("Failed to parse YAML config: {error}"))?;
    serde_json::to_value(yaml_value)
        .map_err(|error| format!("Failed to convert YAML config: {error}"))
}

fn write_json_as_yaml(path: &Path, value: &Value) -> Result<(), String> {
    ensure_parent_dir(path)?;
    let yaml_value: serde_yaml::Value = serde_json::from_value(value.clone())
        .map_err(|error| format!("Failed to convert config to YAML: {error}"))?;
    let content = serde_yaml::to_string(&yaml_value)
        .map_err(|error| format!("Failed to serialize YAML config: {error}"))?;
    fs::write(path, content).map_err(|error| format!("Failed to write YAML config: {error}"))
}

fn read_toml_config(path: &Path) -> Result<toml::Value, String> {
    if !path.exists() {
        return Ok(toml::Value::Table(toml::map::Map::new()));
    }

    let content =
        fs::read_to_string(path).map_err(|error| format!("Failed to read TOML config: {error}"))?;
    if content.trim().is_empty() {
        return Ok(toml::Value::Table(toml::map::Map::new()));
    }

    let table: toml::Table = content
        .parse()
        .map_err(|error| format!("Failed to parse TOML config: {error}"))?;
    Ok(toml::Value::Table(table))
}

fn write_toml_config(path: &Path, value: &toml::Value) -> Result<(), String> {
    ensure_parent_dir(path)?;
    let content = toml::to_string_pretty(value)
        .map_err(|error| format!("Failed to serialize TOML config: {error}"))?;
    fs::write(path, content).map_err(|error| format!("Failed to write TOML config: {error}"))
}

fn build_npm_server_entry(package_spec: &str) -> Value {
    let npm_launcher = if cfg!(windows) { "npx.cmd" } else { "npx" };
    serde_json::json!({
        "command": npm_launcher,
        "args": ["-y", package_spec]
    })
}

fn build_remote_server_entry(remote_url: &str) -> Value {
    serde_json::json!({
        "url": remote_url
    })
}

fn build_remote_auth_server_entry(remote_url: &str, auth_headers: &[String]) -> Value {
    let mut entry = serde_json::Map::new();
    entry.insert("url".to_string(), Value::String(remote_url.to_string()));

    let mut headers = serde_json::Map::new();
    for header_name in auth_headers.iter().map(|header| header.trim()) {
        if header_name.is_empty() {
            continue;
        }

        headers.insert(
            header_name.to_string(),
            Value::String("REPLACE_WITH_REAL_SECRET".to_string()),
        );
    }
    if !headers.is_empty() {
        entry.insert("headers".to_string(), Value::Object(headers));
    }

    Value::Object(entry)
}

fn write_server_to_config_path(
    server_id: &str,
    config_path: &Path,
    server_entry: Value,
) -> Result<(), String> {
    if is_continue_mcp_server_file(config_path) {
        let mut value = server_entry;
        if value.get("name").is_none() {
            if let Some(map) = value.as_object_mut() {
                map.insert("name".to_string(), Value::String(server_id.to_string()));
            }
        }

        if is_yaml_config_path(config_path) {
            return write_json_as_yaml(config_path, &value);
        }
        return write_json_config(config_path, &value);
    }

    if config_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("toml"))
        .unwrap_or(false)
    {
        let mut document = read_toml_config(config_path)?;
        if !matches!(document, toml::Value::Table(_)) {
            document = toml::Value::Table(toml::map::Map::new());
        }

        let root = document.as_table_mut().expect("toml root table");
        if !root
            .get("mcp_servers")
            .map(|value| value.is_table())
            .unwrap_or(false)
        {
            root.insert(
                "mcp_servers".to_string(),
                toml::Value::Table(toml::map::Map::new()),
            );
        }

        let mut server_table = toml::map::Map::new();
        if let Some(command) = server_entry.get("command").and_then(Value::as_str) {
            server_table.insert(
                "command".to_string(),
                toml::Value::String(command.to_string()),
            );
        }
        if let Some(url) = server_entry.get("url").and_then(Value::as_str) {
            server_table.insert("url".to_string(), toml::Value::String(url.to_string()));
        }
        if let Some(args) = server_entry.get("args").and_then(Value::as_array) {
            server_table.insert(
                "args".to_string(),
                toml::Value::Array(
                    args.iter()
                        .filter_map(|value| {
                            value
                                .as_str()
                                .map(|value| toml::Value::String(value.to_string()))
                        })
                        .collect(),
                ),
            );
        }
        if let Some(headers) = server_entry.get("headers").and_then(Value::as_object) {
            let mut header_table = toml::map::Map::new();
            for (key, value) in headers {
                if let Some(text) = value.as_str() {
                    header_table.insert(key.to_string(), toml::Value::String(text.to_string()));
                }
            }
            if !header_table.is_empty() {
                server_table.insert("headers".to_string(), toml::Value::Table(header_table));
            }
        }
        if let Some(env) = server_entry.get("env").and_then(Value::as_object) {
            let mut env_table = toml::map::Map::new();
            for (key, value) in env {
                if let Some(text) = value.as_str() {
                    env_table.insert(key.to_string(), toml::Value::String(text.to_string()));
                }
            }
            if !env_table.is_empty() {
                server_table.insert("env".to_string(), toml::Value::Table(env_table));
            }
        }

        root.get_mut("mcp_servers")
            .and_then(toml::Value::as_table_mut)
            .expect("mcp_servers table")
            .insert(server_id.to_string(), toml::Value::Table(server_table));
        return write_toml_config(config_path, &document);
    }

    if is_yaml_config_path(config_path) {
        let mut config = read_yaml_as_json(config_path)?;
        upsert_server_into_json_value(&mut config, config_path, server_id, &server_entry);
        return write_json_as_yaml(config_path, &config);
    }

    let mut config = read_json_config(config_path)?;
    upsert_server_into_json_value(&mut config, config_path, server_id, &server_entry);
    write_json_config(config_path, &config)
}

fn write_server_to_platform(
    server_id: &str,
    platform: &str,
    server_entry: Value,
) -> Result<(), String> {
    let config_path = get_mcp_config_for_platform(platform)
        .ok_or_else(|| format!("Unknown platform: {platform}"))?;
    write_server_to_config_path(server_id, &config_path, server_entry)
}

fn add_server_to_platform_by_item(
    item: &StoreCatalogItem,
    platform: &str,
    server_entry: Value,
) -> Result<(), String> {
    write_server_to_platform(&item.id, platform, server_entry)
}

pub(crate) fn remove_server_from_config_path(
    item_id: &str,
    config_path: &PathBuf,
) -> Result<bool, String> {
    if !config_path.exists() {
        return Ok(false);
    }

    if is_continue_mcp_server_file(config_path) {
        let value = if is_yaml_config_path(config_path) {
            read_yaml_as_json(config_path)?
        } else {
            read_json_config(config_path)?
        };
        let same_server = server_name_in_value(&value) == Some(item_id)
            || config_path.file_stem().and_then(|value| value.to_str()) == Some(item_id);
        if same_server {
            fs::remove_file(config_path)
                .map_err(|error| format!("Failed to remove MCP config file: {error}"))?;
            return Ok(true);
        }
        return Ok(false);
    }

    if config_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("toml"))
        .unwrap_or(false)
    {
        let mut document = read_toml_config(config_path)?;
        let removed = document
            .get_mut("mcp_servers")
            .and_then(toml::Value::as_table_mut)
            .map(|table| usize::from(table.remove(item_id).is_some()))
            .unwrap_or(0);
        if removed > 0 {
            write_toml_config(config_path, &document)?;
        }
        return Ok(removed > 0);
    }

    if is_yaml_config_path(config_path) {
        let mut config = read_yaml_as_json(config_path)?;
        let removed = remove_server_from_json_value(&mut config, item_id);
        if removed > 0 {
            write_json_as_yaml(config_path, &config)?;
        }
        return Ok(removed > 0);
    }

    let mut config = read_json_config(config_path)?;
    let removed = remove_server_from_json_value(&mut config, item_id);
    if removed > 0 {
        write_json_config(config_path, &config)?;
    }
    Ok(removed > 0)
}

fn remove_skill_root(skill_path: &PathBuf) -> Result<(), String> {
    if !skill_path.exists() {
        return Ok(());
    }

    if skill_path.is_symlink() || skill_path.is_file() {
        fs::remove_file(skill_path).map_err(|error| {
            format!(
                "Failed to remove skill link {}: {error}",
                skill_path.to_string_lossy()
            )
        })?;
    } else {
        fs::remove_dir_all(skill_path).map_err(|error| {
            format!(
                "Failed to remove skill directory {}: {error}",
                skill_path.to_string_lossy()
            )
        })?;
    }

    Ok(())
}

fn skill_path_allows_auto_cleanup(skill_path: &Path) -> bool {
    if skill_path.as_os_str().is_empty() {
        return false;
    }
    if skill_path
        .components()
        .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return false;
    }

    let normalized = normalize_path(skill_path);
    if normalized.is_empty() || normalized == "/" || normalized.ends_with("/skills") {
        return false;
    }

    normalized.contains("/skills/")
}

// ---------------------------------------------------------------------------
// Helper: find item in current catalog (in-memory or loaded)
// ---------------------------------------------------------------------------

fn find_item_in_catalog(catalog: &[StoreCatalogItem], item_id: &str) -> Option<StoreCatalogItem> {
    catalog.iter().find(|i| i.id == item_id).cloned()
}

fn make_update_result(
    item_id: String,
    platform: String,
    source_path: String,
    current_version: String,
    new_version: String,
    tracked: bool,
    reason: String,
) -> UpdateResult {
    let has_update = tracked
        && parse_semver(&current_version)
            .zip(parse_semver(&new_version))
            .map(|(current, latest)| latest > current)
            .unwrap_or(false);

    UpdateResult {
        item_id,
        platform,
        source_path,
        current_version,
        new_version,
        has_update,
        tracked,
        reason,
    }
}

async fn check_managed_item_update(
    item: &InstalledItem,
    latest_catalog: &[StoreCatalogItem],
) -> UpdateResult {
    let (tracked, new_version, reason) = match item.install_strategy.as_str() {
        STRATEGY_BUILTIN_NPM | STRATEGY_REGISTRY_NPM => {
            let (package_name, current_version) = split_package_spec(&item.install_identifier);
            if package_name.is_empty() {
                (
                    false,
                    item.version.clone(),
                    "未记录可验证的安装包信息".to_string(),
                )
            } else if current_version.is_none() {
                (
                    false,
                    item.version.clone(),
                    "当前配置使用浮动版本，下一次启动时会自动获取上游最新版本".to_string(),
                )
            } else {
                match resolve_latest_npm_version(&package_name).await {
                    Ok(latest_version) => (true, latest_version, String::new()),
                    Err(error) => (
                        false,
                        item.version.clone(),
                        format!("无法连接 npm 注册表：{error}"),
                    ),
                }
            }
        }
        STRATEGY_REGISTRY_REMOTE => {
            let latest_item = latest_catalog.iter().find(|catalog_item| {
                catalog_item.registry_name == item.registry_name || catalog_item.id == item.id
            });

            match latest_item {
                Some(catalog_item) if !catalog_item.install_version.is_empty() => {
                    (true, catalog_item.install_version.clone(), String::new())
                }
                Some(_) => (
                    false,
                    item.version.clone(),
                    "注册表未提供可比较的版本号".to_string(),
                ),
                None => (
                    false,
                    item.version.clone(),
                    "未在注册表中找到该远端服务的最新版本元数据".to_string(),
                ),
            }
        }
        STRATEGY_REGISTRY_REMOTE_AUTH => (
            false,
            item.version.clone(),
            "该远端服务包含认证头（密钥）配置。为避免覆盖你的凭据，已禁用自动升级。".to_string(),
        ),
        _ => (
            false,
            item.version.clone(),
            "该组件未纳入 AgentShield 的版本跟踪范围".to_string(),
        ),
    };

    make_update_result(
        item.id.clone(),
        item.platform.clone(),
        item.source_url.clone(),
        item.version.clone(),
        new_version,
        tracked,
        reason,
    )
}

async fn check_detected_item_update(
    server: &crate::commands::scan::InstalledMcpServer,
) -> UpdateResult {
    if server.command == "skill" {
        return make_update_result(
            server.name.clone(),
            server.platform_id.clone(),
            server.config_path.clone(),
            "unknown".to_string(),
            "unknown".to_string(),
            false,
            "Skill 目录当前只支持扫描、隔离和卸载，不支持自动升级".to_string(),
        );
    }

    if let Some((package_name, current_version)) =
        extract_npm_package_from_command(&server.command, &server.args)
    {
        if let Some(current_version) = current_version {
            return match resolve_latest_npm_version(&package_name).await {
                Ok(latest_version) => make_update_result(
                    server.name.clone(),
                    server.platform_id.clone(),
                    server.config_path.clone(),
                    current_version,
                    latest_version,
                    true,
                    String::new(),
                ),
                Err(error) => make_update_result(
                    server.name.clone(),
                    server.platform_id.clone(),
                    server.config_path.clone(),
                    "unknown".to_string(),
                    "unknown".to_string(),
                    false,
                    format!("无法连接 npm 注册表：{error}"),
                ),
            };
        }

        return make_update_result(
            server.name.clone(),
            server.platform_id.clone(),
            server.config_path.clone(),
            "unknown".to_string(),
            "unknown".to_string(),
            false,
            "当前配置使用浮动版本，AgentShield 无法确认是否需要升级".to_string(),
        );
    }

    make_update_result(
        server.name.clone(),
        server.platform_id.clone(),
        server.config_path.clone(),
        "unknown".to_string(),
        "unknown".to_string(),
        false,
        "该组件未纳入 AgentShield 的自动升级范围".to_string(),
    )
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_store_catalog() -> Result<Vec<StoreCatalogItem>, String> {
    // Check in-memory cache first
    {
        let lock = CATALOG_CACHE
            .lock()
            .map_err(|e| format!("Lock error: {e}"))?;
        if let Some(ref cached) = *lock {
            return Ok(cached.clone());
        }
    }

    let items = load_catalog().await;

    // Store in memory
    {
        let mut lock = CATALOG_CACHE
            .lock()
            .map_err(|e| format!("Lock error: {e}"))?;
        *lock = Some(items.clone());
    }

    Ok(items)
}

#[tauri::command]
pub async fn refresh_catalog() -> Result<Vec<StoreCatalogItem>, String> {
    // Always start with built-in catalog
    let mut items = builtin_catalog();
    let builtin_ids: std::collections::HashSet<String> =
        items.iter().map(|i| i.id.clone()).collect();

    // Force re-fetch from remote, bypassing caches
    match fetch_remote_catalog().await {
        Ok(remote_items) if !remote_items.is_empty() => {
            let _ = save_catalog_cache(&remote_items);
            for r in remote_items {
                if !builtin_ids.contains(&r.id) && !r.name.is_empty() {
                    items.push(r);
                }
            }
        }
        Ok(_) => {
            eprintln!("Registry returned empty catalog on refresh");
        }
        Err(e) => {
            eprintln!("Remote fetch failed on refresh: {e}");
        }
    }

    // Update in-memory cache
    {
        let mut lock = CATALOG_CACHE
            .lock()
            .map_err(|e| format!("Lock error: {e}"))?;
        *lock = Some(items.clone());
    }

    Ok(items)
}

#[tauri::command]
pub async fn search_store(query: String) -> Result<Vec<StoreCatalogItem>, String> {
    let catalog = get_store_catalog().await?;
    let q = query.to_lowercase();
    let results: Vec<StoreCatalogItem> = catalog
        .iter()
        .filter(|e| {
            e.name.to_lowercase().contains(&q)
                || e.description.to_lowercase().contains(&q)
                || e.id.to_lowercase().contains(&q)
        })
        .cloned()
        .collect();
    Ok(results)
}

#[tauri::command]
pub async fn list_installed_items() -> Result<Vec<InstalledItem>, String> {
    Ok(load_installed_items().items)
}

#[tauri::command]
pub async fn install_store_item(
    app: tauri::AppHandle,
    item_id: String,
    platforms: Vec<String>,
    approval_ticket: Option<String>,
) -> Result<InstallResult, String> {
    require_one_click_automation("安装").await?;
    let catalog = get_store_catalog().await?;

    // Try to find in loaded catalog first, then in fallback
    let item = find_item_in_catalog(&catalog, &item_id)
        .or_else(|| find_builtin_entry(&item_id).map(builtin_item))
        .ok_or_else(|| format!("Item not found: {item_id}"))?;

    if platforms.is_empty() {
        return Ok(InstallResult {
            success: false,
            message: "请选择至少一个安装目标".to_string(),
            installed_platforms: vec![],
            errors: vec!["No compatible platform selected".to_string()],
        });
    }

    if !item.installable {
        return Ok(InstallResult {
            success: false,
            message: "该条目没有可验证的一键安装配方，已禁止自动安装".to_string(),
            installed_platforms: vec![],
            errors: vec![format!(
                "Unsupported install strategy: {}",
                item.install_strategy
            )],
        });
    }

    let approval_targets = install_approval_targets(&platforms);
    runtime_guard::require_action_approval_ticket(
        approval_ticket.as_deref(),
        &format!("agentshield:store:{item_id}"),
        "component_install",
        &approval_targets,
        "user_requested_install",
    )?;

    let (install_strategy, install_identifier, version, server_entry) =
        match item.install_strategy.as_str() {
            STRATEGY_BUILTIN_NPM => {
                let package_name = item.install_identifier.clone();
                let latest_version = resolve_latest_npm_version(&package_name).await?;
                let package_spec = format_package_spec(&package_name, Some(&latest_version));
                (
                    STRATEGY_BUILTIN_NPM.to_string(),
                    package_spec.clone(),
                    latest_version,
                    build_npm_server_entry(&package_spec),
                )
            }
            STRATEGY_REGISTRY_NPM => {
                let package_name = item.install_identifier.clone();
                let pinned_version = if !item.install_version.trim().is_empty() {
                    item.install_version.clone()
                } else {
                    resolve_latest_npm_version(&package_name).await?
                };
                let package_spec = format_package_spec(&package_name, Some(&pinned_version));
                (
                    STRATEGY_REGISTRY_NPM.to_string(),
                    package_spec.clone(),
                    pinned_version,
                    build_npm_server_entry(&package_spec),
                )
            }
            STRATEGY_REGISTRY_REMOTE => {
                let remote_url = item.install_identifier.clone();
                (
                    STRATEGY_REGISTRY_REMOTE.to_string(),
                    remote_url.clone(),
                    item.install_version.clone(),
                    build_remote_server_entry(&remote_url),
                )
            }
            STRATEGY_REGISTRY_REMOTE_AUTH => {
                let remote_url = item.install_identifier.clone();
                let auth_headers = if item.auth_headers.is_empty() {
                    vec!["Authorization".to_string()]
                } else {
                    item.auth_headers.clone()
                };
                (
                    STRATEGY_REGISTRY_REMOTE_AUTH.to_string(),
                    remote_url.clone(),
                    item.install_version.clone(),
                    build_remote_auth_server_entry(&remote_url, &auth_headers),
                )
            }
            other => {
                return Ok(InstallResult {
                    success: false,
                    message: "该条目当前不支持真实安装".to_string(),
                    installed_platforms: vec![],
                    errors: vec![format!("Unsupported install strategy: {other}")],
                });
            }
        };

    let mut installed_platforms: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    let platform_capabilities = detected_platform_capabilities().await;

    for platform in &platforms {
        let Some(capability) = platform_capabilities.get(platform) else {
            errors.push(format!("{platform}: 未检测到可写入的宿主工具或有效配置"));
            continue;
        };
        if !capability_allows_one_click(capability) {
            errors.push(capability_block_message(capability, platform));
            continue;
        }
        match add_server_to_platform_by_item(&item, platform, server_entry.clone()) {
            Ok(()) => installed_platforms.push(platform.clone()),
            Err(e) => errors.push(format!("{platform}: {e}")),
        }
    }

    // Record in installed-items.json
    let mut store = load_installed_items();
    let now = chrono::Utc::now().to_rfc3339();

    for platform in &installed_platforms {
        store
            .items
            .retain(|i| !(i.id == item_id && i.platform == *platform));

        store.items.push(InstalledItem {
            id: item_id.clone(),
            name: item.name.clone(),
            version: version.clone(),
            platform: platform.clone(),
            installed_at: now.clone(),
            install_strategy: install_strategy.clone(),
            install_identifier: install_identifier.clone(),
            registry_name: item.registry_name.clone(),
            source_url: item.source_url.clone(),
        });
    }

    save_installed_items(&store)?;
    let _ = runtime_guard::sync_runtime_guard_components(app).await;

    if errors.is_empty() {
        Ok(InstallResult {
            success: true,
            message: format!(
                "Successfully installed {} on: {}",
                item.name,
                installed_platforms.join(", ")
            ),
            installed_platforms,
            errors,
        })
    } else if !installed_platforms.is_empty() {
        Ok(InstallResult {
            success: true,
            message: format!(
                "Partially installed {} (ok: {} | errors: {})",
                item.name,
                installed_platforms.join(", "),
                errors.join("; ")
            ),
            installed_platforms,
            errors,
        })
    } else {
        Ok(InstallResult {
            success: false,
            message: format!("Failed to install {}: {}", item.name, errors.join("; ")),
            installed_platforms,
            errors,
        })
    }
}

#[tauri::command]
pub async fn uninstall_item(
    app: tauri::AppHandle,
    item_id: String,
    platform: Option<String>,
    source_path: Option<String>,
    approval_ticket: Option<String>,
) -> Result<bool, String> {
    require_one_click_automation("卸载").await?;
    let platform_capabilities = detected_platform_capabilities().await;
    let platform_label = platform.clone().unwrap_or_else(|| "unknown".to_string());
    if let Some(platform_filter) = platform.as_deref() {
        if let Some(capability) = platform_capabilities.get(platform_filter) {
            if !capability_allows_one_click(capability) {
                return Err(capability_block_message(capability, platform_filter));
            }
        }
    }
    let action_targets = vec![source_path
        .clone()
        .unwrap_or_else(|| format!("{platform_label}:{item_id}"))];
    runtime_guard::require_action_approval_ticket(
        approval_ticket.as_deref(),
        &format!("agentshield:installed:{platform_label}:{item_id}"),
        "file_delete",
        &action_targets,
        "user_requested_uninstall",
    )?;
    let mut store = load_installed_items();
    let installed_mcps = crate::commands::scan::scan_installed_mcps()
        .await
        .unwrap_or_default();
    let platform_filter = platform.as_deref();

    if let Some(raw_path) = source_path.as_ref() {
        let skill_path = PathBuf::from(raw_path);
        let is_skill = installed_mcps.iter().any(|server| {
            server.name == item_id
                && server.command == "skill"
                && server.config_path == *raw_path
                && platform_filter
                    .map(|filter| server.platform_id == filter)
                    .unwrap_or(true)
        }) || item_id.ends_with(" (skill)");

        if is_skill && skill_path.exists() {
            remove_skill_root(&skill_path)?;
            store.items.retain(|item| {
                !(item.id == item_id
                    && platform_filter
                        .map(|filter| item.platform == filter)
                        .unwrap_or(true))
            });
            save_installed_items(&store)?;
            let _ = runtime_guard::sync_runtime_guard_components(app).await;
            return Ok(true);
        }
    }

    let mut config_paths: Vec<PathBuf> = installed_mcps
        .iter()
        .filter(|server| {
            server.name == item_id
                && platform_filter
                    .map(|filter| server.platform_id == filter)
                    .unwrap_or(true)
        })
        .map(|server| PathBuf::from(&server.config_path))
        .collect();

    let platforms: Vec<String> = store
        .items
        .iter()
        .filter(|item| {
            item.id == item_id
                && platform_filter
                    .map(|filter| item.platform == filter)
                    .unwrap_or(true)
        })
        .map(|item| item.platform.clone())
        .collect();

    for platform in &platforms {
        if let Some(config_path) = get_mcp_config_for_platform(platform) {
            config_paths.push(config_path);
        }
    }

    config_paths.sort();
    config_paths.dedup();

    if config_paths.is_empty() {
        return Err(match platform_filter {
            Some(filter) => format!("Item {} is not installed on {}", item_id, filter),
            None => format!("Item {} is not installed", item_id),
        });
    }

    let mut removed_any = false;
    for config_path in &config_paths {
        removed_any |= remove_server_from_config_path(&item_id, config_path)?;
    }

    if !removed_any {
        return Err(match platform_filter {
            Some(filter) => format!("未在 {} 的真实配置中找到 {}", filter, item_id),
            None => format!("未在真实配置中找到 {}", item_id),
        });
    }

    store.items.retain(|item| {
        !(item.id == item_id
            && platform_filter
                .map(|filter| item.platform == filter)
                .unwrap_or(true))
    });
    save_installed_items(&store)?;
    let _ = runtime_guard::sync_runtime_guard_components(app).await;

    Ok(true)
}

#[tauri::command]
pub async fn check_installed_updates() -> Result<Vec<UpdateResult>, String> {
    let store = load_installed_items();
    let latest_catalog = refresh_catalog().await.unwrap_or_else(|_| Vec::new());
    let mut results: Vec<UpdateResult> = Vec::new();

    for item in &store.items {
        results.push(check_managed_item_update(item, &latest_catalog).await);
    }

    let detected_items = crate::commands::scan::scan_installed_mcps()
        .await
        .unwrap_or_default();
    for server in &detected_items {
        let already_tracked = store
            .items
            .iter()
            .any(|item| item.id == server.name && item.platform == server.platform_id);
        if already_tracked {
            continue;
        }

        results.push(check_detected_item_update(server).await);
    }

    Ok(results)
}

#[tauri::command]
pub async fn update_installed_item(
    app: tauri::AppHandle,
    item_id: String,
    platform: Option<String>,
    source_path: Option<String>,
    approval_ticket: Option<String>,
) -> Result<bool, String> {
    require_one_click_automation("升级").await?;
    let platform_capabilities = detected_platform_capabilities().await;
    let platform_filter = platform.as_deref();
    if let Some(platform_filter) = platform_filter {
        if let Some(capability) = platform_capabilities.get(platform_filter) {
            if !capability_allows_one_click(capability) {
                return Err(capability_block_message(capability, platform_filter));
            }
        }
    }
    let managed_records: Vec<InstalledItem> = load_installed_items()
        .items
        .into_iter()
        .filter(|item| {
            item.id == item_id
                && platform_filter
                    .map(|filter| item.platform == filter)
                    .unwrap_or(true)
        })
        .collect();
    let action_targets = build_update_action_targets(
        &item_id,
        platform_filter,
        source_path.as_deref(),
        &managed_records,
    );
    runtime_guard::require_action_approval_ticket(
        approval_ticket.as_deref(),
        &format!(
            "agentshield:update:{}:{}",
            platform_filter.unwrap_or("any"),
            item_id
        ),
        "component_update",
        &action_targets,
        "user_requested_update",
    )?;
    update_installed_item_impl(app, item_id, platform, source_path).await
}

fn build_update_action_targets(
    item_id: &str,
    platform: Option<&str>,
    source_path: Option<&str>,
    managed_records: &[InstalledItem],
) -> Vec<String> {
    let mut targets: Vec<String> = managed_records
        .iter()
        .map(|item| {
            if item.source_url.trim().is_empty() {
                format!("{}:{}", item.platform, item.id)
            } else {
                item.source_url.clone()
            }
        })
        .collect();

    if targets.is_empty() {
        targets.push(
            source_path
                .filter(|value| !value.trim().is_empty())
                .map(ToString::to_string)
                .unwrap_or_else(|| format!("{}:{}", platform.unwrap_or("unknown"), item_id)),
        );
    }

    targets.sort();
    targets.dedup();
    targets
}

async fn update_installed_item_impl(
    app: tauri::AppHandle,
    item_id: String,
    platform: Option<String>,
    source_path: Option<String>,
) -> Result<bool, String> {
    let mut store = load_installed_items();
    let platform_filter = platform.as_deref();

    let managed_records: Vec<InstalledItem> = store
        .items
        .iter()
        .filter(|item| {
            item.id == item_id
                && platform_filter
                    .map(|filter| item.platform == filter)
                    .unwrap_or(true)
        })
        .cloned()
        .collect();

    if !managed_records.is_empty() {
        let tracked_item = managed_records
            .iter()
            .max_by(|left, right| left.installed_at.cmp(&right.installed_at))
            .cloned()
            .ok_or_else(|| format!("Item {} is not installed", item_id))?;

        let (new_version, new_identifier, server_entry) =
            match tracked_item.install_strategy.as_str() {
                STRATEGY_BUILTIN_NPM | STRATEGY_REGISTRY_NPM => {
                    let (package_name, current_version) =
                        split_package_spec(&tracked_item.install_identifier);
                    let current_version = current_version
                        .ok_or_else(|| "当前配置使用浮动版本，不需要显式升级".to_string())?;
                    let latest_version = resolve_latest_npm_version(&package_name).await?;
                    let current = parse_semver(&current_version)
                        .ok_or_else(|| format!("无法解析当前版本：{current_version}"))?;
                    let latest = parse_semver(&latest_version)
                        .ok_or_else(|| format!("无法解析最新版本：{latest_version}"))?;
                    if latest <= current {
                        return Ok(false);
                    }
                    let package_spec = format_package_spec(&package_name, Some(&latest_version));
                    (
                        latest_version,
                        package_spec.clone(),
                        build_npm_server_entry(&package_spec),
                    )
                }
                STRATEGY_REGISTRY_REMOTE => {
                    let latest_item = refresh_catalog()
                        .await?
                        .into_iter()
                        .find(|catalog_item| {
                            catalog_item.registry_name == tracked_item.registry_name
                                || catalog_item.id == item_id
                        })
                        .ok_or_else(|| "未找到远端服务的最新注册表信息".to_string())?;
                    if latest_item.install_version.is_empty()
                        || latest_item.install_identifier.is_empty()
                    {
                        return Err("注册表没有提供可升级的远端元数据".to_string());
                    }
                    if latest_item.install_version == tracked_item.version {
                        return Ok(false);
                    }
                    (
                        latest_item.install_version.clone(),
                        latest_item.install_identifier.clone(),
                        build_remote_server_entry(&latest_item.install_identifier),
                    )
                }
                STRATEGY_REGISTRY_REMOTE_AUTH => {
                    return Err(
                        "该远端服务包含认证头配置。为避免覆盖你已填写的密钥，暂不支持自动升级。"
                            .to_string(),
                    );
                }
                _ => {
                    return Err("该组件当前不支持自动升级".to_string());
                }
            };

        let platforms: Vec<String> = managed_records
            .iter()
            .map(|item| item.platform.clone())
            .collect();

        if platforms.is_empty() {
            return Err(format!("Item {} is not installed", item_id));
        }

        let catalog = get_store_catalog().await?;
        let catalog_item = find_item_in_catalog(&catalog, &item_id)
            .or_else(|| find_builtin_entry(&item_id).map(builtin_item));

        for platform in &platforms {
            if let Some(item) = catalog_item.as_ref() {
                add_server_to_platform_by_item(item, platform, server_entry.clone())?;
            } else if let Some(config_path) = get_mcp_config_for_platform(platform) {
                write_server_to_config_path(&item_id, &config_path, server_entry.clone())?;
            } else {
                return Err(format!("Unknown platform: {platform}"));
            }
        }

        let now = chrono::Utc::now().to_rfc3339();
        for item in store.items.iter_mut() {
            if item.id == item_id
                && platform_filter
                    .map(|filter| item.platform == filter)
                    .unwrap_or(true)
            {
                item.version = new_version.clone();
                item.install_identifier = new_identifier.clone();
                item.installed_at = now.clone();
            }
        }

        save_installed_items(&store)?;
        let _ = runtime_guard::sync_runtime_guard_components(app).await;
        return Ok(true);
    }

    let config_path = source_path.ok_or_else(|| "缺少待升级组件的真实配置路径".to_string())?;
    let server = crate::commands::scan::scan_installed_mcps()
        .await
        .unwrap_or_default()
        .into_iter()
        .find(|server| {
            server.name == item_id
                && server.config_path == config_path
                && platform_filter
                    .map(|filter| server.platform_id == filter)
                    .unwrap_or(true)
        })
        .ok_or_else(|| "未找到待升级组件的真实配置入口".to_string())?;

    if server.command == "skill" {
        return Err("Skill 目录当前不支持自动升级".to_string());
    }

    let (package_name, current_version) =
        extract_npm_package_from_command(&server.command, &server.args)
            .ok_or_else(|| "该组件当前不支持自动升级".to_string())?;
    let current_version =
        current_version.ok_or_else(|| "当前配置使用浮动版本，无法安全执行显式升级".to_string())?;
    let latest_version = resolve_latest_npm_version(&package_name).await?;
    let current = parse_semver(&current_version)
        .ok_or_else(|| format!("无法解析当前版本：{current_version}"))?;
    let latest = parse_semver(&latest_version)
        .ok_or_else(|| format!("无法解析最新版本：{latest_version}"))?;
    if latest <= current {
        return Ok(false);
    }

    let package_spec = format_package_spec(&package_name, Some(&latest_version));
    write_server_to_config_path(
        &server.name,
        &PathBuf::from(&server.config_path),
        build_npm_server_entry(&package_spec),
    )?;
    let _ = runtime_guard::sync_runtime_guard_components(app).await;

    Ok(true)
}

#[tauri::command]
pub async fn batch_update_items(
    app: tauri::AppHandle,
    item_ids: Vec<String>,
    approval_ticket: Option<String>,
) -> Result<u32, String> {
    require_one_click_automation("批量升级").await?;
    if item_ids.is_empty() {
        return Ok(0);
    }
    let action_targets = item_ids
        .iter()
        .map(|item_id| format!("managed:{item_id}"))
        .collect::<Vec<_>>();
    runtime_guard::require_action_approval_ticket(
        approval_ticket.as_deref(),
        "agentshield:update:batch",
        "component_update",
        &action_targets,
        "user_requested_batch_update",
    )?;

    let mut count: u32 = 0;
    for id in &item_ids {
        match update_installed_item_impl(app.clone(), id.clone(), None, None).await {
            Ok(true) => count += 1,
            Ok(false) => {}
            Err(e) => {
                eprintln!("batch_update_items: failed to update {}: {}", id, e);
            }
        }
    }
    Ok(count)
}

fn normalize_cleanup_scope(scope_platforms: Option<Vec<String>>) -> Vec<String> {
    let mut scope = scope_platforms
        .unwrap_or_default()
        .into_iter()
        .map(|platform| platform.trim().to_string())
        .filter(|platform| !platform.is_empty())
        .collect::<Vec<_>>();
    scope.sort();
    scope.dedup();
    scope
}

fn inferred_cleanup_capability(
    platform: &str,
    capabilities: &HashMap<String, ManagementCapability>,
) -> ManagementCapability {
    if let Some(capability) = capabilities.get(platform) {
        return capability.clone();
    }
    if platform.starts_with("unknown_ai_tool_") {
        ManagementCapability::Manual
    } else {
        ManagementCapability::OneClick
    }
}

fn extract_global_cleanup_dependency_tasks(
    server: &InstalledMcpServer,
    include_dependency_cleanup: bool,
) -> Vec<GlobalCleanupDependencyTask> {
    if !include_dependency_cleanup {
        return Vec::new();
    }

    let mut tasks = Vec::new();
    let mut seen = HashSet::new();

    if let Some((package_name, _)) = extract_npm_package_from_command(&server.command, &server.args)
    {
        if !package_name.trim().is_empty() && seen.insert(package_name.clone()) {
            tasks.push(GlobalCleanupDependencyTask {
                manager: GlobalCleanupDependencyManager::NpmGlobal,
                identifier: package_name.clone(),
                command_preview: format!("{} uninstall -g {}", npm_command(), package_name),
            });
        }
    }

    if let Some(package_name) = extract_pip_package_from_command(&server.command, &server.args) {
        if !package_name.trim().is_empty() && seen.insert(format!("pip:{package_name}")) {
            tasks.push(GlobalCleanupDependencyTask {
                manager: GlobalCleanupDependencyManager::PipPackage,
                identifier: package_name.clone(),
                command_preview: format!(
                    "{} -m pip uninstall -y {}",
                    pip_runtime_command().unwrap_or("python"),
                    package_name
                ),
            });
        }
    }

    if server.platform_id == "openclaw" {
        for package_name in ["openclaw", "openclaw-mcp", "@openclaw/cli"] {
            if seen.insert(package_name.to_string()) {
                tasks.push(GlobalCleanupDependencyTask {
                    manager: GlobalCleanupDependencyManager::NpmGlobal,
                    identifier: package_name.to_string(),
                    command_preview: format!("{} uninstall -g {}", npm_command(), package_name),
                });
            }
        }
    }

    tasks
}

fn normalized_command_basename(command: &str) -> String {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    Path::new(trimmed)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(trimmed)
        .to_ascii_lowercase()
}

fn normalize_pip_package_identifier(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let mut token = trimmed.to_string();
    for marker in ["==", ">=", "<=", "~=", "!=", ">", "<"] {
        if let Some((head, _)) = token.split_once(marker) {
            token = head.to_string();
            break;
        }
    }
    token = token
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string();
    token
}

fn extract_pip_package_from_command(command: &str, args: &[String]) -> Option<String> {
    let command_name = normalized_command_basename(command);
    if command_name.is_empty() {
        return None;
    }

    if matches!(
        command_name.as_str(),
        "python" | "python3" | "python.exe" | "python3.exe" | "py" | "py.exe"
    ) && args.len() >= 2
        && args.first().is_some_and(|arg| arg == "-m")
    {
        if args
            .get(1)
            .is_some_and(|module| module.eq_ignore_ascii_case("pip"))
        {
            if let Some(install_index) = args
                .iter()
                .position(|arg| arg.eq_ignore_ascii_case("install"))
            {
                let package = args
                    .iter()
                    .skip(install_index + 1)
                    .find(|arg| !arg.starts_with('-'))
                    .cloned()?;
                let normalized = normalize_pip_package_identifier(&package);
                if normalized.is_empty() {
                    return None;
                }
                return Some(normalized);
            }
            return None;
        }

        let module = args.get(1).cloned().unwrap_or_default();
        let normalized = normalize_pip_package_identifier(&module.replace('_', "-"));
        if normalized.is_empty() {
            return None;
        }
        return Some(normalized);
    }

    if matches!(
        command_name.as_str(),
        "pip" | "pip3" | "pip.exe" | "pip3.exe"
    ) {
        let install_index = args
            .iter()
            .position(|arg| arg.eq_ignore_ascii_case("install"))?;
        let package = args
            .iter()
            .skip(install_index + 1)
            .find(|arg| !arg.starts_with('-'))
            .cloned()?;
        let normalized = normalize_pip_package_identifier(&package);
        if normalized.is_empty() {
            return None;
        }
        return Some(normalized);
    }

    None
}

fn pip_runtime_command() -> Option<&'static str> {
    if which::which("python3").is_ok() {
        Some("python3")
    } else if which::which("python").is_ok() {
        Some("python")
    } else if cfg!(windows) && which::which("py").is_ok() {
        Some("py")
    } else {
        None
    }
}

fn extract_dependency_tasks_from_installed_item(
    item: &InstalledItem,
) -> Vec<GlobalCleanupDependencyTask> {
    let mut tasks = Vec::new();
    match item.install_strategy.as_str() {
        STRATEGY_BUILTIN_NPM | STRATEGY_REGISTRY_NPM => {
            let (package_name, _) = split_package_spec(&item.install_identifier);
            if !package_name.trim().is_empty() {
                tasks.push(GlobalCleanupDependencyTask {
                    manager: GlobalCleanupDependencyManager::NpmGlobal,
                    identifier: package_name.clone(),
                    command_preview: format!("{} uninstall -g {}", npm_command(), package_name),
                });
            }
        }
        _ => {
            if let Some(value) = item.install_identifier.strip_prefix("pip:") {
                let package = normalize_pip_package_identifier(value);
                if !package.is_empty() {
                    tasks.push(GlobalCleanupDependencyTask {
                        manager: GlobalCleanupDependencyManager::PipPackage,
                        identifier: package.clone(),
                        command_preview: format!(
                            "{} -m pip uninstall -y {}",
                            pip_runtime_command().unwrap_or("python"),
                            package
                        ),
                    });
                }
            }
            if let Some(value) = item.install_identifier.strip_prefix("winget:") {
                let identifier = value.trim().to_string();
                if !identifier.is_empty() {
                    tasks.push(GlobalCleanupDependencyTask {
                        manager: GlobalCleanupDependencyManager::WingetPackage,
                        identifier: identifier.clone(),
                        command_preview: format!(
                            "winget uninstall --id {} --exact --silent",
                            identifier
                        ),
                    });
                }
            }
            if let Some(value) = item.install_identifier.strip_prefix("choco:") {
                let identifier = value.trim().to_string();
                if !identifier.is_empty() {
                    tasks.push(GlobalCleanupDependencyTask {
                        manager: GlobalCleanupDependencyManager::ChocoPackage,
                        identifier: identifier.clone(),
                        command_preview: format!("choco uninstall {} -y", identifier),
                    });
                }
            }
        }
    }

    tasks
}

fn push_unique_action_target(targets: &mut Vec<String>, value: String) {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return;
    }
    if !targets.iter().any(|target| target == trimmed) {
        targets.push(trimmed.to_string());
    }
}

fn dependency_manager_key(manager: &GlobalCleanupDependencyManager) -> &'static str {
    match manager {
        GlobalCleanupDependencyManager::NpmGlobal => "npm_global",
        GlobalCleanupDependencyManager::PipPackage => "pip_package",
        GlobalCleanupDependencyManager::WingetPackage => "winget_package",
        GlobalCleanupDependencyManager::ChocoPackage => "choco_package",
    }
}

async fn build_global_cleanup_preview(
    scope_platforms: Option<Vec<String>>,
    include_dependency_cleanup: bool,
) -> Result<GlobalCleanupPreview, String> {
    let scope = normalize_cleanup_scope(scope_platforms);
    let scope_set: HashSet<String> = scope.iter().cloned().collect();

    let detected_tools = detect_ai_tools().await.unwrap_or_default();
    let mut platform_capabilities: HashMap<String, ManagementCapability> = HashMap::new();
    let mut platform_names: HashMap<String, String> = HashMap::new();
    let mut openclaw_detected = false;

    for tool in detected_tools {
        if tool.id == "openclaw" && (tool.detected || tool.host_detected || tool.has_mcp_config) {
            openclaw_detected = true;
        }
        platform_capabilities.insert(tool.id.clone(), tool.management_capability.clone());
        platform_names.insert(tool.id.clone(), tool.name.clone());
    }

    let mut components = crate::commands::scan::scan_installed_mcps()
        .await
        .unwrap_or_default();
    let installed_store = load_installed_items();
    components.sort_by(|left, right| {
        left.platform_id
            .cmp(&right.platform_id)
            .then(left.name.cmp(&right.name))
            .then(left.config_path.cmp(&right.config_path))
    });

    let mut planned_components = Vec::new();
    let mut action_targets = Vec::new();
    let mut dependency_tasks = Vec::new();
    let mut dependency_seen: HashSet<(GlobalCleanupDependencyManager, String)> = HashSet::new();

    for component in components {
        if !scope_set.is_empty() && !scope_set.contains(&component.platform_id) {
            continue;
        }

        let management_capability =
            inferred_cleanup_capability(&component.platform_id, &platform_capabilities);
        let auto_cleanup_supported = capability_allows_one_click(&management_capability);

        if auto_cleanup_supported {
            push_unique_action_target(&mut action_targets, component.config_path.clone());
            if component.command == "skill" {
                push_unique_action_target(
                    &mut action_targets,
                    format!("skill-root:{}", component.config_path),
                );
            }
        }

        let component_dependency_tasks =
            extract_global_cleanup_dependency_tasks(&component, include_dependency_cleanup);
        let matched_installed_items = installed_store
            .items
            .iter()
            .filter(|item| {
                item.id == component.name
                    && item.platform == component.platform_id
                    && (item.source_url.trim().is_empty()
                        || normalize_path_string(&item.source_url)
                            == normalize_path_string(&component.config_path))
            })
            .collect::<Vec<_>>();
        if auto_cleanup_supported {
            for task in &component_dependency_tasks {
                let key = (task.manager.clone(), task.identifier.clone());
                if dependency_seen.insert(key) {
                    dependency_tasks.push(task.clone());
                    push_unique_action_target(
                        &mut action_targets,
                        format!(
                            "dependency:{}:{}",
                            dependency_manager_key(&task.manager),
                            task.identifier
                        ),
                    );
                }
            }
            for installed_item in matched_installed_items {
                for task in extract_dependency_tasks_from_installed_item(installed_item) {
                    let key = (task.manager.clone(), task.identifier.clone());
                    if dependency_seen.insert(key) {
                        dependency_tasks.push(task.clone());
                        push_unique_action_target(
                            &mut action_targets,
                            format!(
                                "dependency:{}:{}",
                                dependency_manager_key(&task.manager),
                                task.identifier
                            ),
                        );
                    }
                }
            }
        }

        planned_components.push(GlobalCleanupComponentPlan {
            item_id: component.name.clone(),
            platform: component.platform_id.clone(),
            platform_name: platform_names
                .get(&component.platform_id)
                .cloned()
                .unwrap_or_else(|| component.platform_name.clone()),
            component_type: if component.command == "skill" {
                "skill".to_string()
            } else {
                "mcp".to_string()
            },
            config_path: component.config_path.clone(),
            command: component.command.clone(),
            args: component.args.clone(),
            management_capability,
            auto_cleanup_supported,
            dependency_tasks: component_dependency_tasks,
        });
    }

    let openclaw_selected = scope_set.is_empty() || scope_set.contains("openclaw");
    let include_openclaw_deep_cleanup = openclaw_selected && openclaw_detected;
    if include_openclaw_deep_cleanup {
        push_unique_action_target(&mut action_targets, "openclaw:deep_cleanup".to_string());
    }

    action_targets.sort();
    action_targets.dedup();
    dependency_tasks.sort_by(|left, right| left.identifier.cmp(&right.identifier));

    let component_count = planned_components.len() as u32;
    let auto_cleanup_component_count = planned_components
        .iter()
        .filter(|component| component.auto_cleanup_supported)
        .count() as u32;
    let manual_only_component_count = component_count.saturating_sub(auto_cleanup_component_count);

    Ok(GlobalCleanupPreview {
        plan_id: format!("cleanup-{}", uuid::Uuid::new_v4()),
        generated_at: chrono::Utc::now().to_rfc3339(),
        scope_platforms: scope,
        include_dependency_cleanup,
        include_openclaw_deep_cleanup,
        action_targets,
        component_count,
        auto_cleanup_component_count,
        manual_only_component_count,
        dependency_task_count: dependency_tasks.len() as u32,
        components: planned_components,
        dependency_tasks,
    })
}

fn command_output_combined(output: &std::process::Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        stdout
    } else if stdout.is_empty() {
        stderr
    } else {
        format!("{stdout}\n{stderr}")
    }
}

fn run_dependency_cleanup_task(task: &GlobalCleanupDependencyTask) -> (String, String) {
    match task.manager {
        GlobalCleanupDependencyManager::NpmGlobal => {
            if which::which(npm_command()).is_err() {
                return (
                    "skipped".to_string(),
                    format!(
                        "未检测到 npm，已跳过自动清理。请手动执行: {} uninstall -g {}",
                        npm_command(),
                        task.identifier
                    ),
                );
            }
            let output = Command::new(npm_command())
                .args(["uninstall", "-g", task.identifier.as_str()])
                .output()
                .map_err(|error| format!("无法执行 npm 卸载: {}", error));
            let output = match output {
                Ok(value) => value,
                Err(error) => {
                    return ("failed".to_string(), error);
                }
            };
            if output.status.success() {
                (
                    "success".to_string(),
                    format!("已清理 npm 全局依赖 {}", task.identifier),
                )
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                let lowered = stderr.to_ascii_lowercase();
                if lowered.contains("is not installed")
                    || lowered.contains("up to date")
                    || lowered.contains("not installed")
                {
                    (
                        "skipped".to_string(),
                        format!("{} 当前未安装，已跳过。", task.identifier),
                    )
                } else if stderr.is_empty() {
                    (
                        "failed".to_string(),
                        format!("npm 卸载失败: {}", task.identifier),
                    )
                } else {
                    (
                        "failed".to_string(),
                        format!("npm 卸载失败 {}: {}", task.identifier, stderr),
                    )
                }
            }
        }
        GlobalCleanupDependencyManager::PipPackage => {
            let Some(python_cmd) = pip_runtime_command() else {
                return (
                    "skipped".to_string(),
                    format!(
                        "未检测到 Python/PIP 运行环境，已跳过。请手动执行: python -m pip uninstall -y {}",
                        task.identifier
                    ),
                );
            };

            let output = Command::new(python_cmd)
                .args(["-m", "pip", "uninstall", "-y", task.identifier.as_str()])
                .output();

            let output = match output {
                Ok(value) => value,
                Err(error) => {
                    return (
                        "failed".to_string(),
                        format!("无法执行 pip 卸载 {}: {}", task.identifier, error),
                    );
                }
            };

            if output.status.success() {
                return (
                    "success".to_string(),
                    format!("已清理 pip 依赖 {}", task.identifier),
                );
            }

            let message = command_output_combined(&output);
            let lowered = message.to_ascii_lowercase();
            if lowered.contains("skipping")
                || lowered.contains("not installed")
                || lowered.contains("not currently installed")
            {
                return (
                    "skipped".to_string(),
                    format!("{} 当前未安装，已跳过。", task.identifier),
                );
            }

            (
                "failed".to_string(),
                if message.is_empty() {
                    format!("pip 卸载失败: {}", task.identifier)
                } else {
                    format!("pip 卸载失败 {}: {}", task.identifier, message)
                },
            )
        }
        GlobalCleanupDependencyManager::WingetPackage => {
            if !cfg!(windows) {
                return (
                    "skipped".to_string(),
                    "winget 仅支持 Windows，已跳过。".to_string(),
                );
            }
            if which::which("winget").is_err() {
                return (
                    "skipped".to_string(),
                    "未检测到 winget，已跳过。".to_string(),
                );
            }
            let output = Command::new("winget")
                .args([
                    "uninstall",
                    "--id",
                    task.identifier.as_str(),
                    "--exact",
                    "--silent",
                    "--disable-interactivity",
                ])
                .output();
            let output = match output {
                Ok(value) => value,
                Err(error) => {
                    return (
                        "failed".to_string(),
                        format!("无法执行 winget 卸载 {}: {}", task.identifier, error),
                    );
                }
            };
            if output.status.success() {
                return (
                    "success".to_string(),
                    format!("已清理 winget 包 {}", task.identifier),
                );
            }
            let message = command_output_combined(&output);
            let lowered = message.to_ascii_lowercase();
            if lowered.contains("no installed package found")
                || lowered.contains("could not find")
                || lowered.contains("not installed")
            {
                return (
                    "skipped".to_string(),
                    format!("{} 当前未安装，已跳过。", task.identifier),
                );
            }
            (
                "failed".to_string(),
                if message.is_empty() {
                    format!("winget 卸载失败: {}", task.identifier)
                } else {
                    format!("winget 卸载失败 {}: {}", task.identifier, message)
                },
            )
        }
        GlobalCleanupDependencyManager::ChocoPackage => {
            if !cfg!(windows) {
                return (
                    "skipped".to_string(),
                    "Chocolatey 仅支持 Windows，已跳过。".to_string(),
                );
            }
            if which::which("choco").is_err() {
                return (
                    "skipped".to_string(),
                    "未检测到 Chocolatey，已跳过。".to_string(),
                );
            }
            let output = Command::new("choco")
                .args(["uninstall", task.identifier.as_str(), "-y"])
                .output();
            let output = match output {
                Ok(value) => value,
                Err(error) => {
                    return (
                        "failed".to_string(),
                        format!("无法执行 choco 卸载 {}: {}", task.identifier, error),
                    );
                }
            };
            if output.status.success() {
                return (
                    "success".to_string(),
                    format!("已清理 Chocolatey 包 {}", task.identifier),
                );
            }
            let message = command_output_combined(&output);
            let lowered = message.to_ascii_lowercase();
            if lowered.contains("is not installed") || lowered.contains("not installed") {
                return (
                    "skipped".to_string(),
                    format!("{} 当前未安装，已跳过。", task.identifier),
                );
            }
            (
                "failed".to_string(),
                if message.is_empty() {
                    format!("choco 卸载失败: {}", task.identifier)
                } else {
                    format!("choco 卸载失败 {}: {}", task.identifier, message)
                },
            )
        }
    }
}

fn component_label(component: &GlobalCleanupComponentPlan) -> String {
    format!(
        "{}:{} ({})",
        component.platform, component.item_id, component.config_path
    )
}

#[tauri::command]
pub async fn preview_global_cleanup(
    scope_platforms: Option<Vec<String>>,
    include_dependency_cleanup: Option<bool>,
) -> Result<GlobalCleanupPreview, String> {
    let preview =
        build_global_cleanup_preview(scope_platforms, include_dependency_cleanup.unwrap_or(true))
            .await?;
    let mut cache = global_cleanup_plan_cache()
        .lock()
        .map_err(|_| "Failed to lock global cleanup plan cache".to_string())?;
    cache.insert(preview.plan_id.clone(), preview.clone());
    if cache.len() > 8 {
        let mut keys = cache.keys().cloned().collect::<Vec<_>>();
        keys.sort();
        for key in keys.into_iter().take(cache.len().saturating_sub(8)) {
            cache.remove(&key);
        }
    }
    Ok(preview)
}

#[tauri::command]
pub async fn execute_global_cleanup(
    app: tauri::AppHandle,
    plan_id: String,
    approval_ticket: Option<String>,
) -> Result<GlobalCleanupReport, String> {
    require_one_click_automation("全局清理").await?;
    let plan = {
        let cache = global_cleanup_plan_cache()
            .lock()
            .map_err(|_| "Failed to lock global cleanup plan cache".to_string())?;
        cache
            .get(&plan_id)
            .cloned()
            .ok_or_else(|| "全局清理计划已过期，请先重新预览后再执行。".to_string())?
    };

    runtime_guard::require_action_approval_ticket(
        approval_ticket.as_deref(),
        "agentshield:installed:global_cleanup",
        "bulk_file_modify",
        &plan.action_targets,
        "user_requested_global_cleanup",
    )?;

    let run_id = format!("cleanup-run-{}", uuid::Uuid::new_v4());
    let started_at = chrono::Utc::now().to_rfc3339();
    let mut results: Vec<GlobalCleanupActionResult> = Vec::new();
    let config_backups = backup_global_cleanup_configs(&plan.components, &run_id)?;
    let backup_dir = if config_backups.is_empty() {
        None
    } else {
        Some(
            global_cleanup_backup_dir(&run_id)
                .to_string_lossy()
                .to_string(),
        )
    };
    for (source_path, backup_path) in &config_backups {
        results.push(GlobalCleanupActionResult {
            action_type: "backup_config".to_string(),
            target: source_path.clone(),
            status: "success".to_string(),
            message: format!("已备份到 {}", backup_path),
        });
    }
    let mut store = load_installed_items();
    let mut store_changed = false;

    if plan.include_openclaw_deep_cleanup {
        match crate::commands::install::uninstall_openclaw_for_global_cleanup().await {
            Ok(message) => results.push(GlobalCleanupActionResult {
                action_type: "openclaw_deep_cleanup".to_string(),
                target: "openclaw".to_string(),
                status: "success".to_string(),
                message,
            }),
            Err(error) => results.push(GlobalCleanupActionResult {
                action_type: "openclaw_deep_cleanup".to_string(),
                target: "openclaw".to_string(),
                status: "failed".to_string(),
                message: error,
            }),
        }
    }

    for component in &plan.components {
        if !component.auto_cleanup_supported {
            results.push(GlobalCleanupActionResult {
                action_type: "component_cleanup".to_string(),
                target: component_label(component),
                status: "skipped".to_string(),
                message: "该宿主当前仅支持手动治理，已跳过自动清理。".to_string(),
            });
            continue;
        }

        if component.component_type == "skill" {
            let skill_path = PathBuf::from(&component.config_path);
            if !skill_path_allows_auto_cleanup(&skill_path) {
                results.push(GlobalCleanupActionResult {
                    action_type: "remove_skill_root".to_string(),
                    target: component.config_path.clone(),
                    status: "skipped".to_string(),
                    message: "该 Skill 路径不在安全清理范围内，已跳过自动删除，请手动处理。"
                        .to_string(),
                });
            } else {
                match remove_skill_root(&skill_path) {
                    Ok(()) => results.push(GlobalCleanupActionResult {
                        action_type: "remove_skill_root".to_string(),
                        target: component.config_path.clone(),
                        status: "success".to_string(),
                        message: "Skill 目录已删除".to_string(),
                    }),
                    Err(error) => results.push(GlobalCleanupActionResult {
                        action_type: "remove_skill_root".to_string(),
                        target: component.config_path.clone(),
                        status: "failed".to_string(),
                        message: error,
                    }),
                }
            }
        }

        if component.component_type != "skill" {
            match remove_server_from_config_path(
                &component.item_id,
                &PathBuf::from(&component.config_path),
            ) {
                Ok(true) => results.push(GlobalCleanupActionResult {
                    action_type: "remove_config_entry".to_string(),
                    target: component_label(component),
                    status: "success".to_string(),
                    message: "已从真实配置移除组件引用".to_string(),
                }),
                Ok(false) => results.push(GlobalCleanupActionResult {
                    action_type: "remove_config_entry".to_string(),
                    target: component_label(component),
                    status: "skipped".to_string(),
                    message: "未在配置中找到对应条目，可能已被移除。".to_string(),
                }),
                Err(error) => results.push(GlobalCleanupActionResult {
                    action_type: "remove_config_entry".to_string(),
                    target: component_label(component),
                    status: "failed".to_string(),
                    message: error,
                }),
            }
        } else {
            results.push(GlobalCleanupActionResult {
                action_type: "remove_config_entry".to_string(),
                target: component_label(component),
                status: "skipped".to_string(),
                message: "Skill 组件没有独立配置文件条目，已跳过此步骤。".to_string(),
            });
        }

        let before = store.items.len();
        store.items.retain(|item| {
            !(item.id == component.item_id
                && item.platform == component.platform
                && (item.source_url.trim().is_empty()
                    || normalize_path_string(&item.source_url)
                        == normalize_path_string(&component.config_path)))
        });
        if store.items.len() != before {
            store_changed = true;
        }
    }

    if plan.include_dependency_cleanup {
        let mut dependency_seen: HashSet<(GlobalCleanupDependencyManager, String)> = HashSet::new();
        for dependency in &plan.dependency_tasks {
            let key = (dependency.manager.clone(), dependency.identifier.clone());
            if !dependency_seen.insert(key) {
                continue;
            }
            let (status, message) = run_dependency_cleanup_task(dependency);
            results.push(GlobalCleanupActionResult {
                action_type: "dependency_cleanup".to_string(),
                target: dependency.identifier.clone(),
                status,
                message,
            });
        }
    }

    if store_changed {
        save_installed_items(&store)?;
    }
    let _ = runtime_guard::sync_runtime_guard_components(app).await;

    let rescanned = crate::commands::scan::scan_installed_mcps()
        .await
        .unwrap_or_default();
    let mut remaining_components = Vec::new();
    for component in &plan.components {
        if rescanned.iter().any(|server| {
            server.name == component.item_id
                && server.platform_id == component.platform
                && normalize_path_string(&server.config_path)
                    == normalize_path_string(&component.config_path)
        }) {
            remaining_components.push(component_label(component));
        }
    }
    remaining_components.sort();
    remaining_components.dedup();

    let total_actions = results.len() as u32;
    let success_actions = results
        .iter()
        .filter(|result| result.status == "success")
        .count() as u32;
    let failed_actions = results
        .iter()
        .filter(|result| result.status == "failed")
        .count() as u32;
    let skipped_actions = results
        .iter()
        .filter(|result| result.status == "skipped")
        .count() as u32;
    let completed_at = chrono::Utc::now().to_rfc3339();

    let report = GlobalCleanupReport {
        run_id,
        plan_id: plan.plan_id.clone(),
        started_at,
        completed_at,
        backup_dir,
        backup_count: config_backups.len() as u32,
        total_actions,
        success_actions,
        failed_actions,
        skipped_actions,
        remaining_components,
        results,
    };

    save_global_cleanup_report(&report)?;
    {
        let mut cache = global_cleanup_report_cache()
            .lock()
            .map_err(|_| "Failed to lock global cleanup report cache".to_string())?;
        *cache = Some(report.clone());
    }
    Ok(report)
}

#[tauri::command]
pub async fn get_global_cleanup_report() -> Result<Option<GlobalCleanupReport>, String> {
    if let Ok(cache) = global_cleanup_report_cache().lock() {
        if let Some(report) = cache.clone() {
            return Ok(Some(report));
        }
    }
    Ok(load_global_cleanup_report())
}

// ---------------------------------------------------------------------------
// Manual fix guide — generates terminal commands for free users
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct ManualFixStep {
    pub step_type: String,     // "permission", "remove_key", "remove_mcp", "remove_skill"
    pub title: String,
    pub description: String,
    pub commands: Vec<String>,  // Terminal commands to copy-paste
    pub target_path: String,
    pub severity: String,       // "critical", "high", "medium"
}

#[tauri::command]
pub async fn generate_manual_fix_guide(
    issue_type: String,
    target_path: String,
    detail: Option<String>,
) -> Result<Vec<ManualFixStep>, String> {
    let mut steps = Vec::new();

    match issue_type.as_str() {
        "permission" => {
            steps.push(ManualFixStep {
                step_type: "permission".to_string(),
                title: "Fix file permissions".to_string(),
                description: "Restrict config file to current user only".to_string(),
                commands: if cfg!(unix) {
                    vec![format!("chmod 600 \"{}\"", target_path)]
                } else {
                    vec![format!(
                        "icacls \"{}\" /inheritance:r /grant:r \"%USERNAME%:F\"",
                        target_path
                    )]
                },
                target_path: target_path.clone(),
                severity: "high".to_string(),
            });
        }
        "exposed_key" => {
            let key_hint = detail.as_deref().unwrap_or("API key");
            steps.push(ManualFixStep {
                step_type: "remove_key".to_string(),
                title: format!("Remove exposed {}", key_hint),
                description: "Open the config file and remove the plaintext API key".to_string(),
                commands: if cfg!(target_os = "macos") {
                    vec![format!("open -e \"{}\"", target_path)]
                } else if cfg!(target_os = "windows") {
                    vec![format!("notepad \"{}\"", target_path)]
                } else {
                    vec![format!("xdg-open \"{}\"", target_path)]
                },
                target_path: target_path.clone(),
                severity: "critical".to_string(),
            });
        }
        "remove_mcp" => {
            let server_name = detail.as_deref().unwrap_or("server");
            steps.push(ManualFixStep {
                step_type: "remove_mcp".to_string(),
                title: format!("Remove MCP server: {}", server_name),
                description: "Open the config file and delete the server entry".to_string(),
                commands: if cfg!(target_os = "macos") {
                    vec![format!("open -e \"{}\"", target_path)]
                } else if cfg!(target_os = "windows") {
                    vec![format!("notepad \"{}\"", target_path)]
                } else {
                    vec![format!("xdg-open \"{}\"", target_path)]
                },
                target_path: target_path.clone(),
                severity: "medium".to_string(),
            });
        }
        "remove_skill" => {
            steps.push(ManualFixStep {
                step_type: "remove_skill".to_string(),
                title: "Remove suspicious skill".to_string(),
                description: "Delete the entire skill directory".to_string(),
                commands: if cfg!(unix) {
                    vec![format!("rm -rf \"{}\"", target_path)]
                } else {
                    vec![format!("rmdir /s /q \"{}\"", target_path)]
                },
                target_path: target_path.clone(),
                severity: "high".to_string(),
            });
        }
        _ => {
            steps.push(ManualFixStep {
                step_type: issue_type.clone(),
                title: "Manual review required".to_string(),
                description: "Open the file and review the flagged content".to_string(),
                commands: if cfg!(target_os = "macos") {
                    vec![format!("open -e \"{}\"", target_path)]
                } else if cfg!(target_os = "windows") {
                    vec![format!("notepad \"{}\"", target_path)]
                } else {
                    vec![format!("xdg-open \"{}\"", target_path)]
                },
                target_path: target_path.clone(),
                severity: "medium".to_string(),
            });
        }
    }

    Ok(steps)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "agentshield-store-{}-{}",
            name,
            uuid::Uuid::new_v4()
        ))
    }

    #[test]
    fn write_server_to_config_path_creates_zed_context_servers() {
        let base = temp_path("zed");
        let path = base.join(".config/zed/settings.json");

        write_server_to_config_path("demo", &path, build_npm_server_entry("@demo/server@1.2.3"))
            .expect("write zed config");

        let config = read_json_config(&path).expect("read zed config");
        assert!(config["context_servers"].get("demo").is_some());

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn remove_server_from_config_path_removes_codex_toml_entries() {
        let base = temp_path("codex");
        let path = base.join(".codex/config.toml");
        ensure_parent_dir(&path).expect("create parent dir");
        write_server_to_config_path("demo", &path, build_npm_server_entry("@demo/server@1.0.0"))
            .expect("seed codex config");

        let removed = remove_server_from_config_path("demo", &path).expect("remove codex entry");
        assert!(removed);

        let content = fs::read_to_string(&path).expect("read updated codex config");
        assert!(!content.contains("[mcp_servers.demo]"));

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn write_server_to_config_path_persists_codex_remote_headers() {
        let base = temp_path("codex-remote-auth");
        let path = base.join(".codex/config.toml");
        ensure_parent_dir(&path).expect("create parent dir");

        let server_entry = build_remote_auth_server_entry(
            "https://api.example.com/mcp",
            &["Authorization".to_string(), "X-API-Key".to_string()],
        );

        write_server_to_config_path("remote_demo", &path, server_entry)
            .expect("write codex remote auth config");

        let content = fs::read_to_string(&path).expect("read codex config");
        assert!(content.contains("[mcp_servers.remote_demo]"));
        assert!(content.contains("url = \"https://api.example.com/mcp\""));
        assert!(content.contains("[mcp_servers.remote_demo.headers]"));
        assert!(content.contains("Authorization = \"REPLACE_WITH_REAL_SECRET\""));
        assert!(content.contains("X-API-Key = \"REPLACE_WITH_REAL_SECRET\""));

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn continue_yaml_configs_support_upsert_and_remove() {
        let base = temp_path("continue");
        let path = base.join(".continue/config.yaml");
        ensure_parent_dir(&path).expect("create parent dir");
        fs::write(
            &path,
            r#"mcpServers:
  - name: existing
    command: npx
    args:
      - -y
      - existing@1.0.0
"#,
        )
        .expect("seed continue config");

        write_server_to_config_path("demo", &path, build_npm_server_entry("@demo/server@2.0.0"))
            .expect("upsert continue server");
        let config = read_yaml_as_json(&path).expect("read continue config");
        let names: Vec<String> = config["mcpServers"]
            .as_array()
            .expect("mcpServers array")
            .iter()
            .filter_map(|item| {
                item.get("name")
                    .and_then(Value::as_str)
                    .map(ToString::to_string)
            })
            .collect();
        assert!(names.contains(&"existing".to_string()));
        assert!(names.contains(&"demo".to_string()));

        let removed =
            remove_server_from_config_path("demo", &path).expect("remove continue server");
        assert!(removed);
        let config = read_yaml_as_json(&path).expect("read continue config after removal");
        let names: Vec<String> = config["mcpServers"]
            .as_array()
            .expect("mcpServers array")
            .iter()
            .filter_map(|item| {
                item.get("name")
                    .and_then(Value::as_str)
                    .map(ToString::to_string)
            })
            .collect();
        assert!(names.contains(&"existing".to_string()));
        assert!(!names.contains(&"demo".to_string()));

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn install_target_paths_include_kiro_global_mcp_config() {
        let base = temp_path("kiro-target");
        let config_path = base.join(".kiro/settings/mcp.json");
        ensure_parent_dir(&config_path).expect("create kiro settings dir");

        let target = get_mcp_config_for_platform_in_home(&base, "kiro").expect("kiro target");
        assert_eq!(target, config_path);

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn install_target_paths_include_qwen_and_kimi_global_configs() {
        let base = temp_path("qwen-kimi-target");

        let qwen_target =
            get_mcp_config_for_platform_in_home(&base, "qwen_code").expect("qwen target");
        assert_eq!(qwen_target, base.join(".qwen/settings.json"));

        let kimi_target =
            get_mcp_config_for_platform_in_home(&base, "kimi_cli").expect("kimi target");
        assert_eq!(kimi_target, base.join(".kimi/mcp.json"));

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn install_target_paths_choose_codebuddy_highest_priority_existing_file() {
        let base = temp_path("codebuddy-target");
        let low_priority = base.join(".codebuddy.json");
        ensure_parent_dir(&low_priority).expect("create parent dir");
        fs::write(&low_priority, "{}").expect("write low priority config");

        let target =
            get_mcp_config_for_platform_in_home(&base, "codebuddy").expect("codebuddy target");
        assert_eq!(target, low_priority);

        let high_priority = base.join(".codebuddy/.mcp.json");
        ensure_parent_dir(&high_priority).expect("create codebuddy dir");
        fs::write(&high_priority, "{}").expect("write high priority config");

        let target =
            get_mcp_config_for_platform_in_home(&base, "codebuddy").expect("codebuddy target");
        assert_eq!(target, high_priority);

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn build_update_action_targets_prefers_real_source_paths() {
        let targets = build_update_action_targets(
            "playwright",
            Some("cursor"),
            None,
            &[InstalledItem {
                id: "playwright".to_string(),
                name: "playwright".to_string(),
                version: "1.0.0".to_string(),
                platform: "cursor".to_string(),
                installed_at: "2026-03-11T00:00:00Z".to_string(),
                install_strategy: STRATEGY_BUILTIN_NPM.to_string(),
                install_identifier: "@modelcontextprotocol/server-playwright@1.0.0".to_string(),
                registry_name: String::new(),
                source_url: "/tmp/cursor-mcp.json".to_string(),
            }],
        );

        assert_eq!(targets, vec!["/tmp/cursor-mcp.json".to_string()]);
    }

    #[test]
    fn build_update_action_targets_falls_back_to_platform_item_label() {
        let targets = build_update_action_targets("memory", Some("claude_code"), None, &[]);
        assert_eq!(targets, vec!["claude_code:memory".to_string()]);
    }

    #[test]
    fn capability_gate_only_allows_one_click_platforms_for_automation() {
        assert!(capability_allows_one_click(&ManagementCapability::OneClick));
        assert!(!capability_allows_one_click(&ManagementCapability::Manual));
        assert!(!capability_allows_one_click(
            &ManagementCapability::DetectOnly
        ));
    }

    #[test]
    fn capability_block_messages_are_human_readable() {
        assert!(
            capability_block_message(&ManagementCapability::Manual, "unknown_ai_tool_x")
                .contains("仅支持手动治理")
        );
        assert!(
            capability_block_message(&ManagementCapability::DetectOnly, "unknown_ai_tool_y")
                .contains("仅支持检测")
        );
    }

    #[test]
    fn normalize_cleanup_scope_sorts_and_deduplicates() {
        let scope = normalize_cleanup_scope(Some(vec![
            " codex ".to_string(),
            "openclaw".to_string(),
            "codex".to_string(),
            "".to_string(),
        ]));
        assert_eq!(scope, vec!["codex".to_string(), "openclaw".to_string()]);
    }

    #[test]
    fn extract_global_cleanup_dependency_tasks_from_npx_command() {
        let server = InstalledMcpServer {
            id: "cursor:playwright".to_string(),
            name: "playwright".to_string(),
            platform_id: "cursor".to_string(),
            platform_name: "Cursor".to_string(),
            command: "npx".to_string(),
            args: vec!["@modelcontextprotocol/server-playwright@1.2.3".to_string()],
            config_path: "/tmp/cursor-mcp.json".to_string(),
            safety_level: "caution".to_string(),
        };

        let tasks = extract_global_cleanup_dependency_tasks(&server, true);
        assert_eq!(tasks.len(), 1);
        assert_eq!(
            tasks[0].identifier,
            "@modelcontextprotocol/server-playwright"
        );
    }

    #[test]
    fn skill_cleanup_path_guard_blocks_non_skill_targets() {
        assert!(skill_path_allows_auto_cleanup(Path::new(
            "/Users/demo/.codex/skills/my-skill"
        )));
        assert!(!skill_path_allows_auto_cleanup(Path::new(
            "/Users/demo/Documents"
        )));
        assert!(!skill_path_allows_auto_cleanup(Path::new(
            "/Users/demo/.codex/skills"
        )));
    }

    #[test]
    fn backup_global_cleanup_configs_creates_backup_files() {
        let base = temp_path("global-backup");
        let config_path = base.join(".cursor/mcp.json");
        ensure_parent_dir(&config_path).expect("create config parent");
        fs::write(&config_path, "{\"mcpServers\":{}}").expect("seed config");

        let components = vec![GlobalCleanupComponentPlan {
            item_id: "playwright".to_string(),
            platform: "cursor".to_string(),
            platform_name: "Cursor".to_string(),
            component_type: "mcp".to_string(),
            config_path: config_path.to_string_lossy().to_string(),
            command: "npx".to_string(),
            args: vec!["@modelcontextprotocol/server-playwright".to_string()],
            management_capability: ManagementCapability::OneClick,
            auto_cleanup_supported: true,
            dependency_tasks: Vec::new(),
        }];

        let run_id = format!("cleanup-test-{}", uuid::Uuid::new_v4());
        let backups =
            backup_global_cleanup_configs(&components, &run_id).expect("backup should succeed");
        assert_eq!(backups.len(), 1);
        assert!(PathBuf::from(&backups[0].1).exists());

        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(global_cleanup_backup_dir(&run_id));
    }

    #[test]
    fn extract_global_cleanup_dependency_tasks_detects_pip_modules() {
        let server = InstalledMcpServer {
            id: "codex:filesystem_server".to_string(),
            name: "filesystem_server".to_string(),
            platform_id: "codex".to_string(),
            platform_name: "Codex".to_string(),
            command: "python3".to_string(),
            args: vec!["-m".to_string(), "mcp_filesystem".to_string()],
            config_path: "/tmp/codex-config.toml".to_string(),
            safety_level: "caution".to_string(),
        };

        let tasks = extract_global_cleanup_dependency_tasks(&server, true);
        assert!(tasks.iter().any(|task| {
            task.manager == GlobalCleanupDependencyManager::PipPackage
                && task.identifier == "mcp-filesystem"
        }));
    }

    #[test]
    fn extract_dependency_tasks_from_installed_item_supports_prefixed_identifiers() {
        let pip_item = InstalledItem {
            id: "pip-demo".to_string(),
            name: "pip-demo".to_string(),
            version: "1.0.0".to_string(),
            platform: "codex".to_string(),
            installed_at: "2026-03-14T00:00:00Z".to_string(),
            install_strategy: "manual".to_string(),
            install_identifier: "pip:mcp-filesystem==1.2.3".to_string(),
            registry_name: String::new(),
            source_url: "/tmp/demo.toml".to_string(),
        };
        let winget_item = InstalledItem {
            id: "winget-demo".to_string(),
            name: "winget-demo".to_string(),
            version: "1.0.0".to_string(),
            platform: "codex".to_string(),
            installed_at: "2026-03-14T00:00:00Z".to_string(),
            install_strategy: "manual".to_string(),
            install_identifier: "winget:Microsoft.VisualStudioCode".to_string(),
            registry_name: String::new(),
            source_url: "/tmp/demo.toml".to_string(),
        };
        let choco_item = InstalledItem {
            id: "choco-demo".to_string(),
            name: "choco-demo".to_string(),
            version: "1.0.0".to_string(),
            platform: "codex".to_string(),
            installed_at: "2026-03-14T00:00:00Z".to_string(),
            install_strategy: "manual".to_string(),
            install_identifier: "choco:git".to_string(),
            registry_name: String::new(),
            source_url: "/tmp/demo.toml".to_string(),
        };

        let pip_tasks = extract_dependency_tasks_from_installed_item(&pip_item);
        assert!(pip_tasks.iter().any(|task| {
            task.manager == GlobalCleanupDependencyManager::PipPackage
                && task.identifier == "mcp-filesystem"
        }));

        let winget_tasks = extract_dependency_tasks_from_installed_item(&winget_item);
        assert!(winget_tasks.iter().any(|task| {
            task.manager == GlobalCleanupDependencyManager::WingetPackage
                && task.identifier == "Microsoft.VisualStudioCode"
        }));

        let choco_tasks = extract_dependency_tasks_from_installed_item(&choco_item);
        assert!(choco_tasks.iter().any(|task| {
            task.manager == GlobalCleanupDependencyManager::ChocoPackage && task.identifier == "git"
        }));
    }
}
