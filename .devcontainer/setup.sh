#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
CI=true pnpm install --frozen-lockfile
pnpm --filter @kanbun/verifier exec playwright install --only-shell chromium
pnpm verify doctor
