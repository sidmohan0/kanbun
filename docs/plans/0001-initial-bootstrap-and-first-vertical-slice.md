# Initial Bootstrap and First Vertical Slice

## Purpose

This plan translates the current ADRs and product specs into a concrete implementation sequence.

It is intentionally biased toward:

- small, reviewable milestones
- a real running application early
- mock-friendly UI bootstrap
- durable foundations before provider complexity

## Planning assumptions

This plan assumes the repository will implement:

- Next.js application
- Tailwind CSS
- `shadcn/ui`
- PostgreSQL
- Drizzle ORM
- Graphile Worker

These assumptions come from the current ADR set.

## High-level milestone order

1. repository bootstrap
2. frontend foundation
3. backend foundation
4. first vertical slice
5. integration groundwork

The first vertical slice should land before real Gmail, Microsoft, or Todoist integrations.

## Milestone 1: Repository Bootstrap

### Goal

Create a working repository with deterministic local commands, basic CI, and a clean app/worker structure.

### Deliverables

- Next.js app scaffold
- Tailwind configured
- `shadcn/ui` initialized
- package manager and workspace conventions established
- Docker Compose for PostgreSQL
- environment file examples
- baseline lint, format, and typecheck commands
- baseline test runner setup
- initial GitHub templates and CI

### Recommended structure

- `apps/web/` or a root app directory for the Next.js application
- `packages/` only if shared code emerges quickly enough to justify it
- `src/` organized by domain and UI layers, not by file type alone
- `components/`, `lib/`, `db/`, `jobs/`, and `app/` organized deliberately

### Verification gate

This milestone is complete when:

- a new contributor can clone the repo and start local services with documented commands
- the app boots locally
- CI can run formatting, linting, and typechecking
- no product behavior is implemented yet beyond foundation shells

## Milestone 2: Frontend Foundation

### Goal

Implement the shared UI shell and design-token system before building product-specific screens deeply.

### Deliverables

- CSS variables and theme tokens
- typography setup
- customized base `shadcn/ui` primitives
- `AppShell`, `SidebarNav`, `PageHeader`, `SectionHeader`
- `Home`, `Contacts`, `Contact`, `Sequences`, `Tasks`, and `Settings` shell routes
- mock data patterns for rendering the main views

### Priority components

- Button
- Input
- Textarea
- Badge
- Dialog
- Sheet
- Table
- EmptyState
- StatusBadge
- FilterBar

### Verification gate

This milestone is complete when:

- the app shell feels intentional and visually coherent
- tokens are in use instead of ad hoc values
- the first screens can be rendered with mock data
- the UI no longer looks like default `shadcn`

## Milestone 3: Backend Foundation

### Goal

Set up the database, auth, migrations, and worker scaffolding without yet taking on real provider integrations.

### Deliverables

- Drizzle schema structure
- initial migrations
- local migration workflow
- Auth.js or chosen auth implementation
- bootstrap owner-access flow
- connected-account schema
- Graphile Worker setup
- job runner process
- structured logging baseline
- audit-event schema skeleton

### Initial schema targets

- users
- sessions
- connected_accounts
- contacts
- contact_identities
- contact_sources
- tasks
- sequences
- sequence_enrollments
- audit_events

### Verification gate

This milestone is complete when:

- a local database can be bootstrapped from migrations alone
- the app supports authenticated owner access
- the worker can start and process a trivial internal job
- core schema objects exist for the first slice

## Milestone 4: First Vertical Slice

### Goal

Deliver one real end-to-end workflow that proves the architecture and the product model.

### Recommended first slice

CSV import to canonical contact to contact workspace to manual follow-up task.

This is the best first slice because it exercises:

- ingestion
- contact creation and unification
- contact detail UI
- internal tasks
- the queue and job model

without depending on real provider APIs yet.

### Deliverables

- CSV upload UI
- basic column mapping UI
- import record creation
- import-processing worker job
- canonical contact creation and conservative merge behavior
- contacts list
- contact detail view
- manual follow-up creation from the contact page
- tasks list showing created follow-ups

### Verification gate

This milestone is complete when an operator can:

1. upload a CSV
2. see an import summary
3. open resulting contacts
4. create a follow-up
5. see that follow-up in the tasks queue

## Milestone 5: Integration Groundwork

### Goal

Prepare the product for real provider integrations after the first slice proves the system shape.

### Deliverables

- integration settings UI
- connected-account management screens
- provider mock adapters and fixtures
- scope/reference docs for Gmail, Microsoft Graph, and Todoist
- degraded-state UI for disconnected or unhealthy providers

### Verification gate

This milestone is complete when:

- the product can represent connected accounts and their health state
- provider adapters can be developed against local mocks and fixtures
- real provider work can begin without schema churn

## Implementation order inside each milestone

Within a milestone, prefer this order:

1. schema or contract
2. core library or shared primitive
3. thin UI surface
4. worker or orchestration path if needed
5. tests
6. docs update

This keeps changes legible and prevents UI-only or schema-only dead ends.

## Pull request strategy

Prefer PRs that map to one outcome each.

Good examples:

- initialize Next.js, Tailwind, and `shadcn/ui`
- add design tokens and app shell
- add Drizzle migrations and local DB workflow
- add owner auth bootstrap
- add contact schema and contacts list shell
- add CSV import artifact and upload flow
- add import-processing worker
- add contact detail and follow-up creation

Avoid giant “bootstrap everything” changes.

## Test strategy by phase

### Bootstrap phase

- lint
- typecheck
- smoke route rendering

### Backend foundation phase

- migration tests
- auth flow tests
- worker smoke tests

### First slice phase

- CSV parsing and mapping tests
- merge-rule tests
- contact creation tests
- follow-up creation tests
- minimal end-to-end route and action coverage

## Open questions to resolve during implementation

These do not block bootstrap, but should be settled as code lands:

- exact font choices
- exact token values and accent family
- precise route structure in Next.js app router
- exact Drizzle file layout
- exact Graphile Worker task organization

## Recommended immediate next coding sequence

When coding starts, the first sequence should be:

1. initialize the app and repo tooling
2. add design tokens and shell
3. add local Postgres and Drizzle
4. add auth bootstrap
5. add core contact schema
6. add CSV import skeleton
7. add contact list and detail views
8. add follow-up creation and task queue

## Success criteria for the overall bootstrap

The bootstrap is successful when:

- the repo is pleasant to work in
- the UI has a coherent visual baseline
- the core schema is real and migration-driven
- one complete operator workflow works end to end
- real provider integrations can be added without redesigning the system

## Related docs

- [ADR Index](../adr/README.md)
- [Frontend Foundation Spec](../product/frontend-foundation-spec.md)
- [Contact Ingestion and Unification](../product/contact-ingestion-and-unification.md)
- [Contact Workspace](../product/contact-workspace.md)
- [Follow-Ups and Task Management](../product/follow-ups-and-task-management.md)
