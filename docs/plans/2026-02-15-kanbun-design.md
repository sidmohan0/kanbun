# Kanbun — Personal CRM for Founder Outreach

## Overview

Kanbun is a TypeScript CLI + Electron desktop app for founders doing manual, high-touch outreach. It is not a mass email tool. Every email passes through human review before sending.

Core capabilities:
- Manage contacts across multiple simultaneous outreach projects
- Import contacts manually, via CSV, or from Apollo
- Generate email drafts via templates or LLM-powered personalization
- Review and send drafts through a desktop UI
- Automatic follow-up scheduling with manual send approval
- Gmail, Outlook, Google Calendar, and Apollo integrations

## Architecture

```
┌──────────────────────────────┐
│  Electron Window             │
│  ┌────────────────────────┐  │
│  │  Web UI (Preact)       │  │
│  └────────────────────────┘  │
└──────────┬───────────────────┘
           │ HTTP (localhost)
┌──────────▼───────────────────┐
│  Kanbun Server (Hono)        │
│  + Agent Orchestrator        │
│  + Follow-up Scheduler       │
│  + SQLite (better-sqlite3)   │
├──────────────────────────────┤
│  CLI (Commander.js)          │  ← Talks to same server
└──────────────────────────────┘
```

- `kanbun` launches the Hono server as a background process and opens the Electron window.
- `kanbun server` starts the server headless (no window).
- CLI commands (`kanbun project create`, `kanbun draft generate`, etc.) make HTTP requests to the running server.
- The Electron window and CLI share the same server and database.

## Data Model

### projects

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| name | TEXT | e.g., "Series A Raise" |
| description | TEXT | Project context for LLM drafts |
| pipeline_stages | JSON | e.g., `["Researched","Drafted","Sent","Replied","Meeting"]` |
| follow_up_cadence | JSON | Days after send, e.g., `[3, 7, 14]` |
| default_send_account_id | INTEGER FK | Links to email_accounts |
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601 |

### contacts

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| first_name | TEXT | |
| last_name | TEXT | |
| email | TEXT | |
| company | TEXT | |
| title | TEXT | |
| linkedin_url | TEXT | |
| phone | TEXT | |
| notes | TEXT | Freeform |
| apollo_id | TEXT | Prevents duplicate Apollo imports |
| source | TEXT | `manual`, `csv`, or `apollo` |
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601 |

### project_contacts

| Column | Type | Notes |
|--------|------|-------|
| project_id | INTEGER FK | |
| contact_id | INTEGER FK | |
| current_stage | TEXT | Must match a value in project's pipeline_stages |
| assigned_at | TEXT | ISO 8601 |
| stage_updated_at | TEXT | ISO 8601 |

Contacts are global. A contact can appear in multiple projects at different stages.

### email_accounts

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| provider | TEXT | `gmail` or `outlook` |
| email_address | TEXT | |
| display_name | TEXT | |
| credentials | TEXT | Encrypted JSON (OAuth tokens) |

### drafts

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| project_id | INTEGER FK | |
| contact_id | INTEGER FK | |
| send_account_id | INTEGER FK | |
| subject | TEXT | |
| body | TEXT | |
| draft_type | TEXT | `template` or `agent` |
| status | TEXT | `pending_review`, `approved`, `sent`, `skipped` |
| scheduled_send_at | TEXT | ISO 8601, nullable |
| parent_draft_id | INTEGER FK | Links follow-ups to original thread |
| sequence_step | INTEGER | 1 = initial, 2 = first follow-up, etc. |
| created_at | TEXT | ISO 8601 |
| sent_at | TEXT | ISO 8601, nullable |

### templates

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| project_id | INTEGER FK | |
| name | TEXT | e.g., "Cold Intro" |
| subject | TEXT | Supports `{{variables}}` |
| body | TEXT | Supports `{{variables}}` |
| variables | JSON | Array of field names, e.g., `["firstName","company"]` |

## CLI Commands

### Application

```
kanbun                          # Launch Electron app + server
kanbun server                   # Start server only (headless)
```

### Projects

```
kanbun project create "Series A Raise"
kanbun project list
kanbun project set-stages <id> "Researched,Drafted,Sent,Replied,Meeting"
kanbun project set-cadence <id> 3,7,14
kanbun project set-account <id> <email-account-id>
```

### Contacts

```
kanbun contact add --name "Jane Doe" --email jane@co.com --company Acme
kanbun contact import --csv ./leads.csv --project <id>
kanbun contact list --project <id> --stage "Drafted"
kanbun contact move <contact-id> --project <id> --stage "Sent"
```

### Apollo

```
kanbun apollo search "CTO Series A fintech SF" --limit 25
kanbun apollo import-list "Q1 Fintech Founders" --project <id>
kanbun apollo enrich <contact-id>
```

### Drafts

```
kanbun draft generate --project <id> --template <template-id>
kanbun draft generate --project <id> --agent --context "warm intro via Mike"
kanbun draft list --status pending_review
kanbun draft preview <draft-id>
```

### Email Accounts

```
kanbun account add gmail
kanbun account add outlook
kanbun account list
```

### Templates

```
kanbun template create --project <id> --name "Cold Intro"
kanbun template list --project <id>
```

## Web UI

Two views inside the Electron window.

### Dashboard

- Left sidebar: project list with draft queue count badge
- Main area: selected project's pipeline displayed as a stage bar with contact counts per stage
- Pending items: drafts awaiting review, follow-ups due today
- Recent activity feed: replies received, drafts generated, imports completed
- Top bar: connected account indicators (Gmail, Outlook status)

### Draft Review

- Navigation: "Draft 3 of 8" with previous/next controls
- Header: recipient email, sending account, project name, sequence step
- Editable subject line
- Editable rich text body
- Contact context card: name, title, company, source, LinkedIn link, notes
- Actions: **Skip** (mark skipped, next), **Save & Next** (save edits, next), **Send** (dispatch immediately)

Sending happens exclusively in the web UI. The CLI queues drafts; the UI is where you review and send.

## Integrations

### Apollo (via MCP)

- Uses the Apollo MCP server for search, list import, and contact enrichment
- Two workflows: ad-hoc search from CLI, and import saved Apollo lists
- Results normalized into Kanbun's contact schema
- `apollo_id` prevents duplicate imports

### Gmail (via Google APIs)

- OAuth2 flow triggered by `kanbun account add gmail`
- Credentials stored encrypted in email_accounts table
- Send via Gmail API (not SMTP) so emails appear in Gmail's Sent folder
- Reply detection via inbox polling for matching thread subjects

### Outlook (via Microsoft Graph API)

- OAuth2 flow triggered by `kanbun account add outlook`
- Send via Graph API, appears in Outlook Sent folder
- Reply detection via Graph API mail polling

### Google Calendar (via Google APIs)

- Reuses OAuth2 token from Gmail setup
- Create calendar events linked to contacts and projects
- `kanbun cal create --contact <id> --project <id>` creates event and moves contact to Meeting stage
- Dashboard shows upcoming meetings per project

### Common Patterns

- Each integration is a standalone service class with a clean interface
- Auth tokens refreshed automatically
- API calls go through a retry wrapper with exponential backoff
- `SyncService` polls for replies on a configurable interval (default: every 5 minutes) and updates contact stages

## Agent Orchestrator

A pipeline runner that chains steps for multi-step workflows.

### Draft Generation

When `--agent` is used, the orchestrator:
1. Loads the project (description, context)
2. Loads target contacts (filtered by stage, no existing draft)
3. For each contact, builds a prompt with: project description, contact info, prior email thread if any, and freeform `--context`
4. Calls the Anthropic API (Claude Sonnet by default, `--model opus` for high-stakes)
5. Saves the generated draft with `status = pending_review`

### Follow-up Scheduler

Runs hourly while the server is active:
1. For each project with a `follow_up_cadence`, find contacts where:
   - Last email was sent N days ago (matching a cadence step)
   - No reply has been received
   - No follow-up draft is already pending
2. Generate a follow-up draft (template or agent, per project config)
3. Save with `parent_draft_id` linking to the previous email, `sequence_step` incremented
4. Draft appears in the same review queue as initial drafts
5. If a reply arrives before the next check, contact moves to "Replied" and no follow-up is generated

## Project Structure

```
kanbun/
├── package.json
├── tsconfig.json
├── electron/
│   ├── main.ts              # Electron main process, launches server + window
│   └── preload.ts
├── src/
│   ├── server/
│   │   ├── index.ts          # Hono HTTP server
│   │   ├── routes/           # API routes (projects, contacts, drafts, etc.)
│   │   └── middleware/
│   ├── cli/
│   │   ├── index.ts          # Commander.js entry point
│   │   └── commands/         # One file per command group
│   ├── services/
│   │   ├── project.ts
│   │   ├── contact.ts
│   │   ├── draft.ts
│   │   ├── template.ts
│   │   ├── email.ts          # Common interface, delegates to gmail/outlook
│   │   ├── gmail.ts
│   │   ├── outlook.ts
│   │   ├── apollo.ts
│   │   ├── calendar.ts
│   │   └── sync.ts           # Reply polling, stage updates
│   ├── agent/
│   │   ├── orchestrator.ts   # Pipeline runner
│   │   ├── scheduler.ts      # Follow-up cron
│   │   └── prompts.ts        # LLM prompt templates
│   ├── db/
│   │   ├── schema.ts         # Table definitions
│   │   ├── migrations/       # Versioned SQL migrations
│   │   └── index.ts          # better-sqlite3 setup
│   └── shared/
│       └── types.ts          # Shared TypeScript types
├── ui/
│   ├── index.html
│   ├── app.tsx               # Preact entry
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   └── DraftReview.tsx
│   └── components/
├── docs/
│   └── plans/
└── data/
    └── kanbun.db             # SQLite file (gitignored)
```

### Key Dependencies

- `commander` — CLI framework
- `better-sqlite3` — SQLite driver
- `hono` — HTTP server
- `electron` — Desktop window
- `preact` — Web UI
- `@anthropic-ai/sdk` — LLM calls for agent-written drafts
- `googleapis` — Gmail + Google Calendar
- `@microsoft/microsoft-graph-client` — Outlook
- `@anthropic-ai/mcp` — Apollo MCP client
