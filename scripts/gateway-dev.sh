#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
env_file="${AGENTSHIELD_PUBLIC_SALE_ENV:-$repo_root/.env.public-sale.local}"

# shellcheck source=./lib/load-dotenv-literal.sh
source "$repo_root/scripts/lib/load-dotenv-literal.sh"

if [[ -f "$env_file" ]]; then
  load_dotenv_literal "$env_file"
else
  echo "[gateway:dev] env file not found, continuing with current environment: $env_file"
fi

exec node "$repo_root/scripts/license-gateway.mjs"
