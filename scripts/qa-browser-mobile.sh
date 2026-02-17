#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECKLIST="$ROOT_DIR/docs/QA_BROWSER_MOBILE_CHECKLIST.md"

if [[ ! -f "$CHECKLIST" ]]; then
  echo "checklist not found: $CHECKLIST" >&2
  exit 1
fi

echo "[qa] browser/mobile manual checklist"
echo "open: $CHECKLIST"
echo
cat "$CHECKLIST"
