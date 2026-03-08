# ADR-0002: Auth, Connected Accounts, and Secret Management

- Status: Proposed
- Date: 2026-03-08

## Context

Kanbun is initially a personal system for a single primary operator, but it needs to connect to multiple third-party systems:

- Gmail
- Microsoft Outlook via Microsoft Graph
- Todoist

Those concerns are related but not identical:

- application authentication determines who may access Kanbun itself
- connected accounts determine which third-party accounts Kanbun may read from or act on
- secret management determines how credentials, session secrets, and provider tokens are protected

If these are not separated early, the implementation will drift into unsafe shortcuts such as treating a Gmail login as the entire permission model or storing provider tokens without clear ownership and rotation rules.

## Decision

Kanbun will adopt the following initial model:

- Kanbun is single-operator by default in the first phase
- application login is separate from connected provider accounts
- Kanbun will use a database-backed authentication system suitable for Next.js
- access to the application will be restricted by explicit allowlist and bootstrap-owner rules, not public sign-up
- Gmail, Microsoft, and Todoist integrations will be represented as connected accounts with explicit provider metadata, scopes, token state, and health state
- provider refresh tokens and other sensitive credentials will be encrypted at rest before being stored in PostgreSQL
- production secrets will live in a real secret manager; local development secrets will live in environment files outside version control

This ADR does not yet lock the exact auth library, but it does lock the model and repository constraints around it.

## Why this direction

### Single-user first is the right complexity level

The product is initially for one operator. Pretending it is multi-tenant from day one would add account, invitation, workspace, and authorization complexity before the core contact workflow exists.

At the same time, the design should avoid painting the project into a corner. A single-user-first model can later grow into multi-user or workspace support if the core tables and boundaries are clean.

### Login and provider connections are different concerns

A user being allowed into Kanbun is not the same thing as Kanbun being allowed to access a Gmail inbox or Todoist workspace.

Separating these concerns gives us:

- cleaner security boundaries
- clearer auditing
- easier provider token rotation and re-consent flows
- simpler future support for multiple connected mail accounts under one operator

### Open source requires explicit secrets discipline

Because the repository will be public, secret-handling conventions must be visible and opinionated from the start. The project should make the secure path the default path.

## Application auth model

### Initial access model

Kanbun should start in owner-mode:

- one bootstrap owner account
- no public sign-up
- optional allowlist for additional permitted identities later
- authenticated access required for all application surfaces except OAuth callback endpoints and health checks that are intentionally public

The owner-mode assumption keeps the product aligned with the personal-tool goal while avoiding fake multi-tenant abstractions.

### Authentication approach

The application should use:

- server-side session validation
- database-backed sessions
- explicit user records in PostgreSQL
- a small, well-supported Next.js auth library rather than a custom auth stack

The implementation should prefer a library with:

- mature Next.js support
- database adapter support
- OAuth support
- session hardening support
- active maintenance and broad adoption

Auth.js is the current leading candidate, but the key decision here is to use a standard library and not invent custom auth primitives.

### Identity rules

Kanbun should track a first-class application user model even in single-user mode. That user record should not be conflated with provider-specific account identifiers.

At minimum, the user model should support:

- internal user id
- email
- role
- status
- created and updated timestamps

The initial role set can stay minimal:

- `owner`
- `disabled`

## Connected account model

Connected accounts are integrations Kanbun can act through on behalf of the operator.

Each connected account should be stored separately from the application user record and should include:

- provider type
- provider account identifier
- display identity details
- granted scopes
- token metadata
- sync status
- last successful sync time
- last error state

### Provider boundaries

Each provider should be implemented behind a connector boundary with a stable internal interface. That boundary should hide provider-specific OAuth, token refresh, pagination, and webhook details from the rest of the application.

Initial providers:

- Google for Gmail-related sync and sending
- Microsoft Graph for Outlook-related sync and sending
- Todoist for task synchronization

### Ownership

Connected accounts should belong to an application user, even if there is only one user at first. This keeps data ownership explicit and makes later expansion possible without a redesign.

## Token and secret handling

### Storage rules

Sensitive values must not be stored in plaintext when durable storage is required.

The following should be encrypted at rest before insertion into PostgreSQL:

- provider refresh tokens
- provider access tokens if persisted
- webhook signing secrets if stored
- any future SMTP or API credentials

Short-lived access tokens may be cached transiently when appropriate, but durable storage should still assume encryption.

### Secret sources

Development:

- `.env.local` or equivalent ignored local env files
- seeded example env docs without real values

Production:

- platform secret manager or cloud secret store
- environment injection at runtime
- no secrets committed to the repository, CI logs, fixtures, or screenshots

### Key management

Application-level encryption should use a dedicated encryption key that is separate from session secrets and separate from provider OAuth client secrets.

This implies at least three secret classes:

- session/auth secret
- provider client credentials
- data encryption key material

## OAuth and consent principles

OAuth should be implemented with the minimum viable scopes required for the product to function.

Rules:

- request only scopes needed for the current feature set
- keep scope sets documented in `docs/references/`
- store consented scopes with the connected account record
- detect missing or downgraded scopes explicitly
- support reconnect and re-consent flows without manual database edits

For Gmail and Microsoft, provider permissions should be designed so reading contacts or messages is not coupled more broadly than needed with send capabilities.

## Session and access hardening

The implementation should assume:

- secure, httpOnly session cookies
- CSRF protection where applicable
- short enough session lifetimes for a personal admin system
- explicit invalidation on sign-out and sensitive account changes
- audit visibility for sign-in and provider-connect events

Because Kanbun will be an operational tool with access to personal communication systems, convenience should not override basic hardening.

## Local development rules

To keep open-source setup sane and safe:

- local development must work with zero real provider credentials for core app development
- provider connectors should support mocks, fixtures, or disabled mode
- the app should degrade cleanly when integrations are not configured
- sample env files should document required variables without containing secrets

This is necessary for contributors, CI, and future agent-driven testing.

## Consequences

### Positive

- Clear separation between user auth and provider connectivity
- Safer token lifecycle management
- Cleaner support for multiple connected accounts later
- Better fit for an open-source repository
- Lower chance of security shortcuts leaking into the core schema

### Costs and risks

- OAuth and token refresh flows will need to be designed early
- Encryption at rest adds operational complexity
- Local setup becomes more disciplined and less permissive
- Provider-specific consent quirks will need dedicated reference docs

## Follow-up implementation work

This ADR implies near-term follow-ups:

- choose the auth library and session adapter
- define the initial user, session, and connected account schema
- define token encryption utilities and key-loading rules
- document Gmail, Microsoft Graph, and Todoist scopes
- define mock and fixture strategy for local development and CI

## Related ADRs

- [ADR-0001: Foundation for Kanbun](./0001-foundation.md)
