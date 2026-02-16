#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_PORT="${POSTGRES_E2E_PORT:-4100}"
API_BASE_URL="${VITE_POSTGRES_SYNC_API_BASE_URL:-http://localhost:${API_PORT}}"
HEALTH_URL="${API_BASE_URL%/}/api/health"
E2E_DB_NAME="${POSTGRES_E2E_DB:-useful_git_info_e2e}"
PGHOST_VALUE="${PGHOST:-localhost}"
PGPORT_VALUE="${PGPORT:-55432}"
PGUSER_VALUE="${PGUSER:-postgres}"
PGPASSWORD_VALUE="${PGPASSWORD:-postgres}"
PGSSL_VALUE="${PGSSL:-false}"
STARTED_SERVER="false"
SERVER_PID=""

if [[ "${E2E_DB_NAME}" == "useful_git_info" ]] && [[ "${ALLOW_E2E_ON_MAIN_DB:-false}" != "true" ]]; then
  echo "[e2e] refused: POSTGRES_E2E_DB points to main DB (${E2E_DB_NAME})." >&2
  echo "[e2e] set POSTGRES_E2E_DB to a dedicated test DB or override with ALLOW_E2E_ON_MAIN_DB=true." >&2
  exit 1
fi

if [[ "${API_PORT}" == "4000" ]] && [[ "${ALLOW_E2E_ON_PORT_4000:-false}" != "true" ]]; then
  echo "[e2e] refused: POSTGRES_E2E_PORT=4000 can conflict with the main API server." >&2
  echo "[e2e] use a dedicated port (default 4100) or override with ALLOW_E2E_ON_PORT_4000=true." >&2
  exit 1
fi

cleanup() {
  if [[ "${STARTED_SERVER}" == "true" ]] && [[ -n "${SERVER_PID}" ]]; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

EXISTING_PIDS="$(lsof -ti "tcp:${API_PORT}" -sTCP:LISTEN || true)"
if [[ -n "${EXISTING_PIDS}" ]]; then
  echo "[e2e] stopping existing server(s) on port ${API_PORT}"
  kill ${EXISTING_PIDS} >/dev/null 2>&1 || true
  sleep 1
fi

(
  cd "${ROOT_DIR}/server"
  PGHOST="${PGHOST_VALUE}" \
  PGPORT="${PGPORT_VALUE}" \
  PGUSER="${PGUSER_VALUE}" \
  PGPASSWORD="${PGPASSWORD_VALUE}" \
  POSTGRES_E2E_DB="${E2E_DB_NAME}" \
  node --input-type=module <<'EOF'
import pg from 'pg'

const host = process.env.PGHOST || 'localhost'
const port = Number(process.env.PGPORT || 55432)
const user = process.env.PGUSER || 'postgres'
const password = process.env.PGPASSWORD || 'postgres'
const targetDb = process.env.POSTGRES_E2E_DB || 'useful_git_info_e2e'
const adminDb = process.env.POSTGRES_E2E_ADMIN_DB || 'postgres'

const quoteIdent = (value) => `"${String(value).replace(/"/g, '""')}"`

const client = new pg.Client({
  host,
  port,
  user,
  password,
  database: adminDb,
})

try {
  await client.connect()
  await client.query(`CREATE DATABASE ${quoteIdent(targetDb)}`)
} catch (error) {
  if (error?.code !== '42P04') {
    throw error
  }
} finally {
  await client.end().catch(() => {})
}
EOF
)

(
  cd "${ROOT_DIR}"
  DATABASE_URL="" \
  PGHOST="${PGHOST_VALUE}" \
  PGPORT="${PGPORT_VALUE}" \
  PGUSER="${PGUSER_VALUE}" \
  PGPASSWORD="${PGPASSWORD_VALUE}" \
  PGDATABASE="${E2E_DB_NAME}" \
  PGSSL="${PGSSL_VALUE}" \
  npm --prefix server run migrate >/dev/null
)

echo "[e2e] starting API server on port ${API_PORT}"
(
  cd "${ROOT_DIR}"
  PORT="${API_PORT}" \
  DATABASE_URL="" \
  PGHOST="${PGHOST_VALUE}" \
  PGPORT="${PGPORT_VALUE}" \
  PGUSER="${PGUSER_VALUE}" \
  PGPASSWORD="${PGPASSWORD_VALUE}" \
  PGDATABASE="${E2E_DB_NAME}" \
  PGSSL="${PGSSL_VALUE}" \
  npm --prefix server run start >/dev/null 2>&1
) &
SERVER_PID=$!
STARTED_SERVER="true"

for _ in {1..30}; do
  if curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then
  echo "[e2e] API server health check failed: ${HEALTH_URL}" >&2
  exit 1
fi

cd "${ROOT_DIR}"
RUN_POSTGRES_E2E=true \
VITE_POSTGRES_SYNC_API_BASE_URL="${API_BASE_URL}" \
npx vitest run --maxWorkers=1 src/app/postgresDashboardRoundtrip.e2e.test.tsx src/app/postgresSync.e2e.test.tsx src/app/postgresYoutubeSync.e2e.test.tsx src/app/postgresBookmarkSync.e2e.test.tsx src/app/postgresBookmarkMetadataApi.e2e.test.ts src/app/postgresSearchRanking.e2e.test.tsx
