---
slug: 2026-02-16-unified-sidebar-and-state
status: active
phase: plan
plan_mode: lightweight
detail_level: more
priority: medium
owner: sid
---

# Unified Workspace Sidebar and Persistent UI State

This Plan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, `Outcomes & Retrospective`, and `Revision Notes` current as work proceeds.

This Plan must be maintained in accordance with `docs/PLANS.md`. It implements the intent in `docs/specs/2026-02-16-unified-sidebar-and-state-spec.md`.

## Purpose / Big Picture

Navigation in Kanbun has grown organically as the Clay-style People-first UX was implemented. People/Profile/Groups/Settings have a workspace-style sidebar, but Projects, Draft Review, and GTM use different shells or no sidebar at all. State for view selection and user preferences lives in local component state and is not persisted across reloads.

This Plan unifies navigation and basic UI state so Kanbun feels like a single, coherent workspace:

- a single **Workspace sidebar** is visible across all top-level sections (People, Projects, Drafts, GTM, Groups, Settings)
- the app’s current section and view, selected project/contact, and small preferences (filters, GTM scenario) live in a central UI store
- this UI state is persisted to `localStorage`, so the user’s last context is restored after a reload

## Progress

- [ ] (2026-02-16T10:56:00Z) P1 [Design] Confirm store shape, section/view mapping, and sidebar behavior against the spec.
- [ ] (2026-02-16T10:56:00Z) P2 [Backend-neutral] Introduce a small vanilla Zustand UI store with view/section/selection state plus persistence.
- [ ] (2026-02-16T10:56:00Z) P3 [Frontend] Implement `AppShell` (shared workspace sidebar) and refactor `ui/app.tsx` to always render it.
- [ ] (2026-02-16T10:56:00Z) P4 [Frontend] Refactor People/Profile/Groups/Projects/Drafts/GTM/Settings pages to use the UI store for navigation and filters instead of local view state.
- [ ] (2026-02-16T10:56:00Z) P5 [Validation] Run tests and manually exercise navigation across all sections, including reload behavior, updating this Plan with findings.

## Surprises & Discoveries

- Observation: …
  Evidence: …

## Decision Log

- Decision: …
  Rationale: …
  Date/Author: …

## Outcomes & Retrospective

- Outcome: …
  Evidence: …
  Gaps / Follow-ups: …

## Context and Orientation

Repository root for this work: `/Users/sidmohan/Projects/kanbun/kanbun`.

Relevant pieces:

- `ui/app.tsx` currently holds:
  - `view` state (union of "people" | "contact_profile" | "projects" | "project" | "drafts" | "gtm" | "groups" | "settings") via `useState`.
  - `selectedProject` and `selectedContactId` state.
  - conditional rendering that:
    - returns standalone components for some views (e.g., `Home` for `projects`)
    - wraps others in full-layout components (`Dashboard`, `DraftReview`, `GtmDashboard` have their own shells).
- People-first pages:
  - `ui/pages/PeoplePage.tsx` (People list + CSV import + filters)
  - `ui/pages/ContactProfilePage.tsx` (contact profile)
  - `ui/pages/GroupsPage.tsx` (groups CRUD + members)
  - `ui/pages/SettingsPage.tsx` (accounts + system info)
  - Each has its own sidebar markup today, though largely similar.
- Projects & other views:
  - `ui/pages/Home.tsx` (projects overview)
  - `ui/pages/Dashboard.tsx` (project dashboard with its own `ProjectSidebar`)
  - `ui/pages/DraftReview.tsx` (draft review flow, full-width layout)
  - `ui/pages/GtmDashboard.tsx` (GTG model view)

We will:

- consolidate navigation into a single `AppShell` with a shared `Workspace` sidebar
- centralize UI state in a new "UI store" module under `src/shared/` or `ui/state/` while keeping layout concerns in `ui/`

This Plan does **not** touch backend logic or API contracts.

## Plan of Work

### 1. Design the UI store shape and section/view mapping

Purpose: decide once where and how we represent navigation and UI preferences.

Steps:

1. Define a clear mapping between sidebar sections and views as per the spec:
   - Section "people" → views `"people"` and `"contact_profile"`.
   - Section "projects" → views `"projects"` and `"project"`.
   - Section "drafts" → view `"drafts"`.
   - Section "gtm" → view `"gtm"`.
   - Section "groups" → view `"groups"`.
   - Section "settings" → view `"settings"`.

2. Decide which bits of state to include initially:
   - `view` and `section`.
   - `selectedProjectId` and `selectedContactId`.
   - People filters: `{ q, tag, groupId }` (align with current PeoplePage state).
   - GTM scenario: `"conservative" | "base" | "aggressive"`.

3. Decide on default values:
   - `section = "people"`, `view = "people"`.
   - `selectedProjectId = null`, `selectedContactId = null`.
   - People filters all empty; GTM scenario `"base"`.

Record any refinements to this shape in the `Decision Log`.

### 2. Implement vanilla Zustand UI store with persistence

Purpose: centralize UI state and make it usable from any component.

Steps:

1. Add Zustand dependency:

       cd /Users/sidmohan/Projects/kanbun/kanbun
       npm install zustand

2. Create a UI store module, e.g. `src/shared/ui-store.ts`:
   - Define types:
     - `Section`, `View`, `UiState`, `UiActions` as in the spec.
   - Use `createStore` from `zustand/vanilla` to create `uiStore`.
   - Implement actions:
     - `navigateTo(section)` sets `section` and `view` according to mapping.
     - `openProject(projectId)` sets `selectedProjectId`, `section = "projects"`, `view = "project"`.
     - `openContact(contactId)` sets `selectedContactId`, `section = "people"`, `view = "contact_profile"`.
     - `setPeopleFilters`, `setGtmScenario` update respective parts.

3. Add a small persistence layer inside `ui-store.ts`:
   - On initialization, try to read a JSON blob from `localStorage.getItem("kanbun_ui_state")`.
   - Merge any valid fields into the initial `UiState`.
   - Subscribe to store updates and save the current `UiState` (or a subset) to `localStorage` on each change.
   - Guard against JSON parse errors and invalid data by falling back to defaults.

4. Add a Preact hook for components, e.g. `ui/state/useUiStore.ts`:
   - Implement `useUiStore(selector)` using `useSyncExternalStore` or a simple custom subscription wrapper.
   - Ensure we can read both state and actions from components.

5. Add targeted unit tests (optional but recommended) for UI store logic:
   - In `src/shared/__tests__/ui-store.test.ts`, test transitions for `navigateTo`, `openProject`, `openContact`, `setPeopleFilters`, and `setGtmScenario` without persistence.

### 3. Implement `AppShell` with unified sidebar

Purpose: ensure a single, shared sidebar wraps all top-level views.

Steps:

1. Create `ui/components/AppShell.tsx`:
   - Accept props:
     - `activeSection: Section`
     - `onNavigate: (section: Section) => void`
     - `children`
   - Render:
     - left sidebar with brand, Workspace header, and sections (People, Projects, Drafts, GTM, Groups, Settings)
     - `ServiceStatus` at the bottom
     - main content area.
   - Use existing CSS classes (`.app`, `.sidebar`, `.sidebar-item`, `.sidebar-brand`, `.main`) to maintain the current look.

2. Replace the ad-hoc Projects wrapper in `ui/app.tsx` (and similar wrappers if any) with `AppShell`. After this refactor:
   - `App` should always render something like:

       ```tsx
       return (
         <AppShell activeSection={section} onNavigate={navigateTo}>
           {contentForView}
         </AppShell>
       );
       ```

3. Remove duplicate sidebar markup from `PeoplePage`, `ContactProfilePage`, `GroupsPage`, and `SettingsPage` as part of P4 (see below), so sidebar layout is not scattered.

### 4. Refactor views to use the UI store and shared shell

Purpose: align all page components with the shared navigation and state.

Steps (high level):

1. `ui/app.tsx`:
   - Replace local `useState` view/selection logic with calls to `useUiStore`.
   - Derive `view`, `section`, `selectedProjectId`, `selectedContactId` from the store.
   - Compute `contentForView` with a `switch` on `view`, passing callbacks that call store actions instead of calling `setView`/`setSelected*`.

2. People-related pages:
   - `PeoplePage`:
     - Use `useUiStore` for `peopleFilters` and `setPeopleFilters`.
     - On row click, call `openContact(id)` instead of a prop callback.
   - `ContactProfilePage`:
     - Remove direct sidebar navigation props in favor of using the shared sidebar.
     - Provide callbacks for actions that remain specific (e.g., opening project-level context if needed) but rely on `openProject` from the store rather than `setView`.

3. Projects & Drafts:
   - `Home` (projects overview) and `Dashboard`:
     - Use `openProject` for project selection.
     - The sidebar (from `AppShell`) will navigate between sections; project list remains as content.
   - `DraftReview` and `GtmDashboard`:
     - Make back behavior rely on `section` and `selectedProjectId` (e.g., if a project is selected, back goes to `view = "project"`, else `"projects"`).

4. Groups and Settings:
   - Remove per-page sidebars; rely on `AppShell`.
   - Use `navigateTo("people" | "projects" | "drafts" | "groups" | "settings")` for internal navigation.

5. Incremental strategy:
   - Start by wiring `AppShell` + store and migrating People/Projects.
   - Then migrate Drafts/GTM and finally Groups/Settings.
   - At each step, run `npm test` and a quick manual navigation check.

### 5. Validation and manual checks

Purpose: ensure the unified sidebar and persistent state behave as expected.

Steps:

1. Automated:

       cd /Users/sidmohan/Projects/kanbun/kanbun
       npm test

   Confirm all tests pass after each major refactor.

2. Manual navigation check:
   - Start dev server:

         npm run dev

   - In the browser:
     - Click through sidebar sections in this order: People → Projects → Drafts → GTM → Groups → Settings → People.
     - Ensure the sidebar remains visible and highlight moves correctly.
     - From People, open a contact profile, then navigate via sidebar to Settings and back; confirm context feels consistent.

3. Persistence check:
   - In People, set filters and open a particular contact.
   - Navigate to Projects and select a project.
   - Reload the page.
   - Expect:
     - Sidebar shows the last active section (e.g., Projects or People, depending on design decision recorded in the store).
     - `selectedProjectId` is preserved if appropriate.
     - People filters are preserved and re-applied when returning to People.

4. Document results in this Plan:
   - Update `Progress` for P5 with a timestamp.
   - Capture any unexpected behaviors in `Surprises & Discoveries`.
   - Summarize final behavior in `Outcomes & Retrospective`.

## Concrete Steps

From repo root `/Users/sidmohan/Projects/kanbun/kanbun`:

1. Add Zustand and implement `ui-store` with persistence, plus any tests:

       npm install zustand
       # create src/shared/ui-store.ts and ui/state/useUiStore.ts
       # add src/shared/__tests__/ui-store.test.ts (optional)

2. Implement `AppShell` and refactor `ui/app.tsx` to always use it:

       # add ui/components/AppShell.tsx
       # update ui/app.tsx to use UI store + AppShell

3. Refactor pages to use the store and remove duplicated sidebars:

       # update ui/pages/PeoplePage.tsx, ContactProfilePage.tsx, GroupsPage.tsx, SettingsPage.tsx
       # update ui/pages/Home.tsx, Dashboard.tsx, DraftReview.tsx, GtmDashboard.tsx

4. Run tests and manual checks:

       npm test
       npm run dev
       # then exercise navigation and reload behavior as described.

## Validation and Acceptance

This Plan is complete when:

- A single, unified sidebar appears across People, Projects, Drafts, GTM, Groups, and Settings.
- Navigation between sections is driven by a central UI store (no scattered `setView` calls in unrelated components).
- UI state (at least `view`, `section`, `selectedProjectId`, People filters, GTM scenario) persists across reloads.
- `npm test` passes.

## Idempotence and Recovery

- The UI store is additive and affects only client-side behavior; backend behavior and APIs are unchanged.
- If the store or persistence behaves unexpectedly, reverting to the prior behavior involves:
  - restoring the previous `ui/app.tsx` and page layout components
  - removing the new store and AppShell.
- The localStorage key used for UI state can be safely ignored or cleared without affecting application data.

## Artifacts and Notes

- Spec: `docs/specs/2026-02-16-unified-sidebar-and-state-spec.md`.
- Plan: `docs/plans/active/2026-02-16-unified-sidebar-and-state-plan.md` (this file).

## Interfaces and Dependencies

- UI store:
  - Exported `uiStore` vanilla store and `useUiStore` hook for Preact components.
- AppShell:
  - `AppShell` component that takes `activeSection` and `onNavigate` and wraps children with the sidebar layout.
- Dependencies:
  - `zustand` as the only new external library introduced by this Plan.

## Pull Request

- pr:
- branch:
- commit:
- ci:

## Review Findings

- Pending.

## Verify/Release Decision

- decision: pending
- date:
- open findings by priority (if any):
- evidence:
- rollback:
- post-release checks:
- owner:

## Revision Notes

- 2026-02-16T10:56:00Z: Initial Plan created from unified sidebar/state spec to introduce a centralized UI store and shared AppShell without touching backend APIs.
