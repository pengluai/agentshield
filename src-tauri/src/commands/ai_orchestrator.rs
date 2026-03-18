use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::{Command, Output};

use crate::commands::license;
use crate::commands::platform::{npm_command, openclaw_command, preferred_openclaw_config_dir};
use crate::commands::runtime_guard;
use crate::commands::store::get_mcp_config_for_platform;

const CHANNEL_KEYRING_SERVICE: &str = "com.agentshield.openclaw.channels";

#[allow(dead_code)]
#[derive(Serialize, Deserialize, Clone)]
pub struct AiConfig {
    pub provider: String, // "deepseek", "gemini", "openai", "custom"
    pub api_key: String,
    pub model: String,
    pub base_url: Option<String>, // for custom endpoints
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AiConnectionResult {
    pub success: bool,
    pub model_name: String,
    pub message: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct StepResult {
    pub success: bool,
    pub step_id: String,
    pub message: String,
    pub output: Option<String>,
    pub error: Option<String>,
    pub needs_ai_help: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AiDiagnosis {
    pub diagnosis: String,
    pub suggested_fix: String,
    pub auto_fixable: bool,
    pub fix_command: Option<String>,
}

struct StepApprovalSpec {
    action_kind: &'static str,
    action_source: &'static str,
    action_targets: Vec<String>,
}

fn get_base_url(provider: &str, custom_url: &Option<String>) -> String {
    match provider {
        "deepseek" => "https://api.deepseek.com".to_string(),
        "gemini" => "https://generativelanguage.googleapis.com/v1beta/openai".to_string(),
        "openai" => "https://api.openai.com".to_string(),
        "custom" => custom_url
            .clone()
            .unwrap_or_else(|| "https://api.openai.com".to_string()),
        _ => "https://api.deepseek.com".to_string(),
    }
}

fn get_default_model(provider: &str) -> &str {
    match provider {
        "deepseek" => "deepseek-chat",
        "gemini" => "gemini-2.0-flash",
        "openai" => "gpt-4o-mini",
        _ => "deepseek-chat",
    }
}

#[cfg(windows)]
fn apply_no_window_flag(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn apply_no_window_flag(_command: &mut Command) {}

fn command_output(mut command: Command) -> std::io::Result<Output> {
    apply_no_window_flag(&mut command);
    command.output()
}

async fn command_output_async(command: Command) -> Result<Output, String> {
    tokio::task::spawn_blocking(move || command_output(command))
        .await
        .map_err(|error| format!("Command execution task failed: {error}"))?
        .map_err(|error| format!("Command execution failed: {error}"))
}

fn mask_channel_secret(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= 6 {
        return "*".repeat(chars.len().max(4));
    }
    let prefix: String = chars.iter().take(3).collect();
    let suffix: String = chars
        .iter()
        .rev()
        .take(2)
        .copied()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("{prefix}***{suffix}")
}

fn store_channel_secret(channel: &str, raw_token: &str) -> Result<String, String> {
    let key_id = format!("channel:{}:{}", channel.trim(), uuid::Uuid::new_v4());
    let entry = keyring::Entry::new(CHANNEL_KEYRING_SERVICE, &key_id)
        .map_err(|error| format!("Failed to create channel keyring entry: {error}"))?;
    entry
        .set_password(raw_token)
        .map_err(|error| format!("Failed to persist channel secret in keyring: {error}"))?;
    Ok(key_id)
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
            "Failed to harden Windows ACL for OpenClaw config files: {}",
            failures.join(", ")
        ))
    }
}

#[cfg(not(windows))]
fn harden_windows_paths(_paths: &[PathBuf]) -> Result<(), String> {
    Ok(())
}

fn license_allows_one_click_automation(plan: &str, status: &str) -> bool {
    matches!(plan, "trial" | "pro" | "enterprise") && status == "active"
}

fn is_paid_openclaw_step(step_id: &str) -> bool {
    matches!(
        step_id,
        "install_openclaw"
            | "run_onboard"
            | "setup_mcp"
            | "harden_permissions"
            | "configure_channel"
    )
}

fn normalize_action_targets(targets: Vec<String>) -> Vec<String> {
    let mut normalized = targets
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    normalized.sort();
    normalized.dedup();
    normalized
}

fn approval_spec_for_step(
    step_id: &str,
    channel_id: Option<&str>,
    platform_ids: Option<&Vec<String>>,
) -> Option<StepApprovalSpec> {
    match step_id {
        "install_openclaw" => Some(StepApprovalSpec {
            action_kind: "shell_exec",
            action_source: "user_requested_setup_install",
            action_targets: vec!["npm install -g openclaw@latest".to_string()],
        }),
        "run_onboard" => Some(StepApprovalSpec {
            action_kind: "shell_exec",
            action_source: "user_requested_setup_onboard",
            action_targets: vec!["openclaw onboard --install-daemon".to_string()],
        }),
        "setup_mcp" => {
            let targets = platform_ids
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .map(|platform| format!("platform:{}", platform.trim()))
                .collect::<Vec<_>>();

            Some(StepApprovalSpec {
                action_kind: "file_modify",
                action_source: "user_requested_setup_mcp",
                action_targets: normalize_action_targets(targets),
            })
        }
        "harden_permissions" => Some(StepApprovalSpec {
            action_kind: "file_modify",
            action_source: "user_requested_setup_permissions",
            action_targets: vec!["openclaw-config-permissions".to_string()],
        }),
        "configure_channel" => {
            let channel = channel_id.unwrap_or_default().trim().to_string();
            if channel.is_empty() {
                return Some(StepApprovalSpec {
                    action_kind: "file_modify",
                    action_source: "user_requested_setup_channel",
                    action_targets: vec!["channel:unknown".to_string()],
                });
            }

            Some(StepApprovalSpec {
                action_kind: "file_modify",
                action_source: "user_requested_setup_channel",
                action_targets: vec![format!("channel:{channel}")],
            })
        }
        _ => None,
    }
}

fn is_http_url(value: &str) -> bool {
    reqwest::Url::parse(value)
        .map(|url| matches!(url.scheme(), "http" | "https"))
        .unwrap_or(false)
}

fn validate_channel_token(channel: &str, token: &str) -> Result<(), String> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return Err("Token cannot be empty".to_string());
    }

    match channel {
        "telegram" => {
            let Some((bot_id, bot_token)) = trimmed.split_once(':') else {
                return Err("Telegram token must look like <bot_id>:<bot_token>".to_string());
            };
            if !bot_id.chars().all(|char| char.is_ascii_digit()) {
                return Err("Telegram bot ID must be numeric".to_string());
            }
            if bot_token.len() < 20
                || !bot_token
                    .chars()
                    .all(|char| char.is_ascii_alphanumeric() || matches!(char, '_' | '-'))
            {
                return Err("Telegram bot token format is invalid".to_string());
            }
            Ok(())
        }
        "feishu" => {
            let token_part = trimmed
                .rsplit('/')
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(trimmed);
            if token_part.len() < 16
                || !token_part
                    .chars()
                    .all(|char| char.is_ascii_alphanumeric() || matches!(char, '_' | '-'))
            {
                return Err(
                    "Feishu token/secret should contain at least 16 URL-safe characters"
                        .to_string(),
                );
            }
            Ok(())
        }
        "wework" => {
            let key = if trimmed.contains("key=") {
                trimmed
                    .split("key=")
                    .nth(1)
                    .map(str::trim)
                    .unwrap_or_default()
            } else {
                trimmed
            };
            if key.len() < 16
                || !key
                    .chars()
                    .all(|char| char.is_ascii_alphanumeric() || matches!(char, '_' | '-'))
            {
                return Err("WeCom bot key format is invalid".to_string());
            }
            Ok(())
        }
        "dingtalk" => {
            if !is_http_url(trimmed) || !trimmed.contains("access_token=") {
                return Err(
                    "DingTalk token must be a webhook URL containing access_token=".to_string(),
                );
            }
            Ok(())
        }
        "slack" => {
            if !trimmed.starts_with("xoxb-") || trimmed.len() < 20 {
                return Err("Slack bot token must start with xoxb-".to_string());
            }
            Ok(())
        }
        "discord" => {
            let segment_count = trimmed.split('.').count();
            if segment_count < 3 || trimmed.len() < 30 {
                return Err("Discord bot token format is invalid".to_string());
            }
            Ok(())
        }
        "ntfy" => {
            if trimmed.contains(char::is_whitespace) {
                return Err("ntfy value cannot contain whitespace".to_string());
            }
            let topic = if let Some((_, right)) = trimmed.split_once('@') {
                right
            } else {
                trimmed
            };
            if topic.is_empty()
                || topic.len() > 120
                || !topic
                    .chars()
                    .all(|char| char.is_ascii_alphanumeric() || matches!(char, '_' | '-' | '.'))
            {
                return Err(
                    "ntfy topic must use letters, numbers, dot, underscore, or dash".to_string(),
                );
            }
            Ok(())
        }
        "webhook" => {
            if is_http_url(trimmed) || trimmed.len() >= 16 {
                Ok(())
            } else {
                Err(
                    "Webhook value must be a URL or a token with at least 16 characters"
                        .to_string(),
                )
            }
        }
        "email" => {
            if !trimmed.starts_with("smtp://") {
                return Err("Email channel expects an SMTP URL starting with smtp://".to_string());
            }
            match reqwest::Url::parse(trimmed) {
                Ok(url) if url.host_str().is_some() => Ok(()),
                _ => Err("SMTP credential URL is invalid".to_string()),
            }
        }
        _ => Err("Unsupported channel id".to_string()),
    }
}

#[tauri::command]
pub async fn test_ai_connection(
    provider: String,
    api_key: String,
    model: Option<String>,
    base_url: Option<String>,
) -> Result<AiConnectionResult, String> {
    let base = get_base_url(&provider, &base_url);
    let model_name = model.unwrap_or_else(|| get_default_model(&provider).to_string());
    let url = format!("{}/v1/chat/completions", base);

    let body = serde_json::json!({
        "model": model_name,
        "messages": [{"role": "user", "content": "Reply with exactly: OK"}],
        "max_tokens": 5,
        "temperature": 0,
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    if resp.status().is_success() {
        Ok(AiConnectionResult {
            success: true,
            model_name: model_name.clone(),
            message: format!("Successfully connected to {} ({})", provider, model_name),
        })
    } else {
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        Ok(AiConnectionResult {
            success: false,
            model_name: model_name.clone(),
            message: format!(
                "API error {}: {}",
                status,
                text.chars().take(200).collect::<String>()
            ),
        })
    }
}

#[tauri::command]
pub async fn ai_diagnose_error(
    provider: String,
    api_key: String,
    model: Option<String>,
    base_url: Option<String>,
    error_context: String,
    step_name: String,
) -> Result<AiDiagnosis, String> {
    let base = get_base_url(&provider, &base_url);
    let model_name = model.unwrap_or_else(|| get_default_model(&provider).to_string());
    let url = format!("{}/v1/chat/completions", base);

    let prompt = format!(
        "You are a system administrator assistant for {}. The user is installing OpenClaw (an AI security tool). \
        During the step '{}', the following error occurred:\n\n{}\n\n\
        Provide a JSON response with these fields:\n\
        - diagnosis: brief explanation of what went wrong (in Chinese)\n\
        - suggested_fix: actionable fix steps (in Chinese)\n\
        - auto_fixable: boolean, whether a shell command can fix it\n\
        - fix_command: the shell command to run if auto_fixable is true, null otherwise\n\
        Respond ONLY with valid JSON, no markdown.",
        std::env::consts::OS,
        step_name,
        error_context
    );

    let body = serde_json::json!({
        "model": model_name,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 500,
        "temperature": 0.1,
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("AI request failed: {}", e))?;

    if !resp.status().is_success() {
        return Ok(AiDiagnosis {
            diagnosis: "AI 诊断服务暂时不可用".to_string(),
            suggested_fix: format!(
                "请手动检查错误: {}",
                error_context.chars().take(100).collect::<String>()
            ),
            auto_fixable: false,
            fix_command: None,
        });
    }

    let resp_json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let content = resp_json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("{}");

    // Try to parse the AI response as JSON
    match serde_json::from_str::<AiDiagnosis>(content) {
        Ok(diagnosis) => Ok(diagnosis),
        Err(_) => {
            // If AI didn't return valid JSON, wrap the raw text
            Ok(AiDiagnosis {
                diagnosis: content.to_string(),
                suggested_fix: "请参考上述诊断信息手动修复".to_string(),
                auto_fixable: false,
                fix_command: None,
            })
        }
    }
}

#[tauri::command]
pub async fn execute_install_step(
    step_id: String,
    channel_id: Option<String>,
    token: Option<String>,
    platform_ids: Option<Vec<String>>,
    approval_ticket: Option<String>,
) -> Result<StepResult, String> {
    if is_paid_openclaw_step(&step_id) {
        let info = license::check_license_status().await?;
        if !license_allows_one_click_automation(&info.plan, &info.status) {
            return Ok(StepResult {
                success: false,
                step_id,
                message: format!(
                    "当前许可证状态（{}/{}）不支持一键处理。请前往「升级 Pro」激活许可证。",
                    info.plan, info.status
                ),
                output: None,
                error: Some(
                    "该步骤为一键自动化能力。免费版请按官方文档手动安装/更新/卸载，或升级完整版继续一键处理。"
                        .to_string(),
                ),
                needs_ai_help: false,
            });
        }
    }

    if let Some(approval) =
        approval_spec_for_step(&step_id, channel_id.as_deref(), platform_ids.as_ref())
    {
        runtime_guard::require_action_approval_ticket(
            approval_ticket.as_deref(),
            "agentshield:openclaw:setup",
            approval.action_kind,
            &approval.action_targets,
            approval.action_source,
        )?;
    }

    match step_id.as_str() {
        "check_node" => {
            let node_ok = which::which("node").is_ok();
            let npm_ok = which::which("npm").is_ok();
            if node_ok && npm_ok {
                let mut version_command = Command::new("node");
                version_command.arg("--version");
                let version = command_output_async(version_command)
                    .await
                    .ok()
                    .and_then(|o| String::from_utf8(o.stdout).ok())
                    .map(|v| v.trim().to_string())
                    .unwrap_or_else(|| "unknown".to_string());
                Ok(StepResult {
                    success: true,
                    step_id,
                    message: format!("Node.js {} 和 npm 已就绪", version),
                    output: Some(version),
                    error: None,
                    needs_ai_help: false,
                })
            } else {
                Ok(StepResult {
                    success: false,
                    step_id,
                    message: "Node.js 或 npm 未安装".to_string(),
                    output: None,
                    error: Some("请先安装 Node.js (https://nodejs.org)".to_string()),
                    needs_ai_help: true,
                })
            }
        }

        "install_openclaw" => {
            // Check if already installed
            if which::which("openclaw").is_ok() {
                let mut version_command = Command::new(openclaw_command());
                version_command.arg("--version");
                let version = command_output_async(version_command)
                    .await
                    .ok()
                    .and_then(|o| String::from_utf8(o.stdout).ok())
                    .map(|v| v.trim().to_string())
                    .unwrap_or_else(|| "已安装".to_string());
                return Ok(StepResult {
                    success: true,
                    step_id,
                    message: format!("OpenClaw {} 已安装", version),
                    output: Some(version),
                    error: None,
                    needs_ai_help: false,
                });
            }

            // Run npm install
            let mut install_command = Command::new(npm_command());
            install_command.args(["install", "-g", "openclaw@latest"]);
            let output = command_output_async(install_command)
                .await
                .map_err(|error| format!("Failed to run npm: {error}"))?;

            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                Ok(StepResult {
                    success: true,
                    step_id,
                    message: "OpenClaw 安装成功".to_string(),
                    output: Some(stdout),
                    error: None,
                    needs_ai_help: false,
                })
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                Ok(StepResult {
                    success: false,
                    step_id,
                    message: "OpenClaw 安装失败".to_string(),
                    output: None,
                    error: Some(stderr),
                    needs_ai_help: true,
                })
            }
        }

        "run_onboard" => {
            let mut onboard_command = Command::new(openclaw_command());
            onboard_command.args(["onboard", "--install-daemon"]);
            let output = command_output_async(onboard_command).await;

            match output {
                Ok(o) if o.status.success() => Ok(StepResult {
                    success: true,
                    step_id,
                    message: "OpenClaw 初始化完成".to_string(),
                    output: Some(String::from_utf8_lossy(&o.stdout).to_string()),
                    error: None,
                    needs_ai_help: false,
                }),
                Ok(o) => Ok(StepResult {
                    success: false,
                    step_id,
                    message: "OpenClaw 初始化失败".to_string(),
                    output: None,
                    error: Some(String::from_utf8_lossy(&o.stderr).to_string()),
                    needs_ai_help: true,
                }),
                Err(e) => Ok(StepResult {
                    success: false,
                    step_id,
                    message: "无法运行 openclaw 命令".to_string(),
                    output: None,
                    error: Some(e.to_string()),
                    needs_ai_help: true,
                }),
            }
        }

        "configure_channel" => {
            let channel = channel_id.unwrap_or_default();
            let token_val = token.unwrap_or_default();

            if channel.is_empty() || token_val.is_empty() {
                return Ok(StepResult {
                    success: false,
                    step_id,
                    message: "Missing channel or token".to_string(),
                    output: None,
                    error: Some("channel_id and token are required".to_string()),
                    needs_ai_help: false,
                });
            }

            if let Err(error) = validate_channel_token(&channel, &token_val) {
                return Ok(StepResult {
                    success: false,
                    step_id,
                    message: "Invalid channel token".to_string(),
                    output: None,
                    error: Some(error),
                    needs_ai_help: false,
                });
            }

            // Write channel config to ~/.openclaw/channels/<channel_id>.json
            let home = dirs::home_dir().ok_or("Cannot find home directory")?;
            let config_dir = preferred_openclaw_config_dir(&home).join("channels");
            std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
            let token_ref = store_channel_secret(&channel, &token_val)?;

            let config = serde_json::json!({
                "channel": channel,
                "token_ref": token_ref,
                "token_masked": mask_channel_secret(&token_val),
                "enabled": true,
                "created_at": chrono::Utc::now().to_rfc3339(),
            });

            let config_path = config_dir.join(format!("{}.json", channel));
            let serialized =
                serde_json::to_string_pretty(&config).map_err(|error| error.to_string())?;
            std::fs::write(&config_path, serialized).map_err(|error| error.to_string())?;

            // Harden channel config permissions after write.
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&config_path, std::fs::Permissions::from_mode(0o600))
                    .map_err(|e| e.to_string())?;
            }
            harden_windows_paths(&[config_dir.clone(), config_path.clone()])?;

            Ok(StepResult {
                success: true,
                step_id,
                message: format!("{} 渠道配置完成", channel),
                output: Some(config_path.to_string_lossy().to_string()),
                error: None,
                needs_ai_help: false,
            })
        }

        "setup_mcp" => {
            let platforms = platform_ids.unwrap_or_default();
            let mut results = Vec::new();

            for platform in &platforms {
                let config_path = get_mcp_config_path(platform);
                if let Some(path) = config_path {
                    match inject_openclaw_mcp(&path) {
                        Ok(_) => results.push(format!("{}: 已配置", platform)),
                        Err(e) => results.push(format!("{}: 失败 ({})", platform, e)),
                    }
                } else {
                    results.push(format!("{}: 跳过 (未找到配置文件)", platform));
                }
            }

            let all_ok = results
                .iter()
                .all(|r| r.contains("已配置") || r.contains("跳过"));
            Ok(StepResult {
                success: all_ok,
                step_id,
                message: if all_ok {
                    "MCP 配置完成".to_string()
                } else {
                    "部分平台配置失败".to_string()
                },
                output: Some(results.join("\n")),
                error: None,
                needs_ai_help: !all_ok,
            })
        }

        "harden_permissions" => {
            let home = dirs::home_dir().ok_or("Cannot find home directory")?;
            let openclaw_dir = preferred_openclaw_config_dir(&home);
            let mut hardened: Vec<String> = Vec::new();
            let mut targets: Vec<PathBuf> = Vec::new();

            if openclaw_dir.exists() {
                // Harden all config files in the OpenClaw directory.
                if let Ok(entries) = std::fs::read_dir(&openclaw_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_file() {
                            targets.push(path);
                        }
                    }
                }
                // Also harden channels subdir.
                let channels_dir = openclaw_dir.join("channels");
                if channels_dir.exists() {
                    if let Ok(entries) = std::fs::read_dir(&channels_dir) {
                        for entry in entries.flatten() {
                            let path = entry.path();
                            if path.is_file() {
                                targets.push(path);
                            }
                        }
                    }
                }
            }

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                for path in &targets {
                    if std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).is_ok() {
                        hardened.push(path.to_string_lossy().to_string());
                    }
                }
            }

            #[cfg(windows)]
            {
                let mut windows_targets = targets.clone();
                if openclaw_dir.exists() {
                    windows_targets.push(openclaw_dir.clone());
                }
                harden_windows_paths(&windows_targets)?;
                hardened.extend(
                    windows_targets
                        .iter()
                        .filter(|path| path.exists())
                        .map(|path| path.to_string_lossy().to_string()),
                );
            }

            Ok(StepResult {
                success: true,
                step_id,
                message: format!("已加固 {} 个配置文件权限", hardened.len()),
                output: Some(hardened.join("\n")),
                error: None,
                needs_ai_help: false,
            })
        }

        "verify_install" => {
            let openclaw_ok = which::which("openclaw").is_ok();
            let version = if openclaw_ok {
                let mut version_command = Command::new(openclaw_command());
                version_command.arg("--version");
                command_output_async(version_command)
                    .await
                    .ok()
                    .and_then(|o| String::from_utf8(o.stdout).ok())
                    .map(|v| v.trim().to_string())
            } else {
                None
            };

            // Check if config dir exists
            let home = dirs::home_dir().ok_or("Cannot find home directory")?;
            let config_exists = preferred_openclaw_config_dir(&home).exists();

            if openclaw_ok && config_exists {
                Ok(StepResult {
                    success: true,
                    step_id,
                    message: format!(
                        "OpenClaw {} 验证通过",
                        version.unwrap_or_else(|| "OK".to_string())
                    ),
                    output: None,
                    error: None,
                    needs_ai_help: false,
                })
            } else {
                Ok(StepResult {
                    success: false,
                    step_id,
                    message: "OpenClaw 安装验证失败".to_string(),
                    output: None,
                    error: Some(
                        if !openclaw_ok {
                            "openclaw 命令不可用"
                        } else {
                            "配置目录不存在"
                        }
                        .to_string(),
                    ),
                    needs_ai_help: true,
                })
            }
        }

        _ => {
            let msg = format!("Unknown step: {}", step_id);
            Ok(StepResult {
                success: false,
                step_id,
                message: msg,
                output: None,
                error: Some("Invalid step_id".to_string()),
                needs_ai_help: false,
            })
        }
    }
}

/// Get the MCP config file path for a given platform
fn get_mcp_config_path(platform: &str) -> Option<std::path::PathBuf> {
    get_mcp_config_for_platform(platform)
}

/// Inject OpenClaw MCP server config into a platform's MCP config file
fn inject_openclaw_mcp(config_path: &std::path::Path) -> Result<(), String> {
    // Read existing config or create new
    let mut config: serde_json::Value = if config_path.exists() {
        let content = std::fs::read_to_string(config_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        // Create parent dirs
        if let Some(parent) = config_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        serde_json::json!({})
    };

    // Ensure mcpServers object exists
    if config.get("mcpServers").is_none() {
        config["mcpServers"] = serde_json::json!({});
    }

    // Add openclaw server entry
    config["mcpServers"]["openclaw"] = serde_json::json!({
        "command": "npx",
        "args": ["openclaw-mcp"],
        "env": {}
    });

    // Write back
    let json_str = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(config_path, json_str).map_err(|e| e.to_string())?;

    Ok(())
}
