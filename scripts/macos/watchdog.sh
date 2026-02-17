#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
source "$ROOT_DIR/scripts/macos/launchd-common.sh"

API_URL="${API_URL:-http://localhost:4000/api/health}"
WEB_URL="${WEB_URL:-http://localhost:5173/}"
LAUNCHD_DOMAIN_VALUE="$(resolve_launchd_domain)"

API_LABEL="${LAUNCHD_DOMAIN_VALUE}/com.usefulgitinfo.api"
WEB_LABEL="${LAUNCHD_DOMAIN_VALUE}/com.usefulgitinfo.web"

mkdir -p "$ROOT_DIR/.runtime/launchd"

log() {
  printf '[watchdog] %s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1"
}

if ! curl -fsS --max-time 5 "$API_URL" >/dev/null 2>&1; then
  log "api health failed -> kickstart ${API_LABEL}"
  launchctl kickstart -k "$API_LABEL" >/dev/null 2>&1 || true
fi

if ! curl -fsS --max-time 5 "$WEB_URL" >/dev/null 2>&1; then
  log "web health failed -> kickstart ${WEB_LABEL}"
  launchctl kickstart -k "$WEB_LABEL" >/dev/null 2>&1 || true
fi
