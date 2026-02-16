# Architecture

## High-level overview
Kanbun is a TypeScript monorepo with four main parts:

- **Server (Hono)**: REST API + static UI hosting
- **CLI (Commander.js)**: HTTP client that talks to the server
- **Electron shell**: desktop wrapper that loads the server UI
- **UI (Preact)**: dashboard + draft review screens

```
CLI ───► Hono API ───► SQLite
               ▲
Electron ─► Preact UI (served by Hono)
```

## Key modules
- `src/server` — Hono app + routes
- `src/services` — database-backed domain services
- `src/db` — schema + connection setup
- `src/agent` — LLM draft generation + follow‑up scheduling
- `ui` — Preact UI (built to `dist/ui`)
- `electron` — Electron main/preload

## Data model (tables)
- `projects`
- `contacts`
- `project_contacts`
- `email_accounts`
- `drafts`
- `templates`

## Integrations (status)
- Gmail/Outlook/Calendar services exist in `src/services/*`.
- OAuth flows and reply sync are not fully wired.
- Apollo MCP integration is currently stubbed.
