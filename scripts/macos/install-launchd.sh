#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/macos/launchd-common.sh"
TEMPLATE_DIR="$ROOT_DIR/deploy/macos"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
RUNTIME_DIR="$ROOT_DIR/.runtime/launchd"
LAUNCHD_DOMAIN_VALUE="$(resolve_launchd_domain)"

LABELS=(
  "com.usefulgitinfo.api"
  "com.usefulgitinfo.web"
  "com.usefulgitinfo.watchdog"
)

bootstrap_label() {
  local label="$1"
  local target="$2"
  local attempts=0

  while [[ "$attempts" -lt 3 ]]; do
    attempts=$((attempts + 1))
    if launchctl bootstrap "$LAUNCHD_DOMAIN_VALUE" "$target" >/dev/null 2>&1; then
      return 0
    fi
    launchctl bootout "${LAUNCHD_DOMAIN_VALUE}/${label}" >/dev/null 2>&1 || true
    sleep 1
  done

  return 1
}

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

if [[ "$OSTYPE" != darwin* ]]; then
  echo "[install-launchd] macOS only." >&2
  exit 1
fi

mkdir -p "$LAUNCH_AGENTS_DIR" "$RUNTIME_DIR"

for script in "$ROOT_DIR/scripts/macos/start-api.sh" "$ROOT_DIR/scripts/macos/start-web.sh" "$ROOT_DIR/scripts/macos/watchdog.sh"; do
  chmod +x "$script"
done

if [[ "$DRY_RUN" -eq 0 ]]; then
  for port in 4000 5173; do
    if lsof -ti "tcp:${port}" -sTCP:LISTEN >/dev/null 2>&1; then
      kill $(lsof -ti "tcp:${port}" -sTCP:LISTEN) >/dev/null 2>&1 || true
    fi
  done
  sleep 1

  (
    cd "$ROOT_DIR"
    npm run build >/dev/null
    npm --prefix server run migrate >/dev/null
  )
fi

for label in "${LABELS[@]}"; do
  template="$TEMPLATE_DIR/${label}.plist"
  target="$LAUNCH_AGENTS_DIR/${label}.plist"

  sed "s|__ROOT__|$ROOT_DIR|g" "$template" > "$target"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] prepared $target"
    continue
  fi

  launchctl bootout "${LAUNCHD_DOMAIN_VALUE}/${label}" >/dev/null 2>&1 || true
  if ! bootstrap_label "$label" "$target"; then
    echo "[install-launchd] failed to bootstrap ${label}" >&2
    exit 1
  fi
  launchctl enable "${LAUNCHD_DOMAIN_VALUE}/${label}" >/dev/null 2>&1 || true
  launchctl kickstart -k "${LAUNCHD_DOMAIN_VALUE}/${label}" >/dev/null 2>&1 || true
  echo "[install-launchd] loaded ${label}"
done

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[install-launchd] dry-run completed."
  exit 0
fi

echo "[install-launchd] completed."
echo "  API: http://localhost:4000"
echo "  WEB: http://localhost:5173"
