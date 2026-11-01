#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
command_name="${1:-help}"
if [ "$#" -gt 0 ]; then shift; fi

case "$command_name" in
  help|--help|-h)
    cat <<'HELP'
Usage: ./scripts/devcontainer.sh <command> [arguments...]
  up        Build/start the container and run workspace setup
  doctor    Diagnose runtime, checkout and running-container access
  rebuild   Recreate this workspace's container after configuration changes
  exec      Run a command inside the container
  verify    Run the verifier inside the container (optional profile)
  dev       Run the web shell and local Worker inside the container
  shell     Open a container shell
  status    Show this workspace's containers
  url       Print the localhost URL published for the web shell
  stop      Stop only this workspace's containers; preserve data
HELP
    exit 0
    ;;
  up|rebuild|exec|verify|dev|shell|status|url|stop|doctor) ;;
  *) printf 'Unknown container command: %s\n' "$command_name" >&2; exit 2 ;;
esac

command -v docker >/dev/null || { printf 'Docker CLI not found. Install Docker or Colima first.\n' >&2; exit 1; }
# Use the project runtime when the default is unavailable, without changing global context.
if ! docker info >/dev/null 2>&1; then
  if [ -z "${DOCKER_CONTEXT:-}" ] && [ -z "${DOCKER_HOST:-}" ] &&
    docker --context colima-kanbun info >/dev/null 2>&1; then
    export DOCKER_CONTEXT=colima-kanbun
  else
    if [ -n "${DOCKER_CONTEXT:-}" ] || [ -n "${DOCKER_HOST:-}" ]; then
      printf 'The explicitly selected Docker context or host is unavailable; check DOCKER_CONTEXT/DOCKER_HOST.\n' >&2
    else
      printf 'Docker is unavailable. For the Kanbun Colima profile: colima start --profile kanbun --activate=false\n' >&2
      printf 'If Colima reports a running VM without a host agent, check other users of the profile before stopping and restarting it.\n' >&2
    fi
    exit 1
  fi
fi

container_ids() {
  docker ps --quiet --filter "label=devcontainer.local_folder=$repo_root"
}

case "$command_name" in
  status)
    exec docker ps --all --filter "label=devcontainer.local_folder=$repo_root" \
      --format 'table {{.ID}}\t{{.Status}}\t{{.Names}}'
    ;;
  stop)
    while IFS= read -r container_id; do
      if [ -n "$container_id" ]; then docker stop "$container_id"; fi
    done < <(container_ids)
    exit 0
    ;;
  url)
    container_id="$(container_ids | head -n 1)"
    [ -n "$container_id" ] || { printf 'Start this workspace container first.\n' >&2; exit 1; }
    address="$(docker port "$container_id" 5173/tcp)"
    printf 'http://%s\n' "$address"
    exit 0
    ;;
esac

command -v npx >/dev/null || { printf 'Install Node.js to bootstrap the devcontainer CLI.\n' >&2; exit 1; }
container_cli=(npx --yes @devcontainers/cli@0.90.0)
# Linked worktrees point at the common Git directory using a host path. Mount it
# at that same path so Git and source-metadata checks work inside the container.
worktree_mount=()
if [ -f "$repo_root/.git" ]; then
  common_dir="$(git -C "$repo_root" rev-parse --git-common-dir)"
  common_dir="$(cd "$repo_root" && cd "$common_dir" && pwd -P)"
  if [[ "$common_dir" == *,* ]]; then
    printf 'Git common directory cannot contain a comma when mounted: %s\n' "$common_dir" >&2
    exit 1
  fi
  worktree_mount=(--mount "type=bind,source=$common_dir,target=$common_dir")
fi
if [ "$command_name" = doctor ]; then
  printf 'Docker context: %s\n' "${DOCKER_CONTEXT:-$(docker context show 2>/dev/null || printf 'unknown')}"
  printf 'Workspace: %s\n' "$repo_root"
  printf 'Filesystem capacity (workspace):\n'
  df -h "$repo_root"
  if [ -n "${common_dir:-}" ]; then printf 'Git common directory: %s\n' "$common_dir"; fi
  container_id="$(container_ids | head -n 1)"
  if [ -z "$container_id" ]; then
    printf 'No running container for this workspace. Run ./scripts/devcontainer.sh up.\n'
    exit 0
  fi
  printf 'Running container: %s\n' "$container_id"
  if ! "${container_cli[@]}" exec --workspace-folder "$repo_root" git rev-parse --verify HEAD >/dev/null; then
    printf 'Container cannot resolve this checkout Git metadata. For a linked worktree, rebuild to mount its common Git directory.\n' >&2
    exit 1
  fi
  printf 'Container Git metadata: accessible\n'
  exit 0
fi
case "$command_name" in
  up)
    exec "${container_cli[@]}" up --workspace-folder "$repo_root" ${worktree_mount[@]+"${worktree_mount[@]}"} "$@"
    ;;
  rebuild)
    exec "${container_cli[@]}" up --workspace-folder "$repo_root" --remove-existing-container ${worktree_mount[@]+"${worktree_mount[@]}"} "$@"
    ;;
  exec)
    [ "$#" -gt 0 ] || { printf 'Supply a command to execute.\n' >&2; exit 2; }
    ;;
  verify) set -- pnpm --silent verify "$@" --json ;;
  dev) set -- pnpm dev "$@" ;;
  shell) set -- bash "$@" ;;
esac
exec "${container_cli[@]}" exec --workspace-folder "$repo_root" "$@"
