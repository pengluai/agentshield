use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct StoreCatalogItem {
    pub id: String,
    pub name: String,
    pub description: String,
    pub safety_level: String,
    pub compatible_platforms: Vec<String>,
    pub rating: f32,
    pub install_count: u32,
    #[serde(default)]
    pub featured: bool,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub source_url: String,
    #[serde(default)]
    pub item_type: String, // "mcp" or "skill"
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub installable: bool,
    #[serde(default)]
    pub install_strategy: String,
    #[serde(default)]
    pub install_identifier: String,
    #[serde(default)]
    pub install_version: String,
    #[serde(default)]
    pub registry_name: String,
    #[serde(default)]
    pub requires_auth: bool,
    #[serde(default)]
    pub auth_headers: Vec<String>,
    #[serde(default)]
    pub openclaw_ready: bool,
    #[serde(default)]
    pub review_status: String,
    #[serde(default)]
    pub review_notes: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct InstalledItem {
    pub id: String,
    pub name: String,
    pub version: String,
    pub platform: String,
    pub installed_at: String,
    #[serde(default)]
    pub install_strategy: String,
    #[serde(default)]
    pub install_identifier: String,
    #[serde(default)]
    pub registry_name: String,
    #[serde(default)]
    pub source_url: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct InstallResult {
    pub success: bool,
    pub message: String,
    #[serde(default)]
    pub installed_platforms: Vec<String>,
    #[serde(default)]
    pub errors: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct UpdateResult {
    pub item_id: String,
    #[serde(default)]
    pub platform: String,
    #[serde(default)]
    pub source_path: String,
    pub current_version: String,
    pub new_version: String,
    pub has_update: bool,
    #[serde(default)]
    pub tracked: bool,
    #[serde(default)]
    pub reason: String,
}
