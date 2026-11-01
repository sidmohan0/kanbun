#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
# Docker bind mounts can appear root-owned even when the remote user owns the
# host checkout. Trust only this workspace, not every mounted repository.
git config --global --add safe.directory "$(pwd -P)"
CI=true pnpm install --frozen-lockfile
pnpm --filter @kanbun/verifier exec playwright install --only-shell chromium
pnpm verify doctor
