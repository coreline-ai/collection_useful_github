#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/db-common.sh"

require_command pg_dump
require_command gzip

load_server_env

OUTPUT_PATH=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      OUTPUT_PATH="${2:-}"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      echo "usage: npm run db:backup -- --output backups/backup.sql.gz" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$OUTPUT_PATH" ]]; then
  mkdir -p "$ROOT_DIR/backups"
  OUTPUT_PATH="$ROOT_DIR/backups/useful_git_info_$(date +%Y%m%d_%H%M%S).sql.gz"
elif [[ "$OUTPUT_PATH" != /* ]]; then
  OUTPUT_PATH="$ROOT_DIR/$OUTPUT_PATH"
  mkdir -p "$(dirname "$OUTPUT_PATH")"
fi

DB_URL="$(resolve_db_url)"
TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT

echo "[db:backup] starting backup..."
if ! pg_dump --no-owner --no-privileges --dbname "$DB_URL" | gzip -c > "$TMP_FILE"; then
  echo "[db:backup] failed." >&2
  exit 1
fi

mv "$TMP_FILE" "$OUTPUT_PATH"
echo "[db:backup] completed: $OUTPUT_PATH"
if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$OUTPUT_PATH"
fi
