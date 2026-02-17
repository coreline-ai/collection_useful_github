#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [[ -f "$ROOT_DIR/server/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/server/.env"
  set +a
fi

if [[ -z "${NODE_ENV:-}" ]]; then
  if [[ -n "${ADMIN_API_TOKEN:-}" ]]; then
    export NODE_ENV="production"
  else
    export NODE_ENV="development"
  fi
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

exec node "$ROOT_DIR/server/src/index.js"
