use crate::types::license::LicenseInfo;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, Duration, Utc};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use std::time::Duration as StdDuration;

const TRIAL_DURATION_DAYS: i64 = 14;
#[cfg(not(test))]
const LICENSE_KEYRING_SERVICE: &str = "com.agentshield.license";
const TRIAL_LOCK_KEY_ID: &str = "trial-lock-v1";
const LICENSE_ONLINE_CHECK_INTERVAL_HOURS: i64 = 6;
const LICENSE_ONLINE_REQUEST_TIMEOUT_SECS: u64 = 8;
const LICENSE_ONLINE_CONNECT_TIMEOUT_SECS: u64 = 5;
const LICENSE_ONLINE_USER_AGENT: &str = concat!("AgentShield/", env!("CARGO_PKG_VERSION"));
#[cfg(not(test))]
const DEFAULT_LICENSE_PUBLIC_KEY_BASE64URL: &str = "p-p1nNJB9CTwlvedV2If0h2A2_yHAbb7thMkVHRh620";

static ONLINE_CHECK_CACHE: LazyLock<Mutex<HashMap<String, DateTime<Utc>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq)]
struct LicenseData {
    key: Option<String>,
    plan: String,
    status: String,
    activated_at: Option<String>,
    expires_at: Option<String>,
    trial_start: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct SignedLicensePayload {
    plan: String,
    #[serde(default)]
    billing_cycle: Option<String>,
    #[serde(default)]
    expires_at: Option<String>,
    #[serde(default)]
    issued_at: Option<String>,
    #[serde(default)]
    license_id: Option<String>,
    #[serde(default)]
    customer: Option<String>,
}

#[derive(Serialize)]
struct LicenseVerifyRequest {
    activation_code: String,
}

#[derive(Deserialize)]
struct LicenseVerifyResponse {
    ok: bool,
    #[serde(default)]
    found: bool,
    #[serde(default)]
    license: Option<GatewayLicenseRecord>,
}

#[derive(Deserialize)]
struct GatewayLicenseRecord {
    #[allow(dead_code)]
    license_id: String,
    status: String,
    #[serde(default)]
    expires_at: Option<String>,
}

fn parse_signed_license_internal(
    key: &str,
    allow_expired: bool,
) -> Result<SignedLicensePayload, String> {
    let parts: Vec<&str> = key.trim().split('.').collect();
    if parts.len() != 3 || parts[0] != "AGSH" {
        return Err(
            "Invalid activation code format. Expected AGSH.<payload>.<signature>.".to_string(),
        );
    }

    let payload_bytes = URL_SAFE_NO_PAD
        .decode(parts[1])
        .map_err(|_| "Failed to decode activation payload".to_string())?;
    let signature_bytes = URL_SAFE_NO_PAD
        .decode(parts[2])
        .map_err(|_| "Failed to decode activation signature".to_string())?;

    let signature = Signature::from_slice(&signature_bytes)
        .map_err(|_| "Activation signature is malformed".to_string())?;
    let verifying_key = VerifyingKey::from_bytes(&public_key_bytes())
        .map_err(|e| format!("Embedded public key is invalid: {e}"))?;

    verifying_key
        .verify(&payload_bytes, &signature)
        .map_err(|_| "Activation signature verification failed".to_string())?;

    let payload: SignedLicensePayload = serde_json::from_slice(&payload_bytes)
        .map_err(|_| "Activation payload is not valid JSON".to_string())?;

    if payload.plan != "pro" && payload.plan != "enterprise" {
        return Err("Unsupported license plan in activation payload".to_string());
    }

    if let Some(ref expires_at) = payload.expires_at {
        let expires = expires_at
            .parse::<DateTime<Utc>>()
            .map_err(|_| "Activation payload contains an invalid expiry time".to_string())?;
        if !allow_expired && Utc::now() >= expires {
            return Err("This activation code has already expired".to_string());
        }
    }

    Ok(payload)
}

fn get_license_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".agentshield").join("license.json")
}

fn load_license() -> Option<LicenseData> {
    let path = get_license_path();
    let contents = fs::read_to_string(path).ok()?;
    serde_json::from_str(&contents).ok()
}

fn save_license(data: &LicenseData) -> Result<(), String> {
    let path = get_license_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {e}"))?;
    }
    let json =
        serde_json::to_string_pretty(data).map_err(|e| format!("Failed to serialize: {e}"))?;
    fs::write(path, json).map_err(|e| format!("Failed to write license file: {e}"))?;
    Ok(())
}

fn to_license_info(data: &LicenseData) -> LicenseInfo {
    let trial_days_left = if data.plan == "trial" && data.status == "active" {
        data.trial_start
            .as_ref()
            .and_then(|ts| ts.parse::<DateTime<Utc>>().ok())
            .map(|start| {
                let end = start + Duration::days(TRIAL_DURATION_DAYS);
                let remaining = end.signed_duration_since(Utc::now()).num_days();
                if remaining > 0 {
                    remaining as u32
                } else {
                    0
                }
            })
    } else {
        None
    };

    LicenseInfo {
        plan: data.plan.clone(),
        status: data.status.clone(),
        expires_at: data.expires_at.clone(),
        trial_days_left,
    }
}

#[cfg(not(test))]
fn license_secret_entry(key_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(LICENSE_KEYRING_SERVICE, key_id)
        .map_err(|error| format!("Failed to open system license keychain entry: {error}"))
}

#[cfg(not(test))]
fn store_license_secret(key_id: &str, value: &str) -> Result<(), String> {
    let entry = license_secret_entry(key_id)?;
    entry
        .set_password(value)
        .map_err(|error| format!("Failed to store license secret in system keychain: {error}"))
}

#[cfg(not(test))]
fn load_license_secret(key_id: &str) -> Result<String, String> {
    let entry = license_secret_entry(key_id)?;
    entry
        .get_password()
        .map_err(|error| format!("Failed to read license secret from system keychain: {error}"))
}

#[cfg(test)]
static TEST_LICENSE_SECRET_STORE: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[cfg(test)]
fn store_license_secret(key_id: &str, value: &str) -> Result<(), String> {
    let mut guard = TEST_LICENSE_SECRET_STORE
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    guard.insert(key_id.to_string(), value.to_string());
    Ok(())
}

#[cfg(test)]
fn load_license_secret(key_id: &str) -> Result<String, String> {
    let guard = TEST_LICENSE_SECRET_STORE
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    guard
        .get(key_id)
        .cloned()
        .ok_or_else(|| "License secret not found".to_string())
}

fn trial_was_used() -> bool {
    load_license_secret(TRIAL_LOCK_KEY_ID)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

fn mark_trial_as_used(at: &str) -> Result<(), String> {
    store_license_secret(TRIAL_LOCK_KEY_ID, at)
}

#[cfg(not(test))]
fn public_key_bytes() -> [u8; 32] {
    let compiled_key = option_env!("AGENTSHIELD_LICENSE_PUBLIC_KEY")
        .map(str::to_string)
        .unwrap_or_else(|| DEFAULT_LICENSE_PUBLIC_KEY_BASE64URL.to_string());
    let selected_key = if cfg!(debug_assertions) {
        env::var("AGENTSHIELD_LICENSE_PUBLIC_KEY")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(compiled_key)
    } else {
        compiled_key
    };

    let decoded = URL_SAFE_NO_PAD
        .decode(selected_key.trim())
        .ok()
        .filter(|bytes| bytes.len() == 32)
        .or_else(|| {
            URL_SAFE_NO_PAD
                .decode(DEFAULT_LICENSE_PUBLIC_KEY_BASE64URL.trim())
                .ok()
                .filter(|bytes| bytes.len() == 32)
        })
        .unwrap_or_else(|| vec![0u8; 32]);

    let mut key_bytes = [0u8; 32];
    key_bytes.copy_from_slice(&decoded[..32]);
    key_bytes
}

#[cfg(test)]
fn public_key_bytes() -> [u8; 32] {
    use ed25519_dalek::SigningKey;
    SigningKey::from_bytes(&[7u8; 32])
        .verifying_key()
        .to_bytes()
}

fn parse_signed_license(key: &str) -> Result<SignedLicensePayload, String> {
    parse_signed_license_internal(key, false)
}

fn parse_signed_license_allow_expired(key: &str) -> Result<SignedLicensePayload, String> {
    parse_signed_license_internal(key, true)
}

fn resolve_license_gateway_base_url() -> Option<String> {
    let runtime = env::var("AGENTSHIELD_LICENSE_GATEWAY_URL").ok();
    let compile_time = option_env!("AGENTSHIELD_LICENSE_GATEWAY_URL").map(str::to_string);
    let candidate = runtime.or(compile_time)?;
    let normalized = candidate.trim().trim_end_matches('/').to_string();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn cache_key_for_license(raw_key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(raw_key.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn should_skip_online_check(cache_key: &str, now: DateTime<Utc>) -> bool {
    let Ok(cache) = ONLINE_CHECK_CACHE.lock() else {
        return false;
    };
    let Some(last_checked_at) = cache.get(cache_key) else {
        return false;
    };
    let next_allowed = *last_checked_at + Duration::hours(LICENSE_ONLINE_CHECK_INTERVAL_HOURS);
    now < next_allowed
}

fn mark_online_check(cache_key: String, now: DateTime<Utc>) {
    if let Ok(mut cache) = ONLINE_CHECK_CACHE.lock() {
        cache.insert(cache_key, now);
    }
}

async fn maybe_refresh_paid_license_status(data: &mut LicenseData) {
    if !matches!(data.plan.as_str(), "pro" | "enterprise") || data.status != "active" {
        return;
    }

    let Some(activation_code) = data.key.clone() else {
        return;
    };
    let Some(gateway_base_url) = resolve_license_gateway_base_url() else {
        return;
    };

    let now = Utc::now();
    let cache_key = cache_key_for_license(&activation_code);
    if should_skip_online_check(&cache_key, now) {
        return;
    }

    let request_body = LicenseVerifyRequest { activation_code };

    let client = match Client::builder()
        .user_agent(LICENSE_ONLINE_USER_AGENT)
        .timeout(StdDuration::from_secs(LICENSE_ONLINE_REQUEST_TIMEOUT_SECS))
        .connect_timeout(StdDuration::from_secs(LICENSE_ONLINE_CONNECT_TIMEOUT_SECS))
        .build()
    {
        Ok(client) => client,
        Err(_) => return,
    };

    let response = match client
        .post(format!("{gateway_base_url}/client/licenses/verify"))
        .json(&request_body)
        .send()
        .await
    {
        Ok(response) => response,
        Err(_) => {
            mark_online_check(cache_key, now);
            return;
        }
    };

    let status = response.status();
    let body = match response.json::<LicenseVerifyResponse>().await {
        Ok(body) => body,
        Err(_) => {
            mark_online_check(cache_key, now);
            return;
        }
    };

    if !status.is_success() || !body.ok {
        mark_online_check(cache_key, now);
        return;
    }

    if !body.found {
        data.status = "suspended".to_string();
        mark_online_check(cache_key, now);
        return;
    }

    let Some(license) = body.license else {
        data.status = "suspended".to_string();
        mark_online_check(cache_key, now);
        return;
    };

    if let Some(remote_expiry) = license.expires_at {
        data.expires_at = Some(remote_expiry);
    }

    if license.status == "active" {
        if let Some(expiry) = data
            .expires_at
            .as_ref()
            .and_then(|value| value.parse::<DateTime<Utc>>().ok())
        {
            data.status = if now >= expiry {
                "expired".to_string()
            } else {
                "active".to_string()
            };
        } else {
            data.status = "active".to_string();
        }
    } else {
        data.status = "suspended".to_string();
    }

    mark_online_check(cache_key, now);
}

fn normalize_license_data(data: LicenseData, now: DateTime<Utc>) -> LicenseData {
    let trial_anchor = load_license_secret(TRIAL_LOCK_KEY_ID).ok();

    let downgrade_to_free = |activated_at: Option<String>| LicenseData {
        key: None,
        plan: "free".to_string(),
        status: "active".to_string(),
        activated_at,
        expires_at: None,
        trial_start: trial_anchor.clone(),
    };

    match data.plan.as_str() {
        "trial" => {
            let Some(trial_start) = data.trial_start.as_ref() else {
                return downgrade_to_free(data.activated_at);
            };

            // Keychain anchor validation — if keychain is inaccessible, try to
            // recover rather than permanently destroying the trial.
            let anchor_ok = match trial_anchor.as_ref() {
                Some(anchor) => anchor == trial_start,
                None => {
                    // Keychain read failed. If trial_start parses as a valid
                    // timestamp within the expected range, trust the file and
                    // attempt to re-create the keychain entry for next time.
                    if let Ok(start) = trial_start.parse::<DateTime<Utc>>() {
                        let earliest_plausible =
                            now - Duration::days(TRIAL_DURATION_DAYS + 30);
                        if start > earliest_plausible && start <= now {
                            // Best-effort keychain recovery
                            let _ = store_license_secret(TRIAL_LOCK_KEY_ID, trial_start);
                            true
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                }
            };

            if !anchor_ok {
                return downgrade_to_free(data.activated_at);
            }

            let Ok(start) = trial_start.parse::<DateTime<Utc>>() else {
                return downgrade_to_free(data.activated_at);
            };
            let expires = start + Duration::days(TRIAL_DURATION_DAYS);
            LicenseData {
                key: None,
                plan: "trial".to_string(),
                status: if now >= expires {
                    "expired".to_string()
                } else {
                    "active".to_string()
                },
                activated_at: data.activated_at,
                expires_at: Some(expires.to_rfc3339()),
                trial_start: Some(trial_start.clone()),
            }
        }
        "pro" | "enterprise" => {
            let Some(key) = data.key.as_ref() else {
                return downgrade_to_free(data.activated_at);
            };
            let Ok(payload) = parse_signed_license_allow_expired(key) else {
                return downgrade_to_free(data.activated_at);
            };

            let mut status = if matches!(data.status.as_str(), "suspended" | "cancelled") {
                data.status.clone()
            } else {
                "active".to_string()
            };
            let mut expires_at = payload.expires_at.clone();

            if let Some(ref expires_raw) = payload.expires_at {
                let Ok(expires) = expires_raw.parse::<DateTime<Utc>>() else {
                    return downgrade_to_free(data.activated_at);
                };
                if now >= expires {
                    status = "expired".to_string();
                }
                expires_at = Some(expires.to_rfc3339());
            }

            LicenseData {
                key: data.key,
                plan: payload.plan,
                status,
                activated_at: data.activated_at,
                expires_at,
                trial_start: data.trial_start.or(trial_anchor),
            }
        }
        "free" => LicenseData {
            key: None,
            plan: "free".to_string(),
            status: "active".to_string(),
            activated_at: data.activated_at,
            expires_at: None,
            trial_start: data.trial_start.or(trial_anchor),
        },
        _ => downgrade_to_free(data.activated_at),
    }
}

#[tauri::command]
pub async fn activate_license(key: String) -> Result<LicenseInfo, String> {
    let payload = parse_signed_license(&key)?;
    let now = Utc::now();

    let data = LicenseData {
        key: Some(key),
        plan: payload.plan,
        status: "active".to_string(),
        activated_at: Some(now.to_rfc3339()),
        expires_at: payload.expires_at,
        trial_start: load_license().and_then(|data| data.trial_start),
    };

    save_license(&data)?;
    Ok(to_license_info(&data))
}

#[tauri::command]
pub async fn check_license_status() -> Result<LicenseInfo, String> {
    let Some(data) = load_license() else {
        return Ok(LicenseInfo {
            plan: "free".to_string(),
            status: "active".to_string(),
            expires_at: None,
            trial_days_left: None,
        });
    };

    let mut normalized = normalize_license_data(data.clone(), Utc::now());
    maybe_refresh_paid_license_status(&mut normalized).await;
    if normalized != data {
        save_license(&normalized).ok();
    }

    Ok(to_license_info(&normalized))
}

#[tauri::command]
pub async fn deactivate_license() -> Result<bool, String> {
    let path = get_license_path();
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to remove license file: {e}"))?;
    }
    Ok(true)
}

#[tauri::command]
pub async fn start_trial() -> Result<LicenseInfo, String> {
    if trial_was_used() {
        return Err("Trial has already been used on this machine.".to_string());
    }

    if let Some(existing) = load_license() {
        if existing.trial_start.is_some() || existing.plan == "trial" {
            return Err("Trial has already been used on this machine.".to_string());
        }
    }

    let now = Utc::now();
    let expires = now + Duration::days(TRIAL_DURATION_DAYS);
    let now_rfc3339 = now.to_rfc3339();

    let data = LicenseData {
        key: None,
        plan: "trial".to_string(),
        status: "active".to_string(),
        activated_at: None,
        expires_at: Some(expires.to_rfc3339()),
        trial_start: Some(now_rfc3339.clone()),
    };

    mark_trial_as_used(&now_rfc3339)?;
    save_license(&data)?;
    Ok(to_license_info(&data))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use std::sync::{LazyLock, Mutex};

    static TEST_TRIAL_LOCK_SERIAL: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    fn reset_trial_lock() {
        TEST_LICENSE_SECRET_STORE
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(TRIAL_LOCK_KEY_ID);
    }

    fn with_trial_lock_guard<R>(f: impl FnOnce() -> R) -> R {
        let _guard = TEST_TRIAL_LOCK_SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        reset_trial_lock();
        let result = f();
        reset_trial_lock();
        result
    }

    fn build_test_license(plan: &str, expires_at: &str) -> String {
        let signing_key = SigningKey::from_bytes(&[7u8; 32]);
        let payload = serde_json::json!({
            "plan": plan,
            "expires_at": expires_at,
            "issued_at": "2026-03-09T00:00:00Z",
            "license_id": "lic_test_001",
            "customer": "tests"
        });
        let payload_bytes = serde_json::to_vec(&payload).unwrap();
        let signature = signing_key.sign(&payload_bytes);

        format!(
            "AGSH.{}.{}",
            URL_SAFE_NO_PAD.encode(payload_bytes),
            URL_SAFE_NO_PAD.encode(signature.to_bytes())
        )
    }

    #[test]
    fn verifies_signed_activation_code() {
        let license = build_test_license("pro", "2099-01-01T00:00:00Z");
        let parsed = parse_signed_license(&license).unwrap();
        assert_eq!(parsed.plan, "pro");
    }

    #[test]
    fn rejects_tampered_activation_code() {
        let mut license = build_test_license("pro", "2099-01-01T00:00:00Z");
        license.push('x');
        assert!(parse_signed_license(&license).is_err());
    }

    #[test]
    fn trial_lock_persists_in_secret_store() {
        with_trial_lock_guard(|| {
            assert!(!trial_was_used());
            mark_trial_as_used("2026-03-11T00:00:00Z").unwrap();
            assert!(trial_was_used());
        });
    }

    #[test]
    fn trial_duration_is_14_days() {
        let now = Utc::now();
        let data = LicenseData {
            key: None,
            plan: "trial".to_string(),
            status: "active".to_string(),
            activated_at: None,
            expires_at: Some((now + Duration::days(TRIAL_DURATION_DAYS)).to_rfc3339()),
            trial_start: Some(now.to_rfc3339()),
        };

        let info = to_license_info(&data);
        assert!(info.trial_days_left.unwrap_or_default() <= 14);
    }

    #[test]
    fn normalize_license_data_downgrades_tampered_paid_file() {
        with_trial_lock_guard(|| {
            let data = LicenseData {
                key: Some("AGSH.invalid.payload".to_string()),
                plan: "pro".to_string(),
                status: "active".to_string(),
                activated_at: Some("2026-03-11T00:00:00Z".to_string()),
                expires_at: Some("2099-01-01T00:00:00Z".to_string()),
                trial_start: None,
            };

            let normalized = normalize_license_data(
                data,
                DateTime::parse_from_rfc3339("2026-03-12T00:00:00Z")
                    .unwrap()
                    .with_timezone(&Utc),
            );
            assert_eq!(normalized.plan, "free");
            assert_eq!(normalized.status, "active");
            assert!(normalized.key.is_none());
        });
    }

    #[test]
    fn normalize_license_data_keeps_valid_paid_status() {
        with_trial_lock_guard(|| {
            let key = build_test_license("pro", "2099-01-01T00:00:00Z");
            let data = LicenseData {
                key: Some(key),
                plan: "pro".to_string(),
                status: "active".to_string(),
                activated_at: Some("2026-03-11T00:00:00Z".to_string()),
                expires_at: Some("2099-01-01T00:00:00Z".to_string()),
                trial_start: None,
            };

            let normalized = normalize_license_data(
                data,
                DateTime::parse_from_rfc3339("2026-03-12T00:00:00Z")
                    .unwrap()
                    .with_timezone(&Utc),
            );
            assert_eq!(normalized.plan, "pro");
            assert_eq!(normalized.status, "active");
        });
    }

    #[test]
    fn normalize_license_data_recovers_trial_when_keychain_missing_but_plausible() {
        with_trial_lock_guard(|| {
            let data = LicenseData {
                key: None,
                plan: "trial".to_string(),
                status: "active".to_string(),
                activated_at: None,
                expires_at: None,
                trial_start: Some("2026-03-11T00:00:00Z".to_string()),
            };

            let normalized = normalize_license_data(
                data,
                DateTime::parse_from_rfc3339("2026-03-12T00:00:00Z")
                    .unwrap()
                    .with_timezone(&Utc),
            );
            // With keychain recovery, a plausible trial_start is trusted
            assert_eq!(normalized.plan, "trial");
            assert_eq!(normalized.status, "active");
        });
    }

    #[test]
    fn normalize_license_data_rejects_trial_with_implausible_start() {
        with_trial_lock_guard(|| {
            let data = LicenseData {
                key: None,
                plan: "trial".to_string(),
                status: "active".to_string(),
                activated_at: None,
                expires_at: None,
                // trial_start far in the future — implausible
                trial_start: Some("2099-01-01T00:00:00Z".to_string()),
            };

            let normalized = normalize_license_data(
                data,
                DateTime::parse_from_rfc3339("2026-03-12T00:00:00Z")
                    .unwrap()
                    .with_timezone(&Utc),
            );
            assert_eq!(normalized.plan, "free");
        });
    }

    #[test]
    fn normalize_license_data_expires_trial_with_matching_lock() {
        with_trial_lock_guard(|| {
            let trial_start = "2026-03-01T00:00:00Z";
            mark_trial_as_used(trial_start).unwrap();

            let data = LicenseData {
                key: None,
                plan: "trial".to_string(),
                status: "active".to_string(),
                activated_at: None,
                expires_at: None,
                trial_start: Some(trial_start.to_string()),
            };

            let normalized = normalize_license_data(
                data,
                DateTime::parse_from_rfc3339("2026-03-20T00:00:00Z")
                    .unwrap()
                    .with_timezone(&Utc),
            );
            assert_eq!(normalized.plan, "trial");
            assert_eq!(normalized.status, "expired");
        });
    }
}
