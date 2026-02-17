#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/macos/launchd-common.sh"
LAUNCHD_DOMAIN_VALUE="$(resolve_launchd_domain)"

LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
LABELS=(
  "com.usefulgitinfo.watchdog"
  "com.usefulgitinfo.web"
  "com.usefulgitinfo.api"
)

if [[ "$OSTYPE" != darwin* ]]; then
  echo "[uninstall-launchd] macOS only." >&2
  exit 1
fi

for label in "${LABELS[@]}"; do
  launchctl bootout "${LAUNCHD_DOMAIN_VALUE}/${label}" >/dev/null 2>&1 || true
  rm -f "$LAUNCH_AGENTS_DIR/${label}.plist"
  echo "[uninstall-launchd] removed ${label}"
done

echo "[uninstall-launchd] completed."
