# Kanbun

Personal CRM for founder outreach. Kanbun combines a Hono HTTP server, a Commander.js CLI, an Electron desktop shell, and a Preact UI. It’s designed for manual, high‑touch outreach workflows (no bulk send).

## What’s in the repo
- **Server**: `src/server` (Hono + SQLite)
- **Services**: `src/services` (projects, contacts, drafts, email accounts, integrations)
- **CLI**: `src/cli`
- **Agent layer**: `src/agent` (LLM draft generation + follow‑up scheduler)
- **Desktop UI**: `ui` (Preact)
- **Electron shell**: `electron`

## Quickstart
```bash
npm install

# 1) Build the UI bundle (serves from dist/ui)
npx vite build

# 2) Start the server (serves API + UI)
npm run dev

# 3) In another terminal, run the Electron shell
npm run electron
```

### CLI usage (server must be running)
```bash
npm run cli -- project list
npm run cli -- contact list --project 1
```

## Scripts
- `npm run dev` — start the server
- `npm run cli -- <args>` — run CLI commands
- `npm run build` — TypeScript build
- `npm run electron` — build + launch Electron (server must already be running)

## Notes / known gaps
- Apollo integration is stubbed (`src/services/apollo.ts`).
- OAuth flows for Gmail/Outlook are not wired into the CLI yet.
- `/api/drafts/generate` is not implemented on the server (CLI expects it).
- Reply sync needs thread/conversation IDs persisted to drafts.

## Docs
- `docs/setup.md` — local setup and config
- `docs/cli.md` — CLI command reference
- `docs/api.md` — HTTP API reference
- `docs/architecture.md` — system overview
