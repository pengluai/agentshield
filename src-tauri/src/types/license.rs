use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct LicenseInfo {
    pub plan: String,
    pub status: String,
    pub expires_at: Option<String>,
    pub trial_days_left: Option<u32>,
}
