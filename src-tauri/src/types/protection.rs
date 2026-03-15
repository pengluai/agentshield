use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct ProtectionConfig {
    pub enabled: bool,
    pub auto_quarantine: bool,
    pub auto_quarantine_opt_in: bool,
}

impl Default for ProtectionConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            auto_quarantine: false,
            auto_quarantine_opt_in: false,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ProtectionIncident {
    pub id: String,
    pub timestamp: String,
    pub category: String,
    pub severity: String,
    pub title: String,
    pub description: String,
    pub file_path: String,
    pub action: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ProtectionStatus {
    pub enabled: bool,
    pub watcher_ready: bool,
    pub auto_quarantine: bool,
    pub watched_paths: Vec<String>,
    pub incident_count: u32,
    pub last_event_at: Option<String>,
    pub quarantine_dir: String,
    pub last_incident: Option<ProtectionIncident>,
}

impl ProtectionStatus {
    pub fn disabled(quarantine_dir: String) -> Self {
        Self {
            enabled: false,
            watcher_ready: false,
            auto_quarantine: false,
            watched_paths: vec![],
            incident_count: 0,
            last_event_at: None,
            quarantine_dir,
            last_incident: None,
        }
    }
}
