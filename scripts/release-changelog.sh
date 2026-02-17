#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LAST_TAG="$(git describe --tags --abbrev=0 2>/dev/null || true)"
if [[ -n "$LAST_TAG" ]]; then
  RANGE="$LAST_TAG..HEAD"
else
  RANGE="HEAD"
fi

echo "## Release candidate ($(date '+%Y-%m-%d %H:%M:%S'))"
if [[ -n "$LAST_TAG" ]]; then
  echo "- Base tag: \`$LAST_TAG\`"
else
  echo "- Base tag: (none)"
fi
echo
echo "### Commits"
git log --pretty=format:'- %h %s (%an)' "$RANGE"
