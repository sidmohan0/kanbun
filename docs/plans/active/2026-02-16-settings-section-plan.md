---
slug: 2026-02-16-settings-section
status: active
phase: plan
plan_mode: lightweight
detail_level: more
priority: medium
owner: sid
---

# Settings section for accounts and system configuration

This Plan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, `Outcomes & Retrospective`, and `Revision Notes` must be kept up to date as work proceeds.

This Plan must be maintained in accordance with `docs/PLANS.md` (from the Kanbun repo root: `docs/PLANS.md`). It implements the intent in `docs/specs/2026-02-16-settings-section-spec.md`.

## Purpose / Big Picture

Kanbun now has a people-first shell and richer CRM surfaces, but there is no single, obvious place to manage email connections or inspect basic system configuration. Email accounts are surfaced only on the project dashboard, and errors like missing OAuth env vars are hard to understand.

This Plan adds a **Settings** section to the app shell with an initial focus on:

- **Email & Integrations**: list connected Gmail/Outlook accounts and provide a centralized entry point to start the OAuth flows.
- **System**: show read-only runtime configuration details (version, port, DB path, OAuth env status) to make troubleshooting easier.

After this Plan, users should know where to go to understand and manage their email connections, and have a clear, non-technical explanation when configuration is incomplete.

## Progress

Use timestamps in ISO format (UTC) and keep this list accurate at every stopping point.

- [ ] (2026-02-16T10:30:00Z) P1 [Design] Confirm scope and UX for Settings (navigation, Email & Integrations, System), referencing the spec.
- [ ] (2026-02-16T10:30:00Z) P2 [Backend] Add a small `GET /api/system/info` endpoint exposing version, port, DB path, and OAuth env status, with tests.
- [ ] (2026-02-16T10:30:00Z) P3 [Frontend] Add Settings to the shell navigation in `ui/app.tsx` and shared styles, preserving existing People/Projects/Drafts/GTM flows.
- [ ] (2026-02-16T10:30:00Z) P4 [Frontend] Implement Settings page with Email & Integrations card and System card, wired to `/api/accounts` and `/api/system/info`.
- [ ] (2026-02-16T10:30:00Z) P5 [Validation] Run tests, exercise Settings manually (including misconfigured env case), and update this Plan with outcomes.

## Surprises & Discoveries

Document unexpected behaviors, bugs, or insights discovered during implementation.

- Observation: …
  Evidence: …

## Decision Log

Record each decision that affects implementation or scope.

- Decision: …
  Rationale: …
  Date/Author: …

## Outcomes & Retrospective

Summarize outcomes and lessons learned as milestones complete.

- Outcome: …
  Evidence: …
  Gaps / Follow-ups: …

## Context and Orientation

This Plan operates within the Kanbun app hosted under `/Users/sidmohan/Projects/kanbun/kanbun`.

Key elements relevant to Settings:

- **Backend**
  - `src/server/index.ts` wires the Hono app and registers route groups under `/api/*`.
  - `src/server/start.ts` starts the server (`npm run dev`), now importing `dotenv/config` so `.env` is loaded for development.
  - `src/server/routes/accounts.ts` defines:
    - `GET /api/accounts` → list email accounts.
    - `GET /api/accounts/:id` → fetch a specific account.
    - `POST /api/accounts` → create an account.
    - `GET /api/accounts/oauth/:provider/start` → initiate Gmail or Outlook OAuth, checking env vars and redirecting or returning an error JSON.
  - `src/services/email-account.ts` provides persistence for email accounts in the `email_accounts` table.
  - There is currently **no** dedicated system/diagnostics route; system behavior (port, DB path, env loading) is implicit in `src/server/start.ts` and `electron/main.ts`.

- **Frontend**
  - `ui/app.tsx` contains the main Preact app shell and state machine. It currently supports:
    - `PeoplePage` as the default view.
    - `ContactProfilePage`, `GroupsPage`, `Home` (Projects), `Dashboard` (project view), `DraftReview`, and `GtmDashboard`.
  - Navigation is sidebar-oriented in the People/Profile/Groups pages (People / Projects / Drafts / Groups) and project-oriented in `Dashboard` using `ProjectSidebar`.
  - `ui/styles.css` includes shared layout styles (`.app`, `.sidebar`, `.main`, `.info-card`, buttons), as well as People/Profile/Groups-specific styles.
  - There is currently no Settings page or Settings navigation item.

- **Spec for this feature**
  - `docs/specs/2026-02-16-settings-section-spec.md` describes the desired behavior:
    - Settings sidebar entry.
    - Email & Integrations card showing accounts and connect buttons.
    - System card with version, port, DB path, and OAuth env status.
    - Read-only treatment of environment-based configuration.

Assumptions for this Plan:

- We continue to treat Kanbun as a single-user desktop-style app, not a multi-tenant web service.
- Modifying `.env` remains an external, manual step; the app only needs to **display** configuration state.
- `npm test` is the canonical test command; `npm run dev` starts the server on `KANBUN_PORT` (default 7890).

## Plan of Work

This section describes the sequence of edits and additions required to implement Settings in a safe, incremental way.

### 1. Backend: `GET /api/system/info`

Purpose: provide a simple, testable JSON payload with system info the Settings page can display.

Steps:

1. Create a new route module `src/server/routes/system.ts`:
   - Export `systemRoutes(db: Database.Database)` returning a Hono router.
   - Implement `GET /` (mounted as `/api/system` from `createApp`):
     - Derive `version` from `process.env.KANBUN_VERSION` if set, else fall back to reading `package.json` via a small helper (read once and cache).
     - Derive `port` from `process.env.KANBUN_PORT ?? 7890`.
     - Derive `db_path` from `process.env.KANBUN_DB_PATH` if present; otherwise return the default path that `getDb()` uses (we can either import a helper from `src/db/index.ts` or duplicate the logic in a small, side-effect-free function).
     - Compute OAuth status:
       - Gmail: check for `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` in `process.env`.
       - Outlook: check for `OUTLOOK_CLIENT_ID`, `OUTLOOK_TENANT_ID`, `OUTLOOK_REDIRECT_URI`.
       - For each provider, return `{ configured: boolean; missing: string[] }`.
     - Response shape:
       - `{ version: string | null; port: number; db_path: string | null; oauth: { gmail: { configured: boolean; missing: string[] }, outlook: { configured: boolean; missing: string[] } } }`.

2. Wire the system routes in `src/server/index.ts`:
   - Import `systemRoutes`.
   - Add `app.route("/api/system", systemRoutes(db));` before the static file handler.

3. Add tests for the new route in `src/server/__tests__/system.test.ts`:
   - Use an in-memory DB and `createApp(db)` as in other tests.
   - Ensure different env setups are respected by temporarily manipulating `process.env` within the test (and restoring afterward):
     - Case 1: no OAuth env vars → `oauth.gmail.configured` and `oauth.outlook.configured` are `false`, with full missing lists.
     - Case 2: all Gmail vars present → `oauth.gmail.configured` is `true` and `missing` is empty.
     - Verify `port` equals `Number(process.env.KANBUN_PORT ?? 7890)`.
     - Optionally verify `db_path` returns non-null (we may need to set `KANBUN_DB_PATH` for a deterministic value).

4. Run targeted tests:

       cd /Users/sidmohan/Projects/kanbun/kanbun
       npx vitest run src/server/__tests__/system.test.ts

   Fix any failures and keep the test fast and deterministic.

### 2. Frontend: add Settings view and shell integration

Purpose: expose Settings via the shell with minimal disruption to existing navigation.

Steps:

1. Create `ui/pages/SettingsPage.tsx`:
   - Use `useState` / `useEffect` to fetch:
     - `GET /api/accounts` → list of email accounts.
     - `GET /api/system` → system info as defined above.
   - UI structure inside `.main`:
     - Header: `Settings` title and a short description.
     - **Email & Integrations** card:
       - Show accounts in a simple list or table with provider, email address, display name.
       - Buttons: "Connect Gmail" and "Connect Outlook" which call `window.open("/api/accounts/oauth/gmail/start", "_blank")` and the Outlook equivalent.
       - If `system.oauth.gmail.configured` is `false`, show a small warning listing missing vars.
       - Same for Outlook.
     - **System** card:
       - Show `version`, `port`, and `db_path` from `/api/system`.
       - Show OAuth status badges (Configured / Missing) for Gmail and Outlook.
       - A small note: "To change these values, edit your `.env` file and restart Kanbun.".

2. Add basic styles in `ui/styles.css`:
   - Reuse existing `.info-card`, `.field-label`, `.btn`.
   - Optionally add `.settings-header` and specific classes if needed, but keep it minimal.

3. Integrate Settings into `ui/app.tsx`:
   - Import `SettingsPage`.
   - Extend the `View` union type to include `"settings"`.
   - In the People/Profile/Groups sidebar layouts, add a `Settings` item that sets the view to `"settings"` when clicked.
   - Add a branch in the App component:
     - When `view === "settings"`, render `<SettingsPage onShowPeople={() => setView("people")} />` (and any other callbacks if needed).
   - Ensure Settings is reachable without breaking existing flows:
     - From People/Profile/Groups sidebars.
     - Optionally from the project sidebar (`ProjectSidebar`) as a bottom link.

4. Ensure navigation remains consistent:
   - From Settings, provide at least a link back to People (or a generic "Back" / "Close" to People) so users can easily return to their primary workflows.

### 3. Frontend: align sidebars to include Settings

Purpose: keep Settings discoverable regardless of which view is active.

Steps:

1. Update People/Profile/Groups sidebar implementations (`ui/pages/PeoplePage.tsx`, `ui/pages/ContactProfilePage.tsx`, `ui/pages/GroupsPage.tsx`):
   - Add a `onShowSettings` callback prop where appropriate.
   - Add a `Settings` item in the `Workspace` list that calls this callback.

2. Update `ui/app.tsx` to pass `onShowSettings={() => setView("settings")}` into these pages.

3. Optionally update `ui/components/ProjectSidebar.tsx`:
   - Add an optional `onOpenSettings` prop.
   - Render a `Settings` entry at the bottom that calls `onOpenSettings`.
   - Wire this in `Dashboard` so that, when called, the app sets `view` to `"settings"`.

### 4. Validation and manual checks

Purpose: prove that Settings works and does not regress existing behavior.

Steps:

1. Automated tests:
   - Run full test suite:

         cd /Users/sidmohan/Projects/kanbun/kanbun
         npm test

   - Confirm all server and service tests pass, including the new `system.test.ts`.

2. Manual dev validation (with env vars configured):
   - Ensure `.env` includes valid Gmail/Outlook OAuth values.
   - Start the dev server:

         npm run dev

   - Open `http://localhost:7890` in a browser.
   - Verify:
     - People view loads.
     - Settings is present in the sidebar.
     - Settings → Email & Integrations shows any existing accounts and the Connect buttons.
     - Clicking Connect Gmail/Outlook opens OAuth in a new tab.
     - System card shows the expected port, DB path, and reports OAuth as Configured.

3. Manual misconfiguration scenario:
   - Temporarily comment out or remove one of the OAuth env vars in `.env` (e.g. `GOOGLE_CLIENT_SECRET`).
   - Restart the dev server.
   - Open Settings and confirm:
     - System card shows Gmail as Missing and lists `GOOGLE_CLIENT_SECRET`.
     - Connect Gmail still calls the route; the initiation may fail, but the Settings card now explains why.
   - Restore the env var after testing.

4. Regression scan:
   - Quickly exercise:
     - People → Profile → Groups navigation.
     - Projects → Dashboard → Drafts → GTM.
   - Ensure adding Settings did not break the shell routing.

## Concrete Steps

From the repo root `/Users/sidmohan/Projects/kanbun/kanbun`:

1. Implement backend system info route and tests:

       cd /Users/sidmohan/Projects/kanbun/kanbun
       # add src/server/routes/system.ts and src/server/__tests__/system.test.ts
       # wire systemRoutes in src/server/index.ts
       npx vitest run src/server/__tests__/system.test.ts

2. Implement Settings UI and shell integration:

       # add ui/pages/SettingsPage.tsx
       # update ui/app.tsx, ui/styles.css
       # add Settings entries in People/Profile/Groups sidebars (and optionally ProjectSidebar)

3. Run the full test suite and manual checks:

       npm test
       npm run dev
       # then open http://localhost:7890 and exercise Settings as described.

## Validation and Acceptance

The Plan is complete when the following are true:

- **Navigation**
  - A "Settings" item exists in the sidebar and is reachable from People/Profile/Groups and Projects (directly or via the app shell).
- **Email & Integrations**
  - Settings shows existing email accounts via `GET /api/accounts`.
  - "Connect Gmail" and "Connect Outlook" open the correct OAuth start URLs.
  - When env vars are missing, Settings clearly indicates which keys are missing instead of forcing the user to infer from raw JSON errors.
- **System**
  - Settings shows the app version, current server port, and DB path.
  - OAuth configuration status in Settings matches the actual env var setup.
- **Regression**
  - `npm test` passes with all suites.
  - People/Projects/Drafts/GTM flows behave as before, with no new navigation dead ends.

## Idempotence and Recovery

- The new `/api/system` endpoint is read-only and safe to call repeatedly.
- Adding the Settings view and navigation links is non-destructive; reverting consists of removing the new route, page, and nav items.
- If a deploy is partially updated (backend without frontend or vice versa), the system remains functional:
  - If backend route exists but UI does not, it has no user-visible impact.
  - If UI tries to call `/api/system` and it does not exist, the Settings page should handle the error gracefully (e.g., show a simple "System info unavailable" message) and the rest of the app still works.

## Artifacts and Notes

- Spec: `docs/specs/2026-02-16-settings-section-spec.md`.
- Plan: `docs/plans/active/2026-02-16-settings-section-plan.md` (this file).
- New route: `src/server/routes/system.ts` (planned).
- New page: `ui/pages/SettingsPage.tsx` (planned).

## Interfaces and Dependencies

- New backend route:
  - `GET /api/system` → returns:

        {
          version: string | null;
          port: number;
          db_path: string | null;
          oauth: {
            gmail: { configured: boolean; missing: string[] };
            outlook: { configured: boolean; missing: string[] };
          };
        }

- Existing backend routes used:
  - `GET /api/accounts` → list email accounts for Settings.
  - `GET /api/accounts/oauth/:provider/start` → initiate Gmail/Outlook OAuth flows.

- Frontend contracts:
  - `SettingsPage` will expect `/api/accounts` and `/api/system` to respond with JSON in the shapes described above.
  - Shell navigation in `ui/app.tsx` must support a new `"settings"` view and keep People/Projects/Drafts/GTM views intact.

## Pull Request

- pr:
- branch:
- commit:
- ci:

## Review Findings

- Pending: to be populated by review tooling or human review.

## Verify/Release Decision

- decision: pending
- date:
- open findings by priority (if any):
- evidence:
- rollback:
- post-release checks:
- owner:

## Revision Notes

- 2026-02-16T10:30:00Z: Initial Settings Plan created from the intake spec to add a Settings section with Email & Integrations and System cards, plus a small `/api/system` backend route. Scope is intentionally lean and read-only for configuration values.
