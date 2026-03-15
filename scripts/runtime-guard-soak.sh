#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REPEAT_COUNT="${REPEAT_COUNT:-5}"

echo "[runtime-guard-soak] repeating browser smoke test ${REPEAT_COUNT} times"
pnpm exec playwright test e2e/smoke.spec.ts --reporter=line --repeat-each="${REPEAT_COUNT}"

echo "[runtime-guard-soak] repeating runtime-guard Rust tests"
for run in $(seq 1 "$REPEAT_COUNT"); do
  echo "[runtime-guard-soak] cargo test run ${run}/${REPEAT_COUNT}"
  cargo test --manifest-path src-tauri/Cargo.toml commands::runtime_guard::
done

echo "[runtime-guard-soak] completed"
