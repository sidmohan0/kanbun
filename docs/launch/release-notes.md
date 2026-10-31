# Initial source release — draft notes

Kanbun is a local-first issue tracker with collaborative descriptions, discussion, and GitHub
context. This draft describes the current implementation and its operating boundaries. The
publication receipt will identify the qualified source commit and any assigned release tag.

## Included capabilities

- Issue creation and editing, status, priority, assignee, labels, reversible archive controls,
  sub-issues, dependencies, search, combined filters, list and board views.
- Optimistic browser updates, persisted pending mutations, cross-browser synchronization, and
  tested retry and reconnect behavior.
- Collaborative Yjs descriptions, attributed comments and replies, thread resolution, issue
  activity, and a personal inbox for assignments, mentions, replies, and followed discussion.
- Owner-managed invitations and membership, native email-link sign-in, and access checks across
  HTTP synchronization, descriptions, and WebSocket notifications.
- Optional GitHub App integration for selected repository context, linked pull requests,
  branches, current-commit reviews, and CI signals.
- Durable workspace branch APIs for the documented issue operations, merge conflict choices,
  and retry receipts.
- Private coherent recovery bundles covering directory records, workspace SQL, and collaborative
  bodies, with validated restoration into isolated storage.
- A pinned development container, retained verification evidence, and explicit public-launch
  criteria covering installation, operations, documentation, security, and review.

See the [README](../../README.md), [evaluation walkthrough](../evaluation.md), and
[changelog](../../CHANGELOG.md#unreleased) for the feature scope and supporting references.

## Installation and evaluation

The [local quickstart](../local-worker.md) runs the application in the devcontainer with synthetic
fixture identities. Its maintained lifecycle rehearsal covers initialization, issue operations,
stop/restart, container replacement, and deliberate reset with isolated local data.

The official deployment button starts the Cloudflare setup flow. Initial public identity keys are
omitted so the wizard does not require blank identity inputs. Disable preview builds in the wizard
and supply real private provider credentials directly to the isolated Worker when available.
The setup shell keeps sign-in and workspace access disabled until installer-owned settings and
provider secrets are configured.
Follow the [Cloudflare installation guide](../cloudflare-deployment.md) for Worker resources,
the owner identity, a verified email sender, Turnstile, and the optional GitHub App.

Use synthetic data for evaluation and complete the relevant live-account rehearsals before team
adoption. An authorized existing account can host dedicated rehearsal resources; the receipt
identifies account reuse and resource isolation. This does not imply separate-account or
separate-organization approval proof. The [operating overview](../operations-overview.md) describes
service responsibilities, cost drivers, upgrades, backup retention, credential rotation, and teardown.

## Current limitations

- Hosted admission is invitation-only and uses the configured owner and eligible email domain.
  Public self-service registration is outside the implemented scope.
- An already open authenticated page can retain queued edits during an outage. A hosted cold
  start or reload requires connectivity and authentication before reopening cached workspace data.
- Autonomous agent execution, branch-review UI, evidence-derived status, broader planning views,
  external notification delivery, and general-purpose tracker import/export remain planned.
- Semantic event replay covers the documented migrated commands. Other mutations retain their
  legacy path during the incremental migration.
- Workspace branch support is limited to the documented command set. GitHub observations do not
  automatically change a person's issue status.
- Recovery bundles require compatible Kanbun source and schemas. Restoration targets must be
  isolated and empty; archived sessions and authentication handshakes are cleared. Existing
  backup bundles have no automatic retention deletion.
- This initial source release has no established prior public-release upgrade compatibility
  baseline. Data-affecting updates require a populated-data rehearsal and compatibility review;
  code rollback preserves data and does not reverse database migrations.
- The 5,000-issue performance fixture is synthetic. Hosted throughput, real-team cost, and
  organization-wide operating suitability require installation-specific measurements.
- The application depends on Cloudflare runtime services. The browser also requests Inter and
  Shippori Mincho from Google Fonts; operators should include that request in their privacy review.

## Qualification and publication

Use the [launch-readiness report](../launch-readiness.md) for the candidate's actual outcomes,
retained evidence, and unresolved requirements. A full devcontainer verification receipt covers
the tested source and environment. Independent provider setup, publication decisions, and release
identity have their own acceptance criteria.

The project source is licensed under [Apache-2.0](../../LICENSE). Dependencies retain their
upstream licenses; the [third-party inventory](../../THIRD_PARTY_NOTICES.md) describes the current
components and artifact-specific notice responsibilities. Security reporting and support scope
are documented in [SECURITY.md](../../SECURITY.md) and [SUPPORT.md](../../SUPPORT.md).
