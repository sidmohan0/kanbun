# Hosted workspace and email sign-in

The hosted application serves the React app and workspace APIs from one Cloudflare Worker at
`https://kanbun.ai`. Native email sign-in authenticates a person, and Kanbun's directory authorizes
the configured owner and explicitly invited members. This remains an invitation-only workspace:
a public sign-in page does not make workspace data public or create an open registration flow.

The email implementation and its [user flow](ux/email-sign-in.md) replace the previous Cloudflare
Access login. The [staged rollout](#email-authentication-rollout) keeps Access in place until a real
native owner session is proved and its removal is explicitly confirmed. A code merge alone does
not establish that the hosted authentication cutover is complete.

## Identity and storage

With `AUTH_MODE=email`, static assets and the sign-in shell are public. The browser first requests
`GET /api/auth/config`; an unauthenticated person sees an email form before any workspace lease,
cached rows, or mutation queue is opened. Email requests require a server-verified Turnstile token
with the configured hostname and `magic_link` action. Resend sends links only to the configured
owner or eligible active/invited people in the configured email domain. Eligible and ineligible
addresses receive the same generic `202` response; that response is not proof of email delivery.

The link opens in the browser that requested it and requires an explicit confirmation. Inspecting
it does not sign in, so a scanner cannot consume the link simply by following it. The link and its
resulting session both expire one hour after the request; consuming the link does not extend the
session. A single atomic claim can create a session. D1 stores hashes of link tokens, browser
nonces, and session credentials rather than their raw bearer values. Browser cookies are Secure,
HttpOnly, SameSite=Lax, and host-only. Authentication POST requests require the configured origin
and JSON; tokens stay in request bodies or the link fragment, not query parameters or localStorage.

A valid email session may open the invitation screen before membership exists. Context, sync,
documents, and member administration still require active directory and workspace membership.
The configured owner email controls initial owner admission. Native confirmation deliberately
binds the proven mailbox to an existing account when migrating from Access, preserving its account,
workspace, membership and admission IDs. Typing an email or presenting an invitation alone never
provides that authentication proof.

The first authorized context request creates the owner workspace and an empty starter team using
the existing system commands and mutations. It adds no synthetic members or demonstration issues.
Subsequent requests reuse those identities. Removed memberships and deleted workspaces are denied
rather than recreated by ordinary sign-in. The owner can deliberately readmit a removed member
through a fresh targeted invitation; old links cannot reactivate that admission.

`GET /api/context` supplies the actual workspace, user, role, admission, authentication method and
display names. The browser validates it before acquiring a Web Lock or opening IndexedDB. Hosted
outboxes are partitioned by workspace, actor, branch and member admission. Existing owner storage
keys remain compatible. A fresh admission leaves old private drafts stored but unopened rather than
resubmitting them under renewed access. No session bearer enters application storage or a WebSocket
URL. An authentication rejection hides cached rows, disables editing and closes the socket while
preserving pending work. Native expiry displays the email form rather than a reload-to-login loop.
Sign-out preserves the persisted outbox, revokes the current session, hides cached work and closes
the socket. An expected-admission precondition prevents an old page from adopting a new membership.

A hosted cold start requires fresh sign-in configuration and an authenticated context; a network
failure does not authorize reopening a previous user's cached data. An already open page can queue
edits offline. Reloading while offline preserves that outbox but requires connectivity before
reopening it. Only explicit local development retains its existing verified local-context fallback.

Only the edge Worker selects the Durable Object and forwards a trusted identity. Client identity
headers cannot select a user or workspace. The DO checks active directory membership, the live
native session and local membership before operations and notification delivery. Socket identity
attachments include authorization expiry; expired or revoked identities receive no further hints.
HTTP push/pull remains the source of rows and acknowledgements. The preview keeps `LOCAL_DEV` false,
local seed routes disabled, and both workers.dev and version preview URLs disabled. The static asset
router runs the Worker first so an alternative path cannot bypass the mode's authentication rules.

## Cloudflare configuration

[`wrangler.preview.json`](../apps/worker/wrangler.preview.json) defines the dedicated Worker,
SQLite Durable Object namespaces, D1 directory, backup bucket, custom hostname and web assets.
Native configuration includes `AUTH_MODE=email`, `APP_ORIGIN`, `AUTH_EMAIL_DOMAIN`, `AUTH_FROM_EMAIL`,
`TURNSTILE_SITE_KEY` and the existing owner/workspace identifiers. The Turnstile site key is public;
`TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`, deployment tokens and session credentials are secrets and
must remain outside Git and retained test artifacts. The sender uses a verified Resend domain.
The hosted sender is `Kanbun <signin@auth.kanbun.ai>`, with `datafog.ai` as the invitation/sign-in
domain. Keep provider-enforced TLS enabled and click/open tracking disabled for sign-in mail.
Production uses provider HTTPS APIs; private test transports must not become public endpoints or
an authentication bypass. See [Resend's Workers setup](https://resend.com/docs/send-with-cloudflare-workers)
and [Turnstile validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

`AUTH_MODE=preview` retains the legacy Access mode for compatibility and migration checks. In that
mode, hostname-based Access protects the app and the Worker verifies signature, issuer, audience and
expiry against JWKS. Kanbun membership remains required. Local development stays explicitly local;
neither legacy compatibility nor test fixtures confer authority in native hosted mode.

## Invitations and member administration

The owner uses Members to create a targeted invitation, copy its one-time link, revoke pending
invitations and remove members. The UI creates invitations without an expiry; the API accepts an
optional expiry. Creating an invitation does not send email. Sign-in email is a separate flow.
Invitation tokens are stored as hashes, links use URL fragments, and inspection/acceptance send
tokens in same-origin POST bodies. Listing invitations never returns their bearer tokens.

An unauthenticated invitee requests a sign-in link using the targeted address, confirms it in the
same browser, then returns to the preserved invitation and explicitly accepts it. Acceptance checks
the verified target email, an unused or same-identity accepted token, and an available workspace.
The owner cannot be removed or replaced through this interface. Removal revokes outstanding
invitations and the current admission, closes sockets, and blocks later data access. Readmission
changes the admission ID and clears previous private-team grants; normal sign-in cannot reactivate
removed membership. Interrupted directory-to-workspace projection can finish on a later request.

## Build and deploy

Run all repository commands in the devcontainer. A build validates local and hosted Worker
configurations using Wrangler dry runs; it does not deploy.

```sh
./scripts/devcontainer.sh exec pnpm install --frozen-lockfile
./scripts/devcontainer.sh verify
./scripts/devcontainer.sh exec pnpm build
```

Merge through required CI, changelog and spec-lock checks. Check out the exact green commit with a
clean tree. Authenticate the pinned container Wrangler to the intended account using private
credentials, then pass that commit's full SHA:

```sh
./scripts/devcontainer.sh exec pnpm deploy:preview --sha <green-commit-sha> --check
./scripts/devcontainer.sh exec pnpm deploy:preview --sha <green-commit-sha>
```

The command refuses mismatched or dirty source and incomplete authentication/database
configuration. It rebuilds, applies reviewed D1 migrations and publishes the Worker with assets.
It never enables local fixture identities. The operator confirms the commit passed CI; the manual
script does not interpret GitHub results. Do not modify applied migrations or share the preview's
account database or namespaces with an unrelated application.

## Email authentication rollout

1. Configure the verified Resend sender with enforced TLS and no click/open tracking, secret API
   key, managed Turnstile widget for the actual
   hostname, server secret and public site key. Keep provider credentials out of source and logs.
2. Review the additive accounts authentication migration, retained identities and backup policy.
   Deploy the exact verified native-auth commit through the manual compatibility-review path.
3. Retain the existing hostname Access application during staging. With the normal owner browser
   session passing that outer gate, request a real native email link, confirm it in the requesting
   browser, and verify the existing owner account, workspace, issues and pending-data behavior.
4. After native owner proof, obtain explicit confirmation for removing the outer Access application.
   Remove it as the planned authentication cutover, without adding an authentication bypass. Native
   session and workspace authorization remain enforced by the Worker and DOs.
5. Check public shell/config responses and anonymous data/document/WebSocket denial, then complete
   an authenticated owner reload and the affected issue flow. Run automated deployment and health
   checks against the released source and retain their receipts.

Before step 4, anonymous requests still receive Access redirects. That is a staged release, not a
passing native public-boundary probe. Removing Access is a separate hosted action; neither a code
merge nor a native configuration flag removes it. Do not roll code back across the authentication
or schema transition using the ordinary automatic code-only rollback path.

## Recovery

Use [private workspace backups and isolated restoration](data-recovery.md) for application data.
The dedicated restore procedure does not bypass sign-in or workspace admission. Follow its
credential/session recovery policy and authenticate normally after restoration.

Record the deployed Worker version. A compatible code rollback restores a known prior version
while retaining D1 and workspace storage; it does not delete data or undo an applied migration.
An initial deployment has no previous version to restore. Authentication/schema transitions require
compatibility review and a corrective release rather than an unsafe automatic rollback.

## Automatic releases

After successful push CI on current main, Deploy preview checks out that exact SHA and builds and
deploys in the same devcontainer. Superseded runs do not publish. The scoped
`CLOUDFLARE_API_TOKEN` Actions secret remains outside Git and receipts. It expires January 28, 2027;
rotate it before expiry. Its Worker permission covers `kanbun-preview`, zone/route permissions cover
`kanbun.ai`, and D1 Write is account-wide because the dashboard offers no per-database selector.

Native smoke checks require public HTML and unauthenticated sign-in configuration, JSON `401`
responses with `authentication: email` for context, member, sync, document and WebSocket routes,
disabled alternative URLs, and the exact stable active Worker version. Legacy mode retains its
Access redirect/JWKS checks. Neither mode's anonymous probes authenticate as a teammate, send a
sign-in email or prove a real issue flow. Authenticated behavior is tested in the actual local
runtime; a live authorized browser proves owner entry during hosted rollout.

Automatic code releases refuse changed SQL/DO migrations, storage bindings, identity configuration
or routes, and require the remote D1 migration ledger to match local files. The native-auth rollout
uses that separate reviewed path; do not weaken the guard to make a schema/authentication change
look like an ordinary code release. Version tags record the source SHA.

If smoke fails, automation restores and checks its prior compatible version only while its own
known candidate is still active. An unknown candidate, unavailable control plane or newer release
requires operator review. Receipts remain available even on failure. Automatic runs serialize;
avoid concurrent manual deployments. Rollback never reverses database changes or removes data.

## Operational monitoring

GitHub context uses a separate owner-authorized GitHub App; it does not replace native email login.
See [GitHub integration setup](github-integration.md) for the public App identifiers, private Worker
secrets, callback/webhook destinations, selected read permissions, repository-to-team mappings and
the first migration rollout. Anonymous health checks do not prove that integration's authenticated
provider flow.

The daily/manual [health report and recovery runbook](operations.md) cover the configured public
shell and authentication boundary, deployed source/release state, and read-only accounts
connectivity. They do not prove email delivery, an authenticated application flow or durable storage
integrity.
