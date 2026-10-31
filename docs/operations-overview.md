# Operating your Kanbun installation

Choose a responsible operator and record the installation's source commit, configuration, resource
names, owner identity, and provider accounts. Start with synthetic data and follow the
[Cloudflare installation guide](cloudflare-deployment.md). The existing maintainer preview uses
its own [runbook](operations.md); its resource identifiers are specific to that installation.

## Services and data

| Service                                | Purpose and responsibility                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Cloudflare Worker and static assets    | Serve the application and authenticated APIs; maintain routes, deployment credentials, and logs.           |
| Workspace and Document Durable Objects | Hold workspace SQL and collaborative description state; preserve namespace identity during upgrades.       |
| D1                                     | Store directory, membership, invitation, and authentication records.                                       |
| Private R2 bucket                      | Store complete recovery bundles; manage access, retention, and storage cost.                               |
| Resend                                 | Deliver sign-in mail through your verified sender domain; maintain delivery configuration and credentials. |
| Turnstile                              | Verify sign-in requests; configure the actual hostname and server secret.                                  |
| GitHub App, optional                   | Read selected repository metadata and receive signed webhooks; manage installation scope and keys.         |
| Google Fonts                           | The browser requests Inter and Shippori Mincho; include this external request in your privacy review.      |

Application data includes issues, descriptions, discussions, membership, provider metadata, and
browser queues. Cloudflare account jurisdiction and resource settings, provider logs, email
delivery, and browser storage all contribute to the deployment's data handling. Confirm these
settings against your organization's requirements. This project makes no blanket data-residency
or regulatory-compliance claim.

## Costs and capacity

Review provider plans and prices before provisioning. Costs depend on Worker requests and CPU,
Durable Object operations and storage, D1 queries and storage, R2 retained bundles and operations,
email volume, and any paid GitHub or Cloudflare features you select. Backup bundles are retained
without automatic deletion, so storage can grow over time.

Use the current [Cloudflare developer pricing](https://www.cloudflare.com/plans/developer-platform/)
and [Resend pricing](https://resend.com/pricing), confirm account eligibility for every binding in
the install guide, and configure provider budgets/alerts where available. Measure your actual
workload before estimating ongoing spend. The synthetic 5,000-issue fixture provides a local
acceptance workload; it supplies no hosted throughput or cost guarantee.

## Updates and rollback

1. Record the deployed source commit and take a complete backup before a data-affecting update.
2. Read the change's release notes, migration files, configuration changes, and compatibility
   requirements. Test the candidate against an isolated copy with representative data.
3. Run the complete devcontainer verifier, then follow the supported deployment procedure for
   that candidate. Apply only its reviewed migrations.
4. Check anonymous data denial, owner sign-in, existing issue and description reads, a new write,
   member access, and backup health after deployment.

Code rollback keeps current databases and Durable Object state. It does not reverse migrations.
Only use a prior version that is compatible with the current storage and authentication state.
Schema, namespace, and authentication transitions need a reviewed migration/recovery plan.
The maintainer preview's automatic release guard rejects these transitions for ordinary code
releases. Independently installed deployments must perform the same compatibility review.

There is no published cross-release upgrade compatibility promise yet. Record a rehearsal against
the prior release you intend to support in the [launch evidence](launch-readiness.md). An
empty-database installation establishes initial setup behavior.

## Backups, restore, and retention

Follow the [backup and isolated restore procedure](data-recovery.md). A complete manifest validates
its parts and source/schema identity. Preserve workspace, directory, and description state
together. Test restoration into empty isolated namespaces before relying on the installation for
real work. Restored sessions and authentication handshakes are deliberately cleared; sign in again
and recheck permissions.

Set an organizational retention policy and implement deletion only after validating backup age,
completeness, and restore requirements. The application currently performs no automatic retention
deletion. Raw SQL dumps and independently selected point-in-time bookmarks do not establish a
coherent cross-store recovery point.

## Routine checks and credential rotation

Check availability, recent deployment state, anonymous API denial, owner/member workflows,
email delivery, and recent complete backup manifests. Public health probes cover only their
documented boundaries; schedule a real authenticated workflow check according to your team's
operating needs.

Keep credentials in provider secret stores. Inventory deployment tokens, Resend keys, the
Turnstile server secret, and optional GitHub App keys/webhook secrets with their owners and expiry.
Rotate each through its provider, update the Worker or CI secret store, exercise its affected flow,
then revoke the old credential. Keep old secret values out of Git and retained evidence. Suspected
compromise also requires reviewing sessions, invitations, provider access, and affected data.

## Export and teardown

General-purpose import/export tooling is planned. A recovery bundle needs compatible Kanbun code;
confirm your data-exit requirements before adoption. Any migration to another tracker needs a
separately scoped mapping and validation.

For a disposable installation, stop deployment automation and user writes, capture and validate
the final backup, retain its matching source, and record an isolated restore result. Revoke App
installations and provider credentials, remove routes and the Worker, and separately remove the
installation's D1, R2, and Durable Object data only after confirming ownership and retention
requirements. Cloud resource deletion can permanently remove data. Use the provider inventory to
avoid removing shared services or another installation's resources.
