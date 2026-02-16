# Kanbun

Personal CRM for founder outreach. Manage contacts, draft personalized emails with LLMs, track your pipeline, and send via Gmail or Outlook — all local-first with SQLite.

Kanbun is designed for manual, high-touch outreach workflows (no bulk send). Every email goes through human review before it's sent.

## Features

- **Pipeline management** — projects with customizable stages, follow-up cadence, and GTM tracking
- **LLM-powered drafts** — generate personalized outreach emails with Anthropic Claude
- **Multi-account email** — send via Gmail and Outlook with OAuth
- **Apollo integration** — search, enrich contacts, and import lists
- **Reply detection** — auto-sync replies and move contacts through pipeline stages
- **Follow-up scheduler** — automatically generate follow-up drafts based on cadence
- **Pi agent extension** — use [pi](https://github.com/badlogic/pi-mono) as a CRM manager with permission gates on dangerous actions
- **Desktop app** — Electron shell for native experience

## Architecture

```
CLI ───► Hono API ───► SQLite
               ▲
Electron ─► Preact UI (served by Hono)
               │
         Pi Extension (tools + gates)
               │
         Apollo MCP Server
```

| Layer | Location | Tech |
|-------|----------|------|
| Server | `src/server` | Hono + SQLite (better-sqlite3) |
| Services | `src/services` | Projects, contacts, drafts, email, Apollo, GTM |
| Agent | `src/agent` | Anthropic Claude for draft generation + follow-up scheduling |
| CLI | `src/cli` | Commander.js (talks to server over HTTP) |
| UI | `ui` | Preact + Vite |
| Desktop | `electron` | Electron shell loading the server UI |
| Pi extension | `docs/pi-extension` | Role-based CRM agent with permission gates |
| Apollo | `kanbun-apollo-mcp` | Standalone Hono server wrapping Apollo API |

## Quickstart

### Prerequisites

- Node.js 20+
- An Anthropic API key (for draft generation)
- Gmail and/or Outlook OAuth credentials (for sending)
- Apollo API key (optional, for contact enrichment)

### 1. Install and configure

```bash
git clone https://github.com/YOUR_USER/kanbun.git
cd kanbun
npm install

# Copy and fill in your credentials
cp .env.example .env
```

Edit `.env` with your credentials:

```env
KANBUN_PORT=7890
KANBUN_URL=http://localhost:7890

# Gmail OAuth (Google Cloud Console → APIs & Services → Credentials)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:7890/api/oauth/gmail/callback

# Outlook OAuth (Azure Portal → App Registrations)
OUTLOOK_CLIENT_ID=
OUTLOOK_CLIENT_SECRET=
OUTLOOK_TENANT_ID=common
OUTLOOK_REDIRECT_URI=http://localhost:7890/api/oauth/outlook/callback

# Anthropic (for LLM draft generation)
ANTHROPIC_API_KEY=

# Apollo (optional — for contact enrichment)
APOLLO_MCP_URL=http://localhost:3001
```

### 2. Build and start

```bash
# Build the UI
npx vite build

# Start the server
npm run dev
```

The server runs at `http://localhost:7890`.

### 3. Connect email accounts

With the server running, open these URLs in your browser to connect accounts via OAuth:

**Gmail:**
```
https://accounts.google.com/o/oauth2/v2/auth?access_type=offline&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.send%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.readonly&response_type=code&client_id=YOUR_CLIENT_ID&redirect_uri=http%3A%2F%2Flocalhost%3A7890%2Fapi%2Foauth%2Fgmail%2Fcallback&prompt=consent
```

**Outlook:**
```
https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=YOUR_CLIENT_ID&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A7890%2Fapi%2Foauth%2Foutlook%2Fcallback&scope=Mail.Send%20Mail.Read%20offline_access&response_mode=query
```

Replace `YOUR_CLIENT_ID` with the values from your `.env`.

### 4. Apollo (optional)

```bash
cd kanbun-apollo-mcp
cp .env.example .env
# Add your APOLLO_API_KEY to .env
npm install
npm run dev
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the server (API + UI) |
| `npm run build` | TypeScript compilation |
| `npm run cli -- <args>` | Run CLI commands (server must be running) |
| `npm run electron` | Build + launch Electron shell (server must be running) |
| `npm run dist` | Production Electron build (macOS) |
| `npm test` | Run tests |

### CLI examples

```bash
npm run cli -- project list
npm run cli -- contact list --project 1
npm run cli -- draft list --status pending_review
```

## Pi Agent Extension

Kanbun ships with a [pi](https://github.com/badlogic/pi-mono) extension that turns pi into your personal CRM manager. Instead of clicking through a UI, you talk to an agent that manages your pipeline, generates drafts, and sends emails — with permission gates on every dangerous action.

### What the agent can do

| Tool | Description |
|------|-------------|
| `projects_list` | List outreach projects |
| `contacts_list` / `contacts_add` / `contacts_move_stage` | Manage contacts and pipeline |
| `contacts_import_csv` | Bulk import from CSV |
| `drafts_generate` / `drafts_list` / `drafts_show` / `drafts_edit` | LLM draft workflow |
| `drafts_approve` / `drafts_skip` | Review queue |
| `email_send` | Send approved drafts via Gmail/Outlook |
| `sync_replies` | Check for replies, auto-move contacts |
| `followup_check` | Generate overdue follow-up drafts |
| `pipeline_status` | Pipeline dashboard |
| `gtm_report` | Weekly GTM metrics |
| `apollo_search` / `apollo_enrich` / `apollo_enrich_org` | Apollo enrichment |
| `templates_list` | List email templates |

### Permission gates

| Action | Gate |
|--------|------|
| Sending email | **Always confirm** — shows recipient, subject, body |
| Approving drafts | **Show + confirm** — displays full draft content |
| Bulk import (>10 contacts) | **Confirm** threshold |
| Apollo API calls | **Rate-limited** — 25 per session, then confirm |
| Email account changes | **Blocked entirely** — use the UI |

### Setup

1. **Install [pi](https://github.com/badlogic/pi-mono):**
   ```bash
   npm install -g @mariozechner/pi-coding-agent
   ```

2. **Copy the extension:**
   ```bash
   mkdir -p ~/.pi/agent/extensions/kanbun
   cp docs/pi-extension/index.ts ~/.pi/agent/extensions/kanbun/
   ```

3. **Install the native dependency:**
   ```bash
   cd ~/.pi/agent/extensions/kanbun
   npm init -y
   npm install better-sqlite3
   ```

4. **Update paths** in `~/.pi/agent/extensions/kanbun/index.ts`:
   - `KANBUN_ROOT` — path to your Kanbun clone
   - Verify `DB_PATH` resolves to your `kanbun.db`

5. **Start pi:**
   ```bash
   pi
   ```

   The extension auto-loads. The Apollo MCP server is started automatically if configured.

### Commands

| Command | Description |
|---------|-------------|
| `/daily` | Run the morning CRM routine (sync → follow-ups → status → drafts) |
| `/pipeline` | Pipeline snapshot |
| `/pipeline 1` | Pipeline for project #1 |
| `/drafts` | Review pending drafts |
| `/apollo` | Apollo MCP server status and logs |

### Building your own role-based agents

See [`docs/pi-role-based-agents-guide.md`](docs/pi-role-based-agents-guide.md) for a comprehensive checklist on designing constrained, role-based agents with pi — covering tool design, permission gates, system prompts, lifecycle management, and more.

## Data model

| Table | Purpose |
|-------|---------|
| `projects` | Outreach campaigns with pipeline stages and follow-up cadence |
| `contacts` | People (manual, CSV import, or Apollo) |
| `project_contacts` | Pipeline stage per contact per project |
| `email_accounts` | Connected Gmail/Outlook accounts (credentials encrypted) |
| `drafts` | Email drafts with status workflow: `pending_review` → `approved` → `sent` |
| `templates` | Reusable email templates with variable interpolation |

## Docs

- [`docs/setup.md`](docs/setup.md) — local setup and configuration details
- [`docs/cli.md`](docs/cli.md) — CLI command reference
- [`docs/api.md`](docs/api.md) — HTTP API reference
- [`docs/architecture.md`](docs/architecture.md) — system overview
- [`docs/pi-role-based-agents-guide.md`](docs/pi-role-based-agents-guide.md) — building role-based agents with pi

## License

[MIT](LICENSE)
