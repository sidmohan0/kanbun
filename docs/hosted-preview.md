# Protected hosted preview

The preview serves the React app and workspace APIs from one Cloudflare Worker at
`https://kanbun.ai`. It is restricted to the configured owner through a **hostname-based**
Cloudflare Access application. This is a private preview of the existing issue flow; native sign-in,
invites, and public onboarding remain separate work.

## Identity and storage

The Worker verifies the Access assertion's signature, issuer, audience, and expiry against the
issuer's JWKS before serving assets or APIs. It also checks the configured owner email. The D1
directory binds the verified issuer and subject to a stable account, workspace, and active
membership; email alone never links a new subject to an existing account.

The first authorized context request creates the owner workspace and an empty starter team using
the existing system commands and mutations. It adds no synthetic members or demonstration issues.
Subsequent requests reuse those identities. Removed memberships and deleted workspaces are denied
rather than recreated.

`GET /api/context` supplies the browser's actual workspace, user, and display names. The browser
validates that response before acquiring a Web Lock or opening IndexedDB. Hosted outboxes are
partitioned by workspace, actor, and branch. No Access token is stored in browser application
storage or included in a WebSocket URL. An authentication rejection hides cached rows, disables
editing, closes the notification socket, and preserves the outbox for recovery after signing in
and reloading.

A hosted cold start requires a fresh authenticated context; a network failure alone does not
authorize opening a previous user's cached data. An already open page can queue edits offline.
Reloading while offline preserves that outbox but requires connectivity before reopening it.

Only the edge Worker selects the Durable Object and forwards its trusted identity context. Client
identity headers cannot select a user or workspace. The Durable Object checks active directory
membership and local membership before operations and notification delivery. WebSocket identity
attachments include the authorization expiry; expired or revoked identities receive no further
cursor hints. Normal authenticated HTTP push/pull remains the source of rows and acknowledgements.

The preview keeps `LOCAL_DEV` false. Local seed routes are disabled, synthetic actor headers confer
no authority, and both workers.dev and version preview URLs are disabled. The static asset router
runs the Worker first so an alternative asset path cannot skip JWT verification.

## Cloudflare configuration

[`wrangler.preview.json`](../apps/worker/wrangler.preview.json) defines the dedicated Worker,
SQLite Durable Object namespace, D1 accounts directory, custom hostname, and web assets. Its
issuer, audience, hostname, database ID, and owner allowlist are deployment configuration rather
than credentials. Keep API tokens, OAuth refresh tokens, and Access service credentials outside
Git.

Configure Access on the **hostname**, not the Worker-level protection switch: Worker-level Access
currently rejects WebSocket upgrades. Static Assets also does not forward `ctx.access`, so the
application verifies the signed assertion itself. See Cloudflare's
[Access configuration](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
and [JWT validation guidance](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

Cloudflare Access activation requires the account owner's acceptance of its terms and any billing
authorization shown by Cloudflare. Select the intended plan explicitly before creating the Access
application. The application policy should allow only the configured owner, with no bypass policy.
Create the Access application before publishing the custom hostname.

Use the existing accounts SQL migrations for the dedicated D1 database; preview data must not
share an unrelated application's database or namespace. The DO applies its existing migration
bundle when the workspace starts. Do not edit previously applied migrations.

## Build and deploy

All repository commands run in the devcontainer. A complete build first builds the web assets,
then validates both Worker configurations using Wrangler dry runs; it does not deploy.

```sh
./scripts/devcontainer.sh exec pnpm install --frozen-lockfile
./scripts/devcontainer.sh verify
./scripts/devcontainer.sh exec pnpm build
```

Merge through the required CI, changelog, and spec-lock checks. Check out the exact green commit
with a clean working tree. Authenticate the pinned container Wrangler to the intended account
using a private credential file or scoped API token, then pass that commit's full SHA:

```sh
./scripts/devcontainer.sh exec pnpm deploy:preview --sha <green-commit-sha> --check
./scripts/devcontainer.sh exec pnpm deploy:preview --sha <green-commit-sha>
```

The deployment command refuses mismatched or dirty source and incomplete Access/database
configuration. It rebuilds, applies D1 migrations, and publishes the Worker with its web assets.
It never enables local fixture identity. The operator must confirm that the supplied SHA has
passed CI; the script does not interpret GitHub results.

After deployment, confirm that anonymous context, mutation, asset, and WebSocket requests are
blocked. With the authorized identity, verify context, create/rename persistence, reload recovery,
and live convergence. Keep credential headers and session cookies out of logs, traces, and retained
test artifacts. Never add a public test-authentication bypass to perform smoke tests.

## Recovery

Application data uses [private workspace backups and isolated restoration](data-recovery.md).
The recovery bundle includes the account directory, workspace engine state, and collaborative
description bodies. Its restore path requires a fresh isolated target and preserves normal JWT
authentication.

Record the deployed Worker version from Wrangler's output. For a later regression, use Wrangler's
rollback command to restore a known working Worker version from the same devcontainer. Leave D1
and workspace storage intact; reverting code must not delete user data or reverse an applied
migration. A failed initial deployment has no previous application version to restore.

## Automatic releases

After successful push CI on current main, `Deploy preview` checks out that exact SHA and uses the
same devcontainer to build and deploy. Superseded workflow runs do not publish. The scoped
`CLOUDFLARE_API_TOKEN` Actions secret is required; it is never committed or included in receipts.
It expires January 28, 2027 and must be rotated before then. Its Worker permission covers only
`kanbun-preview`, its route/zone permissions cover only `kanbun.ai`, and D1 Write is account-wide
because the token dashboard does not offer a per-database selector.

The live smoke checks validate HTTPS, anonymous Access redirects on the app/context/bootstrap/
connect paths, available verification keys, disabled alternative URLs, and the exact active
Worker version. They verify the hosted security boundary; they do not authenticate as the owner
or mutate workspace data. Authenticated issue flows, convergence, and recovery run in the real
local runtime in PR CI; owner sign-in and retained workspace data are checked during hosted setup.

Code releases refuse changed SQL migrations, Durable Object migrations, storage bindings, identity
configuration, or routes, and
require the remote D1 migration ledger to match local files. Schema rollouts require separate
compatibility review. Version tags record the source SHA; the first automated release recognizes
the exact manually verified domain-cutover version as its bootstrap baseline.

If post-deployment smoke fails, automation restores and checks the prior version only while its
own known candidate is still active. An unknown candidate, unavailable control plane, or newer
deployment requires operator review. Deployment receipts are retained as Actions artifacts even
on failure. Automatic runs are serialized; avoid simultaneous manual deployments because
Cloudflare's rollback API has no atomic compare-and-swap precondition. Rollback never reverses
database changes or removes workspace data.

## Collaborative description rollout

Issue descriptions add a `DOCUMENTS` binding and an appended SQLite `DocumentDO` class migration.
The workspace schema also adds team scope to description metadata. These are additive changes;
existing workspace IDs, issue IDs, accounts, and previously applied SQL migrations stay intact.
The automatic code release correctly refuses this configuration change before publishing.

After the exact merged commit passes CI, review the appended migration and deploy that clean
commit with `pnpm deploy:preview --sha <green-commit-sha>`. The manual deployment command tags the
Worker version with its source SHA. Verify owner sign-in, an existing issue, description save and
reload, and anonymous document denial. Rerun the automatic deployment workflow after the reviewed
storage rollout; its active version now has the same storage contract as the candidate.

Do not roll code back across this binding migration using the ordinary code-only rollback path.
Keep the new class and binding in a corrective release. Reverting code does not restore document
or workspace data; data recovery is a separate operation.
