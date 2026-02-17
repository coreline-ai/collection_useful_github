#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
source "$ROOT_DIR/scripts/macos/launchd-common.sh"

ITERATIONS="${1:-3}"
if ! [[ "$ITERATIONS" =~ ^[0-9]+$ ]] || [[ "$ITERATIONS" -lt 1 ]]; then
  echo "usage: bash scripts/macos/self-test-resume-no-sleep.sh [iterations>=1]" >&2
  exit 1
fi

API_URL="${API_URL:-http://localhost:4000/api/health}"
WEB_URL="${WEB_URL:-http://localhost:5173/}"
LAUNCHD_DOMAIN_VALUE="$(resolve_launchd_domain)"
API_LABEL="${LAUNCHD_DOMAIN_VALUE}/com.usefulgitinfo.api"
WEB_LABEL="${LAUNCHD_DOMAIN_VALUE}/com.usefulgitinfo.web"
WATCHDOG_LABEL="${LAUNCHD_DOMAIN_VALUE}/com.usefulgitinfo.watchdog"

require_loaded_label() {
  local label="$1"
  if ! launchctl print "$label" >/dev/null 2>&1; then
    echo "[self-test] label not loaded: $label" >&2
    exit 1
  fi
}

wait_health() {
  local timeout_seconds="$1"
  local elapsed=0
  while [[ "$elapsed" -lt "$timeout_seconds" ]]; do
    if curl -fsS --max-time 2 "$API_URL" >/dev/null 2>&1 && curl -fsS --max-time 2 "$WEB_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 1
}

kill_listener() {
  local port="$1"
  local pid
  pid="$(lsof -ti "tcp:${port}" -sTCP:LISTEN || true)"
  if [[ -n "$pid" ]]; then
    kill -9 "$pid" >/dev/null 2>&1 || true
  fi
}

require_loaded_label "$API_LABEL"
require_loaded_label "$WEB_LABEL"
require_loaded_label "$WATCHDOG_LABEL"

if ! wait_health 10; then
  echo "[self-test] initial health check failed" >&2
  exit 1
fi

echo "[self-test] start $(date '+%Y-%m-%d %H:%M:%S %z')"
echo "[self-test] iterations=$ITERATIONS"

for i in $(seq 1 "$ITERATIONS"); do
  before_api_pid="$(lsof -ti tcp:4000 -sTCP:LISTEN || true)"
  before_web_pid="$(lsof -ti tcp:5173 -sTCP:LISTEN || true)"
  echo "[self-test][$i] before api_pid=${before_api_pid:-none} web_pid=${before_web_pid:-none}"

  # 1) simulate post-wake broken state: listeners disappeared
  kill_listener 4000
  kill_listener 5173
  sleep 1

  # 2) watchdog immediate run (equivalent recovery path)
  bash "$ROOT_DIR/scripts/macos/watchdog.sh"

  if ! wait_health 30; then
    echo "[self-test][$i] fail: recovery timeout" >&2
    exit 1
  fi

  after_api_pid="$(lsof -ti tcp:4000 -sTCP:LISTEN || true)"
  after_web_pid="$(lsof -ti tcp:5173 -sTCP:LISTEN || true)"
  echo "[self-test][$i] after api_pid=${after_api_pid:-none} web_pid=${after_web_pid:-none}"

  if [[ -z "$after_api_pid" || -z "$after_web_pid" ]]; then
    echo "[self-test][$i] fail: listener not restored" >&2
    exit 1
  fi

  # 3) simulate wake-time launchd reattach/restart
  launchctl kickstart -k "$API_LABEL" >/dev/null 2>&1 || true
  launchctl kickstart -k "$WEB_LABEL" >/dev/null 2>&1 || true

  if ! wait_health 30; then
    echo "[self-test][$i] fail: kickstart recovery timeout" >&2
    exit 1
  fi
done

echo "[self-test] pass"
