---
slug: 2026-02-16-settings-section
status: intake
date: 2026-02-16T10:30:00Z
owner: sid
plan_mode: lightweight
priority: medium
---

# Add Settings section for accounts and system configuration

## Purpose / Big Picture

Now that Kanbun has a people-first shell and richer CRM surfaces, users need a single, predictable place to manage their email connections and see basic system configuration. Today, account management is scattered (buttons on the dashboard) and error messages like "env vars not configured" are opaque. A Settings section should centralize:

- email account connections (Gmail/Outlook)
- basic system diagnostics (env-dependent features, health checks)
- a future home for other preferences (notifications, defaults)

The first iteration will focus on **Email & Integrations** and a simple **System** panel that exposes state without editing sensitive environment variables from the UI.

## Scope

### In Scope (this iteration)

- Add a **Settings** entry to the main shell navigation, reachable from the sidebar alongside People / Projects / Drafts / GTM.
- Implement a Settings page with two primary sections:
  - **Email & Integrations**
    - list existing connected email accounts
    - surface provider (gmail/outlook), email address, and display name
    - provide a centralized way to start Gmail/Outlook connection flows (reusing existing OAuth routes)
    - show clear error state when OAuth env vars are not configured
  - **System**
    - show read-only runtime configuration details useful for debugging:
      - app version
      - KANBUN_PORT
      - whether Gmail/Outlook OAuth env vars are present
      - database path in dev (KANBUN_DB_PATH if set, or default)
- Keep the implementation **read-only** for sensitive underlying configuration (env vars, DB path). The UI should not attempt to write `.env` or shell configuration.

### Out of Scope (for now)

- Editing environment variables or `.env` values from the UI.
- Per-user or multi-tenant settings; this is a single-user desktop-style app.
- Notification rules, theme selection, or advanced preferences.
- Detailed sync scheduling controls (e.g., changing poll intervals) beyond what is already configured in code.

## Users and User Stories

Primary user: founder/operator using Kanbun on their machine with one or more connected email accounts.

Key stories:

- **S1: Connect my email from one place**
  - As a user, I want a Settings page where I can see a list of my connected email accounts and connect a new Gmail or Outlook account without hunting through the dashboard, so that setup feels intentional and discoverable.

- **S2: See what's wrong when email connection fails**
  - As a user, when connecting Gmail/Outlook fails because environment variables are not set, I want Settings to clearly show which env vars are missing so I can fix my `.env` file without guessing.

- **S3: Verify the system is pointed at the right database and port**
  - As a user or developer, I want to see which port the server is running on and which DB file is in use, so I can diagnose issues with multiple Kanbun instances or conflicting databases.

- **S4: Future-ready surface for additional settings**
  - As a maintainer, I want a Settings page that can later host toggles for Apollo integration, experimental agents, or theme switches, without redoing the shell.

## Current Behavior and Gaps

- Email accounts:
  - `EmailAccountService` persists accounts in the `email_accounts` table.
  - `GET /api/accounts` lists accounts (id, provider, email_address, display_name).
  - `ui/pages/Dashboard.tsx` shows accounts as badges in the top bar and exposes "+ Gmail" / "+ Outlook" buttons that open `/api/accounts/oauth/gmail/start` or `/api/accounts/oauth/outlook/start` in a new tab.
  - When env vars are missing, the OAuth start route returns a JSON error (500) instead of redirecting.
  - There is no central Settings location; account status is visible only per-project.

- System configuration:
  - Server port is determined by `KANBUN_PORT` (with default 7890).
  - In the Electron path, `electron/main.ts` loads `.env` manually and sets `KANBUN_DB_PATH`, but during `npm run dev` we rely on `dotenv/config` from `src/server/start.ts` (added in the Clay plan work).
  - There is no UI surface exposing which port or DB path is active, or whether env vars for Gmail/Outlook are present.

## Proposed UX

### Navigation

- Add **Settings** as a top-level item in the sidebar, visible from all major views.
- Placement: below Drafts and Groups (if space permits) or in a "Workspace" section.
- Clicking **Settings** switches the main content pane to the Settings page without disrupting background jobs.

### Settings Page Layout

Single-column layout with stacked cards:

1. **Email & Integrations** card
   - Title: "Email & Integrations"
   - Content:
     - a table or list of existing email accounts, each row showing:
       - provider icon/label (Gmail/Outlook)
       - email address
       - display name
     - actions:
       - button: "Connect Gmail" → opens `/api/accounts/oauth/gmail/start` in a new window (same behavior as today).
       - button: "Connect Outlook" → opens `/api/accounts/oauth/outlook/start`.
     - error state:
       - if `GET /api/accounts/oauth/gmail/start` responds with a JSON error due to missing env vars, we should surface this as a warning on the Settings page:
         - e.g., "Google OAuth env vars not configured: set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI in your .env file."
       - similar message for Outlook.

   - Optional future iteration: an inline "Disconnect" button for accounts, backed by a `DELETE /api/accounts/:id` endpoint; **not required in the first cut** unless the UX feels incomplete.

2. **System** card
   - Title: "System"
   - Content (read-only fields):
     - **Version**: read from `package.json` or injected at build time.
     - **Server Port**: value of `KANBUN_PORT` or default 7890.
     - **Database Path**:
       - show `KANBUN_DB_PATH` if set; otherwise show the default path used by `getDb()` (e.g., project `data/kanbun.db` for dev).
     - **OAuth configuration**:
       - Gmail: show `Configured` if all of `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` are present in `process.env`; otherwise `Missing` with a list of missing keys.
       - Outlook: same for `OUTLOOK_CLIENT_ID`, `OUTLOOK_TENANT_ID`, `OUTLOOK_REDIRECT_URI`.
   - This card should explicitly say: "To change these values, edit your `.env` file and restart Kanbun." with a short hint on where `.env` lives in dev vs packaged app.

### Visual Style

- Reuse existing `.main`, `.info-card`, `.field-label`, and `.btn` styles.
- Use cards similar to the GTM and profile sections for consistency.

## API and Backend Changes

### New endpoints (optional, for completeness later)

Not strictly required for the initial Settings surface, which can rely on:

- `GET /api/accounts` for account listing.
- `GET /api/accounts/oauth/:provider/start` for initiating OAuth (already exists in `accountRoutes`).

However, we may want to consider these in a follow-up iteration:

- `DELETE /api/accounts/:id` — remove an account, with a constraint that projects using that account must either be reassigned or will show a warning.
- `GET /api/system/info` — a small informational endpoint returning:
  - `version`
  - `port`
  - `db_path`
  - `oauth`: `{ gmail: { configured: boolean; missing: string[] }, outlook: { configured: boolean; missing: string[] } }`

For the initial scope, the System card can compute this data on the server side in `src/server/routes/accounts.ts` or a new `system.ts` route, or the UI can infer directly from window globals if we prefer to keep it simple. Defining a `GET /api/system/info` endpoint is preferred for testability.

## Data Model Changes

- None required for the first iteration.
- If we add account deletion, there may be cascading considerations for `projects.default_send_account_id`; that should be handled in a future spec or a small extension of this one.

## Risks and Mitigations

- **Risk:** Users misinterpret the System card as a place to edit env vars.
  - **Mitigation:** Label all fields as read-only and explicitly direct users to edit `.env` and restart.

- **Risk:** Surfacing env var names may be confusing.
  - **Mitigation:** Include short, concrete examples and keep the list to high-value keys (OAuth-related, port, DB path).

- **Risk:** Future expansion could overstuff Settings.
  - **Mitigation:** Keep this iteration lean, with two focused sections and room for additional cards later.

## Validation and Acceptance

- **Settings nav:** "Settings" appears in the sidebar and is reachable from People, Projects, Drafts, and Groups without losing state.
- **Email accounts:**
  - `GET /api/accounts` data appears in the Settings page list.
  - Clicking "Connect Gmail" or "Connect Outlook" opens the OAuth flow in a new tab.
  - When env vars are missing, the user sees a clear, Settings-page-level message naming the missing variables.
- **System info:**
  - Port and DB path shown match the running process (validated by comparing to console logs during `npm run dev`).
  - OAuth configuration status accurately reflects the presence/absence of env vars.

## Open Questions

- Should we support deleting an email account from Settings in this iteration, or keep the scope strictly read-only plus connect buttons?
- Do we want a second category inside Settings for "Labs" or "Experimental" flags in the near term (e.g., Apollo integration, experimental agents)?

## Handoff

- Proposed next skill: `he-plan` (implementing Settings UI + optional `GET /api/system/info`).
- Implementation will likely:
  - add a Settings route in the UI shell
  - consume `GET /api/accounts` and OAuth start routes
  - optionally add a small `system` route for config info
  - reuse existing styles and components for cards and buttons.
