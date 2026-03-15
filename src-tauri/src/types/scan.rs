use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub enum ScanType {
    Full,
    QuickCheck,
    OpenClawOnly,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ScanReport {
    pub id: String,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub scan_type: ScanType,
    pub total_items: u32,
    pub completed_items: u32,
    pub score: u32,
    pub issues: Vec<SecurityIssue>,
    pub passed: Vec<PassedItem>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SemanticReview {
    pub verdict: String,
    pub confidence: u8,
    pub summary: String,
    pub recommended_action: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SemanticGuardSummary {
    pub licensed: bool,
    pub configured: bool,
    pub active: bool,
    pub reviewed_issues: u32,
    pub cache_hits: u32,
    pub message: String,
}

impl SemanticGuardSummary {
    pub fn disabled(licensed: bool, configured: bool, message: impl Into<String>) -> Self {
        Self {
            licensed,
            configured,
            active: false,
            reviewed_issues: 0,
            cache_hits: 0,
            message: message.into(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SecurityIssue {
    pub id: String,
    pub severity: String,
    pub title: String,
    pub description: String,
    pub auto_fixable: bool,
    pub pro_required: bool,
    /// File or directory path related to this issue (for "open in Finder")
    #[serde(default)]
    pub file_path: Option<String>,
    #[serde(default)]
    pub semantic_review: Option<SemanticReview>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PassedItem {
    pub id: String,
    pub title: String,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "snake_case")]
pub enum HostConfidence {
    High,
    Medium,
    #[default]
    Low,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "snake_case")]
pub enum ManagementCapability {
    #[default]
    DetectOnly,
    Manual,
    OneClick,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "snake_case")]
pub enum SourceTier {
    A,
    B,
    #[default]
    C,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct ToolRiskSurface {
    #[serde(default)]
    pub has_mcp: bool,
    #[serde(default)]
    pub has_skill: bool,
    #[serde(default)]
    pub has_exec_signal: bool,
    #[serde(default)]
    pub has_secret_signal: bool,
    #[serde(default)]
    pub evidence_count: u32,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct ToolEvidenceItem {
    #[serde(default)]
    pub evidence_type: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub detail: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DetectedTool {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub detected: bool,
    #[serde(default)]
    pub host_detected: bool,
    #[serde(default)]
    pub install_target_ready: bool,
    #[serde(default)]
    pub detection_sources: Vec<String>,
    pub path: Option<String>,
    pub version: Option<String>,
    pub has_mcp_config: bool,
    pub mcp_config_path: Option<String>,
    /// All found MCP config paths (a tool may have multiple config locations)
    pub mcp_config_paths: Vec<String>,
    #[serde(default)]
    pub host_confidence: HostConfidence,
    #[serde(default)]
    pub risk_surface: ToolRiskSurface,
    #[serde(default)]
    pub management_capability: ManagementCapability,
    #[serde(default)]
    pub source_tier: SourceTier,
    #[serde(default)]
    pub evidence_items: Vec<ToolEvidenceItem>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ExposedKey {
    pub id: String,
    pub key_pattern: String,
    pub file_path: String,
    pub platform: String,
    pub service: String,
    pub masked_value: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ScanCategory {
    pub id: String,
    pub name: String,
    pub issue_count: u32,
    pub issues: Vec<SecurityIssue>,
    pub passed_count: u32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RealScanResult {
    pub detected_tools: Vec<DetectedTool>,
    pub categories: Vec<ScanCategory>,
    pub exposed_keys: Vec<ExposedKey>,
    pub score: u32,
    pub total_issues: u32,
    pub semantic_guard: SemanticGuardSummary,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ScanProgressEvent {
    pub phase_id: String,
    pub label: String,
    pub progress: u8,
    pub status: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SystemReport {
    pub os: String,
    pub arch: String,
    pub node_installed: bool,
    pub node_version: Option<String>,
    pub npm_installed: bool,
    pub docker_installed: bool,
    pub openclaw_installed: bool,
    pub openclaw_version: Option<String>,
    pub git_installed: bool,
    pub detected_ai_tools: Vec<DetectedTool>,
}
