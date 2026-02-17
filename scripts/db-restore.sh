#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/db-common.sh"

require_command psql
require_command gzip

load_server_env

INPUT_PATH=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --input)
      INPUT_PATH="${2:-}"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      echo "usage: npm run db:restore -- --input backups/backup.sql.gz" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$INPUT_PATH" ]]; then
  echo "input is required: --input <file.sql|file.sql.gz>" >&2
  exit 1
fi

if [[ "$INPUT_PATH" != /* ]]; then
  INPUT_PATH="$ROOT_DIR/$INPUT_PATH"
fi

if [[ ! -f "$INPUT_PATH" ]]; then
  echo "input file not found: $INPUT_PATH" >&2
  exit 1
fi

DB_URL="$(resolve_db_url)"

echo "[db:restore] restoring from: $INPUT_PATH"
if [[ "$INPUT_PATH" == *.gz ]]; then
  gzip -dc "$INPUT_PATH" | psql "$DB_URL" -v ON_ERROR_STOP=1 >/dev/null
else
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$INPUT_PATH" >/dev/null
fi
echo "[db:restore] completed."
