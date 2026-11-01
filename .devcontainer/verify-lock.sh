#!/usr/bin/env bash
set -euo pipefail

# The named Docker volume is shared by all Kanbun containers on this daemon,
# including full clones. flock releases the kernel lock when its last holder
# exits, even after a crash; no PID files or stale-lock deletion are needed.
lock_path="${KANBUN_VERIFY_LOCK_PATH:-/var/lock/kanbun/verifier.lock}"
timeout="${KANBUN_VERIFY_LOCK_TIMEOUT:-900}"
if [[ ! "$timeout" =~ ^[0-9]+$ ]]; then
  printf 'KANBUN_VERIFY_LOCK_TIMEOUT must be a non-negative integer in seconds.\n' >&2
  exit 2
fi
if [ "$#" -eq 0 ]; then
  printf 'Supply a verifier command.\n' >&2
  exit 2
fi
exec 9>"$lock_path"
if ! flock -n 9; then
  printf 'Another Kanbun verifier is running; waiting up to %s seconds.\n' "$timeout" >&2
  flock -w "$timeout" 9 &
  waiter=$!
  trap 'kill "$waiter" 2>/dev/null || true; wait "$waiter" 2>/dev/null || true; exit 130' INT TERM
  if ! wait "$waiter"; then
    trap - INT TERM
    printf 'Timed out waiting for the Kanbun verifier lock. No checks were skipped.\n' >&2
    exit 75
  fi
  trap - INT TERM
fi
exec "$@"
