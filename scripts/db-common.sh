#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

load_server_env() {
  local env_file="$ROOT_DIR/server/.env"
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
}

resolve_db_url() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    printf '%s' "$DATABASE_URL"
    return
  fi

  local host="${PGHOST:-localhost}"
  local port="${PGPORT:-55432}"
  local user="${PGUSER:-postgres}"
  local password="${PGPASSWORD:-postgres}"
  local database="${PGDATABASE:-useful_git_info}"
  printf 'postgresql://%s:%s@%s:%s/%s' "$user" "$password" "$host" "$port" "$database"
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "required command not found: $command_name" >&2
    exit 1
  fi
}
