#!/usr/bin/env bash
set -euo pipefail

# Options may precede the profile; skip option values when finding it. The CLI
# retains responsibility for reporting invalid options and multiple profiles.
profile=all
skip_value=false
for arg in "$@"; do
  if [ "$skip_value" = true ]; then skip_value=false; continue; fi
  case "$arg" in
    --help|-h) exec node packages/verifier/src/cli.mjs "$@" ;;
    --output|--evidence) skip_value=true ;;
    -*) ;;
    *) profile="$arg"; break ;;
  esac
done
# Full and browser-heavy profiles share a daemon-wide lock. Fast profiles remain
# available while another worktree runs the full verifier.
case "$profile" in
  all|preflight|recovery|scale)
    if [ -f /.dockerenv ]; then
      if ! mountpoint -q /var/lock/kanbun; then
        printf 'Verifier lock volume is unavailable; rebuild this devcontainer.\n' >&2
        exit 1
      fi
      exec bash .devcontainer/verify-lock.sh node packages/verifier/src/cli.mjs "$@"
    fi
    ;;
esac
exec node packages/verifier/src/cli.mjs "$@"
