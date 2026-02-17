#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/macos/launchd-common.sh"
LAUNCHD_DOMAIN_VALUE="$(resolve_launchd_domain)"

LABELS=(
  "com.usefulgitinfo.api"
  "com.usefulgitinfo.web"
  "com.usefulgitinfo.watchdog"
)

echo "[status-launchd] domain: ${LAUNCHD_DOMAIN_VALUE}"
echo "[status-launchd] launchctl labels"
for label in "${LABELS[@]}"; do
  if launchctl print "${LAUNCHD_DOMAIN_VALUE}/${label}" >/dev/null 2>&1; then
    echo "  - ${label}: loaded"
  else
    echo "  - ${label}: not-loaded"
  fi
done

echo
echo "[status-launchd] listeners"
lsof -nP -iTCP:4000 -sTCP:LISTEN || true
lsof -nP -iTCP:5173 -sTCP:LISTEN || true
