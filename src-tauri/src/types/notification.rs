use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct NotificationRecord {
    pub id: String,
    /// Serialized as "type" for frontend compatibility
    #[serde(rename = "type", alias = "notification_type")]
    pub notification_type: String,
    pub priority: String,
    pub title: String,
    pub body: String,
    pub timestamp: String,
    pub read: bool,
}
