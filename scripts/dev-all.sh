#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_HEALTH_URL="${SERVER_HEALTH_URL:-http://localhost:4000/api/health}"
CLIENT_PORT="${CLIENT_PORT:-5173}"
SERVER_PID=""

cleanup() {
  if [[ -n "${SERVER_PID}" ]]; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

echo "[dev] starting API server (watch mode)..."
(
  cd "${ROOT_DIR}"
  npm --prefix server run dev
) &
SERVER_PID=$!

echo "[dev] waiting for API health: ${SERVER_HEALTH_URL}"
for _ in {1..40}; do
  if curl -fsS "${SERVER_HEALTH_URL}" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

if ! curl -fsS "${SERVER_HEALTH_URL}" >/dev/null 2>&1; then
  echo "[dev] API health check failed. run 'npm --prefix server run dev' manually and inspect logs." >&2
  exit 1
fi

echo "[dev] starting web client on :${CLIENT_PORT}"
cd "${ROOT_DIR}"
npm run dev -- --host 0.0.0.0 --port "${CLIENT_PORT}"
