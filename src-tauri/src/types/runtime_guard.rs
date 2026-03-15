use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Default)]
#[serde(default)]
pub struct RuntimeGuardComponent {
    pub component_id: String,
    pub component_type: String,
    pub name: String,
    pub platform_id: String,
    pub platform_name: String,
    pub source_kind: String,
    pub install_channel: String,
    pub config_path: String,
    pub exec_command: String,
    pub exec_args: Vec<String>,
    pub file_hash: String,
    pub signing_state: String,
    pub trust_state: String,
    pub network_mode: String,
    pub allowed_domains: Vec<String>,
    pub allowed_env_keys: Vec<String>,
    pub sensitive_capabilities: Vec<String>,
    pub requires_explicit_approval: bool,
    pub risk_summary: String,
    pub first_seen_at: String,
    pub last_seen_at: String,
    pub last_launched_at: Option<String>,
    pub last_parent_pid: Option<u32>,
    pub last_supervisor_session_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Default)]
#[serde(default)]
pub struct RuntimeGuardEvent {
    pub id: String,
    pub timestamp: String,
    pub event_type: String,
    pub component_id: String,
    pub severity: String,
    pub title: String,
    pub description: String,
    pub action: String,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Default)]
#[serde(default)]
pub struct RuntimeApprovalRequest {
    pub id: String,
    pub created_at: String,
    pub updated_at: String,
    pub status: String,
    pub component_id: String,
    pub component_name: String,
    pub platform_id: String,
    pub platform_name: String,
    pub request_kind: String,
    pub trigger_event: String,
    pub title: String,
    pub summary: String,
    pub approval_label: String,
    pub deny_label: String,
    pub action_kind: String,
    pub action_source: String,
    pub action_targets: Vec<String>,
    pub action_preview: Vec<String>,
    pub is_destructive: bool,
    pub is_batch: bool,
    #[serde(default)]
    pub approval_scope_key: Option<String>,
    pub requested_host: Option<String>,
    pub sensitive_capabilities: Vec<String>,
    pub consequence_lines: Vec<String>,
    pub launch_after_approval: bool,
    pub session_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Default)]
#[serde(default)]
pub struct RuntimeConnection {
    pub pid: u32,
    pub protocol: String,
    pub local_address: String,
    pub remote_address: String,
    pub remote_host_hint: String,
    pub state: String,
    pub observed_at: String,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Default)]
#[serde(default)]
pub struct RuntimeGuardSession {
    pub session_id: String,
    pub component_id: String,
    pub component_name: String,
    pub platform_id: String,
    pub pid: u32,
    pub parent_pid: Option<u32>,
    pub child_pids: Vec<u32>,
    pub observed: bool,
    pub supervised: bool,
    pub status: String,
    pub commandline: String,
    pub exe_path: String,
    pub cwd: String,
    pub started_at: String,
    pub last_seen_at: String,
    pub ended_at: Option<String>,
    pub network_connections: Vec<RuntimeConnection>,
    pub last_violation: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(default)]
pub struct RuntimeGuardStatus {
    pub enabled: bool,
    pub polling: bool,
    pub last_poll_at: Option<String>,
    pub active_sessions: u32,
    pub blocked_actions: u32,
    pub pending_approvals: u32,
    pub last_violation: Option<String>,
}

impl Default for RuntimeGuardStatus {
    fn default() -> Self {
        Self {
            enabled: true,
            polling: false,
            last_poll_at: None,
            active_sessions: 0,
            blocked_actions: 0,
            pending_approvals: 0,
            last_violation: None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct RuntimeGuardPolicy {
    pub unknown_default_trust: String,
    pub managed_default_trust: String,
    pub reviewed_default_trust: String,
    pub blocked_network_mode: String,
    pub restricted_network_mode: String,
    pub trusted_network_mode: String,
    pub enforce_blocked_runtime: bool,
    pub enforce_restricted_allowlist: bool,
    pub poll_interval_secs: u64,
    pub max_sessions: usize,
}

impl Default for RuntimeGuardPolicy {
    fn default() -> Self {
        Self {
            unknown_default_trust: "unknown".to_string(),
            managed_default_trust: "restricted".to_string(),
            reviewed_default_trust: "trusted".to_string(),
            blocked_network_mode: "observe_only".to_string(),
            restricted_network_mode: "allowlist".to_string(),
            trusted_network_mode: "inherit".to_string(),
            enforce_blocked_runtime: false,
            enforce_restricted_allowlist: false,
            poll_interval_secs: 5,
            max_sessions: 200,
        }
    }
}
