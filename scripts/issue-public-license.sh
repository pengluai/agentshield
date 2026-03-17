#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
env_file="${AGENTSHIELD_PUBLIC_SALE_ENV:-$repo_root/.env.public-sale.local}"

# shellcheck source=./lib/load-dotenv-literal.sh
source "$repo_root/scripts/lib/load-dotenv-literal.sh"

usage() {
  cat <<'EOF'
Issue an AgentShield activation code using the local public-sale signing seed.

Usage:
  ./scripts/issue-public-license.sh --billing-cycle <monthly|yearly|lifetime> [options]

Examples:
  ./scripts/issue-public-license.sh --billing-cycle monthly --customer buyer@example.com --days 31
  ./scripts/issue-public-license.sh --billing-cycle yearly --customer buyer@example.com --days 366
  ./scripts/issue-public-license.sh --billing-cycle lifetime --customer buyer@example.com

Options:
  Pass any supported `issue_activation_code issue` flags after the wrapper arguments.

Environment:
  AGENTSHIELD_PUBLIC_SALE_ENV=/abs/path/to/.env.public-sale.local
EOF
}

if [[ "${1:-}" == "--" ]]; then
  shift
fi

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" || $# -eq 0 ]]; then
  usage
  exit 0
fi

if [[ -f "$env_file" ]]; then
  load_dotenv_literal "$env_file"
else
  echo "[issue-public-license] env file not found: $env_file" >&2
  exit 1
fi

if [[ -z "${AGENTSHIELD_LICENSE_SIGNING_SEED:-}" ]]; then
  echo "[issue-public-license] AGENTSHIELD_LICENSE_SIGNING_SEED is empty in $env_file" >&2
  exit 1
fi

if [[ -z "${AGENTSHIELD_LICENSE_PUBLIC_KEY:-}" ]]; then
  echo "[issue-public-license] AGENTSHIELD_LICENSE_PUBLIC_KEY is empty in $env_file" >&2
  exit 1
fi

cd "$repo_root"
cargo run --manifest-path src-tauri/Cargo.toml --bin issue_activation_code -- issue "$@"
