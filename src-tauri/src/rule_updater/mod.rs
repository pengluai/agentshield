use std::fs;
use std::path::{Path, PathBuf};
#[cfg(test)]
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, Utc};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use semver::Version;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sha2::{Digest, Sha256};

const BUILTIN_RULE_BUNDLE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/resources/rules/default-skill-risk-rules.json"
));

#[cfg(not(test))]
const DEFAULT_RULE_SIGNING_PUBLIC_KEY_BASE64URL: &str = "REPLACE_WITH_RULE_SIGNING_PUBLIC_KEY";

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
    signature: Option<String>,
    expires_at: Option<String>,
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

#[cfg(not(test))]
fn rule_signing_public_key_bytes() -> Option<[u8; 32]> {
    let compiled_key = option_env!("AGENTSHIELD_RULE_SIGNING_PUBLIC_KEY")
        .map(str::to_string)
        .unwrap_or_else(|| DEFAULT_RULE_SIGNING_PUBLIC_KEY_BASE64URL.to_string());
    let selected_key = if cfg!(debug_assertions) {
        std::env::var("AGENTSHIELD_RULE_SIGNING_PUBLIC_KEY")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(compiled_key)
    } else {
        compiled_key
    };

    if selected_key.trim() == "REPLACE_WITH_RULE_SIGNING_PUBLIC_KEY" {
        return None;
    }

    let decoded = URL_SAFE_NO_PAD.decode(selected_key.trim()).ok()?;
    <[u8; 32]>::try_from(decoded.as_slice()).ok()
}

#[cfg(test)]
fn rule_signing_public_key_bytes() -> Option<[u8; 32]> {
    let key_str = std::env::var("AGENTSHIELD_RULE_SIGNING_PUBLIC_KEY")
        .ok()
        .filter(|value| !value.trim().is_empty())?;
    let decoded = URL_SAFE_NO_PAD.decode(key_str.trim()).ok()?;
    <[u8; 32]>::try_from(decoded.as_slice()).ok()
}

/// Build the canonical manifest payload for signature verification by removing
/// the `signature` field from the raw manifest JSON. The remaining fields are
/// serialized with keys in sorted order to produce a deterministic byte string.
fn canonical_manifest_payload(raw_json: &str) -> Result<Vec<u8>, String> {
    let mut value: JsonValue =
        serde_json::from_str(raw_json).map_err(|e| format!("Failed to parse manifest JSON: {e}"))?;
    if let Some(obj) = value.as_object_mut() {
        obj.remove("signature");
    }
    serde_json::to_vec(&value).map_err(|e| format!("Failed to re-serialize manifest: {e}"))
}

/// Verify the ed25519 signature on a remote rule manifest.
///
/// Returns `Ok(())` when verification passes.
/// Returns `Err` when the manifest is unsigned, when signature verification
/// fails, or when public key configuration is invalid/missing.
fn verify_manifest_signature(raw_manifest_json: &str, manifest: &RemoteRuleManifest) -> Result<(), String> {
    let Some(ref sig_b64) = manifest.signature else {
        if std::env::var("AGENTSHIELD_ALLOW_UNSIGNED_RULE_MANIFEST")
            .ok()
            .map(|value| value == "1")
            .unwrap_or(false)
        {
            eprintln!("[AgentShield] WARNING: remote rule manifest is unsigned but ALLOW_UNSIGNED override is enabled");
            return Ok(());
        }
        return Err("Remote rule manifest is missing signature — update rejected".to_string());
    };

    let key_bytes = rule_signing_public_key_bytes().ok_or_else(|| {
        "Rule signing public key is not configured — cannot verify signed manifest".to_string()
    })?;

    let sig_bytes = URL_SAFE_NO_PAD
        .decode(sig_b64.trim())
        .map_err(|_| "Failed to decode manifest signature (invalid base64url)".to_string())?;

    let signature = Signature::from_slice(&sig_bytes)
        .map_err(|_| "Manifest signature is malformed (expected 64 bytes)".to_string())?;

    let verifying_key = VerifyingKey::from_bytes(&key_bytes)
        .map_err(|e| format!("Rule signing public key is invalid: {e}"))?;

    let payload = canonical_manifest_payload(raw_manifest_json)?;

    verifying_key
        .verify(&payload, &signature)
        .map_err(|_| "Manifest ed25519 signature verification failed — update rejected".to_string())
}

/// Ensure the manifest version is strictly greater than the currently active
/// version to prevent rollback attacks.
fn verify_no_rollback(manifest_version: &str, current_version: &str) -> Result<(), String> {
    match (
        Version::parse(manifest_version),
        Version::parse(current_version),
    ) {
        (Ok(candidate), Ok(current)) => {
            if candidate <= current {
                return Err(format!(
                    "Manifest version {manifest_version} is not newer than current {current_version} — possible rollback attack"
                ));
            }
        }
        _ => {
            // Non-semver: fall back to string comparison; only block exact match.
            if manifest_version <= current_version {
                return Err(format!(
                    "Manifest version {manifest_version} is not newer than current {current_version} — possible rollback attack"
                ));
            }
        }
    }
    Ok(())
}

/// Reject manifests whose `expires_at` timestamp is in the past to prevent
/// freeze / replay attacks with stale manifests.
fn verify_not_expired(manifest: &RemoteRuleManifest) -> Result<(), String> {
    if let Some(ref expires_str) = manifest.expires_at {
        let expires = expires_str
            .parse::<DateTime<Utc>>()
            .map_err(|_| "Manifest expires_at is not a valid timestamp".to_string())?;
        if Utc::now() > expires {
            return Err(format!(
                "Rule manifest expired at {expires_str} — possible freeze attack, update rejected"
            ));
        }
    }
    Ok(())
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

async fn fetch_remote_manifest(
    manifest_url: &str,
) -> Result<(RemoteRuleManifest, String), String> {
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

    let raw_json = response
        .text()
        .await
        .map_err(|error| format!("Failed to read rule manifest body: {error}"))?;

    let manifest: RemoteRuleManifest = serde_json::from_str(&raw_json)
        .map_err(|error| format!("Failed to decode rule manifest: {error}"))?;

    Ok((manifest, raw_json))
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
        let (manifest, _raw_json) = fetch_remote_manifest(&manifest_url).await?;
        if version_changed(&manifest.version, &active_bundle.version) {
            status.update_available = true;
            status.available_version = Some(manifest.version);
        }
    }

    Ok(status)
}

pub async fn apply_latest_rules() -> Result<RuleUpdateStatus, String> {
    if let Some(manifest_url) = remote_manifest_url() {
        let (manifest, raw_manifest_json) = fetch_remote_manifest(&manifest_url).await?;

        // 1. Verify ed25519 signature (if present) BEFORE applying anything.
        verify_manifest_signature(&raw_manifest_json, &manifest)?;

        // 2. Prevent rollback: manifest version must be strictly newer.
        let (_active_bundle, active_meta) = active_bundle_and_metadata()?;
        verify_no_rollback(&manifest.version, &active_meta.version)?;

        // 3. Reject expired manifests (freeze-attack protection).
        verify_not_expired(&manifest)?;

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
    use ed25519_dalek::{Signer, SigningKey};

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

    fn test_keypair() -> (SigningKey, String) {
        let signing_key = SigningKey::from_bytes(&[42u8; 32]);
        let pub_key_b64 = URL_SAFE_NO_PAD.encode(signing_key.verifying_key().to_bytes());
        (signing_key, pub_key_b64)
    }

    fn sign_manifest_json(signing_key: &SigningKey, manifest_json: &str) -> String {
        let payload = canonical_manifest_payload(manifest_json).expect("canonical payload");
        let sig = signing_key.sign(&payload);
        URL_SAFE_NO_PAD.encode(sig.to_bytes())
    }

    #[test]
    fn verify_manifest_signature_accepts_valid_signature() {
        let _guard = TEST_RULES_ENV_LOCK.lock().expect("rules env lock");
        let (signing_key, pub_b64) = test_keypair();
        std::env::set_var("AGENTSHIELD_RULE_SIGNING_PUBLIC_KEY", &pub_b64);

        let manifest_no_sig = r#"{"version":"1.0.0","bundle_url":"https://example.com/b.json","checksum_sha256":"abc123"}"#;
        let sig = sign_manifest_json(&signing_key, manifest_no_sig);

        let raw_with_sig = format!(
            r#"{{"version":"1.0.0","bundle_url":"https://example.com/b.json","checksum_sha256":"abc123","signature":"{sig}"}}"#
        );
        let manifest: RemoteRuleManifest =
            serde_json::from_str(&raw_with_sig).expect("parse manifest");

        let result = verify_manifest_signature(&raw_with_sig, &manifest);
        assert!(result.is_ok(), "expected Ok, got: {result:?}");

        std::env::remove_var("AGENTSHIELD_RULE_SIGNING_PUBLIC_KEY");
    }

    #[test]
    fn verify_manifest_signature_rejects_tampered_manifest() {
        let _guard = TEST_RULES_ENV_LOCK.lock().expect("rules env lock");
        let (signing_key, pub_b64) = test_keypair();
        std::env::set_var("AGENTSHIELD_RULE_SIGNING_PUBLIC_KEY", &pub_b64);

        let manifest_no_sig = r#"{"version":"1.0.0","bundle_url":"https://example.com/b.json","checksum_sha256":"abc123"}"#;
        let sig = sign_manifest_json(&signing_key, manifest_no_sig);

        // Tamper: change the version after signing
        let raw_with_sig = format!(
            r#"{{"version":"2.0.0","bundle_url":"https://example.com/b.json","checksum_sha256":"abc123","signature":"{sig}"}}"#
        );
        let manifest: RemoteRuleManifest =
            serde_json::from_str(&raw_with_sig).expect("parse manifest");

        let result = verify_manifest_signature(&raw_with_sig, &manifest);
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("signature verification failed"),
            "expected signature failure error"
        );

        std::env::remove_var("AGENTSHIELD_RULE_SIGNING_PUBLIC_KEY");
    }

    #[test]
    fn verify_manifest_signature_rejects_unsigned_by_default() {
        let _guard = TEST_RULES_ENV_LOCK.lock().expect("rules env lock");
        std::env::remove_var("AGENTSHIELD_RULE_SIGNING_PUBLIC_KEY");
        std::env::remove_var("AGENTSHIELD_ALLOW_UNSIGNED_RULE_MANIFEST");

        let raw = r#"{"version":"1.0.0","bundle_url":"https://example.com/b.json"}"#;
        let manifest: RemoteRuleManifest = serde_json::from_str(raw).expect("parse manifest");

        let result = verify_manifest_signature(raw, &manifest);
        assert!(result.is_err(), "unsigned manifests should be rejected by default");
        assert!(result.unwrap_err().contains("missing signature"));
    }

    #[test]
    fn verify_manifest_signature_allows_unsigned_when_override_enabled() {
        let _guard = TEST_RULES_ENV_LOCK.lock().expect("rules env lock");
        std::env::remove_var("AGENTSHIELD_RULE_SIGNING_PUBLIC_KEY");
        std::env::set_var("AGENTSHIELD_ALLOW_UNSIGNED_RULE_MANIFEST", "1");

        let raw = r#"{"version":"1.0.0","bundle_url":"https://example.com/b.json"}"#;
        let manifest: RemoteRuleManifest = serde_json::from_str(raw).expect("parse manifest");

        let result = verify_manifest_signature(raw, &manifest);
        assert!(result.is_ok(), "override should allow unsigned manifest");
        std::env::remove_var("AGENTSHIELD_ALLOW_UNSIGNED_RULE_MANIFEST");
    }

    #[test]
    fn verify_no_rollback_rejects_older_version() {
        let result = verify_no_rollback("0.9.0", "1.0.0");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("rollback"));
    }

    #[test]
    fn verify_no_rollback_rejects_same_version() {
        let result = verify_no_rollback("1.0.0", "1.0.0");
        assert!(result.is_err());
    }

    #[test]
    fn verify_no_rollback_allows_newer_version() {
        let result = verify_no_rollback("2.0.0", "1.0.0");
        assert!(result.is_ok());
    }

    #[test]
    fn verify_not_expired_rejects_past_timestamp() {
        let manifest = RemoteRuleManifest {
            version: "1.0.0".to_string(),
            bundle_url: "https://example.com".to_string(),
            checksum_sha256: None,
            published_at: None,
            signature: None,
            expires_at: Some("2020-01-01T00:00:00Z".to_string()),
        };
        let result = verify_not_expired(&manifest);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("expired"));
    }

    #[test]
    fn verify_not_expired_allows_future_timestamp() {
        let manifest = RemoteRuleManifest {
            version: "1.0.0".to_string(),
            bundle_url: "https://example.com".to_string(),
            checksum_sha256: None,
            published_at: None,
            signature: None,
            expires_at: Some("2099-12-31T23:59:59Z".to_string()),
        };
        let result = verify_not_expired(&manifest);
        assert!(result.is_ok());
    }

    #[test]
    fn verify_not_expired_allows_no_expiry() {
        let manifest = RemoteRuleManifest {
            version: "1.0.0".to_string(),
            bundle_url: "https://example.com".to_string(),
            checksum_sha256: None,
            published_at: None,
            signature: None,
            expires_at: None,
        };
        let result = verify_not_expired(&manifest);
        assert!(result.is_ok());
    }

    #[test]
    fn canonical_manifest_payload_strips_signature() {
        let raw = r#"{"version":"1.0.0","signature":"abc123","bundle_url":"https://example.com"}"#;
        let payload = canonical_manifest_payload(raw).expect("canonical payload");
        let reparsed: JsonValue = serde_json::from_slice(&payload).expect("parse canonical");
        assert!(reparsed.get("signature").is_none());
        assert_eq!(reparsed.get("version").unwrap().as_str().unwrap(), "1.0.0");
    }
}
