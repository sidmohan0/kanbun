# Changelog

Notable changes to kanbun are recorded here. New entries stay under `[Unreleased]` until release
preparation moves them to a dated version heading.

## [Unreleased]

### Added

- Added owner-managed targeted invitations, member removal and explicit re-invitation, with individual identities, admission-scoped browser storage, and HTTP/document/WebSocket authorization checks.

- Added issue status, priority, assignee, labels, and reversible archive controls, with semantic history for human status assertions and supported property changes.

- Added shareable issue details and collaborative descriptions with durable Yjs storage, offline recovery, attributed mirror events, and private-team authorization checks.

- Moved the protected application deployment hostname to kanbun.ai while retaining the existing workspace and account directory.
- Added CI-gated preview deployments, live Access and version checks, retained release receipts, and guarded rollback to the previous Worker version.

- Added a protected hosted preview with verified Cloudflare Access identity, a D1 account/workspace directory, isolated browser outboxes, same-origin assets and sync, and a deployment command tied to an exact verified commit.

- Added local main-workspace WebSocket notifications, automatic cross-browser convergence, and reconnect catch-up, with cursor-only hints, hibernation-safe connections, and real-runtime browser recovery checks.

- Added the local issue list, creation form, inline title editing, and visible sync states, with durable browser recovery and actual-app end-to-end checks.

- Added a local Cloudflare Worker and SQLite workspace Durable Object, with validated sync and branch APIs, explicit fixture identities, and real-runtime recovery checks in the devcontainer and CI.

- Added human-reviewed workspace branch merges for issue creation and renaming, with explicit conflict choices, legacy-write conflict detection, atomic numbering, and durable retry receipts.

- Added durable workspace branches for issue creation and renaming, with private ownership, write scopes, restart-safe overlays and queues, and live-main fallback for untouched rows.

- Added typed issue creation and rename events with atomic durable history, deterministic replay, scoped event reads, and retry-safe projection updates.

- Introduced the workspace model, local-first sync engine, shared mutators, deterministic seed, and branded React web shell.
- Added the locked and archived v1.0 specification.
- Added reproducible Node/pnpm setup, linting, formatting, and CI checks for tests, builds, the seed, spec locking, and changelog policy.
- Licensed the project under Apache-2.0.
- Added a deterministic verifier package, retained execution reports, and daily non-gating mechanical documentation reports.
- Added a pinned Linux devcontainer with automatic pnpm and Chromium setup, local command helpers, package-management guidance, and container execution for every repository-owned CI check.
- Added Chromium integration tests for offline IndexedDB recovery and durable mutation retries over HTTP and file-backed SQLite.

### Fixed

- Verification logs and browser traces now stay inside the devcontainer until completion, then export receipts and diagnostic artifacts on success or failure, avoiding shared-mount permission errors without suppressing failed checks or exports.
- Deployment credentials now tolerate pasted whitespace and reject malformed values without including secrets in HTTP header errors.

- Persistent clients now advance mutation IDs after server acknowledgements, save drained rejection queues, and report browser-storage failures instead of silently replacing saved state.

- Semantic event causation now resolves sync-log references to their producing events, and read-only decisions cannot mutate stored JSON through extrema queries.
- Revoked private-team memberships can no longer create or modify issues through the mutation API.
