#!/usr/bin/env bash
set -euo pipefail

resolve_launchd_domain() {
  if [[ -n "${LAUNCHD_DOMAIN:-}" ]]; then
    printf '%s' "$LAUNCHD_DOMAIN"
    return
  fi

  local uid_value
  uid_value="$(id -u)"

  if launchctl print "gui/${uid_value}" >/dev/null 2>&1; then
    printf 'gui/%s' "$uid_value"
    return
  fi

  if launchctl print "user/${uid_value}" >/dev/null 2>&1; then
    printf 'user/%s' "$uid_value"
    return
  fi

  # Fallback for environments where "print" is restricted.
  printf 'user/%s' "$uid_value"
}
