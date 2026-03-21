use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

#[cfg(test)]
use std::sync::{LazyLock, Mutex};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::commands::{ai_orchestrator, license};
use crate::types::license::LicenseInfo;
use crate::types::scan::{SemanticGuardSummary, SemanticReview};

#[cfg_attr(test, allow(dead_code))]
const SEMANTIC_KEYRING_SERVICE: &str = "com.agentshield.semantic";
#[cfg_attr(test, allow(dead_code))]
const SEMANTIC_KEYRING_ID: &str = "semantic-access-key";
// DeepSeek 当前公开 API 的稳定聊天模型标识符。
const DEEP_REVIEW_MODEL: &str = "deepseek-chat";
const DEEP_REVIEW_BASE_URL: &str = "https://api.deepseek.com";
const MAX_REVIEW_ITEMS: usize = 3;
const MAX_CACHE_ENTRIES: usize = 256;

#[derive(Serialize, Deserialize, Clone)]
pub struct SemanticReviewCandidate {
    pub issue_id: String,
    pub category: String,
    pub severity: String,
    pub title: String,
    pub description: String,
    pub file_path: Option<String>,
    pub evidence: String,
}

impl SemanticReviewCandidate {
    fn normalized(mut self) -> Self {
        self.description = normalize_text(&self.description, 220);
        self.evidence = normalize_text(&self.evidence, 360);
        self
    }

    fn cache_key(&self) -> String {
        let payload = json!({
            "category": self.category,
            "severity": self.severity,
            "title": self.title,
            "description": self.description,
            "file_path": self.file_path,
            "evidence": self.evidence,
        });
        let raw = serde_json::to_string(&payload).unwrap_or_default();
        URL_SAFE_NO_PAD.encode(raw.as_bytes())
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SemanticGuardStatus {
    pub licensed: bool,
    pub configured: bool,
    pub custom_configured: bool,
    pub active: bool,
    pub message: String,
}

pub struct SemanticReviewBatchResult {
    pub reviews: HashMap<String, SemanticReview>,
    pub summary: SemanticGuardSummary,
}

#[derive(Serialize, Deserialize, Clone)]
struct CachedSemanticReview {
    key: String,
    review: SemanticReview,
    updated_at: String,
}

#[derive(Serialize, Deserialize, Default)]
struct SemanticCacheFile {
    entries: Vec<CachedSemanticReview>,
}

#[derive(Deserialize)]
struct SemanticResponseEnvelope {
    items: Vec<SemanticResponseItem>,
}

#[derive(Deserialize)]
struct SemanticResponseItem {
    issue_id: String,
    verdict: String,
    confidence: u8,
    summary: String,
    recommended_action: String,
}

#[cfg(test)]
static TEST_SECRET_STORE: LazyLock<Mutex<Option<String>>> = LazyLock::new(|| Mutex::new(None));

fn semantic_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".agentshield")
}

fn semantic_cache_path() -> PathBuf {
    semantic_dir().join("semantic-cache.json")
}

fn ensure_semantic_dir() -> Result<(), String> {
    let dir = semantic_dir();
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|error| format!("Failed to create semantic guard dir: {error}"))?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("Failed to protect semantic guard dir: {error}"))?;
    }

    Ok(())
}

#[cfg(not(test))]
fn store_access_key(raw_value: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SEMANTIC_KEYRING_SERVICE, SEMANTIC_KEYRING_ID)
        .map_err(|error| format!("Failed to open system keychain entry: {error}"))?;
    entry
        .set_password(raw_value)
        .map_err(|error| format!("Failed to store semantic access key: {error}"))
}

#[cfg(not(test))]
fn load_access_key() -> Result<String, String> {
    let entry = keyring::Entry::new(SEMANTIC_KEYRING_SERVICE, SEMANTIC_KEYRING_ID)
        .map_err(|error| format!("Failed to open system keychain entry: {error}"))?;
    entry
        .get_password()
        .map_err(|error| format!("Failed to read semantic access key: {error}"))
}

#[cfg(not(test))]
fn delete_access_key() -> Result<(), String> {
    let entry = keyring::Entry::new(SEMANTIC_KEYRING_SERVICE, SEMANTIC_KEYRING_ID)
        .map_err(|error| format!("Failed to open system keychain entry: {error}"))?;
    entry
        .delete_credential()
        .map_err(|error| format!("Failed to remove semantic access key: {error}"))
}

#[cfg(test)]
fn store_access_key(raw_value: &str) -> Result<(), String> {
    *TEST_SECRET_STORE
        .lock()
        .map_err(|error| format!("Secret store lock error: {error}"))? =
        Some(raw_value.to_string());
    Ok(())
}

#[cfg(test)]
fn load_access_key() -> Result<String, String> {
    TEST_SECRET_STORE
        .lock()
        .map_err(|error| format!("Secret store lock error: {error}"))?
        .clone()
        .ok_or_else(|| "Semantic access key is not configured".to_string())
}

#[cfg(test)]
fn delete_access_key() -> Result<(), String> {
    *TEST_SECRET_STORE
        .lock()
        .map_err(|error| format!("Secret store lock error: {error}"))? = None;
    Ok(())
}

fn license_allows_semantic(license_info: &LicenseInfo) -> bool {
    matches!(license_info.plan.as_str(), "trial" | "pro" | "enterprise")
        && license_info.status == "active"
}

fn normalize_text(value: &str, limit: usize) -> String {
    let collapsed = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut normalized = collapsed.trim().to_string();
    if normalized.chars().count() > limit {
        normalized = normalized.chars().take(limit).collect::<String>();
        normalized.push('…');
    }
    normalized
}

fn trim_json_response(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.starts_with("```") {
        let without_prefix = trimmed
            .trim_start_matches("```json")
            .trim_start_matches("```JSON")
            .trim_start_matches("```");
        return without_prefix.trim_end_matches("```").trim().to_string();
    }
    trimmed.to_string()
}

fn load_cache() -> HashMap<String, CachedSemanticReview> {
    let path = semantic_cache_path();
    let raw = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(_) => return HashMap::new(),
    };

    let parsed: SemanticCacheFile = match serde_json::from_str(&raw) {
        Ok(file) => file,
        Err(_) => return HashMap::new(),
    };

    parsed
        .entries
        .into_iter()
        .map(|entry| (entry.key.clone(), entry))
        .collect()
}

fn save_cache(cache: &HashMap<String, CachedSemanticReview>) -> Result<(), String> {
    ensure_semantic_dir()?;

    let mut entries = cache.values().cloned().collect::<Vec<_>>();
    entries.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    entries.truncate(MAX_CACHE_ENTRIES);

    let payload = SemanticCacheFile { entries };
    let json = serde_json::to_string_pretty(&payload)
        .map_err(|error| format!("Failed to serialize semantic cache: {error}"))?;
    let path = semantic_cache_path();
    fs::write(&path, json).map_err(|error| format!("Failed to write semantic cache: {error}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Failed to protect semantic cache: {error}"))?;
    }

    Ok(())
}

async fn verify_access_key(access_key: &str) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| format!("Failed to build HTTP client: {error}"))?;

    let body = json!({
        "model": DEEP_REVIEW_MODEL,
        "messages": [{"role": "user", "content": "Reply with exactly: OK"}],
        "max_tokens": 5,
        "temperature": 0,
    });

    let response = client
        .post(format!("{DEEP_REVIEW_BASE_URL}/v1/chat/completions"))
        .header("Authorization", format!("Bearer {access_key}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Semantic service connection failed: {error}"))?;

    if response.status().is_success() {
        Ok(())
    } else {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        Err(format!(
            "Semantic service rejected the key (HTTP {status}): {}",
            normalize_text(&body, 120)
        ))
    }
}

async fn request_reviews(
    access_key: &str,
    candidates: &[SemanticReviewCandidate],
) -> Result<Vec<SemanticResponseItem>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|error| format!("Failed to build semantic guard HTTP client: {error}"))?;

    let (system_prompt, user_prompt) = build_review_prompts(candidates)?;

    let body = json!({
        "model": DEEP_REVIEW_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "max_tokens": 600,
        "temperature": 0,
    });

    let response = client
        .post(format!("{DEEP_REVIEW_BASE_URL}/v1/chat/completions"))
        .header("Authorization", format!("Bearer {access_key}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Semantic review request failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Semantic review failed (HTTP {status}): {}",
            normalize_text(&body, 160)
        ));
    }

    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("Failed to parse semantic review response: {error}"))?;
    let content = payload["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| "Semantic review response did not contain message content".to_string())?;
    let json = trim_json_response(content);
    let envelope: SemanticResponseEnvelope = serde_json::from_str(&json)
        .map_err(|error| format!("Semantic review JSON parse failed: {error}"))?;
    Ok(envelope.items)
}

fn build_review_prompts(candidates: &[SemanticReviewCandidate]) -> Result<(String, String), String> {
    let system_prompt = "你是 AgentShield 的高级语义安全研判器。你只能基于提供的结构化证据判断，不得脑补缺失上下文。不要给 shell 命令，不要弱化已存在的规则命中。只输出 JSON。".to_string();
    let user_prompt = format!(
        "请审查下面这些由本地确定性扫描器筛出的高风险候选项。返回 JSON 对象，格式为 {{\"items\":[...]}}。\n\
        items 数组中每项必须包含：issue_id、verdict、confidence、summary、recommended_action。\n\
        verdict 只能是 escalate、review、clear 三个值：\n\
        - escalate: 证据显示应立即提高警惕或优先级\n\
        - review: 证据不足以直接升级，但需要人工确认\n\
        - clear: 没有发现超出原始规则命中的额外危险信号\n\
        summary 用中文，20 到 60 字；recommended_action 用中文，15 到 40 字。\n\
        候选项如下：\n{}",
        serde_json::to_string_pretty(candidates).map_err(|error| error.to_string())?
    );
    Ok((system_prompt, user_prompt))
}

fn proxy_mode_enabled() -> bool {
    std::env::var("AGENTSHIELD_AI_PROXY_URL")
        .map(|value| !value.trim().is_empty())
        .unwrap_or(true)
}

async fn request_reviews_via_proxy(
    candidates: &[SemanticReviewCandidate],
) -> Result<Vec<SemanticResponseItem>, String> {
    let (system_prompt, user_prompt) = build_review_prompts(candidates)?;
    let messages = vec![
        json!({ "role": "system", "content": system_prompt }),
        json!({ "role": "user", "content": user_prompt }),
    ];
    let raw = ai_orchestrator::pro_ai_chat(messages).await?;
    let json = trim_json_response(&raw);
    let envelope: SemanticResponseEnvelope = serde_json::from_str(&json)
        .map_err(|error| format!("Semantic review JSON parse failed: {error}"))?;
    Ok(envelope.items)
}

fn build_status(
    licensed: bool,
    configured: bool,
    custom_configured: bool,
    active: bool,
    message: impl Into<String>,
) -> SemanticGuardStatus {
    SemanticGuardStatus {
        licensed,
        configured,
        custom_configured,
        active,
        message: message.into(),
    }
}

#[tauri::command]
pub async fn get_semantic_guard_status() -> Result<SemanticGuardStatus, String> {
    let license_info = license::check_license_status().await?;
    let custom_configured = load_access_key()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    let proxy_ready = proxy_mode_enabled();
    let configured = proxy_ready || custom_configured;
    let licensed = license_allows_semantic(&license_info);

    Ok(if !licensed {
        build_status(
            false,
            configured,
            custom_configured,
            false,
            "当前套餐未启用高级语义研判",
        )
    } else if proxy_ready {
        build_status(
            true,
            true,
            custom_configured,
            true,
            "✅ Pro 内置 AI 已启用（MiniMax M2.7），无需配置访问密钥",
        )
    } else if configured {
        build_status(true, true, custom_configured, true, "高级语义研判已就绪")
    } else {
        build_status(
            true,
            false,
            custom_configured,
            false,
            "请先配置安全研判访问密钥",
        )
    })
}

#[tauri::command]
pub async fn configure_semantic_guard(access_key: String) -> Result<SemanticGuardStatus, String> {
    let license_info = license::check_license_status().await?;
    if !license_allows_semantic(&license_info) {
        return Err("仅 Pro 或试用版可配置高级语义研判访问密钥".to_string());
    }

    let trimmed = access_key.trim();
    if trimmed.is_empty() {
        return Err("访问密钥不能为空".to_string());
    }

    verify_access_key(trimmed).await?;
    store_access_key(trimmed)?;

    Ok(build_status(true, true, true, true, "高级语义研判已连接"))
}

#[tauri::command]
pub async fn clear_semantic_guard_key() -> Result<bool, String> {
    delete_access_key()?;
    Ok(true)
}

pub async fn review_candidates(
    candidates: Vec<SemanticReviewCandidate>,
) -> SemanticReviewBatchResult {
    let license_info = match license::check_license_status().await {
        Ok(info) => info,
        Err(error) => {
            return SemanticReviewBatchResult {
                reviews: HashMap::new(),
                summary: SemanticGuardSummary::disabled(
                    false,
                    false,
                    format!("许可证检查失败：{error}"),
                ),
            };
        }
    };

    let licensed = license_allows_semantic(&license_info);
    let proxy_ready = proxy_mode_enabled();
    let access_key = match load_access_key() {
        Ok(value) if !value.trim().is_empty() => Some(value),
        _ => None,
    };
    let configured = proxy_ready || access_key.is_some();

    if !licensed {
        return SemanticReviewBatchResult {
            reviews: HashMap::new(),
            summary: SemanticGuardSummary::disabled(
                false,
                configured,
                "当前套餐未启用高级语义研判",
            ),
        };
    }

    if !configured {
        return SemanticReviewBatchResult {
            reviews: HashMap::new(),
            summary: SemanticGuardSummary::disabled(
                true,
                false,
                if proxy_ready {
                    "高级语义研判 Proxy 不可用"
                } else {
                    "高级语义研判未配置访问密钥"
                },
            ),
        };
    }

    if candidates.is_empty() {
        return SemanticReviewBatchResult {
            reviews: HashMap::new(),
            summary: SemanticGuardSummary {
                licensed: true,
                configured: true,
                active: true,
                reviewed_issues: 0,
                cache_hits: 0,
                message: "本次扫描没有需要深度复核的高风险候选项".to_string(),
            },
        };
    }

    let mut normalized = candidates
        .into_iter()
        .map(SemanticReviewCandidate::normalized)
        .collect::<Vec<_>>();
    normalized.sort_by(|left, right| {
        severity_rank(&left.severity)
            .cmp(&severity_rank(&right.severity))
            .then(left.title.cmp(&right.title))
    });
    normalized.truncate(MAX_REVIEW_ITEMS);

    let mut reviews = HashMap::new();
    let mut cache = load_cache();
    let mut cache_hits = 0u32;
    let mut uncached = Vec::new();

    for candidate in normalized {
        let key = candidate.cache_key();
        if let Some(entry) = cache.get(&key) {
            reviews.insert(candidate.issue_id.clone(), entry.review.clone());
            cache_hits += 1;
        } else {
            uncached.push((key, candidate));
        }
    }

    let mut message = if cache_hits > 0 {
        format!("已完成高级语义研判，命中缓存 {} 项", cache_hits)
    } else {
        "已完成高级语义研判".to_string()
    };

    if !uncached.is_empty() {
        let request_items = uncached
            .iter()
            .map(|(_, candidate)| candidate.clone())
            .collect::<Vec<_>>();

        let review_result = if proxy_ready {
            match request_reviews_via_proxy(&request_items).await {
                Ok(items) => Ok(items),
                Err(proxy_error) => {
                    if let Some(access_key) = access_key.as_deref() {
                        request_reviews(access_key, &request_items).await.map_err(|key_error| {
                            format!(
                                "Proxy 与自定义 Key 路径均失败：proxy={proxy_error}; key={key_error}"
                            )
                        })
                    } else {
                        Err(format!("Proxy 语义研判失败：{proxy_error}"))
                    }
                }
            }
        } else if let Some(access_key) = access_key.as_deref() {
            request_reviews(access_key, &request_items).await
        } else {
            Err("高级语义研判未配置访问密钥".to_string())
        };

        match review_result {
            Ok(items) => {
                let now = Utc::now().to_rfc3339();
                let mut reviewed_count = 0u32;

                for item in items {
                    if let Some((key, _candidate)) = uncached
                        .iter()
                        .find(|(_, candidate)| candidate.issue_id == item.issue_id)
                    {
                        let review = SemanticReview {
                            verdict: normalize_verdict(&item.verdict),
                            confidence: item.confidence.min(100),
                            summary: normalize_text(&item.summary, 80),
                            recommended_action: normalize_text(&item.recommended_action, 80),
                        };
                        cache.insert(
                            key.clone(),
                            CachedSemanticReview {
                                key: key.clone(),
                                review: review.clone(),
                                updated_at: now.clone(),
                            },
                        );
                        reviews.insert(item.issue_id, review);
                        reviewed_count += 1;
                    }
                }

                if reviewed_count == 0 {
                    message = "高级语义研判已执行，但未返回可用结果".to_string();
                }

                let _ = save_cache(&cache);
            }
            Err(error) => {
                message = format!("高级语义研判暂时不可用：{error}");
            }
        }
    }

    SemanticReviewBatchResult {
        summary: SemanticGuardSummary {
            licensed: true,
            configured: true,
            active: true,
            reviewed_issues: reviews.len() as u32,
            cache_hits,
            message,
        },
        reviews,
    }
}

fn normalize_verdict(value: &str) -> String {
    match value.trim().to_lowercase().as_str() {
        "escalate" => "escalate".to_string(),
        "clear" => "clear".to_string(),
        _ => "review".to_string(),
    }
}

fn severity_rank(value: &str) -> u8 {
    match value {
        "high" => 0,
        "medium" => 1,
        _ => 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_json_markdown_fences() {
        let wrapped = "```json\n{\"items\":[]}\n```";
        assert_eq!(trim_json_response(wrapped), "{\"items\":[]}");
    }

    #[test]
    fn normalizes_candidate_text_lengths() {
        let candidate = SemanticReviewCandidate {
            issue_id: "1".to_string(),
            category: "skill_security".to_string(),
            severity: "medium".to_string(),
            title: "title".to_string(),
            description: "a".repeat(500),
            file_path: None,
            evidence: "b".repeat(800),
        }
        .normalized();

        assert!(candidate.description.chars().count() <= 221);
        assert!(candidate.evidence.chars().count() <= 361);
    }
}
