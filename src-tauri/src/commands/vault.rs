use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[cfg(test)]
use std::sync::LazyLock;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use zeroize::Zeroize;

use crate::commands::scan::{collect_config_files, scan_file_for_keys};
use crate::commands::{license, runtime_guard};
use crate::types::scan::ExposedKey;
use crate::types::vault::VaultKeyInfo;

const FREE_VAULT_KEY_LIMIT: usize = 10;

#[derive(Serialize, Deserialize, Clone)]
struct VaultEntry {
    id: String,
    name: String,
    service: String,
    created_at: String,
    last_used: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct LegacyVaultEntry {
    id: String,
    name: String,
    service: String,
    raw_value: String,
    created_at: String,
    last_used: Option<String>,
}

static EXPOSED_KEY_CACHE: Mutex<Option<HashMap<String, ExposedKeyCache>>> = Mutex::new(None);
static VAULT_IO_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone)]
struct ExposedKeyCache {
    raw_value: String,
    name: String,
    service: String,
}

fn clear_exposed_key_cache(cache: &mut Option<HashMap<String, ExposedKeyCache>>) {
    if let Some(existing) = cache.take() {
        for (_, mut entry) in existing {
            entry.raw_value.zeroize();
        }
    }
}

#[cfg(test)]
static TEST_SECRET_STORE: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn get_vault_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".agentshield").join("vault.json")
}

fn get_legacy_backup_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".agentshield").join("vault-legacy-backup.json")
}

#[cfg(windows)]
fn harden_windows_paths(paths: &[PathBuf]) -> Result<(), String> {
    let targets = paths
        .iter()
        .filter(|path| path.exists())
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<_>>();
    if targets.is_empty() {
        return Ok(());
    }

    let results = crate::commands::scan::run_windows_permission_fix(&targets, false)?;
    let failures = results
        .into_iter()
        .filter(|result| !result.success)
        .map(|result| {
            format!(
                "{} ({})",
                result.path,
                result.error.unwrap_or_else(|| "unknown error".to_string())
            )
        })
        .collect::<Vec<_>>();
    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Failed to harden Windows vault ACL for: {}",
            failures.join(", ")
        ))
    }
}

#[cfg(not(windows))]
fn harden_windows_paths(_paths: &[PathBuf]) -> Result<(), String> {
    Ok(())
}

fn harden_path_permissions(path: &Path, is_dir: bool) -> Result<(), String> {
    #[cfg(unix)]
    {
        let mode = if is_dir { 0o700 } else { 0o600 };
        fs::set_permissions(path, fs::Permissions::from_mode(mode))
            .map_err(|error| format!("Failed to harden permissions for {}: {error}", path.display()))?;
    }
    #[cfg(not(unix))]
    {
        let _ = (path, is_dir);
    }
    Ok(())
}

fn harden_vault_artifacts() -> Result<(), String> {
    let vault_dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".agentshield");
    harden_path_permissions(&vault_dir, true)?;

    let targets = vec![get_vault_path(), get_legacy_backup_path()];
    for target in &targets {
        if target.exists() {
            harden_path_permissions(target, false)?;
        }
    }
    harden_windows_paths(&targets)?;
    Ok(())
}

fn ensure_vault_dir() -> Result<(), String> {
    let dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".agentshield");

    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create vault dir: {e}"))?;
    }

    harden_path_permissions(&dir, true)?;
    harden_windows_paths(&[dir])?;

    Ok(())
}

fn mask_value(val: &str) -> String {
    let len = val.len();
    if len <= 5 {
        return "****".to_string();
    }
    let prefix = &val[..3];
    let suffix = &val[len - 2..];
    format!("{prefix}****{suffix}")
}

#[cfg(not(test))]
fn store_secret(key_id: &str, raw_value: &str) -> Result<(), String> {
    let entry = keyring::Entry::new("com.agentshield.vault", key_id)
        .map_err(|e| format!("Failed to open system keychain entry: {e}"))?;
    entry
        .set_password(raw_value)
        .map_err(|e| format!("Failed to store secret in system keychain: {e}"))
}

#[cfg(not(test))]
fn load_secret(key_id: &str) -> Result<String, String> {
    let entry = keyring::Entry::new("com.agentshield.vault", key_id)
        .map_err(|e| format!("Failed to open system keychain entry: {e}"))?;
    entry
        .get_password()
        .map_err(|e| format!("Failed to read secret from system keychain: {e}"))
}

#[cfg(not(test))]
fn delete_secret(key_id: &str) -> Result<(), String> {
    let entry = keyring::Entry::new("com.agentshield.vault", key_id)
        .map_err(|e| format!("Failed to open system keychain entry: {e}"))?;
    entry
        .delete_credential()
        .map_err(|e| format!("Failed to delete secret from system keychain: {e}"))
}

#[cfg(test)]
fn store_secret(key_id: &str, raw_value: &str) -> Result<(), String> {
    TEST_SECRET_STORE
        .lock()
        .map_err(|e| format!("Secret store lock error: {e}"))?
        .insert(key_id.to_string(), raw_value.to_string());
    Ok(())
}

#[cfg(test)]
fn load_secret(key_id: &str) -> Result<String, String> {
    TEST_SECRET_STORE
        .lock()
        .map_err(|e| format!("Secret store lock error: {e}"))?
        .get(key_id)
        .cloned()
        .ok_or_else(|| "Secret not found in test store".to_string())
}

#[cfg(test)]
fn delete_secret(key_id: &str) -> Result<(), String> {
    TEST_SECRET_STORE
        .lock()
        .map_err(|e| format!("Secret store lock error: {e}"))?
        .remove(key_id);
    Ok(())
}

fn save_vault(entries: &[VaultEntry]) -> Result<(), String> {
    ensure_vault_dir()?;
    let path = get_vault_path();
    let data = serde_json::to_string_pretty(entries)
        .map_err(|e| format!("Failed to serialize vault metadata: {e}"))?;
    fs::write(&path, data).map_err(|e| format!("Failed to write vault metadata file: {e}"))?;

    harden_vault_artifacts()?;

    Ok(())
}

fn migrate_legacy_vault_if_needed() -> Result<(), String> {
    let path = get_vault_path();
    if !path.exists() {
        return Ok(());
    }

    let data = fs::read_to_string(&path).map_err(|e| format!("Failed to read vault file: {e}"))?;
    if data.trim().is_empty() {
        return Ok(());
    }

    let payload: Value =
        serde_json::from_str(&data).map_err(|e| format!("Failed to parse vault file: {e}"))?;

    let Some(entries) = payload.as_array() else {
        return Err("Vault metadata must be a JSON array".to_string());
    };

    let is_legacy = entries.iter().any(|entry| {
        entry
            .as_object()
            .map(|map| map.contains_key("raw_value"))
            .unwrap_or(false)
    });

    if !is_legacy {
        return Ok(());
    }

    let legacy_entries: Vec<LegacyVaultEntry> = serde_json::from_value(payload)
        .map_err(|e| format!("Failed to parse legacy vault format: {e}"))?;

    let backup_path = get_legacy_backup_path();
    if !backup_path.exists() {
        fs::write(&backup_path, &data)
            .map_err(|e| format!("Failed to write vault backup file: {e}"))?;
        harden_vault_artifacts()?;
    }

    let mut migrated_entries = Vec::with_capacity(legacy_entries.len());
    for legacy in legacy_entries {
        store_secret(&legacy.id, &legacy.raw_value)?;
        migrated_entries.push(VaultEntry {
            id: legacy.id,
            name: legacy.name,
            service: legacy.service,
            created_at: legacy.created_at,
            last_used: legacy.last_used,
        });
    }

    save_vault(&migrated_entries)
}

fn load_vault() -> Result<Vec<VaultEntry>, String> {
    migrate_legacy_vault_if_needed()?;
    let path = get_vault_path();
    if !path.exists() {
        return Ok(vec![]);
    }

    let data = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read vault metadata file: {e}"))?;
    if data.trim().is_empty() {
        return Ok(vec![]);
    }

    serde_json::from_str(&data).map_err(|e| format!("Failed to parse vault metadata file: {e}"))
}

fn entry_to_info(entry: &VaultEntry) -> VaultKeyInfo {
    let masked_value = load_secret(&entry.id)
        .map(|raw| mask_value(&raw))
        .unwrap_or_else(|_| "system-keychain".to_string());

    VaultKeyInfo {
        id: entry.id.clone(),
        name: entry.name.clone(),
        service: entry.service.clone(),
        masked_value,
        created_at: entry.created_at.clone(),
        last_used: entry.last_used.clone(),
        encrypted: true,
    }
}

fn extract_raw_value_from_file(file_path: &str, masked: &str) -> Option<String> {
    let content = fs::read_to_string(file_path).ok()?;
    let parts: Vec<&str> = masked.splitn(2, "****").collect();
    let (prefix, suffix) = if parts.len() == 2 {
        (parts[0], parts[1])
    } else {
        return None;
    };

    let mut start = 0;
    while start < content.len() {
        if let Some(index) = content[start..].find(prefix) {
            let absolute = start + index;
            let token_end = content[absolute..]
                .find(|c: char| {
                    c == '"' || c == '\'' || c == '\n' || c == '\r' || c == ' ' || c == ','
                })
                .map(|offset| absolute + offset)
                .unwrap_or(content.len());
            let token = &content[absolute..token_end];
            if token.len() >= 8 && token.ends_with(suffix) {
                return Some(token.to_string());
            }
            start = absolute + prefix.len();
        } else {
            break;
        }
    }

    None
}

#[tauri::command]
pub async fn vault_list_keys() -> Result<Vec<VaultKeyInfo>, String> {
    let _vault_guard = VAULT_IO_LOCK
        .lock()
        .map_err(|error| format!("Vault lock error: {error}"))?;
    let entries = load_vault()?;
    Ok(entries.iter().map(entry_to_info).collect())
}

#[tauri::command]
pub async fn vault_add_key(
    name: String,
    service: String,
    value: String,
) -> Result<VaultKeyInfo, String> {
    let license = license::check_license_status().await?;
    let unlimited = matches!(license.plan.as_str(), "pro" | "enterprise" | "trial")
        && license.status == "active";

    let _vault_guard = VAULT_IO_LOCK
        .lock()
        .map_err(|error| format!("Vault lock error: {error}"))?;
    let mut entries = load_vault()?;

    if !unlimited && entries.len() >= FREE_VAULT_KEY_LIMIT {
        return Err(format!(
            "免费版最多可保存 {} 个密钥，请升级 Pro 或先删除旧密钥。",
            FREE_VAULT_KEY_LIMIT
        ));
    }

    let entry = VaultEntry {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        service,
        created_at: chrono::Utc::now().to_rfc3339(),
        last_used: None,
    };

    store_secret(&entry.id, &value)?;
    let info = entry_to_info(&entry);
    entries.push(entry);
    save_vault(&entries)?;

    Ok(info)
}

#[tauri::command]
pub async fn vault_delete_key(
    key_id: String,
    approval_ticket: Option<String>,
) -> Result<bool, String> {
    let _vault_guard = VAULT_IO_LOCK
        .lock()
        .map_err(|error| format!("Vault lock error: {error}"))?;
    let mut entries = load_vault()?;
    let Some(index) = entries.iter().position(|entry| entry.id == key_id) else {
        return Ok(false);
    };
    let action_targets = vec![entries[index].name.clone()];
    runtime_guard::require_action_approval_ticket(
        approval_ticket.as_deref(),
        "agentshield:key-vault",
        "credential_delete",
        &action_targets,
        "user_requested_key_delete",
    )?;

    entries.remove(index);
    let _ = delete_secret(&key_id);
    save_vault(&entries)?;
    Ok(true)
}

#[tauri::command]
pub async fn vault_get_key(key_id: String) -> Result<Option<VaultKeyInfo>, String> {
    let _vault_guard = VAULT_IO_LOCK
        .lock()
        .map_err(|error| format!("Vault lock error: {error}"))?;
    let entries = load_vault()?;
    Ok(entries
        .iter()
        .find(|entry| entry.id == key_id)
        .map(entry_to_info))
}

#[tauri::command]
pub async fn vault_reveal_key_value(
    key_id: String,
    approval_ticket: Option<String>,
) -> Result<String, String> {
    let _vault_guard = VAULT_IO_LOCK
        .lock()
        .map_err(|error| format!("Vault lock error: {error}"))?;
    let mut entries = load_vault()?;
    let Some(index) = entries.iter().position(|entry| entry.id == key_id) else {
        return Err("Key not found".to_string());
    };
    let action_targets = vec![entries[index].name.clone()];
    runtime_guard::require_action_approval_ticket(
        approval_ticket.as_deref(),
        "agentshield:key-vault",
        "credential_export",
        &action_targets,
        "user_requested_key_export",
    )?;

    let raw_value = load_secret(&entries[index].id)?;
    entries[index].last_used = Some(chrono::Utc::now().to_rfc3339());
    save_vault(&entries)?;

    Ok(raw_value)
}

#[tauri::command]
pub async fn vault_scan_exposed_keys() -> Result<Vec<ExposedKey>, String> {
    let config_files = collect_config_files();
    let mut results = Vec::new();
    let mut cache = HashMap::new();

    for (path, platform) in &config_files {
        let exposed = scan_file_for_keys(path, platform);

        for key in exposed {
            let raw_value =
                extract_raw_value_from_file(&key.file_path, &key.masked_value).unwrap_or_default();

            cache.insert(
                key.id.clone(),
                ExposedKeyCache {
                    raw_value,
                    name: format!("{} ({})", key.service, key.platform),
                    service: key.service.clone(),
                },
            );

            results.push(key);
        }
    }

    if let Ok(mut guard) = EXPOSED_KEY_CACHE.lock() {
        clear_exposed_key_cache(&mut *guard);
        *guard = Some(cache);
    }

    Ok(results)
}

#[tauri::command]
pub async fn vault_import_exposed_key(key_id: String) -> Result<bool, String> {
    let cached = {
        let guard = EXPOSED_KEY_CACHE
            .lock()
            .map_err(|e| format!("Cache lock error: {e}"))?;
        guard.as_ref().and_then(|cache| cache.get(&key_id).cloned())
    };

    let mut cached = cached.ok_or_else(|| {
        "Exposed key not found in scan cache. Please run the vault exposure scan again.".to_string()
    })?;

    if cached.raw_value.trim().is_empty() {
        return Err("Unable to recover the raw key from the source file.".to_string());
    }

    let license = license::check_license_status().await?;
    let unlimited = matches!(license.plan.as_str(), "pro" | "enterprise" | "trial")
        && license.status == "active";

    let _vault_guard = VAULT_IO_LOCK
        .lock()
        .map_err(|error| format!("Vault lock error: {error}"))?;
    let mut entries = load_vault()?;
    if !unlimited && entries.len() >= FREE_VAULT_KEY_LIMIT {
        return Err(format!(
            "免费版最多可保存 {} 个密钥，请升级 Pro 或先删除旧密钥。",
            FREE_VAULT_KEY_LIMIT
        ));
    }

    let entry = VaultEntry {
        id: uuid::Uuid::new_v4().to_string(),
        name: cached.name,
        service: cached.service,
        created_at: chrono::Utc::now().to_rfc3339(),
        last_used: None,
    };

    store_secret(&entry.id, &cached.raw_value)?;
    entries.push(entry);
    save_vault(&entries)?;
    cached.raw_value.zeroize();

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn masked(prefix: &str, suffix: &str) -> String {
        format!("{prefix}****{suffix}")
    }

    #[test]
    fn mask_value_redacts_middle() {
        assert_eq!(mask_value("sk-1234567890"), "sk-****90");
        assert_eq!(mask_value("short"), "****");
    }

    #[test]
    fn split_exposed_secret_from_file_contents() {
        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join(format!("agentshield-vault-{}.env", uuid::Uuid::new_v4()));
        fs::write(&file_path, "OPENAI_API_KEY=sk-secret-value-42\n").unwrap();

        let raw =
            extract_raw_value_from_file(file_path.to_str().unwrap(), &masked("sk-", "42")).unwrap();
        assert_eq!(raw, "sk-secret-value-42");

        let _ = fs::remove_file(file_path);
    }

    #[test]
    fn test_secret_store_roundtrip() {
        let key_id = uuid::Uuid::new_v4().to_string();
        store_secret(&key_id, "vault-secret").unwrap();
        assert_eq!(load_secret(&key_id).unwrap(), "vault-secret");
        delete_secret(&key_id).unwrap();
    }
}
