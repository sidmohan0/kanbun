# Kanbun

Kanbun is an open-source personal contact manager for relationship-driven outreach.

It brings contacts, follow-ups, sequences, provider sync, and operator review into one application so you can run personal CRM work without bouncing between Gmail, Outlook, CSV spreadsheets, and Todoist.

## What It Does

- sync contacts from Gmail and Microsoft Outlook
- import contacts from CSV into a canonical PostgreSQL model
- create and manage ad hoc follow-ups inside the app
- enroll contacts into multi-step email sequences
- generate drafts, queue sends, and keep approvals supervised
- detect replies and stop future sequence steps automatically
- surface merge conflicts, connector issues, outbound approvals, and task exceptions in one review inbox
- mirror follow-up tasks into Todoist

## Current Status

Kanbun is already runnable locally and covers the core operator loop:

- connect Google and Microsoft accounts
- import and unify contacts
- create and edit manual contacts
- manage follow-ups and Todoist mirroring
- create sequences, approve drafts, and send through connected accounts
- review merge conflicts and connector issues

It is still early-stage software. The product model is strong, but the repo is not yet fully production-hardened or polished for broad public usage.

## Stack

- Next.js 16
- React 19
- Tailwind CSS 4
- `shadcn/ui`
- PostgreSQL
- Drizzle ORM
- TypeScript

## Quickstart

### Prerequisites

- Node.js 20+
- `pnpm`
- Docker

### Local Setup

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

## Environment

### Core

- `KANBUN_PORT`
- `KANBUN_URL`
- `DATABASE_URL`
- `APP_ENCRYPTION_KEY`
- `OWNER_MODE_ENABLED`
- `OWNER_EMAIL`
- `OWNER_PASSWORD`

If `OWNER_MODE_ENABLED=false`, Kanbun bypasses sign-in for local development.

### Optional Integrations

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `MICROSOFT_TENANT_ID`
- `TODOIST_API_TOKEN`

## OAuth Redirect URIs

Register these exact callback URLs in your provider apps when running locally:

- Google: `http://localhost:7890/api/auth/google/callback`
- Microsoft: `http://localhost:7890/api/auth/microsoft/callback`

If you connected Google or Microsoft before send or reply-detection scopes were added, reconnect once so the newer permissions are granted.

## Core Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm format:fix
pnpm db:up
pnpm db:migrate
pnpm db:seed-owner
pnpm worker
pnpm worker:once
```

## Project Structure

- [AGENTS.md](./AGENTS.md): agent workflow and repo operating rules
- [docs/README.md](./docs/README.md): documentation index
- [docs/adr/README.md](./docs/adr/README.md): architectural decision records
- [docs/product/README.md](./docs/product/README.md): product behavior and UX specs
- [docs/plans/README.md](./docs/plans/README.md): implementation plans

## Contributor Notes

This repo is intentionally documentation-first and agent-friendly.

Before changing behavior, read the relevant ADRs and product docs first. The expectation is that code follows the documented operating model instead of drifting into undocumented behavior.

## Near-Term Work

The biggest remaining areas are:

- outbound hardening and thread-aware reply tracking
- stronger contact merge and duplicate resolution tooling
- more provider reliability and observability
- auth cleanup and open-source polish
