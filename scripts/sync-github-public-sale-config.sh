#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=./lib/load-dotenv-literal.sh
source "$ROOT_DIR/scripts/lib/load-dotenv-literal.sh"

ENV_FILE=".env.public-sale.local"
REPO=""
APPLY=0
PROFILE="${PUBLIC_RELEASE_PROFILE:-pilot}"

usage() {
  cat <<'EOF'
Usage: bash ./scripts/sync-github-public-sale-config.sh [--env-file FILE] [--repo OWNER/REPO] [--profile pilot|public] [--apply]

Default mode is plan-only: validate local config and print what would be synced.
Use --apply to push variables and secrets to the GitHub repository via gh CLI.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --repo)
      REPO="$2"
      shift 2
      ;;
    --profile)
      PROFILE="$2"
      shift 2
      ;;
    --apply)
      APPLY=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "[sync-public-sale-config] unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ "$PROFILE" != "pilot" && "$PROFILE" != "public" ]]; then
  echo "[sync-public-sale-config] invalid profile: $PROFILE"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[sync-public-sale-config] env file not found: $ENV_FILE"
  exit 1
fi

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

check_nonempty() {
  local var_name="$1"
  local value="${!var_name:-}"
  if [[ -z "$value" ]]; then
    echo "[sync-public-sale-config] missing required value: $var_name"
    return 1
  fi
}

check_https_url() {
  local var_name="$1"
  local value="${!var_name:-}"
  if [[ -z "$value" ]]; then
    echo "[sync-public-sale-config] missing required value: $var_name"
    return 1
  fi
  if [[ "$value" != https://* ]]; then
    echo "[sync-public-sale-config] $var_name must start with https://"
    return 1
  fi
}

check_json_object() {
  local var_name="$1"
  local value="${!var_name:-}"
  if [[ -z "$value" ]]; then
    echo "[sync-public-sale-config] missing required value: $var_name"
    return 1
  fi
  if ! V="$value" node -e "const v=process.env.V;const parsed=JSON.parse(v);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)) process.exit(1);" >/dev/null 2>&1; then
    echo "[sync-public-sale-config] $var_name must be a valid JSON object string"
    return 1
  fi
}

check_checkout_url() {
  local var_name="$1"
  local value="${!var_name:-}"
  check_https_url "$var_name" || return 1
  local host
  host="$(extract_url_host "$value")"
  if is_placeholder_or_local_host "$host"; then
    echo "[sync-public-sale-config] $var_name cannot use placeholder/local host: $host"
    return 1
  fi
}

check_gateway_url() {
  local var_name="$1"
  local value="${!var_name:-}"
  check_https_url "$var_name" || return 1
  local host
  host="$(extract_url_host "$value")"
  if is_placeholder_or_local_host "$host"; then
    echo "[sync-public-sale-config] $var_name cannot use placeholder/local host: $host"
    return 1
  fi
  if [[ "$PROFILE" == "public" ]] && is_temporary_tunnel_host "$host"; then
    echo "[sync-public-sale-config] $var_name cannot use temporary tunnel host for public profile: $host"
    return 1
  fi
}

load_dotenv_literal "$ENV_FILE"

if [[ -z "$REPO" ]]; then
  REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
fi

VARIABLE_NAMES=(
  VITE_CHECKOUT_MONTHLY_URL
  VITE_CHECKOUT_YEARLY_URL
  VITE_CHECKOUT_LIFETIME_URL
  AGENTSHIELD_LICENSE_GATEWAY_URL
  AGENTSHIELD_LICENSE_PUBLIC_KEY
  LICENSE_DELIVERY_FROM_EMAIL
  LICENSE_DELIVERY_REPLY_TO
  CREEM_SKU_BILLING_MAP_JSON
)

SECRET_NAMES=(
  CREEM_WEBHOOK_SECRET
  LICENSE_GATEWAY_ADMIN_PASSWORD
  AGENTSHIELD_LICENSE_SIGNING_SEED
  RESEND_API_KEY
)

if [[ "$PROFILE" == "public" ]]; then
  VARIABLE_NAMES+=(
    TAURI_UPDATER_ENDPOINT
    WINDOWS_TIMESTAMP_URL
  )
  SECRET_NAMES+=(
    APPLE_ID
    APPLE_PASSWORD
    APPLE_TEAM_ID
    APPLE_SIGNING_IDENTITY
    APPLE_CERTIFICATE
    APPLE_CERTIFICATE_PASSWORD
    KEYCHAIN_PASSWORD
    TAURI_SIGNING_PRIVATE_KEY
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD
    TAURI_UPDATER_PUBLIC_KEY
    WINDOWS_CERTIFICATE
    WINDOWS_CERTIFICATE_PASSWORD
    WINDOWS_CERTIFICATE_THUMBPRINT
  )
fi

failed=0
check_checkout_url "VITE_CHECKOUT_MONTHLY_URL" || failed=1
check_checkout_url "VITE_CHECKOUT_YEARLY_URL" || failed=1
check_checkout_url "VITE_CHECKOUT_LIFETIME_URL" || failed=1
check_gateway_url "AGENTSHIELD_LICENSE_GATEWAY_URL" || failed=1
check_nonempty "AGENTSHIELD_LICENSE_PUBLIC_KEY" || failed=1
check_nonempty "LICENSE_DELIVERY_FROM_EMAIL" || failed=1
check_json_object "CREEM_SKU_BILLING_MAP_JSON" || failed=1
check_nonempty "CREEM_WEBHOOK_SECRET" || failed=1
check_nonempty "LICENSE_GATEWAY_ADMIN_PASSWORD" || failed=1
check_nonempty "AGENTSHIELD_LICENSE_SIGNING_SEED" || failed=1
check_nonempty "RESEND_API_KEY" || failed=1

if [[ -n "${CREEM_PRODUCT_BILLING_MAP_JSON:-}" ]]; then
  VARIABLE_NAMES+=(
    CREEM_PRODUCT_BILLING_MAP_JSON
  )
  check_json_object "CREEM_PRODUCT_BILLING_MAP_JSON" || failed=1
fi

if [[ "$PROFILE" == "public" ]]; then
  check_https_url "TAURI_UPDATER_ENDPOINT" || failed=1
  check_nonempty "WINDOWS_TIMESTAMP_URL" || failed=1
  check_nonempty "APPLE_ID" || failed=1
  check_nonempty "APPLE_PASSWORD" || failed=1
  check_nonempty "APPLE_TEAM_ID" || failed=1
  check_nonempty "APPLE_SIGNING_IDENTITY" || failed=1
  check_nonempty "TAURI_SIGNING_PRIVATE_KEY" || failed=1
  check_nonempty "TAURI_SIGNING_PRIVATE_KEY_PASSWORD" || failed=1
  check_nonempty "TAURI_UPDATER_PUBLIC_KEY" || failed=1
  check_nonempty "WINDOWS_CERTIFICATE_THUMBPRINT" || failed=1
fi

if [[ "$failed" -ne 0 ]]; then
  echo "[sync-public-sale-config] validation failed for profile=$PROFILE env_file=$ENV_FILE"
  exit 2
fi

echo "[sync-public-sale-config] repo=$REPO profile=$PROFILE mode=$([[ "$APPLY" -eq 1 ]] && echo apply || echo plan)"

for name in "${VARIABLE_NAMES[@]}"; do
  value="${!name:-}"
  [[ -z "$value" ]] && continue
  if [[ "$APPLY" -eq 1 ]]; then
    gh variable set "$name" --repo "$REPO" --body "$value"
    echo "[sync-public-sale-config] set variable: $name"
  else
    echo "[sync-public-sale-config] plan variable: $name"
  fi
done

for name in "${SECRET_NAMES[@]}"; do
  value="${!name:-}"
  [[ -z "$value" ]] && continue
  if [[ "$APPLY" -eq 1 ]]; then
    gh secret set "$name" --repo "$REPO" --body "$value"
    echo "[sync-public-sale-config] set secret: $name"
  else
    echo "[sync-public-sale-config] plan secret: $name"
  fi
done

if [[ "$APPLY" -eq 1 ]]; then
  echo "[sync-public-sale-config] GitHub repository configuration updated."
else
  echo "[sync-public-sale-config] Dry run complete. Re-run with --apply to push values."
fi
