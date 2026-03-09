# Kanbun

Kanbun is a personal contact manager for relationship-driven outreach. The product direction is a unified system that can:

- sync contacts and communication metadata from Gmail and Microsoft Outlook
- import contacts from CSV into a normalized database
- manage sequences, ad hoc follow-ups, and contact tasks from one application
- integrate with Todoist for task capture and workflow continuity

The repository is intentionally starting with architecture and operating-model documentation before application code. The goal is to make the codebase agent-friendly, legible, and maintainable from day one.

## Current status

Planning is complete and the repository bootstrap is underway. The current app includes:

- a Next.js 16 app-router foundation
- Tailwind CSS 4
- `shadcn/ui`
- a Kanbun app shell with database-backed home, contacts, imports, and tasks views
- local PostgreSQL scaffolding via Docker Compose
- Drizzle ORM schema and migrations
- owner-mode password authentication backed by PostgreSQL sessions
- a robust CSV import flow with file idempotency, draft preview and remapping, per-row edits and skip controls, paginated review, downloadable review reports, and dedicated worker processing into canonical contacts
- Google OAuth connected-account scaffolding with worker-driven People API contact sync into the canonical contact model
- Microsoft OAuth connected-account scaffolding with worker-driven Graph contact sync into the same canonical contact model
- a first-pass sequence engine with durable enrollments, worker-generated review drafts, and queued outbound delivery through connected Gmail or Microsoft accounts
- ad hoc follow-up creation from the contact workspace into the Kanbun task queue
- Todoist API-token task mirroring with worker-driven reconciliation back into Kanbun task state
- baseline lint, typecheck, test, build, and CI setup

## Docs

- [Agent guide](./AGENTS.md)
- [Docs index](./docs/README.md)
- [ADR index](./docs/adr/README.md)

## Quickstart

```bash
pnpm install
cp .env.example .env.local
# fill in the placeholder values in .env.local
pnpm db:up
pnpm db:migrate
pnpm db:seed-owner
pnpm dev
# in a second terminal
pnpm worker
```

Open `http://localhost:7890`.
PostgreSQL is exposed on `localhost:5433` by default to avoid collisions with an existing local database.
If `OWNER_MODE_ENABLED=true`, sign in with the `OWNER_EMAIL` and `OWNER_PASSWORD` values from `.env.local`.
If `OWNER_MODE_ENABLED=false`, the app bypasses sign-in for local development.
Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to enable the Gmail/People integration and Gmail send permissions.
Set `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and optionally `MICROSOFT_TENANT_ID` to enable the Microsoft Graph integration and Outlook send permissions.
Set `TODOIST_API_TOKEN` to enable Todoist task mirroring.
The app runs on port `7890` by default.
Make sure `KANBUN_URL` matches the OAuth redirect origin you register with the providers.
If you connected Google or Microsoft before outbound sending was added, reconnect once so the new send scopes are granted.

## Core commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:fix
pnpm db:generate
pnpm db:migrate
pnpm db:seed-owner
pnpm worker
pnpm worker:once
```
