#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WRANGLER_CONFIG_PATH="$ROOT_DIR/workers/storefront/wrangler.jsonc"
DEFAULT_RELEASE_REPO="pengluai/agentshield-downloads"

usage() {
  cat <<'EOF'
Update the storefront download release tag and redeploy the Cloudflare Worker.

Usage:
  ./scripts/deploy-storefront-downloads.sh <release-tag> [release-repo]

Examples:
  ./scripts/deploy-storefront-downloads.sh agentshield-pilot-v1.0.1
  ./scripts/deploy-storefront-downloads.sh agentshield-v1.1.0 pengluai/agentshield-downloads
EOF
}

if [[ "${1:-}" == "--" ]]; then
  shift
fi

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" || $# -lt 1 ]]; then
  usage
  [[ $# -lt 1 ]] && exit 1 || exit 0
fi

release_tag="$1"
release_repo="${2:-$DEFAULT_RELEASE_REPO}"

WRANGLER_CONFIG_PATH="$WRANGLER_CONFIG_PATH" RELEASE_TAG="$release_tag" RELEASE_REPO="$release_repo" node <<'NODE'
const fs = require('node:fs');

const configPath = process.env.WRANGLER_CONFIG_PATH;
const releaseTag = process.env.RELEASE_TAG;
const releaseRepo = process.env.RELEASE_REPO;

const raw = fs.readFileSync(configPath, 'utf8');
const config = JSON.parse(raw);

config.vars = config.vars || {};
config.vars.DOWNLOAD_RELEASE_REPO = releaseRepo;
config.vars.DOWNLOAD_RELEASE_TAG = releaseTag;
config.vars.DOWNLOAD_ASSET_MACOS = config.vars.DOWNLOAD_ASSET_MACOS || 'AgentShield-macos-arm64.dmg';
config.vars.DOWNLOAD_ASSET_WINDOWS = config.vars.DOWNLOAD_ASSET_WINDOWS || 'AgentShield-windows-x64-setup.exe';
config.vars.DOWNLOAD_RELEASES_URL = `https://github.com/${releaseRepo}/releases`;

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
NODE

echo "[deploy-storefront-downloads] updated $(basename "$WRANGLER_CONFIG_PATH") with:"
echo "  DOWNLOAD_RELEASE_REPO=$release_repo"
echo "  DOWNLOAD_RELEASE_TAG=$release_tag"

cd "$ROOT_DIR/workers/storefront"
npx wrangler deploy
