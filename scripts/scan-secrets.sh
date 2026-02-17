#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v rg >/dev/null 2>&1; then
  echo "[scan:secrets] ripgrep(rg) is required." >&2
  exit 1
fi

TRACKED_FILES_TMP="$(mktemp)"
trap 'rm -f "$TRACKED_FILES_TMP"' EXIT
git ls-files -z > "$TRACKED_FILES_TMP"
if [[ ! -s "$TRACKED_FILES_TMP" ]]; then
  echo "[scan:secrets] no tracked files found."
  exit 0
fi

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
  "(?i)GLM_API_KEY\\s*=\\s*['\\\"]?[A-Za-z0-9._-]{20,}"
  "(?i)VITE_OPENAI_API_KEY\\s*=\\s*['\\\"]?sk-[A-Za-z0-9]{20,}"
)

for PATTERN in "${PATTERNS[@]}"; do
  MATCHES="$(xargs -0 rg --line-number --pcre2 --color=never --no-heading -e "$PATTERN" < "$TRACKED_FILES_TMP" || true)"

  if [[ -f "$ALLOWLIST_FILE" && -n "$MATCHES" ]]; then
    MATCHES="$(printf '%s\n' "$MATCHES" | grep -vFf "$ALLOWLIST_FILE" || true)"
  fi

  if [[ -n "$MATCHES" ]]; then
    if [[ "$FOUND" -eq 0 ]]; then
      echo "[scan:secrets] potential secrets detected:"
    fi
    FOUND=1
    echo "$MATCHES"
  fi
done

if [[ "$FOUND" -eq 1 ]]; then
  cat <<'EOF'
[scan:secrets] failed.
- Remove real credentials from tracked files.
- If a false-positive is unavoidable, add exact "path:line:content" string to scripts/secret-scan-allowlist.txt.
EOF
  exit 1
fi

echo "[scan:secrets] no secrets detected."
