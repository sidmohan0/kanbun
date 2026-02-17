---
slug: 2026-02-16-unified-sidebar-and-state
status: intake
date: 2026-02-16T10:55:00Z
owner: sid
plan_mode: lightweight
priority: medium
---

# Unified Workspace Sidebar and Persistent UI State

## Purpose / Big Picture

As Kanbun has evolved toward a people-first UX, navigation has accumulated multiple sidebars and view shells (People/Profile/Groups vs. Projects/Drafts/Settings), and view state is held in local component state. This leads to:

- inconsistent navigation (e.g., sidebar disappears when switching to Projects, Drafts, or GTM views)
- duplicated nav logic across pages
- loss of context when switching views or reloading (e.g., last selected project/contact is forgotten)

This spec defines a unified **Workspace sidebar** that is present across the entire application and a small persistent UI state layer ("something like Zustand") that remembers last-selected view, selected project/contact, and simple user preferences. The goal is to make the app feel like one continuous workspace, not a collection of loosely-linked pages.

After implementation, a user should:

- always see the same left sidebar with Workspace sections (People, Projects, Drafts, GTM, Groups, Settings) regardless of the current view
- be able to switch between sections without losing context (e.g., jump from a contact profile to Settings and back)
- have their last selected section and project remembered across reloads

## Scope

### In Scope

- Introduce a **single shared sidebar layout** used by all top-level Kanbun views:
  - People
  - Projects (Home + Dashboard entry point)
  - Drafts (Review)
  - GTM (Growth model view)
  - Groups
  - Settings
- Replace ad-hoc per-page sidebars with this shared layout where appropriate.
- Introduce a small global UI state store to track:
  - `activeView` (which section is currently open)
  - `selectedProjectId` (last project the user interacted with)
  - `selectedContactId` (last contact profile opened, if any)
  - basic preferences (e.g., last used People filters, last GTM scenario) where reasonable
- Persist this UI state to `localStorage` so that a browser reload restores the Workspace state.

### Out of Scope (for this iteration)

- URL-based routing / deep-linking (e.g., `/people/123`) — we remain on state-driven routing for now.
- Multi-user or server-side persistence of UI preferences.
- Complex settings like per-page layout customization or theming.
- Refactoring business logic; this spec is about layout and UI state only.

## Current Behavior and Problems

### Layout & Navigation Today

- People-related pages (`PeoplePage`, `ContactProfilePage`, `GroupsPage`, `SettingsPage`):
  - Implement their own sidebars with a "Workspace" header and links to People / Projects / Drafts / Groups / Settings.
  - The sidebars are very similar but implemented per page, which creates duplication and subtle inconsistencies.
- Projects overview (`Home` via `view === "projects"`):
  - Previously rendered `Home` without any sidebar; this has just been wrapped in a sidebar, but this is still an ad-hoc solution in `ui/app.tsx`.
- Project dashboard (`Dashboard`):
  - Uses `ProjectSidebar`, which lists projects and Drafts plus an optional Settings link.
  - This sidebar is project-centric, not workspace-centric; it diverges in structure and labeling from the People/Groups/Settings sidebars.
- Draft Review and GTM views (`DraftReview`, `GtmDashboard`):
  - Render their own full-screen layouts with minimal or no workspace sidebar.

The result is that the user’s mental model of "left sidebar = workspace" is broken as they move across views.

### UI State Today

- `ui/app.tsx` keeps the current view in a `useState<View>` value, with values such as `"people" | "projects" | "project" | "drafts" | "gtm" | "groups" | "settings"`.
- Selected project and selected contact are also held in component-local state:
  - `selectedProject: number | null`
  - `selectedContactId: number | null`
- Filter states (People search, tag filters, group filters) are held inside `PeoplePage` component state and reset when the user navigates away and back.
- There is no persistence across reloads: refreshing the page always returns the user to the default `"people"` view.

This is manageable while the app is small, but as more views appear, we need a central source of truth for navigation and basic preferences.

## Goals and Requirements

### R1: Unified Sidebar Layout

- There should be a single, reusable **Workspace sidebar** component, responsible for rendering:
  - App brand (Kanbun)
  - Workspace sections:
    - People
    - Projects
    - Drafts
    - GTM
    - Groups
    - Settings
  - Service status indicator (API / Apollo), as today.
- The sidebar should:
  - highlight the **active** section consistently
  - provide clear click targets to navigate between sections
  - be visible for all top-level views except possibly modal-like overlays (e.g., full-screen compose in a future iteration)

### R2: Distinct Views per Section

- Each Workspace section should map to a distinct view in the UI state, even if it renders multiple internal pages:
  - `"people"` → People list
  - `"contact_profile"` is still considered part of the People section, but we may differentiate view-submode internally
  - `"projects"` → Projects overview (Home)
  - `"project"` → Project dashboard for a specific project
  - `"drafts"` → Draft Review
  - `"gtm"` → GTM dashboard
  - `"groups"` → Groups page
  - `"settings"` → Settings
- The sidebar selection should reflect the section, not the submode:
  - When in Contact Profile, People is highlighted in the sidebar.
  - When in Project dashboard or GTM, Projects or GTM is highlighted appropriately.

### R3: Centralized UI State and Persistence

- Navigation state must be hoisted out of `App` component into a small, testable store.
- Store responsibilities:
  - Manage the current `activeView`.
  - Track `selectedProjectId` and `selectedContactId`.
  - Track small preferences like last People filter values (q/tag/group), last GTM scenario, etc. (individual preferences can be added incrementally).
- Persistence:
  - Store should write to `localStorage` on changes.
  - On initialization, store should attempt to hydrate from `localStorage` and fall back to sensible defaults.

### R4: Implementation Simplicity

- Keep the state layer lightweight and framework-aligned.
- It should be possible to use the store from any Preact component (pages, shell, sidebars) via hooks.
- Avoid forcing a switch to React or complex routing libraries in this iteration.

## Proposed Design

### 1. Shared Workspace Shell Component

Introduce a new component, e.g. `ui/components/AppShell.tsx`, responsible for:

- Rendering the Workspace sidebar.
- Providing a slot for the main content.

Rough shape:

```tsx
interface AppShellProps {
  activeSection: "people" | "projects" | "drafts" | "gtm" | "groups" | "settings";
  onNavigate: (section: AppShellProps["activeSection"]) => void;
  children: preact.ComponentChildren;
}

export function AppShell({ activeSection, onNavigate, children }: AppShellProps) {
  return (
    <div class="app">
      <div class="sidebar" style="display:flex;flex-direction:column;">
        <div style="flex:1;overflow-y:auto;">
          <div class="sidebar-brand" onClick={() => onNavigate("people")}>
            Kanbun
          </div>
          <hr ... />
          <h2>Workspace</h2>
          {(
            ["people", "projects", "drafts", "gtm", "groups", "settings"] as const
          ).map((section) => (
            <div
              key={section}
              class={`sidebar-item ${activeSection === section ? "active" : ""}`}
              onClick={() => onNavigate(section)}
            >
              <span>{labelForSection(section)}</span>
            </div>
          ))}
        </div>
        <ServiceStatus />
      </div>
      <div class="main">{children}</div>
    </div>
  );
}
```

All current top-level views (People, Projects overview, Project dashboard, Draft Review, GTM, Groups, Settings) will be rendered inside `AppShell`, with `activeSection` derived from global UI state.

### 2. Global UI Store (Zustand-style)

We will introduce a small UI state store using **Zustand's vanilla store**, which avoids a hard dependency on React and works well with Preact.

- Dependency: add `zustand` as a dependency.
- Store definition (e.g., `src/shared/ui-store.ts`):

```ts
import { createStore } from "zustand/vanilla";

export type Section = "people" | "projects" | "drafts" | "gtm" | "groups" | "settings";
export type View =
  | "people"
  | "contact_profile"
  | "projects"
  | "project"
  | "drafts"
  | "gtm"
  | "groups"
  | "settings";

export interface UiState {
  view: View;
  section: Section; // derived from view, but stored for convenience
  selectedProjectId: number | null;
  selectedContactId: number | null;
  peopleFilters: {
    q: string;
    tag: string;
    groupId: number | null;
  };
  gtmScenario: "conservative" | "base" | "aggressive";
}

export interface UiActions {
  navigateTo(section: Section): void;
  openProject(projectId: number): void;
  openContact(contactId: number): void;
  setPeopleFilters(filters: Partial<UiState["peopleFilters"]>): void;
  setGtmScenario(scenario: UiState["gtmScenario"]): void;
}

export const uiStore = createStore<UiState & UiActions>((set, get) => ({
  view: "people",
  section: "people",
  selectedProjectId: null,
  selectedContactId: null,
  peopleFilters: { q: "", tag: "", groupId: null },
  gtmScenario: "base",

  navigateTo(section) {
    const nextView: View =
      section === "people"
        ? "people"
        : section === "projects"
        ? "projects"
        : section === "drafts"
        ? "drafts"
        : section === "gtm"
        ? "gtm"
        : section === "groups"
        ? "groups"
        : "settings";
    set({ section, view: nextView });
  },

  openProject(projectId) {
    set({ section: "projects", view: "project", selectedProjectId: projectId });
  },

  openContact(contactId) {
    set({ section: "people", view: "contact_profile", selectedContactId: contactId });
  },

  setPeopleFilters(partial) {
    set({ peopleFilters: { ...get().peopleFilters, ...partial } });
  },

  setGtmScenario(scenario) {
    set({ gtmScenario: scenario });
  },
}));
```

- Preact integration: define a small hook `useUiStore` that subscribes to `uiStore` using `useSyncExternalStore` or a simple `useEffect`+`useState` pattern.
- Persistence: wrap `createStore` with a persistence layer that reads/writes to `localStorage` on changes (e.g., subscribe to the store and serialize relevant fields).

### 3. App Root Integration

`ui/app.tsx` should be refactored to:

- Use `useUiStore` to read `view`, `section`, and actions.
- Always render `AppShell`, switching its `children` based on `view`.

Pseudocode:

```tsx
function App() {
  const { view, section, navigateTo, openProject, openContact } = useUiStore();

  let content: preact.VNode;
  switch (view) {
    case "people":
      content = <PeoplePage ... />;
      break;
    case "contact_profile":
      content = selectedContactId ? <ContactProfilePage ... /> : <PeoplePage ... />;
      break;
    case "projects":
      content = <Home ... />;
      break;
    case "project":
      content = <Dashboard ... />;
      break;
    case "drafts":
      content = <DraftReview ... />;
      break;
    case "gtm":
      content = selectedProjectId ? <GtmDashboard ... /> : <Home ... />;
      break;
    case "groups":
      content = <GroupsPage ... />;
      break;
    case "settings":
      content = <SettingsPage ... />;
      break;
  }

  return (
    <AppShell
      activeSection={section}
      onNavigate={(section) => navigateTo(section)}
    >
      {content}
    </AppShell>
  );
}
```

This removes per-view wrappers and ensures the sidebar is always present for all views.

### 4. Page Components Using Store Instead of Direct State

- `PeoplePage`:
  - Should load its filter values (q/tag/group) from `uiStore.peopleFilters` on mount.
  - Should call `setPeopleFilters` when inputs change.
  - Should call `openContact(id)` when opening a profile instead of directly setting local `view`.

- `ContactProfilePage`:
  - Back to People: `navigateTo("people")` (view becomes `people`).
  - Projects/Drafts/Groups/Settings: use `navigateTo` to change sections.

- `Home` (Projects overview):
  - `onSelectProject` should call `openProject(id)`.

- `Dashboard` and `GtmDashboard`:
  - Should respect `selectedProjectId` from the store.
  - For GTM scenario selection, update `uiStore.gtmScenario` so the last scenario persists.

- `DraftReview`:
  - Back behavior can be made more predictable using `section` and `selectedProjectId` (e.g., back to project if set, else Projects overview or People).

## Risks and Mitigations

- **Risk:** Introducing global state store increases complexity.
  - Mitigation: Keep the store small and focused on navigation + a few preferences; avoid pushing domain data into it.

- **Risk:** Zustand + Preact integration might be non-trivial.
  - Mitigation: Use Zustand's vanilla store with a minimal subscription hook; avoid React-specific APIs.

- **Risk:** Persisted state might get corrupted (e.g., invalid project id).
  - Mitigation: On hydrate, validate stored IDs (e.g., if `selectedProjectId` does not exist in `/api/projects`, reset to `null` and `view` to `projects` or `people`).

## Validation and Acceptance

- **Sidebar presence:**
  - From People, Projects overview, Project dashboard, Draft Review, GTM, Groups, and Settings, the Workspace sidebar is visible and identical in structure.
  - Clicking each section label in the sidebar reliably navigates to that section.

- **State persistence:**
  - Selecting a project and contact, then reloading the page, should:
    - return the user to the last `section` and `view` (e.g., People vs Projects).
    - show the last selected project in the Dashboard if they were in project context.
  - People filters (search, tag, group) should persist across view switches and reloads.

- **Regression:**
  - `npm test` remains green.
  - Manual navigation across all sections does not produce dead ends or missing sidebars.

## Open Questions

- Do we want Draft Review to always be a distinct top-level section (like today), or should it be treated as a mode within Projects/People?
- How much of the filter and UI preferences should we persist in this first iteration (People filters and GTM scenario only, or more)?
- Should we add URL-based routing later to support deep links once the store is in place?

## Handoff

- Proposed next skill: `he-plan` to create an implementation plan for:
  - introducing the UI store and persistence
  - adding `AppShell`
  - refactoring `ui/app.tsx` and pages to use the unified shell and store.
