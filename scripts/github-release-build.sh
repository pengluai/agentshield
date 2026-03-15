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

echo "[github-release-build] running sale gate in GitHub direct mode"
PUBLIC_RELEASE_PROFILE=pilot PUBLIC_REQUIRE_TAURI_RELEASE_CONFIG=0 bash ./scripts/public-sale-gate.sh

echo "[github-release-build] building desktop bundles for GitHub distribution"
if [[ "$#" -gt 0 ]]; then
  pnpm tauri build "$@"
else
  pnpm tauri build
fi

echo "[github-release-build] build finished"
echo "[github-release-build] artifacts: src-tauri/target/release/bundle"
