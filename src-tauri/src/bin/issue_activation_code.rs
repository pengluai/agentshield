use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use chrono::{DateTime, Duration, Utc};
use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Serialize};
use std::env;
use std::process;

const SIGNING_SEED_ENV: &str = "AGENTSHIELD_LICENSE_SIGNING_SEED";

#[derive(Serialize, Deserialize, Clone)]
struct SignedLicensePayload {
    plan: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    billing_cycle: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    expires_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    issued_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    license_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    customer: Option<String>,
}

struct IssueOptions {
    plan: String,
    billing_cycle: String,
    expires_at: Option<String>,
    days: Option<i64>,
    issued_at: Option<String>,
    license_id: Option<String>,
    customer: Option<String>,
    seed_input: String,
}

enum CliCommand {
    Issue(IssueOptions),
    PrintPublicKey { seed_input: String },
}

fn print_usage() {
    eprintln!(
        "Usage:
  issue_activation_code issue [--plan pro] --billing-cycle <monthly|yearly|lifetime> [--days <n> | --expires-at <RFC3339>] [--issued-at <RFC3339>] [--license-id <id>] [--customer <email>] [--seed <hex-or-base64url>]
  issue_activation_code print-public-key [--seed <hex-or-base64url>]

Environment:
  {SIGNING_SEED_ENV}=<32-byte hex or base64url seed>
"
    );
}

fn parse_args(args: &[String]) -> Result<CliCommand, String> {
    let Some(subcommand) = args.get(1).map(|value| value.as_str()) else {
        return Err("Missing subcommand".to_string());
    };

    let mut plan = "pro".to_string();
    let mut billing_cycle = None;
    let mut expires_at = None;
    let mut days = None;
    let mut issued_at = None;
    let mut license_id = None;
    let mut customer = None;
    let mut seed_input = env::var(SIGNING_SEED_ENV).unwrap_or_default();

    let mut index = 2usize;
    while index < args.len() {
        let flag = &args[index];
        let next = args
            .get(index + 1)
            .ok_or_else(|| format!("Missing value for {flag}"))?;
        match flag.as_str() {
            "--plan" => plan = next.clone(),
            "--billing-cycle" => billing_cycle = Some(next.clone()),
            "--expires-at" => expires_at = Some(next.clone()),
            "--days" => {
                days = Some(
                    next.parse::<i64>()
                        .map_err(|_| "--days must be an integer".to_string())?,
                )
            }
            "--issued-at" => issued_at = Some(next.clone()),
            "--license-id" => license_id = Some(next.clone()),
            "--customer" => customer = Some(next.clone()),
            "--seed" => seed_input = next.clone(),
            _ => return Err(format!("Unknown flag: {flag}")),
        }
        index += 2;
    }

    if seed_input.trim().is_empty() {
        return Err(format!(
            "Missing signing seed. Pass --seed or set {SIGNING_SEED_ENV}."
        ));
    }

    match subcommand {
        "issue" => Ok(CliCommand::Issue(IssueOptions {
            plan,
            billing_cycle: billing_cycle
                .ok_or_else(|| "--billing-cycle is required".to_string())?,
            expires_at,
            days,
            issued_at,
            license_id,
            customer,
            seed_input,
        })),
        "print-public-key" => Ok(CliCommand::PrintPublicKey { seed_input }),
        _ => Err(format!("Unknown subcommand: {subcommand}")),
    }
}

fn decode_seed(input: &str) -> Result<[u8; 32], String> {
    let trimmed = input.trim();
    let decoded = if trimmed.len() == 64 && trimmed.chars().all(|value| value.is_ascii_hexdigit()) {
        decode_hex(trimmed)?
    } else if let Ok(bytes) = URL_SAFE_NO_PAD.decode(trimmed) {
        bytes
    } else if let Ok(bytes) = STANDARD.decode(trimmed) {
        bytes
    } else {
        return Err("Signing seed must be 32-byte hex, base64url, or base64.".to_string());
    };

    decoded
        .as_slice()
        .try_into()
        .map_err(|_| "Signing seed must decode to exactly 32 bytes.".to_string())
}

fn decode_hex(input: &str) -> Result<Vec<u8>, String> {
    if !input.len().is_multiple_of(2) {
        return Err("Hex seed must have an even length.".to_string());
    }

    let mut bytes = Vec::with_capacity(input.len() / 2);
    let mut index = 0usize;
    while index < input.len() {
        let byte = u8::from_str_radix(&input[index..index + 2], 16)
            .map_err(|_| "Signing seed contains invalid hex.".to_string())?;
        bytes.push(byte);
        index += 2;
    }
    Ok(bytes)
}

fn resolve_issued_at(value: Option<&str>) -> Result<DateTime<Utc>, String> {
    value
        .map(|timestamp| {
            timestamp
                .parse::<DateTime<Utc>>()
                .map_err(|_| "--issued-at must be RFC3339.".to_string())
        })
        .unwrap_or_else(|| Ok(Utc::now()))
}

fn resolve_expires_at(
    billing_cycle: &str,
    issued_at: DateTime<Utc>,
    expires_at: Option<&str>,
    days: Option<i64>,
) -> Result<Option<String>, String> {
    if billing_cycle == "lifetime" {
        return Ok(None);
    }

    if let Some(value) = expires_at {
        let parsed = value
            .parse::<DateTime<Utc>>()
            .map_err(|_| "--expires-at must be RFC3339.".to_string())?;
        return Ok(Some(parsed.to_rfc3339()));
    }

    let resolved_days = match days {
        Some(value) if value > 0 => value,
        Some(_) => return Err("--days must be greater than 0.".to_string()),
        None => match billing_cycle {
            "monthly" => 30,
            "yearly" => 365,
            _ => {
                return Err(
                    "Non-lifetime billing cycles must provide --days or use monthly/yearly."
                        .to_string(),
                )
            }
        },
    };

    Ok(Some(
        (issued_at + Duration::days(resolved_days)).to_rfc3339(),
    ))
}

fn build_payload(options: &IssueOptions) -> Result<SignedLicensePayload, String> {
    if options.plan != "pro" && options.plan != "enterprise" {
        return Err("--plan must be pro or enterprise.".to_string());
    }

    if !matches!(
        options.billing_cycle.as_str(),
        "monthly" | "yearly" | "lifetime"
    ) {
        return Err("--billing-cycle must be monthly, yearly, or lifetime.".to_string());
    }

    let issued_at = resolve_issued_at(options.issued_at.as_deref())?;
    let expires_at = resolve_expires_at(
        &options.billing_cycle,
        issued_at,
        options.expires_at.as_deref(),
        options.days,
    )?;

    Ok(SignedLicensePayload {
        plan: options.plan.clone(),
        billing_cycle: Some(options.billing_cycle.clone()),
        expires_at,
        issued_at: Some(issued_at.to_rfc3339()),
        license_id: options.license_id.clone(),
        customer: options.customer.clone(),
    })
}

fn issue_code(payload: &SignedLicensePayload, seed: [u8; 32]) -> Result<String, String> {
    let payload_bytes = serde_json::to_vec(payload)
        .map_err(|error| format!("Serialize payload failed: {error}"))?;
    let signing_key = SigningKey::from_bytes(&seed);
    let signature = signing_key.sign(&payload_bytes);
    let payload_encoded = URL_SAFE_NO_PAD.encode(payload_bytes);
    let signature_encoded = URL_SAFE_NO_PAD.encode(signature.to_bytes());
    Ok(format!("AGSH.{payload_encoded}.{signature_encoded}"))
}

fn print_issue_output(payload: &SignedLicensePayload, code: &str) -> Result<(), String> {
    let output = serde_json::json!({
        "plan": payload.plan,
        "billing_cycle": payload.billing_cycle,
        "expires_at": payload.expires_at,
        "issued_at": payload.issued_at,
        "license_id": payload.license_id,
        "customer": payload.customer,
        "code": code
    });
    let rendered = serde_json::to_string_pretty(&output)
        .map_err(|error| format!("JSON render failed: {error}"))?;
    println!("{rendered}");
    Ok(())
}

fn print_public_key(seed: [u8; 32]) {
    let signing_key = SigningKey::from_bytes(&seed);
    let public_key = signing_key.verifying_key().to_bytes();
    println!("{}", URL_SAFE_NO_PAD.encode(public_key));
}

fn main() {
    let args = env::args().collect::<Vec<_>>();
    let command = match parse_args(&args) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("Error: {error}");
            print_usage();
            process::exit(1);
        }
    };

    match command {
        CliCommand::Issue(options) => {
            let payload = match build_payload(&options) {
                Ok(value) => value,
                Err(error) => {
                    eprintln!("Error: {error}");
                    process::exit(1);
                }
            };
            let seed = match decode_seed(&options.seed_input) {
                Ok(value) => value,
                Err(error) => {
                    eprintln!("Error: {error}");
                    process::exit(1);
                }
            };
            let code = match issue_code(&payload, seed) {
                Ok(value) => value,
                Err(error) => {
                    eprintln!("Error: {error}");
                    process::exit(1);
                }
            };
            if let Err(error) = print_issue_output(&payload, &code) {
                eprintln!("Error: {error}");
                process::exit(1);
            }
        }
        CliCommand::PrintPublicKey { seed_input } => match decode_seed(&seed_input) {
            Ok(seed) => print_public_key(seed),
            Err(error) => {
                eprintln!("Error: {error}");
                process::exit(1);
            }
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};

    fn parse_code(code: &str) -> (Vec<u8>, [u8; 64]) {
        let parts = code.split('.').collect::<Vec<_>>();
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0], "AGSH");
        let payload = URL_SAFE_NO_PAD.decode(parts[1]).unwrap();
        let signature = URL_SAFE_NO_PAD.decode(parts[2]).unwrap();
        (payload, signature.try_into().unwrap())
    }

    #[test]
    fn issue_code_signs_payload_that_verifies() {
        let seed = [7u8; 32];
        let payload = SignedLicensePayload {
            plan: "pro".to_string(),
            billing_cycle: Some("monthly".to_string()),
            expires_at: Some("2099-01-01T00:00:00Z".to_string()),
            issued_at: Some("2026-03-11T00:00:00Z".to_string()),
            license_id: Some("lic_test_001".to_string()),
            customer: Some("demo@example.com".to_string()),
        };

        let code = issue_code(&payload, seed).unwrap();
        let (payload_bytes, signature_bytes) = parse_code(&code);
        let signing_key = SigningKey::from_bytes(&seed);
        let verifying_key =
            VerifyingKey::from_bytes(&signing_key.verifying_key().to_bytes()).unwrap();
        let signature = Signature::from_slice(&signature_bytes).unwrap();

        verifying_key.verify(&payload_bytes, &signature).unwrap();
        let parsed: SignedLicensePayload = serde_json::from_slice(&payload_bytes).unwrap();
        assert_eq!(parsed.plan, "pro");
        assert_eq!(parsed.billing_cycle.as_deref(), Some("monthly"));
        assert_eq!(parsed.customer.as_deref(), Some("demo@example.com"));
    }

    #[test]
    fn build_payload_uses_default_expiry_for_monthly_and_yearly() {
        let monthly = build_payload(&IssueOptions {
            plan: "pro".to_string(),
            billing_cycle: "monthly".to_string(),
            expires_at: None,
            days: None,
            issued_at: Some("2026-03-11T00:00:00Z".to_string()),
            license_id: None,
            customer: None,
            seed_input: "ignored".to_string(),
        })
        .unwrap();
        let yearly = build_payload(&IssueOptions {
            plan: "pro".to_string(),
            billing_cycle: "yearly".to_string(),
            expires_at: None,
            days: None,
            issued_at: Some("2026-03-11T00:00:00Z".to_string()),
            license_id: None,
            customer: None,
            seed_input: "ignored".to_string(),
        })
        .unwrap();

        assert_eq!(
            monthly.expires_at.as_deref(),
            Some("2026-04-10T00:00:00+00:00")
        );
        assert_eq!(
            yearly.expires_at.as_deref(),
            Some("2027-03-11T00:00:00+00:00")
        );
    }

    #[test]
    fn lifetime_payload_omits_expiry() {
        let payload = build_payload(&IssueOptions {
            plan: "pro".to_string(),
            billing_cycle: "lifetime".to_string(),
            expires_at: None,
            days: None,
            issued_at: Some("2026-03-11T00:00:00Z".to_string()),
            license_id: Some("lic_forever".to_string()),
            customer: Some("owner@example.com".to_string()),
            seed_input: "ignored".to_string(),
        })
        .unwrap();

        assert_eq!(payload.expires_at, None);
        assert_eq!(payload.billing_cycle.as_deref(), Some("lifetime"));
        assert_eq!(payload.license_id.as_deref(), Some("lic_forever"));
    }

    #[test]
    fn decode_seed_supports_hex_and_base64url() {
        let hex_seed = "0707070707070707070707070707070707070707070707070707070707070707";
        let base64_seed = URL_SAFE_NO_PAD.encode([7u8; 32]);

        assert_eq!(decode_seed(hex_seed).unwrap(), [7u8; 32]);
        assert_eq!(decode_seed(&base64_seed).unwrap(), [7u8; 32]);
    }
}
