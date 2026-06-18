#!/usr/bin/env bash
#
# Recreate every generated dependency and build artifact in this Bun/Turbo
# monorepo. It removes local artifacts only; source files, environment files,
# Docker volumes, and bun.lock are never changed.
#
# Removed recursively from the repository:
#   node_modules, dist, .next, .turbo, coverage, generated, *.tsbuildinfo
#
# Usage:
#   ./scripts/clean-rebuild.sh [--yes|-y] [--no-build]
#
# Options:
#   --yes, -y   Skip the destructive-operation confirmation.
#   --no-build  Reinstall dependencies only; do not run Turbo builds.
#   --help, -h  Show this help.

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

DO_BUILD=1
ASSUME_YES=0
INSTALL_CACHE=""

cleanup() {
  [[ -n "$INSTALL_CACHE" ]] && rm -rf -- "$INSTALL_CACHE"
}
trap cleanup EXIT

usage() {
  sed -n '2,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

fail() {
  echo "Error: $*" >&2
  exit 1
}

is_windows_bun() {
  local bun_path="$1"

  [[ "$bun_path" == *.exe ]] && return 0
  command -v file >/dev/null 2>&1 \
    && file -Lb "$bun_path" 2>/dev/null | grep -qiE 'PE32|MS-DOS executable'
}

require_native_bun() {
  local bun_path
  bun_path="$(command -v bun || true)"
  [[ -n "$bun_path" ]] || fail "Bun is not installed or not on PATH."

  # A Windows Bun executable called from WSL emits NtSetInformationFile errors
  # when it tries to cache packages or create workspace links on /home/... .
  # Refuse before deleting node_modules so a failed rebuild is non-destructive.
  if [[ "$(uname -s)" == "Linux" ]] && is_windows_bun "$bun_path"; then
    cat >&2 <<EOF
Error: Windows Bun was detected in a Linux/WSL checkout.

This repository is under $ROOT. A Windows Bun executable cannot reliably write
its cache or workspace symlinks on that filesystem, which causes errors such as:
  EINVAL: Invalid argument (NtSetInformationFile())
  failed to symlink dependencies for package

Install and use the native Linux Bun binary inside WSL, then retry:
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="\$HOME/.bun"
  export PATH="\$BUN_INSTALL/bin:\$PATH"
  hash -r
  bun --version

Verify with:
  file "\$(command -v bun)"

It must report an ELF executable, not PE32/Windows. Do not run this cleanup
script with a Windows Bun binary against a /home/... WSL checkout.
EOF
    exit 1
  fi

  bun --version >/dev/null 2>&1 || fail "Bun exists but cannot execute."
}

for arg in "$@"; do
  case "$arg" in
    --no-build) DO_BUILD=0 ;;
    --yes|-y) ASSUME_YES=1 ;;
    --help|-h) usage; exit 0 ;;
    *) fail "unknown option: $arg (use --help for usage)" ;;
  esac
done

cd "$ROOT"
[[ -f package.json ]] || fail "package.json not found at repository root: $ROOT"
[[ -f bun.lock ]] || fail "bun.lock not found; refusing a clean rebuild without a committed lockfile."
require_native_bun

if [[ "$ASSUME_YES" -ne 1 ]]; then
  echo "Repository: $ROOT"
  echo "This removes generated dependencies and build artifacts from every app, package, and service."
  read -r -p "Continue? [y/N] " reply
  case "$reply" in
    y|Y|yes|YES|Yes) ;;
    *) echo "Aborted."; exit 0 ;;
  esac
fi

remove_directories() {
  local name="$1"
  local count
  count="$(find . -path './.git' -prune -o -type d -name "$name" -print | wc -l | tr -d ' ')"

  if [[ "$count" -gt 0 ]]; then
    echo "==> Removing $count $name director$( [[ "$count" -eq 1 ]] && echo 'y' || echo 'ies' )..."
    find . -path './.git' -prune -o -type d -name "$name" -prune -exec rm -rf -- {} +
  fi
}

echo "==> Cleaning generated artifacts..."
for directory in node_modules dist .next .turbo coverage generated; do
  remove_directories "$directory"
done

echo "==> Removing TypeScript incremental-build metadata..."
find . -path './.git' -prune -o -type f -name '*.tsbuildinfo' -exec rm -f -- {} +

echo "==> Installing locked dependencies with an isolated Bun cache..."
# A temporary cache plus copyfile backend avoids stale/global-cache links and
# cross-filesystem hardlink issues after node_modules has been fully removed.
INSTALL_CACHE="$(mktemp -d "${TMPDIR:-/tmp}/perps-bun-cache.XXXXXX")"
bun install \
  --frozen-lockfile \
  --force \
  --backend=copyfile \
  --cache-dir "$INSTALL_CACHE"

[[ -x node_modules/.bin/turbo ]] || fail "Bun install completed without node_modules/.bin/turbo."

if [[ "$DO_BUILD" -eq 1 ]]; then
  echo "==> Building every workspace with a build task..."
  bun run build
  echo "==> Clean rebuild complete."
else
  echo "==> Dependencies rebuilt; build skipped (--no-build)."
fi
