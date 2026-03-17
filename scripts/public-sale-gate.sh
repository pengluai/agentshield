#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=./lib/load-dotenv-literal.sh
source "$ROOT_DIR/scripts/lib/load-dotenv-literal.sh"

# Optional local env bootstrap for readiness checks.
if [[ -f ".env.public-sale.local" ]]; then
  load_dotenv_literal ".env.public-sale.local"
fi

release_profile="${PUBLIC_RELEASE_PROFILE:-public}"
require_tauri_release_config="${PUBLIC_REQUIRE_TAURI_RELEASE_CONFIG:-1}"
auto_render_tauri_release_config="${PUBLIC_AUTO_RENDER_TAURI_RELEASE_CONFIG:-1}"

if [[ "$release_profile" != "pilot" && "$release_profile" != "public" ]]; then
  echo "[public-sale-gate] invalid PUBLIC_RELEASE_PROFILE: $release_profile (expected pilot or public)"
  exit 1
fi

echo "[public-sale-gate] validating public-sale readiness in $ROOT_DIR (release_profile=$release_profile)"

missing=0
warnings=0

search_file() {
  local pattern="$1"
  local file_path="$2"
  if command -v rg >/dev/null 2>&1; then
    rg -n -- "$pattern" "$file_path" >/dev/null
  else
    grep -E -n -- "$pattern" "$file_path" >/dev/null
  fi
}

check_file_exists() {
  local file_path="$1"
  if [[ ! -f "$file_path" ]]; then
    echo "[public-sale-gate] missing file: $file_path"
    missing=1
  fi
}

check_file_contains() {
  local file_path="$1"
  local pattern="$2"
  local hint="$3"
  if [[ ! -f "$file_path" ]]; then
    return
  fi
  if ! search_file "$pattern" "$file_path"; then
    echo "[public-sale-gate] $file_path missing required content: $hint"
    missing=1
  fi
}

check_env_required() {
  local var_name="$1"
  local value="${!var_name:-}"
  if [[ -z "$value" ]]; then
    echo "[public-sale-gate] missing required env: $var_name"
    missing=1
  fi
}

check_env_required_if_public() {
  local var_name="$1"
  if [[ "$release_profile" != "public" ]]; then
    return
  fi
  check_env_required "$var_name"
}

check_env_json_object() {
  local var_name="$1"
  local value="${!var_name:-}"
  if [[ -z "$value" ]]; then
    echo "[public-sale-gate] missing required env: $var_name"
    missing=1
    return
  fi
  if ! V="$value" node -e "const v=process.env.V;const parsed=JSON.parse(v);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)) process.exit(1);" >/dev/null 2>&1; then
    echo "[public-sale-gate] $var_name must be a valid JSON object string"
    missing=1
  fi
}

check_env_https_url() {
  local var_name="$1"
  local value="${!var_name:-}"
  if [[ -z "$value" ]]; then
    echo "[public-sale-gate] missing required env: $var_name"
    missing=1
    return
  fi
  if [[ "$value" != https://* ]]; then
    echo "[public-sale-gate] $var_name must start with https://"
    missing=1
  fi
}

extract_url_host() {
  local value="$1"
  local normalized
  normalized="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  normalized="${normalized#https://}"
  normalized="${normalized%%/*}"
  normalized="${normalized##*@}"
  normalized="${normalized%%:*}"
  printf '%s' "$normalized"
}

is_placeholder_or_local_host() {
  local host="$1"
  [[ -z "$host" ]] && return 0
  [[ "$host" == "example.com" || "$host" == *.example.com ]] && return 0
  [[ "$host" == "localhost" || "$host" == "127.0.0.1" || "$host" == "0.0.0.0" || "$host" == "::1" ]] && return 0
  [[ "$host" == "invalid" || "$host" == *.invalid ]] && return 0
  [[ "$host" == "test" || "$host" == *.test ]] && return 0
  return 1
}

is_temporary_tunnel_host() {
  local host="$1"
  [[ "$host" == *.trycloudflare.com ]] && return 0
  return 1
}

check_env_checkout_url() {
  local var_name="$1"
  local value="${!var_name:-}"
  check_env_https_url "$var_name"
  [[ -z "$value" || "$value" != https://* ]] && return
  local host
  host="$(extract_url_host "$value")"
  if is_placeholder_or_local_host "$host"; then
    echo "[public-sale-gate] $var_name cannot use placeholder/local host: $host"
    missing=1
  fi
}

check_env_gateway_url() {
  local var_name="$1"
  local value="${!var_name:-}"
  check_env_https_url "$var_name"
  [[ -z "$value" || "$value" != https://* ]] && return
  local host
  host="$(extract_url_host "$value")"
  if is_placeholder_or_local_host "$host"; then
    echo "[public-sale-gate] $var_name cannot use placeholder/local host: $host"
    missing=1
    return
  fi
  if [[ "$release_profile" == "public" ]] && is_temporary_tunnel_host "$host"; then
    echo "[public-sale-gate] $var_name cannot use temporary tunnel host for public release: $host"
    missing=1
  fi
}

echo "[public-sale-gate] checking legal documents"
check_file_exists "docs/legal/privacy-policy.md"
check_file_exists "docs/legal/terms-of-service.md"
check_file_exists "docs/legal/eula.md"
check_file_exists "docs/legal/refund-policy.md"
check_file_contains "docs/legal/privacy-policy.md" "^Last Updated:" "Last Updated date"
check_file_contains "docs/legal/terms-of-service.md" "^Last Updated:" "Last Updated date"
check_file_contains "docs/legal/eula.md" "^Last Updated:" "Last Updated date"
check_file_contains "docs/legal/refund-policy.md" "^Last Updated:" "Last Updated date"

echo "[public-sale-gate] checking checkout links"
check_env_checkout_url "VITE_CHECKOUT_MONTHLY_URL"
check_env_checkout_url "VITE_CHECKOUT_YEARLY_URL"
check_env_checkout_url "VITE_CHECKOUT_LIFETIME_URL"
check_env_gateway_url "AGENTSHIELD_LICENSE_GATEWAY_URL"
check_env_required "AGENTSHIELD_LICENSE_PUBLIC_KEY"

echo "[public-sale-gate] checking license gateway secrets"
check_env_required "CREEM_WEBHOOK_SECRET"
check_env_required "LICENSE_GATEWAY_ADMIN_PASSWORD"
check_env_required "AGENTSHIELD_LICENSE_SIGNING_SEED"
check_env_required "RESEND_API_KEY"
check_env_required "LICENSE_DELIVERY_FROM_EMAIL"
check_env_json_object "CREEM_SKU_BILLING_MAP_JSON"

if [[ -n "${CREEM_PRODUCT_BILLING_MAP_JSON:-}" ]]; then
  check_env_json_object "CREEM_PRODUCT_BILLING_MAP_JSON"
fi

echo "[public-sale-gate] checking signing-related env for full public profile"
check_env_required_if_public "APPLE_ID"
check_env_required_if_public "APPLE_PASSWORD"
check_env_required_if_public "APPLE_TEAM_ID"
check_env_required_if_public "APPLE_SIGNING_IDENTITY"
check_env_required_if_public "TAURI_SIGNING_PRIVATE_KEY"
check_env_required_if_public "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"
check_env_required_if_public "WINDOWS_CERTIFICATE_THUMBPRINT"
check_env_required_if_public "WINDOWS_TIMESTAMP_URL"

license_data_path="${LICENSE_GATEWAY_DATA_PATH:-data/license-gateway.json}"
if [[ "$license_data_path" == "data/license-gateway.json" ]]; then
  echo "[public-sale-gate] warning: LICENSE_GATEWAY_DATA_PATH is using repo-local default (not recommended for public sale)"
  warnings=$((warnings + 1))
fi

echo "[public-sale-gate] checking tauri release config"
tauri_release_config="${PUBLIC_TAURI_CONFIG_PATH:-src-tauri/tauri.release.json}"

if [[ "$require_tauri_release_config" == "1" && ! -f "$tauri_release_config" && "$auto_render_tauri_release_config" == "1" ]]; then
  if [[ -n "${TAURI_UPDATER_PUBLIC_KEY:-}" ]] && [[ -n "${TAURI_UPDATER_ENDPOINTS_JSON:-${TAURI_UPDATER_ENDPOINTS:-${TAURI_UPDATER_ENDPOINT:-}}}" ]]; then
    echo "[public-sale-gate] generating tauri release config from env via scripts/render-tauri-release-config.mjs"
    if ! node ./scripts/render-tauri-release-config.mjs; then
      echo "[public-sale-gate] failed to generate tauri release config from env"
      missing=1
    fi
  fi
fi

if [[ "$require_tauri_release_config" == "1" ]]; then
  if [[ ! -f "$tauri_release_config" ]]; then
    echo "[public-sale-gate] missing tauri release config: $tauri_release_config"
    echo "[public-sale-gate] tip: set TAURI_UPDATER_PUBLIC_KEY + TAURI_UPDATER_ENDPOINT and rerun, or copy src-tauri/tauri.release.example.json to $tauri_release_config with real values"
    missing=1
  else
    if search_file "REPLACE_WITH_|example.com/agentshield|__VERSION__" "$tauri_release_config"; then
      echo "[public-sale-gate] tauri release config still contains placeholder values: $tauri_release_config"
      missing=1
    fi

    check_file_contains "$tauri_release_config" "\"createUpdaterArtifacts\"\\s*:\\s*true" "bundle.createUpdaterArtifacts=true"
    check_file_contains "$tauri_release_config" "\"pubkey\"\\s*:\\s*\"[^\"]+\"" "plugins.updater.pubkey"
    check_file_contains "$tauri_release_config" "\"endpoints\"\\s*:\\s*\\[" "plugins.updater.endpoints"
  fi
else
  echo "[public-sale-gate] skip tauri.release.json checks (PUBLIC_REQUIRE_TAURI_RELEASE_CONFIG=0)"
fi

if [[ "$missing" -ne 0 ]]; then
  echo "[public-sale-gate] prerequisites are incomplete; fix above issues before running build gates"
  exit 2
fi

echo "[public-sale-gate] running repo quality gates (RELEASE_PROFILE=$release_profile)"
RELEASE_PROFILE="$release_profile" pnpm run release:gate

if [[ "$warnings" -gt 0 ]]; then
  echo "[public-sale-gate] passed with $warnings warning(s); review warnings before final release"
else
  echo "[public-sale-gate] passed with zero warnings"
fi
