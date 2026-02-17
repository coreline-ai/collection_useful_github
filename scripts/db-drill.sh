#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/db-common.sh"

require_command pg_dump
require_command psql
require_command gunzip
require_command gzip

load_server_env
DB_URL="$(resolve_db_url)"

START_EPOCH="$(date +%s)"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TIMESTAMP_SAFE="$(printf '%s' "$TIMESTAMP" | tr '[:upper:]' '[:lower:]')"
REPORT_DIR="$ROOT_DIR/.runtime/drill"
BACKUP_DIR="$ROOT_DIR/backups"
REPORT_PATH="$REPORT_DIR/drill_${TIMESTAMP}.md"
BACKUP_PATH="$BACKUP_DIR/drill_${TIMESTAMP}.sql.gz"
DRILL_DB_NAME="useful_git_info_drill_${TIMESTAMP_SAFE}_$$"
DRILL_DB_URL=""

mkdir -p "$REPORT_DIR" "$BACKUP_DIR"

build_db_url_with_database() {
  local original_url="$1"
  local database_name="$2"
  local base="$original_url"
  local query=""

  if [[ "$original_url" == *\?* ]]; then
    base="${original_url%%\?*}"
    query="?${original_url#*\?}"
  fi

  local prefix="${base%/*}"
  printf '%s/%s%s' "$prefix" "$database_name" "$query"
}

cleanup() {
  if [[ -n "$DRILL_DB_URL" ]]; then
    psql "$DB_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$DRILL_DB_NAME\";" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

collect_provider_counts() {
  local target_url="$1"
  psql "$target_url" -At -F '|' -v ON_ERROR_STOP=1 -c "
    SELECT provider, COUNT(*)::text
    FROM unified_items
    GROUP BY provider
    ORDER BY provider;
  "
}

collect_note_counts() {
  local target_url="$1"
  psql "$target_url" -At -F '|' -v ON_ERROR_STOP=1 -c "
    SELECT provider, COUNT(*)::text
    FROM unified_notes
    GROUP BY provider
    ORDER BY provider;
  "
}

collect_meta_keys() {
  local target_url="$1"
  psql "$target_url" -At -v ON_ERROR_STOP=1 -c "
    SELECT key
    FROM unified_meta
    ORDER BY key;
  "
}

echo "[db:drill] creating backup..."
pg_dump --no-owner --no-privileges --dbname "$DB_URL" | gzip -c > "$BACKUP_PATH"

SOURCE_PROVIDER_COUNTS="$(collect_provider_counts "$DB_URL")"
SOURCE_NOTE_COUNTS="$(collect_note_counts "$DB_URL")"
SOURCE_META_KEYS="$(collect_meta_keys "$DB_URL")"

echo "[db:drill] creating rehearsal database: $DRILL_DB_NAME"
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$DRILL_DB_NAME\";" >/dev/null
DRILL_DB_URL="$(build_db_url_with_database "$DB_URL" "$DRILL_DB_NAME")"

echo "[db:drill] ensuring required extensions in rehearsal database..."
psql "$DRILL_DB_URL" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS unaccent;" >/dev/null
psql "$DRILL_DB_URL" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;" >/dev/null
psql "$DRILL_DB_URL" -v ON_ERROR_STOP=1 -c "
  CREATE OR REPLACE FUNCTION public.unaccent(input_dictionary text, input_text text)
  RETURNS text
  LANGUAGE SQL
  IMMUTABLE
AS \$\$
  SELECT public.unaccent(input_dictionary::regdictionary, input_text);
\$\$;
" >/dev/null

echo "[db:drill] restoring backup into rehearsal database..."
gunzip -c "$BACKUP_PATH" | psql "$DRILL_DB_URL" -v ON_ERROR_STOP=1 >/dev/null

RESTORED_PROVIDER_COUNTS="$(collect_provider_counts "$DRILL_DB_URL")"
RESTORED_NOTE_COUNTS="$(collect_note_counts "$DRILL_DB_URL")"
RESTORED_META_KEYS="$(collect_meta_keys "$DRILL_DB_URL")"

if [[ "$SOURCE_PROVIDER_COUNTS" != "$RESTORED_PROVIDER_COUNTS" ]]; then
  echo "[db:drill] provider count mismatch after restore." >&2
  exit 1
fi

if [[ "$SOURCE_NOTE_COUNTS" != "$RESTORED_NOTE_COUNTS" ]]; then
  echo "[db:drill] note count mismatch after restore." >&2
  exit 1
fi

if [[ "$SOURCE_META_KEYS" != "$RESTORED_META_KEYS" ]]; then
  echo "[db:drill] meta key mismatch after restore." >&2
  exit 1
fi

END_EPOCH="$(date +%s)"
RTO_SECONDS="$((END_EPOCH - START_EPOCH))"

cat > "$REPORT_PATH" <<EOF
# DB Drill Report (${TIMESTAMP})

- executed_at_utc: ${TIMESTAMP}
- source_db_url: ${DB_URL}
- rehearsal_db: ${DRILL_DB_NAME}
- backup_file: ${BACKUP_PATH}
- rto_seconds: ${RTO_SECONDS}
- rpo_note: backup created immediately before restore (near-zero)
- result: PASS

## unified_items (provider count)
\`\`\`
${RESTORED_PROVIDER_COUNTS}
\`\`\`

## unified_notes (provider count)
\`\`\`
${RESTORED_NOTE_COUNTS}
\`\`\`

## unified_meta keys
\`\`\`
${RESTORED_META_KEYS}
\`\`\`
EOF

echo "[db:drill] completed successfully."
echo "[db:drill] report: $REPORT_PATH"
