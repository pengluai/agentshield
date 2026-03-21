use chrono::Utc;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

use crate::types::runtime_guard::{RuntimeApprovalRequest, RuntimeGuardEvent};

// ---------------------------------------------------------------------------
// AuditEvent: unified record that merges guard events and approval requests
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct AuditEvent {
    pub event_id: String,
    pub timestamp: String,
    pub event_type: String,
    pub component_id: String,
    pub actor: String,
    pub summary: String,
    pub details: serde_json::Value,
    pub event_hash: String,
}

// ---------------------------------------------------------------------------
// Helpers – mirror the private path / IO helpers in runtime_guard.rs
// ---------------------------------------------------------------------------

fn data_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".agentshield")
}

fn events_path() -> PathBuf {
    data_dir().join("runtime-guard-events.json")
}

fn approval_requests_path() -> PathBuf {
    data_dir().join("runtime-guard-approvals.json")
}

fn exports_dir() -> PathBuf {
    data_dir().join("exports")
}

fn load_json_file<T>(path: &Path) -> T
where
    T: DeserializeOwned + Default,
{
    let Ok(content) = fs::read_to_string(path) else {
        return T::default();
    };
    let normalized = content.trim_start_matches('\u{feff}');
    if normalized.trim().is_empty() {
        return T::default();
    }
    serde_json::from_str(normalized).unwrap_or_default()
}

// ---------------------------------------------------------------------------
// SHA-256 hash for an AuditEvent (computed over stable fields, excluding the
// hash itself)
// ---------------------------------------------------------------------------

fn compute_event_hash(
    event_id: &str,
    timestamp: &str,
    event_type: &str,
    component_id: &str,
    actor: &str,
    summary: &str,
    details: &serde_json::Value,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(event_id.as_bytes());
    hasher.update(timestamp.as_bytes());
    hasher.update(event_type.as_bytes());
    hasher.update(component_id.as_bytes());
    hasher.update(actor.as_bytes());
    hasher.update(summary.as_bytes());
    hasher.update(details.to_string().as_bytes());
    format!("{:x}", hasher.finalize())
}

// ---------------------------------------------------------------------------
// Convert domain objects → AuditEvent
// ---------------------------------------------------------------------------

fn event_to_audit(ev: &RuntimeGuardEvent) -> AuditEvent {
    let details = serde_json::json!({
        "severity": ev.severity,
        "action": ev.action,
        "description": ev.description,
    });
    let hash = compute_event_hash(
        &ev.id,
        &ev.timestamp,
        &ev.event_type,
        &ev.component_id,
        "runtime_guard",
        &ev.title,
        &details,
    );
    AuditEvent {
        event_id: ev.id.clone(),
        timestamp: ev.timestamp.clone(),
        event_type: ev.event_type.clone(),
        component_id: ev.component_id.clone(),
        actor: "runtime_guard".to_string(),
        summary: ev.title.clone(),
        details,
        event_hash: hash,
    }
}

fn approval_to_audit(req: &RuntimeApprovalRequest) -> AuditEvent {
    let details = serde_json::json!({
        "status": req.status,
        "request_kind": req.request_kind,
        "platform_id": req.platform_id,
        "platform_name": req.platform_name,
        "action_kind": req.action_kind,
        "action_source": req.action_source,
        "action_targets": req.action_targets,
        "is_destructive": req.is_destructive,
        "sensitive_capabilities": req.sensitive_capabilities,
    });
    let hash = compute_event_hash(
        &req.id,
        &req.created_at,
        &format!("approval_{}", req.status),
        &req.component_id,
        &req.component_name,
        &req.summary,
        &details,
    );
    AuditEvent {
        event_id: req.id.clone(),
        timestamp: req.created_at.clone(),
        event_type: format!("approval_{}", req.status),
        component_id: req.component_id.clone(),
        actor: req.component_name.clone(),
        summary: req.summary.clone(),
        details,
        event_hash: hash,
    }
}

// ---------------------------------------------------------------------------
// Date filtering
// ---------------------------------------------------------------------------

fn parse_rfc3339(value: &str) -> Option<chrono::DateTime<Utc>> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|ts| ts.with_timezone(&Utc))
}

fn within_date_range(
    timestamp: &str,
    date_from: &Option<String>,
    date_to: &Option<String>,
) -> bool {
    let Some(ts) = parse_rfc3339(timestamp) else {
        // If we cannot parse the timestamp, try a plain date prefix comparison
        // so that dates like "2026-03-01" still work as rough filters.
        let ok_from = date_from
            .as_deref()
            .map_or(true, |f| timestamp >= f);
        let ok_to = date_to
            .as_deref()
            .map_or(true, |t| timestamp <= t);
        return ok_from && ok_to;
    };
    if let Some(from_str) = date_from.as_deref() {
        if let Some(from_ts) = parse_rfc3339(from_str) {
            if ts < from_ts {
                return false;
            }
        } else {
            // Try treating it as a date-only string (YYYY-MM-DD)
            if timestamp < from_str {
                return false;
            }
        }
    }
    if let Some(to_str) = date_to.as_deref() {
        if let Some(to_ts) = parse_rfc3339(to_str) {
            if ts > to_ts {
                return false;
            }
        } else {
            if timestamp > to_str {
                return false;
            }
        }
    }
    true
}

// ---------------------------------------------------------------------------
// Export formatters
// ---------------------------------------------------------------------------

fn escape_csv_field(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn export_json_lines(events: &[AuditEvent]) -> Result<String, String> {
    let mut lines = Vec::with_capacity(events.len());
    for event in events {
        let line = serde_json::to_string(event)
            .map_err(|e| format!("JSON serialization error: {e}"))?;
        lines.push(line);
    }
    Ok(lines.join("\n"))
}

fn export_csv(events: &[AuditEvent]) -> Result<String, String> {
    let mut output = String::from("event_id,timestamp,event_type,component_id,actor,summary,details,event_hash\n");
    for event in events {
        let details_str = event.details.to_string();
        output.push_str(&format!(
            "{},{},{},{},{},{},{},{}\n",
            escape_csv_field(&event.event_id),
            escape_csv_field(&event.timestamp),
            escape_csv_field(&event.event_type),
            escape_csv_field(&event.component_id),
            escape_csv_field(&event.actor),
            escape_csv_field(&event.summary),
            escape_csv_field(&details_str),
            escape_csv_field(&event.event_hash),
        ));
    }
    Ok(output)
}

fn export_html(events: &[AuditEvent]) -> Result<String, String> {
    let generated_at = Utc::now().to_rfc3339();
    let mut rows = String::new();
    for event in events {
        let severity_class = if event.event_type.contains("block")
            || event.event_type.contains("deny")
            || event.event_type.contains("denied")
        {
            "severity-high"
        } else if event.event_type.contains("warn") || event.event_type.contains("approval") {
            "severity-medium"
        } else {
            "severity-low"
        };
        rows.push_str(&format!(
            r#"        <tr class="{severity_class}">
          <td>{}</td>
          <td><code>{}</code></td>
          <td>{}</td>
          <td>{}</td>
          <td>{}</td>
          <td>{}</td>
          <td><code title="{}">{}</code></td>
        </tr>
"#,
            html_escape(&event.timestamp),
            html_escape(&event.event_id),
            html_escape(&event.event_type),
            html_escape(&event.component_id),
            html_escape(&event.actor),
            html_escape(&event.summary),
            html_escape(&event.event_hash),
            &event.event_hash[..16.min(event.event_hash.len())],
        ));
    }

    Ok(format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>AgentShield Audit Report</title>
  <style>
    :root {{ --bg: #0f1117; --fg: #e4e4e7; --border: #27272a; --accent: #6366f1; }}
    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
           background: var(--bg); color: var(--fg); padding: 2rem; }}
    h1 {{ margin-bottom: .25rem; color: var(--accent); }}
    .meta {{ color: #a1a1aa; margin-bottom: 1.5rem; font-size: .85rem; }}
    table {{ width: 100%; border-collapse: collapse; font-size: .85rem; }}
    th, td {{ text-align: left; padding: .5rem .75rem; border-bottom: 1px solid var(--border); }}
    th {{ background: #18181b; position: sticky; top: 0; }}
    tr:hover {{ background: #1e1e24; }}
    .severity-high {{ border-left: 3px solid #ef4444; }}
    .severity-medium {{ border-left: 3px solid #f59e0b; }}
    .severity-low {{ border-left: 3px solid #22c55e; }}
    code {{ font-size: .8rem; color: #a1a1aa; }}
  </style>
</head>
<body>
  <h1>AgentShield Audit Report</h1>
  <p class="meta">Generated at {generated_at} &mdash; {count} events</p>
  <table>
    <thead>
      <tr>
        <th>Timestamp</th>
        <th>Event ID</th>
        <th>Type</th>
        <th>Component</th>
        <th>Actor</th>
        <th>Summary</th>
        <th>Hash</th>
      </tr>
    </thead>
    <tbody>
{rows}    </tbody>
  </table>
</body>
</html>"#,
        generated_at = generated_at,
        count = events.len(),
        rows = rows,
    ))
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

// ---------------------------------------------------------------------------
// Tauri command
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn export_audit_log(
    format: String,
    date_from: Option<String>,
    date_to: Option<String>,
    event_types: Option<Vec<String>>,
) -> Result<String, String> {
    // 1. Load raw data
    let guard_events: Vec<RuntimeGuardEvent> = load_json_file(&events_path());
    let approval_requests: Vec<RuntimeApprovalRequest> = load_json_file(&approval_requests_path());

    // 2. Convert to unified AuditEvent format
    let mut audit_events: Vec<AuditEvent> = Vec::new();
    for ev in &guard_events {
        audit_events.push(event_to_audit(ev));
    }
    for req in &approval_requests {
        audit_events.push(approval_to_audit(req));
    }

    // 3. Sort by timestamp (ascending)
    audit_events.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));

    // 4. Filter by date range
    if date_from.is_some() || date_to.is_some() {
        audit_events.retain(|ev| within_date_range(&ev.timestamp, &date_from, &date_to));
    }

    // 5. Filter by event types
    if let Some(ref types) = event_types {
        if !types.is_empty() {
            let type_set: std::collections::HashSet<&str> =
                types.iter().map(|s| s.as_str()).collect();
            audit_events.retain(|ev| type_set.contains(ev.event_type.as_str()));
        }
    }

    // 6. Export to requested format
    let (content, ext) = match format.as_str() {
        "json" => (export_json_lines(&audit_events)?, "json"),
        "csv" => (export_csv(&audit_events)?, "csv"),
        "html" => (export_html(&audit_events)?, "html"),
        other => return Err(format!("Unsupported export format: {other}. Use json, csv, or html.")),
    };

    // 7. Write to ~/.agentshield/exports/audit-{timestamp}.{ext}
    let exports = exports_dir();
    fs::create_dir_all(&exports)
        .map_err(|e| format!("Failed to create exports directory: {e}"))?;

    let timestamp = Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let filename = format!("audit-{timestamp}.{ext}");
    let filepath = exports.join(&filename);

    fs::write(&filepath, content.as_bytes())
        .map_err(|e| format!("Failed to write export file: {e}"))?;

    Ok(filepath.to_string_lossy().to_string())
}
