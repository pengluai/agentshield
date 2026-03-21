use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct RiskProfileResult {
    pub name: String,
    pub path: String,
    pub risk_score: u32,           // 0–100
    pub risk_level: String,        // "low" | "medium" | "high" | "critical"
    pub signals: Vec<RiskSignal>,
    pub requested_permissions: Vec<String>,
    pub outbound_targets: Vec<String>,
    pub has_shell_access: bool,
    pub has_keyring_access: bool,
    pub has_persistence: bool,
    pub has_network_access: bool,
    pub signature_status: String,  // "signed" | "unsigned" | "invalid"
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RiskSignal {
    pub category: String,     // one of the 8 risk categories
    pub severity: String,     // "info" | "warning" | "danger" | "critical"
    pub description: String,
    pub file_path: Option<String>,
    pub line_number: Option<u32>,
}

// ---------------------------------------------------------------------------
// Pattern definitions (category, weight, severity, patterns)
// ---------------------------------------------------------------------------

struct PatternGroup {
    category: &'static str,
    weight: u32,
    severity: &'static str,
    patterns: &'static [&'static str],
}

const PATTERN_GROUPS: &[PatternGroup] = &[
    PatternGroup {
        category: "shell_exec",
        weight: 30,
        severity: "critical",
        patterns: &["subprocess", "exec(", "spawn(", "system(", "child_process", "Popen", "shell=True"],
    },
    PatternGroup {
        category: "keyring_credential",
        weight: 25,
        severity: "danger",
        patterns: &["keychain", "credential", "password", "secret", "api_key", "apikey", "API_KEY", "keyring"],
    },
    PatternGroup {
        category: "network",
        weight: 20,
        severity: "warning",
        patterns: &["fetch(", "http.get", "http.post", "request(", "urllib", "socket(", "connect(", "reqwest", "axios"],
    },
    PatternGroup {
        category: "file_write",
        weight: 15,
        severity: "warning",
        patterns: &["writeFile", "write_file", "unlink(", "rmdir(", "chmod(", "fs.write", "open(", "w+"],
    },
    PatternGroup {
        category: "persistence",
        weight: 15,
        severity: "danger",
        patterns: &["launchd", "systemd", "crontab", "startup", "autorun", "LaunchAgent", "LaunchDaemon"],
    },
    PatternGroup {
        category: "env_access",
        weight: 10,
        severity: "info",
        patterns: &["process.env", "os.environ", "std::env", "getenv(", "dotenv"],
    },
];

// ---------------------------------------------------------------------------
// Tauri command
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn profile_skill_risk(skill_path: String) -> Result<RiskProfileResult, String> {
    let root = PathBuf::from(&skill_path);
    if !root.is_dir() {
        return Err(format!("Skill path does not exist or is not a directory: {skill_path}"));
    }

    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".into());

    let mut signals: Vec<RiskSignal> = Vec::new();
    let mut requested_permissions: Vec<String> = Vec::new();
    let mut outbound_targets: Vec<String> = Vec::new();
    let mut has_shell_access = false;
    let mut has_keyring_access = false;
    let mut has_persistence = false;
    let mut has_network_access = false;
    let mut signature_status = "unsigned".to_string();

    // ------------------------------------------------------------------
    // 1. Parse SKILL.md frontmatter for declared tools/permissions
    // ------------------------------------------------------------------
    let skill_md = root.join("SKILL.md");
    if skill_md.is_file() {
        if let Ok(content) = fs::read_to_string(&skill_md) {
            parse_skill_md_frontmatter(&content, &mut requested_permissions);
        }
    }

    // ------------------------------------------------------------------
    // 2. Parse metadata.json for allowed_hosts / required_permissions
    // ------------------------------------------------------------------
    let metadata_path = root.join("metadata.json");
    if metadata_path.is_file() {
        if let Ok(raw) = fs::read_to_string(&metadata_path) {
            parse_metadata_json(&raw, &mut requested_permissions, &mut outbound_targets, &mut signature_status);
        }
    }

    // ------------------------------------------------------------------
    // 3. Scan scripts/ directory for risk patterns
    // ------------------------------------------------------------------
    let scripts_dir = root.join("scripts");
    let mut category_hit: Vec<bool> = vec![false; PATTERN_GROUPS.len()];

    if scripts_dir.is_dir() {
        scan_directory_recursive(&scripts_dir, &mut signals, &mut category_hit);
    }

    // Also scan loose script files at root (e.g. index.js, main.py)
    scan_loose_scripts(&root, &mut signals, &mut category_hit);

    // ------------------------------------------------------------------
    // 4. Derive boolean flags from category hits
    // ------------------------------------------------------------------
    for (idx, group) in PATTERN_GROUPS.iter().enumerate() {
        if category_hit[idx] {
            match group.category {
                "shell_exec" => has_shell_access = true,
                "keyring_credential" => has_keyring_access = true,
                "persistence" => has_persistence = true,
                "network" => has_network_access = true,
                _ => {}
            }
        }
    }

    // ------------------------------------------------------------------
    // 5. Calculate weighted risk score (capped at 100)
    // ------------------------------------------------------------------
    let mut raw_score: u32 = 0;
    for (idx, group) in PATTERN_GROUPS.iter().enumerate() {
        if category_hit[idx] {
            raw_score += group.weight;
        }
    }
    let risk_score = raw_score.min(100);

    let risk_level = match risk_score {
        0..=20 => "low",
        21..=50 => "medium",
        51..=75 => "high",
        _ => "critical",
    }
    .to_string();

    Ok(RiskProfileResult {
        name,
        path: skill_path,
        risk_score,
        risk_level,
        signals,
        requested_permissions,
        outbound_targets,
        has_shell_access,
        has_keyring_access,
        has_persistence,
        has_network_access,
        signature_status,
    })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Parse YAML-style frontmatter between `---` markers in SKILL.md.
fn parse_skill_md_frontmatter(content: &str, permissions: &mut Vec<String>) {
    let mut in_frontmatter = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "---" {
            if in_frontmatter {
                break; // end of frontmatter
            }
            in_frontmatter = true;
            continue;
        }
        if !in_frontmatter {
            continue;
        }
        // Look for "tools:" or "permissions:" list items
        if trimmed.starts_with("- ") {
            let value = trimmed.trim_start_matches("- ").trim().to_string();
            if !value.is_empty() && !permissions.contains(&value) {
                permissions.push(value);
            }
        }
    }
}

/// Parse metadata.json for allowed_hosts, required_permissions, and signature.
fn parse_metadata_json(
    raw: &str,
    permissions: &mut Vec<String>,
    outbound: &mut Vec<String>,
    signature_status: &mut String,
) {
    let Ok(val) = serde_json::from_str::<serde_json::Value>(raw) else {
        return;
    };

    if let Some(hosts) = val.get("allowed_hosts").and_then(|v| v.as_array()) {
        for host in hosts {
            if let Some(s) = host.as_str() {
                outbound.push(s.to_string());
            }
        }
    }

    if let Some(perms) = val.get("required_permissions").and_then(|v| v.as_array()) {
        for perm in perms {
            if let Some(s) = perm.as_str() {
                let s = s.to_string();
                if !permissions.contains(&s) {
                    permissions.push(s);
                }
            }
        }
    }

    if let Some(sig) = val.get("signature").and_then(|v| v.as_str()) {
        if !sig.is_empty() {
            *signature_status = "signed".to_string();
        }
    }
}

/// Recursively scan a directory for risk patterns.
fn scan_directory_recursive(
    dir: &Path,
    signals: &mut Vec<RiskSignal>,
    category_hit: &mut [bool],
) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            // Skip node_modules, .git, etc.
            let dirname = path.file_name().unwrap_or_default().to_string_lossy();
            if dirname.starts_with('.') || dirname == "node_modules" {
                continue;
            }
            scan_directory_recursive(&path, signals, category_hit);
        } else if is_scannable_file(&path) {
            scan_file(&path, signals, category_hit);
        }
    }
}

/// Scan loose script files directly inside the skill root (not in subdirs).
fn scan_loose_scripts(
    root: &Path,
    signals: &mut Vec<RiskSignal>,
    category_hit: &mut [bool],
) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && is_scannable_file(&path) {
            scan_file(&path, signals, category_hit);
        }
    }
}

const SCANNABLE_EXTENSIONS: &[&str] = &[
    "js", "ts", "mjs", "cjs", "py", "sh", "bash", "zsh", "ps1", "bat", "cmd", "rb", "rs", "go",
];

fn is_scannable_file(path: &Path) -> bool {
    let Some(ext) = path.extension() else {
        return false;
    };
    let ext = ext.to_string_lossy().to_ascii_lowercase();
    SCANNABLE_EXTENSIONS.contains(&ext.as_str())
}

/// Scan a single file for all pattern groups.
fn scan_file(path: &Path, signals: &mut Vec<RiskSignal>, category_hit: &mut [bool]) {
    let Ok(content) = fs::read_to_string(path) else {
        return;
    };

    // Cap file size to 512 KB to stay performant.
    if content.len() > 512 * 1024 {
        return;
    }

    let file_path_str = path.to_string_lossy().to_string();

    for (line_num_0, line) in content.lines().enumerate() {
        let line_lower = line.to_ascii_lowercase();
        for (group_idx, group) in PATTERN_GROUPS.iter().enumerate() {
            for &pattern in group.patterns {
                if line.contains(pattern) || line_lower.contains(&pattern.to_ascii_lowercase()) {
                    category_hit[group_idx] = true;
                    signals.push(RiskSignal {
                        category: group.category.to_string(),
                        severity: group.severity.to_string(),
                        description: format!(
                            "Found '{}' pattern: `{}`",
                            group.category,
                            pattern
                        ),
                        file_path: Some(file_path_str.clone()),
                        line_number: Some((line_num_0 + 1) as u32),
                    });
                    // One signal per pattern per line is enough; don't duplicate for same pattern.
                    break;
                }
            }
        }
    }
}
