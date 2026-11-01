#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
profile="${1:-full}"
case "$profile" in
  full|deps) ;;
  *) printf 'Unknown setup profile: %s\n' "$profile" >&2; exit 2 ;;
esac
# Docker bind mounts can appear root-owned even when the remote user owns the
# host checkout. Trust only this workspace, not every mounted repository.
git config --global --add safe.directory "$(pwd -P)"
CI=true pnpm install --frozen-lockfile
if [ "$profile" = full ]; then
  pnpm --filter @kanbun/verifier exec playwright install --only-shell chromium
fi
pnpm verify doctor
