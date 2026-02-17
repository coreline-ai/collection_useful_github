#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "[scan:secrets:history] required command not found: $command_name" >&2
    exit 1
  fi
}

require_command git
require_command grep
require_command sort

ALLOWLIST_FILE="$ROOT_DIR/scripts/secret-scan-allowlist.txt"
FOUND=0

PATTERNS=(
  "ghp_[A-Za-z0-9]{20,}"
  "github_pat_[A-Za-z0-9_]{40,}"
  "AIza[0-9A-Za-z_-]{35}"
  "sk-[A-Za-z0-9]{20,}"
  "xox[baprs]-[A-Za-z0-9-]{10,}"
  "AKIA[0-9A-Z]{16}"
  "-----BEGIN (RSA|EC|OPENSSH|DSA) PRIVATE KEY-----"
  "[Gg][Ll][Mm]_[Aa][Pp][Ii]_[Kk][Ee][Yy][[:space:]]*=[[:space:]]*['\\\"]?[A-Za-z0-9._-]{20,}"
  "[Vv][Ii][Tt][Ee]_[Oo][Pp][Ee][Nn][Aa][Ii]_[Aa][Pp][Ii]_[Kk][Ee][Yy][[:space:]]*=[[:space:]]*['\\\"]?sk-[A-Za-z0-9]{20,}"
)

COMMITS_FILE="$(mktemp)"
trap 'rm -f "$COMMITS_FILE"' EXIT
git rev-list --all > "$COMMITS_FILE"

if [[ ! -s "$COMMITS_FILE" ]]; then
  echo "[scan:secrets:history] no commit history found."
  exit 0
fi

for PATTERN in "${PATTERNS[@]}"; do
  MATCHES="$(
    while IFS= read -r REVISION; do
      git grep -nI -E -e "$PATTERN" "$REVISION" -- . || true
    done < "$COMMITS_FILE" | sort -u
  )"

  if [[ -f "$ALLOWLIST_FILE" && -n "$MATCHES" ]]; then
    MATCHES="$(printf '%s\n' "$MATCHES" | grep -vFf "$ALLOWLIST_FILE" || true)"
  fi

  if [[ -n "$MATCHES" ]]; then
    if [[ "$FOUND" -eq 0 ]]; then
      echo "[scan:secrets:history] potential historical secrets detected:"
    fi
    FOUND=1
    printf '%s\n' "$MATCHES"
  fi
done

if [[ "$FOUND" -eq 1 ]]; then
  cat <<'EOF'
[scan:secrets:history] failed.
- Rotate affected keys immediately.
- Follow docs/SECURITY_KEY_ROTATION_RUNBOOK.md.
- Remove leaked values from current files and consider history rewrite only when required.
EOF
  exit 1
fi

echo "[scan:secrets:history] no historical secrets detected."
