#!/usr/bin/env bash

set -euo pipefail

workflow_repo="pengluai/agentshield"
release_repo="pengluai/agentshield-downloads"
run_id=""
tag=""
version=""
keep_existing=0

usage() {
  cat <<'EOF'
Download pilot workflow artifacts, normalize file names, and upload them to a GitHub release.

Usage:
  ./scripts/curate-pilot-release-assets.sh --run-id <run-id> --tag <release-tag> --version <app-version> [--workflow-repo owner/repo] [--release-repo owner/repo] [--repo owner/repo] [--keep-existing]

Examples:
  ./scripts/curate-pilot-release-assets.sh \
    --run-id 23110429107 \
    --tag agentshield-pilot-v1.0.1 \
    --version 1.0.1
EOF
}

if [[ "${1:-}" == "--" ]]; then
  shift
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      workflow_repo="$2"
      release_repo="$2"
      shift 2
      ;;
    --workflow-repo)
      workflow_repo="$2"
      shift 2
      ;;
    --release-repo)
      release_repo="$2"
      shift 2
      ;;
    --run-id)
      run_id="$2"
      shift 2
      ;;
    --tag)
      tag="$2"
      shift 2
      ;;
    --version)
      version="$2"
      shift 2
      ;;
    --keep-existing)
      keep_existing=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "[curate-pilot-release-assets] unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$run_id" || -z "$tag" || -z "$version" ]]; then
  echo "[curate-pilot-release-assets] --run-id, --tag, and --version are required" >&2
  usage >&2
  exit 1
fi

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

mac_dir="$workdir/macos"
win_dir="$workdir/windows"
stage_dir="$workdir/stage"
mkdir -p "$mac_dir" "$win_dir" "$stage_dir"

gh run download "$run_id" --repo "$workflow_repo" -n agentshield-pilot-macos-latest -D "$mac_dir"
gh run download "$run_id" --repo "$workflow_repo" -n agentshield-pilot-windows-2022 -D "$win_dir"

mac_dmg="$(find "$mac_dir" -type f -name '*.dmg' | head -n 1)"
mac_tar="$(find "$mac_dir" -type f -name '*.app.tar.gz' | head -n 1)"
win_exe="$(find "$win_dir" -type f -name '*.exe' | head -n 1)"

if [[ -z "$mac_dmg" || -z "$mac_tar" || -z "$win_exe" ]]; then
  echo "[curate-pilot-release-assets] failed to locate all expected artifacts" >&2
  echo "  mac dmg: ${mac_dmg:-missing}" >&2
  echo "  mac tar: ${mac_tar:-missing}" >&2
  echo "  win exe: ${win_exe:-missing}" >&2
  exit 1
fi

cp "$mac_dmg" "$stage_dir/AgentShield-pilot-${version}-macos-arm64.dmg"
cp "$mac_tar" "$stage_dir/AgentShield-pilot-${version}-macos-arm64.app.tar.gz"
cp "$win_exe" "$stage_dir/AgentShield-pilot-${version}-windows-x64-setup.exe"

# Keep a stable alias for GitHub latest/download links so storefront buttons
# do not need to change on every release.
cp "$mac_dmg" "$stage_dir/AgentShield-macos-arm64.dmg"
cp "$mac_tar" "$stage_dir/AgentShield-macos-arm64.app.tar.gz"
cp "$win_exe" "$stage_dir/AgentShield-windows-x64-setup.exe"

if [[ "$keep_existing" -eq 0 ]]; then
  while IFS= read -r asset_name; do
    if [[ "$asset_name" == AgentShield.* || "$asset_name" == AgentShield\ 智盾* ]]; then
      gh release delete-asset "$tag" "$asset_name" --repo "$release_repo" --yes
    fi
  done < <(gh release view "$tag" --repo "$release_repo" --json assets --jq '.assets[].name')
fi

gh release upload "$tag" "$stage_dir"/* --repo "$release_repo" --clobber

echo "[curate-pilot-release-assets] uploaded curated assets:"
ls -1 "$stage_dir"
