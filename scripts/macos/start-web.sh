#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
WEB_SERVER_MODE="${WEB_SERVER_MODE:-dev}"

if [[ "$WEB_SERVER_MODE" == "preview" ]]; then
  if [[ ! -f "$ROOT_DIR/dist/index.html" ]]; then
    npm run build
  fi

  exec npm run preview -- --host 0.0.0.0 --port 5173
fi

exec npm run dev -- --host 0.0.0.0 --port 5173 --strictPort
