#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PUBLIC_RELEASE_PROFILE=pilot PUBLIC_REQUIRE_TAURI_RELEASE_CONFIG=0 bash ./scripts/public-sale-gate.sh
