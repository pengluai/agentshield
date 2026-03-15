use std::fs;
use std::path::PathBuf;

use chrono::{DateTime, Duration, Local, Utc};
use uuid::Uuid;

use crate::commands::license;
use crate::rule_updater;
use crate::rule_updater::RuleUpdateStatus;
use crate::types::notification::NotificationRecord;

const MAX_NOTIFICATIONS: usize = 500;
const FREE_RULE_SYNC_INTERVAL_DAYS: i64 = 7;

// ---------------------------------------------------------------------------
// Helper: paths & directory
// ---------------------------------------------------------------------------

fn get_data_dir() -> PathBuf {
    dirs::home_dir()
        .expect("cannot resolve home directory")
        .join(".agentshield")
}

fn get_notifications_path() -> PathBuf {
    get_data_dir().join("notifications.json")
}

fn ensure_data_dir() -> Result<(), String> {
    let dir = get_data_dir();
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create data dir: {e}"))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Helper: load / save
// ---------------------------------------------------------------------------

fn is_low_signal_security_notification(record: &NotificationRecord) -> bool {
    record.notification_type == "security"
        && record.priority == "warning"
        && matches!(
            record.title.as_str(),
            "发现新的 MCP / Skill"
                | "组件信任状态已更新"
                | "组件信任状态已手动更新"
                | "检测到组件运行"
                | "已通过运行时守卫受控启动组件"
                | "运行时会话已终止"
                | "组件网络策略已更新"
        )
}

fn trim_notifications(records: &mut Vec<NotificationRecord>) {
    if records.len() <= MAX_NOTIFICATIONS {
        return;
    }
    let drain_count = records.len().saturating_sub(MAX_NOTIFICATIONS);
    records.drain(0..drain_count);
}

fn load_notifications() -> Result<Vec<NotificationRecord>, String> {
    let path = get_notifications_path();
    if !path.exists() {
        return Ok(vec![]);
    }
    let data =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read notifications file: {e}"))?;
    let mut records: Vec<NotificationRecord> =
        serde_json::from_str(&data).map_err(|e| format!("Failed to parse notifications: {e}"))?;
    let original_len = records.len();
    records.retain(|record| !is_low_signal_security_notification(record));
    trim_notifications(&mut records);
    if records.len() != original_len {
        save_notifications(&records)?;
    }
    Ok(records)
}

fn save_notifications(records: &[NotificationRecord]) -> Result<(), String> {
    ensure_data_dir()?;
    let json = serde_json::to_string_pretty(records)
        .map_err(|e| format!("Failed to serialize notifications: {e}"))?;
    fs::write(get_notifications_path(), json)
        .map_err(|e| format!("Failed to write notifications file: {e}"))?;
    Ok(())
}

fn license_allows_realtime_rule_updates(plan: &str, status: &str) -> bool {
    matches!(plan, "trial" | "pro" | "enterprise") && status == "active"
}

fn free_rule_sync_next_available_at(last_applied_at: &str) -> Option<DateTime<Utc>> {
    let last_applied = DateTime::parse_from_rfc3339(last_applied_at).ok()?;
    Some(last_applied.with_timezone(&Utc) + Duration::days(FREE_RULE_SYNC_INTERVAL_DAYS))
}

// ---------------------------------------------------------------------------
// Helper: create default welcome notifications
// ---------------------------------------------------------------------------

fn create_welcome_notifications() -> Result<Vec<NotificationRecord>, String> {
    let now = Utc::now();

    let records = vec![
        NotificationRecord {
            id: Uuid::new_v4().to_string(),
            notification_type: "system".to_string(),
            priority: "info".to_string(),
            title: "欢迎使用 AgentShield 智盾".to_string(),
            body: "AgentShield 智盾已成功安装，为您的 AI Agent 提供全方位安全防护。".to_string(),
            timestamp: now.to_rfc3339(),
            read: false,
        },
        NotificationRecord {
            id: Uuid::new_v4().to_string(),
            notification_type: "security".to_string(),
            priority: "warning".to_string(),
            title: "建议运行首次安全扫描".to_string(),
            body: "请前往安全扫描页面，对已安装的 MCP 进行首次安全检查。".to_string(),
            timestamp: (now - chrono::Duration::seconds(1)).to_rfc3339(),
            read: false,
        },
        NotificationRecord {
            id: Uuid::new_v4().to_string(),
            notification_type: "system".to_string(),
            priority: "info".to_string(),
            title: "查看技能商店获取推荐 MCP".to_string(),
            body: "技能商店提供经过安全审核的 MCP 工具，快去看看吧。".to_string(),
            timestamp: (now - chrono::Duration::seconds(2)).to_rfc3339(),
            read: false,
        },
    ];

    save_notifications(&records)?;
    Ok(records)
}

// ---------------------------------------------------------------------------
// Public helper – callable from other modules
// ---------------------------------------------------------------------------

/// Append a notification. Can be called from scan, license, or any other module.
pub fn add_notification(
    notification_type: &str,
    priority: &str,
    title: &str,
    body: &str,
) -> Result<(), String> {
    ensure_data_dir()?;

    let mut records = load_notifications()?;

    // If the file didn't exist yet, seed with welcome notifications first.
    if records.is_empty() {
        records = create_welcome_notifications()?;
    }

    let record = NotificationRecord {
        id: Uuid::new_v4().to_string(),
        notification_type: notification_type.to_string(),
        priority: priority.to_string(),
        title: title.to_string(),
        body: body.to_string(),
        timestamp: Utc::now().to_rfc3339(),
        read: false,
    };

    records.push(record);
    trim_notifications(&mut records);
    save_notifications(&records)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_notifications() -> Result<Vec<NotificationRecord>, String> {
    ensure_data_dir()?;

    let mut records = load_notifications()?;

    // First launch: seed welcome notifications
    if records.is_empty() {
        records = create_welcome_notifications()?;
    }

    // Sort by timestamp descending (newest first)
    records.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    Ok(records)
}

#[tauri::command]
pub async fn mark_notification_read(id: String) -> Result<bool, String> {
    let mut records = load_notifications()?;

    let mut found = false;
    for record in records.iter_mut() {
        if record.id == id {
            record.read = true;
            found = true;
            break;
        }
    }

    if !found {
        return Err(format!("Notification with id '{id}' not found"));
    }

    save_notifications(&records)?;
    Ok(true)
}

#[tauri::command]
pub async fn create_notification(
    notification_type: String,
    priority: String,
    title: String,
    body: String,
) -> Result<bool, String> {
    add_notification(&notification_type, &priority, &title, &body)?;
    Ok(true)
}

#[tauri::command]
pub async fn delete_notification(id: String) -> Result<bool, String> {
    let mut records = load_notifications()?;
    let original_len = records.len();
    records.retain(|record| record.id != id);

    if records.len() == original_len {
        return Err(format!("Notification with id '{id}' not found"));
    }

    save_notifications(&records)?;
    Ok(true)
}

#[tauri::command]
pub async fn clear_notifications() -> Result<bool, String> {
    save_notifications(&[])?;
    Ok(true)
}

#[tauri::command]
pub async fn get_unread_count() -> Result<u32, String> {
    let records = load_notifications()?;
    let count = records.iter().filter(|r| !r.read).count() as u32;
    Ok(count)
}

#[tauri::command]
pub async fn get_rule_update_status() -> Result<RuleUpdateStatus, String> {
    rule_updater::get_rule_update_status().await
}

#[tauri::command]
pub async fn check_rule_update() -> Result<bool, String> {
    Ok(rule_updater::get_rule_update_status()
        .await?
        .update_available)
}

#[tauri::command]
pub async fn download_and_apply_rules() -> Result<bool, String> {
    let license_info = license::check_license_status().await?;
    if !license_allows_realtime_rule_updates(&license_info.plan, &license_info.status) {
        let current_status = rule_updater::get_rule_update_status().await?;
        if let Some(last_applied_at) = current_status.last_applied_at.as_deref() {
            if let Some(next_available_at) = free_rule_sync_next_available_at(last_applied_at) {
                let now = Utc::now();
                if now < next_available_at {
                    return Err(format!(
                        "免费版规则同步频率为每 7 天一次，请在 {} 后重试。",
                        next_available_at
                            .with_timezone(&Local)
                            .format("%Y-%m-%d %H:%M:%S")
                    ));
                }
            }
        }
    }

    let status = rule_updater::apply_latest_rules().await?;
    let source_label = if status.active_source == "builtin" {
        "内置规则"
    } else {
        "远端规则"
    };
    add_notification(
        "update",
        "info",
        "安全规则已同步",
        &format!(
            "当前使用规则版本 {}（{}）。后续扫描会立即采用这套规则。",
            status.active_version, source_label
        ),
    )?;

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn realtime_rule_updates_require_active_trial_or_paid_license() {
        assert!(license_allows_realtime_rule_updates("trial", "active"));
        assert!(license_allows_realtime_rule_updates("pro", "active"));
        assert!(license_allows_realtime_rule_updates("enterprise", "active"));
        assert!(!license_allows_realtime_rule_updates("free", "active"));
        assert!(!license_allows_realtime_rule_updates("trial", "expired"));
        assert!(!license_allows_realtime_rule_updates("pro", "suspended"));
    }

    #[test]
    fn free_rule_sync_next_available_at_is_seven_days_after_last_apply() {
        let next_at =
            free_rule_sync_next_available_at("2026-03-12T00:00:00Z").expect("parse timestamp");
        assert_eq!(next_at.to_rfc3339(), "2026-03-19T00:00:00+00:00");
    }

    #[test]
    fn free_rule_sync_next_available_at_rejects_invalid_timestamp() {
        assert!(free_rule_sync_next_available_at("invalid-time").is_none());
    }
}
