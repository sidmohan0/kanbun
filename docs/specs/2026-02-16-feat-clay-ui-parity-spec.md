---
slug: 2026-02-16-feat-clay-ui-parity
status: intake-complete
date: 2026-02-16T10:02:00Z
owner: sid
plan_mode: lightweight
spike_recommended: yes
priority: high
---

# Migrate Kanbun UI and CRM workflows toward a lean Clay-like people-first model

## Purpose / Big Picture

Kanbun needs a user interface and interaction flow that is closer to Clay’s relationship-first CRM model while keeping its existing outreach automation core (pipelines, AI draft generation/review, send flow, and GTM reporting). This is a lean iteration focused on the highest-impact parity features: people management, grouping, search/filter, import quality-of-life, and continuity to drafts, not a full feature match of every Clay surface.

## Scope

### In Scope

- Redesign `ui/` into a people-first application shell with these primary areas:
  - **People** (default/landing)
  - **Projects** (legacy outreach control)
  - **Drafts**
  - **GTM**
- Keep a left sidebar/navigation pattern with fast project switching and clear pending draft indicators.
- Add a People list surface that supports:
  - fast text search
  - project/label filtering
  - create/edit contact fields needed for relationship context
- Add contact profile details for richer CRM context:
  - notes
  - tags/labels
  - social/profile links
  - stage/project membership visibility
- Add first-class **Groups** with basic CRUD and assign/unassign operations.
- Improve CSV import handling for people operations:
  - file preview summary
  - row-level success/fail counts
  - deterministic duplicate handling
- Preserve and integrate existing workflows for:
  - project creation
  - pipeline stages
  - draft generation (agent/template)
  - draft review/send
  - GTM config/projections

### Boundaries

- We will not add Clay’s full public profile sharing or team-collaboration model in this iteration.
- We will not add a new reminder/scheduling product layer.
- We will not add a full AI command bar in this phase (basic actions remain button/form based).
- We will not rebuild email provider stacks; existing Gmail/Outlook accounts remain authoritative.

## Non-Goals

- No new billing/subscription system.
- No mobile app rewrite.
- No re-architecture of agent orchestration or MCP layer.
- No full map/archive surfaces.

## Risks

- Users may need to relearn navigation during migration from project-first to people-first workflows.
- Group assignment + pipeline movement in two places can create inconsistent assumptions if not surfaced clearly.
- Broader search/filter combinations can degrade performance without indexing if naive queries are used.
- Data migration for tags/notes/groups can create duplicates if uniqueness rules are not enforced.

## Rollout

- **Phase 1 (Foundation):** add people-first shell and navigation while keeping old routes working.
- **Phase 2 (People + Groups):** add people UI/list/search/filter, group CRUD, and profile fields.
- **Phase 3 (Import + outreach continuity):** add robust import UX and ensure project/pipeline/draft integrations still work end-to-end.
- **Phase 4 (Hardening):** compatibility checks, migration safety, and acceptance testing.

## Validation and Acceptance Signals

- Manual smoke: `npm run dev`, open `http://localhost:7890`, and verify you can move from People list → Profile → Generate draft → Draft Review → Send.
- Functional checks:
  - create contact and update notes/tags
  - create a group and assign a contact
  - filter/search people by name and tag
  - import CSV with visible row summary and duplicate result handling
  - existing projects and drafts still render and function
- Regression check: previously created projects, contacts, and drafts remain readable and link to existing APIs.
- User-visible acceptance: users can complete outreach prep without going back to the legacy home view.

## Requirements

| ID | Priority | Requirement |
|---|---|---|
| R1 | critical | Preserve all existing pipeline, draft, account, and GTM behavior with no regression. |
| R2 | high | Rework the app shell to a people-first workflow while preserving project context for sending and reporting. |
| R3 | high | Add People and Profile surfaces with search/filter + tags/notes/social fields and project context links. |
| R4 | high | Add Group CRUD and deterministic contact group assignment.
| R5 | medium | Improve CSV import experience with preview, dedupe policy, and clear per-row outcome handling.
| R6 | medium | Maintain project mode compatibility so users can still run draft generation, review, send, and GTM flows.

## Chosen Direction

This is a practical additive migration: first ship the new UI shell and data model improvements that improve core CRM usability, then rewire existing Kanbun workflows to this shell. We intentionally delay advanced Clay-like extras (AI command bar, reminders, map/archive parity) to keep risk and scope low.

## Alternatives Considered

- **Monolithic rewrite** was rejected because it would delay delivery and increase regression risk in draft/pipeline flows.
- **People-only surface** was rejected because project workflows are central and must stay visible from the same shell.
- **Full parity-first approach** was rejected because this phase targets a lean MVP and would overload implementation risk.

## Key Decisions

- People-first navigation is the default entry point in this lean iteration.
- Project mode remains a first-class tab in the shell to avoid breaking existing outreach behaviors.
- New contact metadata is additive (notes/labels/social links/groups) and stored in SQLite schema migrations.

## Open Questions

- **[research]** What CSV dedupe strategy should be the default (email-only match first, or include `first_name + last_name + company` fallback)?
- **[decision]** Are tags global across projects, or should they be project-scoped in this phase?
- **[decision]** Do we need one primary notes stream per contact or per project-contact relationship for now?

## Success Criteria

- A user can manage contacts through a people-first UI and still execute outreach from the same screen flow.
- Contacts can be searched, filtered, tagged, and grouped with visible status.
- Imported contacts show clear pass/fail counts and do not create duplicates unexpectedly.
- Draft generation + draft review + send still works after migration.
- GTM configuration and views remain accessible and accurate.

## Constraints

- Keep SQLite as the persistence layer.
- Existing destructive actions (delete/reset/assign/remove) must require explicit confirmation.
- Keep API migrations backward compatible where possible.
- Avoid introducing new infrastructure dependencies.

## Tech Preferences

- **Language/runtime:** TypeScript for server + Preact client.
- **Framework:** Hono + Preact/Vite.
- **State/data:** Add route-driven client state for UI and incremental migrations for schema.

## Reference Artifacts

- `docs/specs/artifacts/2026-02-16-feat-clay-ui-parity/clay-19-home-people.png` — people-first shell reference.
- `docs/specs/artifacts/2026-02-16-feat-clay-ui-parity/clay-101-search-people.png` — list/filter behavior reference.
- `docs/specs/artifacts/2026-02-16-feat-clay-ui-parity/clay-104-group-create.png` — groups management pattern.
- `docs/specs/artifacts/2026-02-16-feat-clay-ui-parity/clay-118-nexus-query.png` — optional future AI surface (deferred in lean scope).

## Priority

- priority: high
- rationale: Scope is reduced, but the work changes the core UX and touches core relational workflows.

## Initial Milestone Candidates

- M1: Introduce a people-first shell and preserve legacy routes via compatibility navigation.
- M2: Add People list/profile views with tags/notes/social fields and search/filter.
- M3: Implement Group CRUD and group assignment APIs/UI.
- M4: Improve CSV import UX + duplicate handling and run regression checks across existing workflow.
- M5: Validate parity checks and finalize acceptance.

## Handoff

- Proposed next skill: `he-plan`.
- Proposed plan mode: `lightweight`.
- Proceed in lean sequence: shell → people/profile/grouping → import polish → regression checks.

## Revision Notes

- 2026-02-16T10:02:00Z: Re-scoped to lean MVP per user request. Deferred advanced assistant, reminders, map/archive, and full sharing features to keep this iteration focused on people-first + grouping + workflow continuity.
