---
slug: 2026-02-16-feat-clay-ui-parity
status: active
phase: plan
plan_mode: lightweight
detail_level: more
priority: high
owner: sid
---

# Lean Clay-inspired People-first UX and CRM parity for Kanbun

This Plan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, `Outcomes & Retrospective`, and `Revision Notes` current as work proceeds.

This plan must be maintained in accordance with `docs/PLANS.md`.

## Purpose / Big Picture

Kanbun already has strong outreach automation (projects, draft generation, send flow, GTM reporting), but its UI and contact management do not match a relationship-first workflow. This plan migrates the shell and core CRM interactions toward a people-first experience inspired by Clay, while preserving existing pipeline + draft logic. The result should let users find and organize people quickly, add profile context (notes/tags/social links), group them, and move smoothly into outreach from one place.

## Progress

- [x] (2026-02-16T10:11:00Z) P1 [M1] Create the plan artifact and align implementation milestones for phase gates.
- [x] (2026-02-16T10:11:00Z) P2 [M1] Add new data model and database migrations for people metadata, tags/labels, groups, and note timeline.
- [x] (2026-02-16T10:18:00Z) P3 [M1] Extend contact services and routes for search/filter/group/tags/note operations.
- [x] (2026-02-16T10:20:00Z) P4 [M1] Add API contract tests for new people/groups behaviors.
- [ ] (2026-02-16T10:11:00Z) P5 [M2] Replace shell from Home-first to people-first with compatibility entry points to project/draft/gtm flows.
- [ ] (2026-02-16T10:11:00Z) P6 [M2] Implement People list, contact profile, and inline editing for notes/tags/social links.
- [ ] (2026-02-16T10:11:00Z) P7 [M2] Implement Groups page with CRUD and membership management.
- [ ] (2026-02-16T10:11:00Z) P8 [M3] Replace CSV import with preview + row-level summary + deterministic dedupe behavior.
- [ ] (2026-02-16T10:11:00Z) P9 [M4] Run full regression checks and finalize parity acceptance against existing project/draft/GTM flows.

## Surprises & Discoveries

- No surprises yet.

## Decision Log

- Decision: Lean scope for this first iteration.
  Rationale: user asked for a lean implementation, so we defer assistant panel, reminders, and map/archive depth. We focus on People, Groups, search/filter, and import continuity.
  Date/Author: 2026-02-16T10:02:00Z, sid

- Decision: Use SQLite additive schema migrations via `applySchema`.
  Rationale: repo currently uses schema application on startup; lightweight additive migrations reduce operational risk and keep old data intact.
  Date/Author: 2026-02-16T10:02:00Z, sid

- Decision: Keep tags and groups as separate normalized tables rather than JSON blobs on contact row.
  Rationale: allows filtering/search efficiently, avoids fragile updates and enables future extension (e.g., membership metadata).
  Date/Author: 2026-02-16T10:02:00Z, sid

## Outcomes & Retrospective

- Not started.

## Context and Orientation

This repo uses:

- `src/db/schema.ts` for database tables and minimal migration logic.
- `src/services/*` for business logic.
- `src/server/routes/*` for REST endpoints consumed by the UI.
- `src/server/index.ts` for route registration.
- `ui/` for Preact pages/components.

Current contact flow:

- `POST /api/contacts` creates a contact (`ContactService.add`).
- `POST /api/contacts/import` imports rows and optionally assigns them to a project.
- `GET /api/contacts?project_id=...` returns people for that project.
- Draft generation still uses `POST /api/drafts/generate` with `mode=agent` or `mode=template` and sends using project-scoped account state.

Relevant constraints:

- Existing tests are endpoint + service-level in `src/server/__tests__` and `src/services/__tests__`.
- The UI has existing pages `Home`, `Dashboard`, `DraftReview`, `GtmDashboard` and route selection in `ui/app.tsx` with minimal state machine.

## Milestone 1 — Compatibility-safe data foundation

We first add persistence support for people profile fields, labels/tags, group memberships, and note timeline with backward-compatible behavior. After this milestone there should be no data loss from existing installs and no breaking change to project/draft APIs.

At milestone completion:

- Existing database rows remain valid.
- New tables exist:
  - `contact_groups`
  - `groups`
  - `contact_tags`
  - `contact_notes`
  - optional `contact_social_links` if needed for extensibility.
- Useful indexes exist for tag/group/search filters and joins.
- Existing routes remain functional.

## Milestone 2 — People-first shell + People/Profile surfaces

We replace the shell in `ui/app.tsx` and styles to support a people-first navigation pattern while keeping legacy project operations reachable.

At milestone completion:

- Users see a left shell with People/Projects/Drafts/GTM views by default.
- People list supports search and basic filters (tag/group/name/email/company/project).
- Selecting a person opens profile details with editable fields for:
  - notes
  - tags
  - social links/website
  - project memberships
- A path back to project operations remains obvious and fast.

## Milestone 3 — Groups + import quality of life

Build full group management and deterministic import behavior.

At milestone completion:

- Users can create/edit/delete groups.
- Users can assign/unassign contacts by group.
- CSV import gives a visible summary (inserted, duplicates, rejected, total).
- Dedup defaults to stable email matching with deterministic handling (same email always updates or skips depending on payload request).

## Milestone 4 — Regression and parity hardening

We verify existing and new workflows end-to-end.

At milestone completion:

- All existing critical paths pass (create/list projects, contact import, draft generation, draft review, draft send, GTM config).
- New endpoints are covered in tests.
- Manual acceptance scenarios show people-first flow reaching draft send without regressions.

## Plan of Work

### Data model and backend API

1. Update `src/db/schema.ts`:

   - Add migration-safe tables:
     - `groups (id, name, color, created_at, updated_at)`
     - `contact_groups (contact_id, group_id, assigned_at)`
     - `contact_tags (id, contact_id, name, created_at)`
     - `contact_notes (id, contact_id, body, created_by, created_at)`
     - optionally `contact_social_links (id, contact_id, type, value, created_at)` if storing multiple links cleanly is desired.
   - Add indexes:
     - `CREATE INDEX IF NOT EXISTS idx_groups_name ON groups(name)`
     - `CREATE INDEX IF NOT EXISTS idx_contact_groups_contact ON contact_groups(contact_id)`
     - `CREATE INDEX IF NOT EXISTS idx_contact_groups_group ON contact_groups(group_id)`
     - `CREATE INDEX IF NOT EXISTS idx_contact_tags_contact ON contact_tags(contact_id)`
     - `CREATE INDEX IF NOT EXISTS idx_contact_tags_name ON contact_tags(name)`
     - `CREATE INDEX IF NOT EXISTS idx_contact_notes_contact ON contact_notes(contact_id)`.

2. Add service layers in `src/services`:

   - Create `src/services/group.ts` with:
     - `list()`, `create(name)`, `rename(id,name)`, `remove(id)`, `assign(contactId, groupId)`, `removeFromGroup(contactId, groupId)`, `listForContact(contactId)`, `listMembers(groupId)`.
   - Extend `ContactService` in `src/services/contact.ts`:
     - `getProfile(id)` returns full profile payload (contact + tags + notes + groups + socials).
     - `setTags(id, tags[])` with deterministic upsert/delete behavior.
     - `appendNote(id, body)`.
     - `searchContacts({query,tags,groupId,projectId,stage})`.
     - `importCsv(rows, dedupeMode='email')` returning summary object instead of only contact list.
   - Optionally add `src/services/contact-profile.ts` only if responsibilities become too large.

3. Extend routes in `src/server/routes/contacts.ts` and add `src/server/routes/groups.ts`:

   - Backward-compatible list shape:
     - keep existing `GET /api/contacts`, `/api/contacts/:id`, `/api/contacts/:id/assign`, `/api/contacts/:id/stage`, `/api/contacts/import`.
   - Add query filters to `GET /api/contacts`:
     - `?q=...`, `?tag=...`, `?group_id=...`, `?project_id=...`, `?stage=...`.
   - Add profile endpoints:
     - `GET /api/contacts/:id/profile` → full people profile.
     - `PATCH /api/contacts/:id` → edit contact + profile fields.
     - `POST /api/contacts/:id/notes` → append note.
   - Add group routes in new `src/server/routes/groups.ts`:
     - `GET /api/groups`, `POST /api/groups`, `PATCH /api/groups/:id`, `DELETE /api/groups/:id`
     - `GET /api/groups/:id/contacts`, `POST /api/groups/:id/contacts`, `DELETE /api/groups/:id/contacts/:contact_id`.
   - Update `src/server/index.ts` to register `groupRoutes`.

4. Update tests:

   - `src/services/__tests__/contact.test.ts` add coverage for `searchContacts`, `setTags`, `appendNote`.
   - Add `src/services/__tests__/group.test.ts` for group CRUD + membership.
   - Add/extend `src/server/__tests__/contacts.test.ts` with filter and profile endpoints.
   - Add `src/server/__tests__/groups.test.ts` for end-to-end group membership flows.

### UI and user experience

5. Replace app shell and shared styling:

   - Update `ui/app.tsx` and `ui/styles.css` to add a shell with these top-level tabs:
     - People
     - Projects
     - Drafts
     - GTM
   - Keep `DraftReview` and `GtmDashboard` as dedicated routes/views.
   - Keep project-first controls reachable via dashboard view.

6. Implement People page:

   - Create `ui/pages/PeoplePage.tsx`:
     - Search input and chips for filters.
     - People list with name/email/company, tags, current stage badges, and assigned groups.
     - Row actions: open profile, move quick stage, quick assign to project.
   - Add lightweight routing to profile.

7. Implement Profile page:

   - Create `ui/pages/ContactProfilePage.tsx`:
     - editable fields for notes, linked contact profile metadata.
     - tag management.
     - social links display/edit.
     - group assignment panel.
     - links to project-level context + generate draft action.

8. Implement Groups page:

   - Create `ui/pages/GroupsPage.tsx`:
     - list groups, create/edit/delete.
     - group detail membership table and add/remove members by checkbox/multi-select.
     - show counts and latest activity.

9. Improve import flow:

   - Add `ui/pages/PeopleImport.tsx` or inline import control in `PeoplePage`:
     - parse CSV in browser
     - preview first N rows
     - dedupe strategy control (default email)
     - submit and render summary response (`inserted`, `skipped`, `updated`, `errors`).

10. Update existing `Dashboard.tsx` and `Home.tsx` usage:

   - Rework as project page and keep `Home` as a lightweight overview for quick counts and shortcut navigation.
   - Ensure old buttons for draft generation and accounts remain functional and visible.

## Concrete Steps

From repo root `/Users/sidmohan/Projects/kanbun/kanbun`:

1. Scaffold/update backend models and migrations:

    cd /Users/sidmohan/Projects/kanbun/kanbun
    # edit src/db/schema.ts, add migrations
    # add/modify src/services/contact.ts

    git add src/db/schema.ts src/services/contact.ts
    git commit -m "feat(db): add people profile, tags, groups, notes tables" (initial commit step)

2. Add group service and route tests:

    # implement new service + tests
    npx vitest run src/services/__tests__/contact.test.ts src/services/__tests__/group.test.ts

3. Extend server routes and run tests:

    # update contacts route + add groups route + index route registration
    npm test

4. Build people-first shell and views:

    # update ui/app.tsx, ui/styles.css, add People/ContactProfile/Groups pages + any shared components
    # wire fetch logic to the new endpoints

5. Add import UX and run project-wide tests:

    npm test
    npm run dev

6. Validate end-to-end acceptance with manual smoke checks (below).

Expected test command outputs (short):

- If passing: `npm test` returns green for all suites.
- If schema changes are broken, tests in `src/db` and `src/services/__tests__` fail with SQL column or table errors.

## Validation and Acceptance

Behavior-level checks:

- Running `npm run dev` and opening `http://localhost:7890` shows a people-first shell with working People/Projects/Drafts/GTM navigation.
- Users can create a contact in People, set at least one note and one tag, assign to a group, and see those persisted after refresh.
- Contact profile returns associated tags/groups via `GET /api/contacts/:id/profile`.
- CSV import returns a clear response shape with counts and performs deterministic dedupe by email.
- Existing project/draft flow still works:
  - generate drafts from project page
  - open review in Drafts
  - send a draft and mark it as sent.

Commands:

- `npm test` must pass with no regression in existing suites.
- `npm run dev` should not crash when opening people/project routes.
- Manual scenario:
  1. Create project and contact.
  2. Create group and assign contact.
  3. Filter people by group and search by email.
  4. Open contact profile, add a note.
  5. Generate draft from contact's project and send through Draft Review.

## Idempotence and Recovery

- Backend migrations are additive: re-running `applySchema` on an existing DB should not mutate existing rows.
- Group and tag endpoints are idempotent for assignment operations (`assign` should not create duplicates).
- If deployment is partially complete:
  - retain old `/api/contacts` behavior.
  - keep `Dashboard` fallback path available.
  - roll back by reverting only app-layer files first, then service/routing changes; database additions are additive and can remain without affecting old workflows.

## Artifacts and Notes

- `docs/specs/2026-02-16-feat-clay-ui-parity-spec.md` (scope and open decisions)
- `docs/plans/active/2026-02-16-feat-clay-ui-parity-plan.md` (this implementation plan)

## Interfaces and Dependencies

- Service interfaces:
  - `ContactService`:
    - `getProfile(contactId: number): ContactProfile`
    - `setTags(contactId: number, tags: string[]): void`
    - `appendNote(contactId: number, body: string): ContactNote`
    - `searchContacts(query?: string, filters?: ContactFilters): ContactWithContext[]`
  - `GroupService`:
    - `list(): Group[]`
    - `create(input: { name: string; color?: string }): Group`
    - `update(id: number, updates: Partial<Group>): void`
    - `remove(id: number): void`
    - `assign(contactId: number, groupId: number): void`
    - `unassign(contactId: number, groupId: number): void`

- Route contracts (new/extended):
  - `GET /api/contacts?` supports `q`, `tag`, `group_id`, `project_id`, `stage`.
  - `GET /api/contacts/:id/profile` returns profile payload.
  - `PATCH /api/contacts/:id` updates base and profile fields.
  - `POST /api/contacts/import` returns summary (`inserted`, `skipped`, `duplicates`, `errors`).
  - `GET /api/groups`, `POST /api/groups`, `PATCH /api/groups/:id`, `DELETE /api/groups/:id`.
  - `GET /api/groups/:id/contacts`, `POST /api/groups/:id/contacts`, `DELETE /api/groups/:id/contacts/:contact_id`.

## Pull Request

- pr: 
- branch: 
- commit: 
- ci:

## Review Findings

- Pending: to be populated by `he-review`.

## Verify/Release Decision

- decision: pending
- date:
- open findings by priority (if any):
- evidence:
- rollback:
- post-release checks:
- owner:

## Revision Notes

- 2026-02-16T10:11:00Z: Initialized lean implementation plan from the committed intake spec. Removed non-essential parity targets and formalized milestone sequence for low-risk migration.
