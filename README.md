# Kanbun

Kanbun is a Tauri desktop app for managing multiple AI workstreams from one place. It is designed for daily personal use first, then open-source release.

## Current Status

### Built and working now

- Multi-project dashboard with per-workstream cards and attention queue.
- Workstream creation with:
  - project assignment,
  - adapter selection (`mock` or `claude_code`),
  - local folder picker (desktop runtime),
  - optional initial instruction (immediately persisted to conversation history).
- Conversation thread persistence (SQLite-backed).
- Run history and run output tracking in the detail panel.
- Adapter config persistence, adapter health checks, and adapter restart action.
- Cross-platform `process` adapter (spawns a real child process, streams stdout/stderr, and supports restart).
- Process output safety guards (line truncation + bounded recent-output buffer for status/health views).
- Connector panel with config + sync flows for:
  - Todoist (API token),
  - Obsidian (local vault path).
- Connector item cache in SQLite with refresh/delete flows.
- Shared project context documents (create/edit/delete).
- File watcher integration for workstream folders (records file-change activity).
- Database export/import from Settings for local backup and restore.
- Clean browser preview empty-state (obscured/blurred pane, no fake dashboard content).

### Partially built / pending

- Additional adapters (`codex`, `http_webhook`) are scaffolded but not implemented.
- Cross-workstream orchestration and agent-to-agent messaging are not implemented yet.
- Global command palette, approval workflows, and scheduled runs are not implemented yet.
- Additional connectors (Notion/Linear/GitHub Issues) are planned but not implemented.

## Runtime Model

- One Kanbun workstream = one `Agent` record in SQLite.
- Each agent has its own adapter loop.
- `claude_code` adapter starts and monitors one `tmux` session per workstream.
- `process` adapter starts and monitors one child process per workstream.
- `mock` adapter simulates responses without spawning an external CLI.

There is no hard-coded cap for "14 workstreams x 10 tasks"; practical limits are system resources and adapter/process capacity.

## Quick Start

### Prerequisites

- Node.js 18+
- Rust toolchain (`rustup`)
- Tauri CLI v2 (`cargo install tauri-cli --version "^2"`)
- `tmux` (required for `claude_code` adapter)
- `claude` CLI in `PATH` (only if using `claude_code`)

### Install

```bash
npm install
```

### Run dev mode

```bash
npm run tauri dev
```

Dev mode runs Next.js on `127.0.0.1:3002` by design (to avoid conflicts with other projects using `3000`).

### Build locally

```bash
npm run tauri build
```

macOS bundles are produced under:

- `src-tauri/target/release/bundle/macos/Kanbun.app`
- `src-tauri/target/release/bundle/dmg/*.dmg`

## Database and Reset

Kanbun stores data in SQLite under the app data directory:

- macOS: `~/Library/Application Support/com.kanbun.desktop/kanbun.db`

To reset local state, quit Kanbun and remove:

- `kanbun.db`
- `kanbun.db-wal`
- `kanbun.db-shm`

Backup and restore are also available from the app Settings view (`Export DB` / `Import DB`).
If you previously ran older builds, Kanbun migrates legacy DB files from `com.kanbun.app` (and older `com.hypervisor.app`) on first launch.

## Repo Structure

```text
kanbun/
├── src/                 # Next.js frontend
├── src-tauri/           # Rust backend (commands, adapters, connectors, db)
├── scripts/             # local dev helpers (including fixed-port dev launcher)
└── public/              # static assets/icons
```

## Open-Source Plan (next milestones)

1. Harden adapter lifecycle and error recovery for long-running daily usage.
2. Complete at least one more real adapter (`codex` or `http_webhook`).
3. Add cross-workstream command and context propagation.
4. Add CI (lint/test/build) and contributor docs.
5. Publish first tagged release with install docs.
