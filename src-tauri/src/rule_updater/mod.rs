use std::fs;
use std::path::{Path, PathBuf};
#[cfg(test)]
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use chrono::Utc;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const BUILTIN_RULE_BUNDLE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/resources/rules/default-skill-risk-rules.json"
));

#[cfg(test)]
pub(crate) static TEST_RULES_ENV_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SkillRiskPattern {
    pub capability: String,
    pub pattern: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SkillScanRuleBundle {
    pub scan_extensions: Vec<String>,
    pub suspicious: Vec<SkillRiskPattern>,
    pub malicious: Vec<SkillRiskPattern>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct RuleBundle {
    pub version: String,
    pub published_at: String,
    pub skill_scan: SkillScanRuleBundle,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct RuleBundleMeta {
    pub source: String,
    pub version: String,
    pub published_at: String,
    pub applied_at: String,
    pub checksum_sha256: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct RuleUpdateStatus {
    pub active_version: String,
    pub active_source: String,
    pub update_available: bool,
    pub available_version: Option<String>,
    pub last_applied_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
struct RemoteRuleManifest {
    version: String,
    bundle_url: String,
    checksum_sha256: Option<String>,
    published_at: Option<String>,
}

fn rules_root_dir() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("AGENTSHIELD_RULES_DIR") {
        return Ok(PathBuf::from(path));
    }

    dirs::home_dir()
        .map(|home| home.join(".agentshield").join("rules"))
        .ok_or_else(|| "Cannot resolve AgentShield rules directory".to_string())
}

fn bundle_path() -> Result<PathBuf, String> {
    Ok(rules_root_dir()?.join("skill-risk-rules.json"))
}

fn metadata_path() -> Result<PathBuf, String> {
    Ok(rules_root_dir()?.join("skill-risk-rules.meta.json"))
}

fn ensure_rules_dir() -> Result<(), String> {
    let dir = rules_root_dir()?;
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|error| format!("Failed to create rules dir: {error}"))?;
    }
    Ok(())
}

fn checksum_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

fn parse_bundle(input: &str) -> Result<RuleBundle, String> {
    serde_json::from_str(input).map_err(|error| format!("Failed to parse rule bundle: {error}"))
}

fn builtin_bundle() -> Result<RuleBundle, String> {
    parse_bundle(BUILTIN_RULE_BUNDLE)
}

fn builtin_metadata() -> Result<RuleBundleMeta, String> {
    let bundle = builtin_bundle()?;
    Ok(RuleBundleMeta {
        source: "builtin".to_string(),
        version: bundle.version.clone(),
        published_at: bundle.published_at.clone(),
        applied_at: bundle.published_at,
        checksum_sha256: checksum_hex(BUILTIN_RULE_BUNDLE.as_bytes()),
    })
}

fn load_bundle_from_disk(path: &Path) -> Result<(RuleBundle, String), String> {
    let raw =
        fs::read_to_string(path).map_err(|error| format!("Failed to read rule bundle: {error}"))?;
    let bundle = parse_bundle(&raw)?;
    Ok((bundle, checksum_hex(raw.as_bytes())))
}

fn load_metadata_from_disk(path: &Path) -> Result<RuleBundleMeta, String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read rule metadata: {error}"))?;
    serde_json::from_str(&raw).map_err(|error| format!("Failed to parse rule metadata: {error}"))
}

pub fn load_applied_bundle() -> Result<Option<(RuleBundle, RuleBundleMeta)>, String> {
    #[cfg(test)]
    if std::env::var_os("AGENTSHIELD_RULES_DIR").is_none() {
        return Ok(None);
    }

    let path = bundle_path()?;
    let meta_path = metadata_path()?;
    if !path.exists() || !meta_path.exists() {
        return Ok(None);
    }

    let (bundle, actual_checksum) = load_bundle_from_disk(&path)?;
    let metadata = load_metadata_from_disk(&meta_path)?;
    if metadata.checksum_sha256 != actual_checksum {
        return Ok(None);
    }

    Ok(Some((bundle, metadata)))
}

fn write_applied_bundle(
    bundle: &RuleBundle,
    source: &str,
    checksum: &str,
    published_at: Option<&str>,
) -> Result<RuleBundleMeta, String> {
    ensure_rules_dir()?;

    let bundle_json = serde_json::to_string_pretty(bundle)
        .map_err(|error| format!("Failed to serialize rule bundle: {error}"))?;
    let path = bundle_path()?;
    fs::write(&path, bundle_json)
        .map_err(|error| format!("Failed to write rule bundle: {error}"))?;

    let metadata = RuleBundleMeta {
        source: source.to_string(),
        version: bundle.version.clone(),
        published_at: published_at.unwrap_or(&bundle.published_at).to_string(),
        applied_at: Utc::now().to_rfc3339(),
        checksum_sha256: checksum.to_string(),
    };
    let metadata_json = serde_json::to_string_pretty(&metadata)
        .map_err(|error| format!("Failed to serialize rule metadata: {error}"))?;
    fs::write(metadata_path()?, metadata_json)
        .map_err(|error| format!("Failed to write rule metadata: {error}"))?;
    Ok(metadata)
}

fn remote_manifest_url() -> Option<String> {
    std::env::var("AGENTSHIELD_RULES_MANIFEST_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

async fn fetch_remote_manifest(manifest_url: &str) -> Result<RemoteRuleManifest, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("Failed to build HTTP client: {error}"))?;

    let response = client
        .get(manifest_url)
        .send()
        .await
        .map_err(|error| format!("Failed to fetch rule manifest: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Rule manifest request failed with status {}",
            response.status()
        ));
    }

    response
        .json::<RemoteRuleManifest>()
        .await
        .map_err(|error| format!("Failed to decode rule manifest: {error}"))
}

async fn fetch_remote_bundle(bundle_url: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("Failed to build HTTP client: {error}"))?;

    let response = client
        .get(bundle_url)
        .send()
        .await
        .map_err(|error| format!("Failed to fetch rule bundle: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Rule bundle request failed with status {}",
            response.status()
        ));
    }

    response
        .text()
        .await
        .map_err(|error| format!("Failed to read rule bundle body: {error}"))
}

fn version_changed(candidate: &str, current: &str) -> bool {
    match (Version::parse(candidate), Version::parse(current)) {
        (Ok(candidate_version), Ok(current_version)) => candidate_version > current_version,
        _ => candidate != current,
    }
}

fn active_bundle_and_metadata() -> Result<(RuleBundle, RuleBundleMeta), String> {
    if let Some((bundle, metadata)) = load_applied_bundle()? {
        return Ok((bundle, metadata));
    }

    Ok((builtin_bundle()?, builtin_metadata()?))
}

pub fn get_active_skill_scan_rules() -> Result<SkillScanRuleBundle, String> {
    Ok(active_bundle_and_metadata()?.0.skill_scan)
}

pub async fn get_rule_update_status() -> Result<RuleUpdateStatus, String> {
    let (active_bundle, active_meta) = active_bundle_and_metadata()?;
    let mut status = RuleUpdateStatus {
        active_version: active_bundle.version.clone(),
        active_source: active_meta.source.clone(),
        update_available: false,
        available_version: None,
        last_applied_at: Some(active_meta.applied_at.clone()),
    };

    if let Some(manifest_url) = remote_manifest_url() {
        let manifest = fetch_remote_manifest(&manifest_url).await?;
        if version_changed(&manifest.version, &active_bundle.version) {
            status.update_available = true;
            status.available_version = Some(manifest.version);
        }
    }

    Ok(status)
}

pub async fn apply_latest_rules() -> Result<RuleUpdateStatus, String> {
    if let Some(manifest_url) = remote_manifest_url() {
        let manifest = fetch_remote_manifest(&manifest_url).await?;
        let raw_bundle = fetch_remote_bundle(&manifest.bundle_url).await?;
        let checksum = checksum_hex(raw_bundle.as_bytes());
        if let Some(expected_checksum) = manifest.checksum_sha256.as_deref() {
            let expected = expected_checksum.trim().to_lowercase();
            if expected != checksum {
                return Err("Downloaded rule bundle checksum mismatch".to_string());
            }
        }

        let bundle = parse_bundle(&raw_bundle)?;
        write_applied_bundle(
            &bundle,
            &manifest.bundle_url,
            &checksum,
            manifest.published_at.as_deref(),
        )?;
        return get_rule_update_status().await;
    }

    let bundle = builtin_bundle()?;
    let checksum = checksum_hex(BUILTIN_RULE_BUNDLE.as_bytes());
    write_applied_bundle(&bundle, "builtin", &checksum, Some(&bundle.published_at))?;
    get_rule_update_status().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_bundle_is_valid() {
        let bundle = builtin_bundle().expect("builtin bundle");
        assert!(!bundle.version.is_empty());
        assert!(!bundle.skill_scan.malicious.is_empty());
    }

    #[test]
    fn apply_latest_rules_persists_builtin_bundle_without_remote_manifest() {
        let _guard = TEST_RULES_ENV_LOCK.lock().expect("rules env lock");
        let rules_dir = std::env::temp_dir().join(format!(
            "agentshield-rule-tests-apply-builtin-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&rules_dir);
        fs::create_dir_all(&rules_dir).expect("create rules test dir");
        std::env::set_var("AGENTSHIELD_RULES_DIR", &rules_dir);
        std::env::remove_var("AGENTSHIELD_RULES_MANIFEST_URL");
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("create tokio runtime");
        let status = runtime
            .block_on(apply_latest_rules())
            .expect("apply builtin rules");
        assert_eq!(status.active_source, "builtin");
        assert!(!status.active_version.is_empty());
        assert!(bundle_path().expect("bundle path").exists());
        assert!(metadata_path().expect("metadata path").exists());
        let _ = fs::remove_dir_all(&rules_dir);
        std::env::remove_var("AGENTSHIELD_RULES_DIR");
    }
}
