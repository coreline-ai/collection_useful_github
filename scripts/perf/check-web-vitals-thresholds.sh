#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/db-common.sh"

require_command curl
require_command node

load_server_env

API_BASE_URL="${PERF_API_BASE_URL:-${VITE_POSTGRES_SYNC_API_BASE_URL:-http://localhost:4000}}"
WINDOW_MINUTES="${WEB_VITALS_SUMMARY_DEFAULT_MINUTES:-60}"
INP_P75_THRESHOLD_MS="${WEB_VITALS_INP_P75_THRESHOLD_MS:-200}"
LCP_P75_THRESHOLD_MS="${WEB_VITALS_LCP_P75_THRESHOLD_MS:-2500}"
CLS_P75_THRESHOLD="${WEB_VITALS_CLS_P75_THRESHOLD:-0.1}"
ALLOW_EMPTY="${WEB_VITALS_ALLOW_EMPTY:-false}"

SUMMARY_URL="${API_BASE_URL%/}/api/admin/rum/web-vitals/summary?minutes=${WINDOW_MINUTES}"
CURL_ARGS=(--silent --show-error --fail)
if [[ -n "${ADMIN_API_TOKEN:-}" ]]; then
  CURL_ARGS+=(-H "x-admin-token: ${ADMIN_API_TOKEN}")
fi
CURL_ARGS+=("$SUMMARY_URL")

echo "[perf] checking web-vitals thresholds from: ${SUMMARY_URL}"

RESPONSE="$(curl "${CURL_ARGS[@]}")"

SUMMARY_FILE="$(mktemp)"
trap 'rm -f "$SUMMARY_FILE"' EXIT
printf '%s' "$RESPONSE" > "$SUMMARY_FILE"

if ! node - "$SUMMARY_FILE" "$INP_P75_THRESHOLD_MS" "$LCP_P75_THRESHOLD_MS" "$CLS_P75_THRESHOLD" "$ALLOW_EMPTY" <<'EOF'
const fs = require('node:fs')

const [, , summaryPath, inpThresholdRaw, lcpThresholdRaw, clsThresholdRaw, allowEmptyRaw] = process.argv
const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'))
const allowEmpty = String(allowEmptyRaw).toLowerCase() === 'true'

if (!summary || summary.ok !== true) {
  console.error('[perf] invalid summary response.')
  process.exit(1)
}

const metrics = summary.metrics || {}
const inp = metrics.INP?.p75
const lcp = metrics.LCP?.p75
const cls = metrics.CLS?.p75
const totalSamples = Number(summary.totalSamples || 0)

if ((!inp && inp !== 0) || (!lcp && lcp !== 0) || (!cls && cls !== 0)) {
  if (allowEmpty && totalSamples === 0) {
    console.log('[perf] no samples available yet. skip due to WEB_VITALS_ALLOW_EMPTY=true.')
    process.exit(0)
  }
  console.error('[perf] insufficient samples. collect RUM traffic and retry.')
  process.exit(1)
}

const inpThreshold = Number(inpThresholdRaw)
const lcpThreshold = Number(lcpThresholdRaw)
const clsThreshold = Number(clsThresholdRaw)

const violations = []
if (inp > inpThreshold) violations.push(`INP p75=${inp}ms > ${inpThreshold}ms`)
if (lcp > lcpThreshold) violations.push(`LCP p75=${lcp}ms > ${lcpThreshold}ms`)
if (cls > clsThreshold) violations.push(`CLS p75=${cls} > ${clsThreshold}`)

console.log(`[perf] INP p75: ${inp}ms (threshold ${inpThreshold}ms)`)
console.log(`[perf] LCP p75: ${lcp}ms (threshold ${lcpThreshold}ms)`)
console.log(`[perf] CLS p75: ${cls} (threshold ${clsThreshold})`)

if (violations.length > 0) {
  console.error('[perf] threshold exceeded:')
  for (const violation of violations) {
    console.error(`- ${violation}`)
  }
  process.exit(1)
}

console.log('[perf] web-vitals thresholds check passed.')
EOF
then
  exit 1
fi
