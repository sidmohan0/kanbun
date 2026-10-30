# Changelog

Notable changes to kanbun are recorded here. New entries stay under `[Unreleased]` until release
preparation moves them to a dated version heading.

## [Unreleased]

### Added

- Added typed issue creation and rename events with atomic durable history, deterministic replay, scoped event reads, and retry-safe projection updates.

- Introduced the workspace model, local-first sync engine, shared mutators, deterministic seed, and branded React web shell.
- Added the locked and archived v1.0 specification.
- Added reproducible Node/pnpm setup, linting, formatting, and CI checks for tests, builds, the seed, spec locking, and changelog policy.
- Licensed the project under Apache-2.0.
- Added a deterministic verifier package, retained execution reports, and daily non-gating mechanical documentation reports.
- Added Chromium integration tests for offline IndexedDB recovery and durable mutation retries over HTTP and file-backed SQLite.

### Fixed

- Revoked private-team memberships can no longer create or modify issues through the mutation API.
