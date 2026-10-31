#!/usr/bin/env bash
set -euo pipefail

# Host operations are Git, Docker lifecycle, and pinned devcontainer CLI bootstrapping.
# All package installation and application probes execute inside the devcontainer.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
if [ -n "$(git -C "$repo_root" status --porcelain)" ]; then
  printf 'Commit the candidate first; the rehearsal clones the exact clean HEAD.\n' >&2
  exit 1
fi
# Keep clones under the already shared workspace. Colima does not necessarily share macOS TMPDIR.
mkdir -p "$repo_root/artifacts/launch/checkouts"
rehearsal_root="$(mktemp -d "$repo_root/artifacts/launch/checkouts/kanbun-install.XXXXXX")"
checkout="$rehearsal_root/repo"
evidence="$repo_root/artifacts/launch/local"
# Keep prior runs available for inspection, but never mix their receipts with this candidate.
if [ -d "$evidence" ]; then
  previous="$(mktemp -d "$repo_root/artifacts/launch/local-previous.XXXXXX")"
  mv "$evidence" "$previous/evidence"
fi
mkdir -p "$evidence"
rehearsal_id="$(basename "$rehearsal_root")"
dev_pid=""
cleanup() {
  if [ -n "$dev_pid" ]; then kill "$dev_pid" 2>/dev/null || true; fi
  if [ -f "$checkout/scripts/devcontainer.sh" ]; then
    "$checkout/scripts/devcontainer.sh" stop >> "$evidence/lifecycle.log" 2>&1 || true
  fi
  printf 'Disposable rehearsal checkout retained at %s\n' "$checkout"
}
trap cleanup EXIT
git clone --no-hardlinks "$repo_root" "$checkout" >> "$evidence/lifecycle.log" 2>&1
git -C "$checkout" rev-parse HEAD > "$evidence/source-commit.txt"
start_app() {
  "$checkout/scripts/devcontainer.sh" dev >> "$evidence/lifecycle.log" 2>&1 &
  dev_pid=$!
}
stop_app() {
  if [ -n "$dev_pid" ]; then kill "$dev_pid" 2>/dev/null || true; wait "$dev_pid" 2>/dev/null || true; dev_pid=""; fi
  "$checkout/scripts/devcontainer.sh" stop >> "$evidence/lifecycle.log" 2>&1
}
probe() {
  "$checkout/scripts/devcontainer.sh" exec env KANBUN_LOCAL_REHEARSAL=1 "KANBUN_LOCAL_REHEARSAL_ID=$rehearsal_id" node scripts/local-install-probe.mjs "$1" >> "$evidence/lifecycle.log" 2>&1
}
"$checkout/scripts/devcontainer.sh" up >> "$evidence/lifecycle.log" 2>&1
start_app
probe create
stop_app
"$checkout/scripts/devcontainer.sh" up >> "$evidence/lifecycle.log" 2>&1
start_app
probe restart
stop_app
"$checkout/scripts/devcontainer.sh" rebuild >> "$evidence/lifecycle.log" 2>&1
start_app
probe rebuild
stop_app
"$checkout/scripts/devcontainer.sh" up >> "$evidence/lifecycle.log" 2>&1
probe reset
start_app
probe reset-verified
cp "$checkout"/artifacts/launch/local/*.json "$evidence/"
printf 'Local clean-install, restart, container replacement, and reset assertions passed. Evidence: %s\n' "$evidence"
