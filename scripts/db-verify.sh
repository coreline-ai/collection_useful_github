#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/db-common.sh"

require_command psql
load_server_env
DB_URL="$(resolve_db_url)"

echo "[db:verify] unified_items by provider"
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "
SELECT provider, COUNT(*) AS count
FROM unified_items
GROUP BY provider
ORDER BY provider;
"

echo "[db:verify] unified_meta keys"
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "
SELECT key
FROM unified_meta
ORDER BY key;
"

echo "[db:verify] unified_notes count"
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "
SELECT provider, COUNT(*) AS count
FROM unified_notes
GROUP BY provider
ORDER BY provider;
"
