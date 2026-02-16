#!/usr/bin/env bash
set -euo pipefail

CLIENT_PORT="${CLIENT_PORT:-5173}"
SERVER_URL="${SERVER_URL:-http://localhost:4000/api/health}"

echo "[status] checking client port :${CLIENT_PORT}"
if lsof -nP -iTCP:"${CLIENT_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[status] client: up"
else
  echo "[status] client: down"
fi

echo "[status] checking server health ${SERVER_URL}"
if curl -fsS "${SERVER_URL}" >/dev/null 2>&1; then
  echo "[status] server: up"
else
  echo "[status] server: down"
fi
