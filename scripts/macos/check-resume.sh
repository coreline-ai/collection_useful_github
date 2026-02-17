#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MINUTES="${1:-30}"

if ! [[ "$MINUTES" =~ ^[0-9]+$ ]]; then
  echo "usage: bash scripts/macos/check-resume.sh [minutes]" >&2
  exit 1
fi

echo "[resume-check] now: $(date '+%Y-%m-%d %H:%M:%S %z')"
echo "[resume-check] window: last ${MINUTES} minutes"
echo

echo "== launchd status =="
bash "$ROOT_DIR/scripts/macos/status-launchd.sh"
echo

echo "== health =="
if curl -fsS --max-time 5 http://localhost:4000/api/health >/dev/null 2>&1; then
  echo "api: ok"
else
  echo "api: fail"
fi
if curl -fsS --max-time 5 http://localhost:5173 >/dev/null 2>&1; then
  echo "web: ok"
else
  echo "web: fail"
fi
echo

echo "== recent sleep/wake events (pmset) =="
pmset -g log | rg -i "Entering Sleep|Wake from|DarkWake|Wake reason|Sleep cause|Wake Requests" | tail -n 30 || true
echo

echo "== watchdog log tail =="
tail -n 40 "$ROOT_DIR/.runtime/launchd/watchdog.out.log" 2>/dev/null || true
echo

echo "== api log tail =="
tail -n 20 "$ROOT_DIR/.runtime/launchd/api.out.log" 2>/dev/null || true
echo

echo "== web log tail =="
tail -n 20 "$ROOT_DIR/.runtime/launchd/web.out.log" 2>/dev/null || true
