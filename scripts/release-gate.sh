#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RELEASE_PROFILE="${RELEASE_PROFILE:-pilot}"

if [[ "$RELEASE_PROFILE" != "pilot" && "$RELEASE_PROFILE" != "public" ]]; then
  echo "[release-gate] invalid RELEASE_PROFILE: $RELEASE_PROFILE (expected pilot or public)"
  exit 1
fi

echo "[release-gate] profile=${RELEASE_PROFILE}"

echo "[release-gate] cargo test"
cargo test --manifest-path src-tauri/Cargo.toml

echo "[release-gate] pnpm build"
pnpm build

echo "[release-gate] vitest"
pnpm test -- --runInBand

echo "[release-gate] pnpm audit (prod, high+)"
pnpm audit --prod --audit-level=high --registry=https://registry.npmjs.org

if cargo audit --version >/dev/null 2>&1; then
  echo "[release-gate] cargo audit"
  (
    cd src-tauri
    cargo audit
  )
else
  echo "[release-gate] warning: cargo audit not available; skipping Rust advisory scan"
fi

echo "[release-gate] playwright smoke"
pnpm exec playwright test e2e/smoke.spec.ts --reporter=line

echo "[release-gate] tauri info"
if ! perl -e 'my $timeout = shift; local $SIG{ALRM} = sub { die "timeout\n" }; alarm($timeout); my $rc = system @ARGV; alarm(0); exit($rc == -1 ? 1 : ($rc >> 8));' 90 pnpm tauri info; then
  echo "[release-gate] warning: tauri info failed or timed out after 90s; continuing"
fi

missing=0

if [[ "$RELEASE_PROFILE" == "public" ]]; then
  if [[ "$(uname -s)" == "Darwin" ]] && ! xcodebuild -version >/dev/null 2>&1; then
    echo "[release-gate] macOS build prerequisites missing: Xcode is not installed"
    missing=1
  fi

  if [[ -z "${APPLE_ID:-}" || -z "${APPLE_PASSWORD:-}" ]]; then
    echo "[release-gate] macOS notarization credentials missing: APPLE_ID / APPLE_PASSWORD"
    missing=1
  fi

  if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
    echo "[release-gate] macOS signing identity missing: APPLE_SIGNING_IDENTITY"
    missing=1
  fi

  if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" || -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]]; then
    echo "[release-gate] updater signing key missing: TAURI_SIGNING_PRIVATE_KEY / TAURI_SIGNING_PRIVATE_KEY_PASSWORD"
    missing=1
  fi

  if [[ -z "${WINDOWS_CERTIFICATE_THUMBPRINT:-}" || -z "${WINDOWS_TIMESTAMP_URL:-}" ]]; then
    echo "[release-gate] Windows signing variables missing: WINDOWS_CERTIFICATE_THUMBPRINT / WINDOWS_TIMESTAMP_URL"
    missing=1
  fi
else
  if [[ "$(uname -s)" == "Darwin" ]] && ! xcodebuild -version >/dev/null 2>&1; then
    echo "[release-gate] warning: full Xcode not installed. This only blocks public notarized macOS release, not pilot GitHub distribution."
  fi
  if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
    echo "[release-gate] warning: no APPLE_SIGNING_IDENTITY set. macOS pilot artifacts should use ad-hoc signing ('-') on CI."
  fi
fi

if [[ "$missing" -ne 0 ]]; then
  echo "[release-gate] Build and test passed, but release-signing prerequisites are incomplete."
  exit 2
fi

if [[ "$RELEASE_PROFILE" == "public" ]]; then
  echo "[release-gate] All repo-local gates and public-release signing prerequisites are present."
else
  echo "[release-gate] All repo-local gates for pilot GitHub distribution are present."
fi
