use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct VaultKeyInfo {
    pub id: String,
    pub name: String,
    pub service: String,
    pub masked_value: String,
    pub created_at: String,
    pub last_used: Option<String>,
    pub encrypted: bool,
}
