#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f ".env.public-sale.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env.public-sale.local"
  set +a
fi

tauri_release_config="${PUBLIC_TAURI_CONFIG_PATH:-src-tauri/tauri.release.json}"

if [[ ! -f "$tauri_release_config" ]]; then
  if [[ "${PUBLIC_AUTO_RENDER_TAURI_RELEASE_CONFIG:-1}" == "1" ]]; then
    echo "[public-release-build] tauri release config not found, trying env-based render"
    node ./scripts/render-tauri-release-config.mjs
  fi
fi

if [[ ! -f "$tauri_release_config" ]]; then
  echo "[public-release-build] missing tauri release config after render attempt: $tauri_release_config"
  exit 2
fi

echo "[public-release-build] running public sale gate checks"
bash ./scripts/public-sale-gate.sh

echo "[public-release-build] building signed desktop bundles with config: $tauri_release_config"
if [[ "$#" -gt 0 ]]; then
  pnpm tauri build -c "$tauri_release_config" "$@"
else
  pnpm tauri build -c "$tauri_release_config"
fi

echo "[public-release-build] build finished"
echo "[public-release-build] artifacts: src-tauri/target/release/bundle"
