# Preview operations

The private preview runs at [kanbun.ai](https://kanbun.ai). The
[Preview health workflow](https://github.com/sidmohan0/kanbun/actions/workflows/preview-health.yml)
runs daily at 06:00 UTC, matching the existing documentation report, and supports manual runs.
It uses the shared devcontainer and existing deployment credential. It does not deploy, roll back,
write application data, or add a monitoring service. Its job shares the deployment concurrency group
so routine releases and scheduled probes do not race the active version. Both workflows use
GitHub’s `queue: max` setting so a newly queued health run cannot replace a pending deployment.

## What the report proves

The retained `receipt.json` and Actions summary identify the active Worker version and its source
commit, verify that source belongs to main, and compare it with the latest successful main push CI.
They show the latest deployment workflow status. A failed latest deployment fails the health check.
A source mismatch without an active release also fails; an active release is explicitly reported as
`release-pending`, rather than current. There is no elapsed-time threshold that silently tolerates
a stale release. After a pending release finishes, inspect its result or rerun the health workflow.

In native email mode, the boundary probe expects public HTML at `/` and public
`/api/auth/config` with `method: email`, `authenticated: false`, a nonempty public site key and no
email address. Anonymous context, member, bootstrap, document and connect requests must return
JSON `401` with `authentication: email`; an actual unauthenticated WebSocket upgrade must also
return `401`. Alternative Worker URLs stay disabled. The probe does not fetch Access verification
keys in this mode. Legacy `AUTH_MODE=preview` retains the Access redirect/JWKS checks for that
different authentication contract. A read-only `SELECT 1 AS healthy` checks accounts D1 connectivity.
The active version must remain unchanged through the check.

Public HTML proves the sign-in shell is available, not that workspace rows are public. Anonymous
`401` responses prove denial at the boundary; they do **not** execute an authenticated application
flow, send an email, verify Resend delivery, or complete a Turnstile challenge. A D1 control-plane
query does **not** prove the Worker's D1 binding or WorkspaceDO/DocumentDO behavior. The probes read
no issue data and do not prove durable storage integrity. Authenticated flows and offline/concurrent
recovery remain covered by the real-runtime PR verifier. Live checks require a normal native email
session; no test authentication bypass is installed.

## Finding and handling failures

A failed check exits nonzero so GitHub can notify repository watchers through their configured
Actions notification settings. Delivery depends on those settings; this setup does not add a
separate email or paging channel. Open the failed run, read its summary, and download the
`preview-health-<run>-<attempt>` artifact. Setup failures may have only workflow logs and the
fallback summary. The report is operational evidence and is not a required PR check.

- **Credential or API failure:** check the Actions secret and its existing scoped permissions.
  The deployment token expires January 28, 2027. Rotate it before expiry without broadening access.
  An unavailable Cloudflare or GitHub control plane can prevent checks while the app remains usable.
- **Sign-in shell or native boundary:** check `AUTH_MODE`, `APP_ORIGIN`, the public auth configuration
  and the Worker's custom domain. Workspace data, documents and WebSocket upgrades must remain
  session-gated even though assets are public. Keep workers.dev and version URLs disabled; never
  add an authentication bypass to make a probe green. During the
  [staged cutover](hosted-preview.md#email-authentication-rollout), Access redirects remain expected
  until native owner proof and confirmed removal of the outer Access application. A staged redirect
  is not a passing native probe. Legacy-mode failures still require its configured issuer/JWKS gate.
- **Sign-in email or verification:** inspect the Resend verified sender/domain, `AUTH_FROM_EMAIL`,
  secret `RESEND_API_KEY`, Turnstile hostname/site key, secret `TURNSTILE_SECRET_KEY`, and the
  `magic_link` action. The hosted sender is `signin@auth.kanbun.ai`; retain enforced TLS and disabled
  click/open tracking for sign-in mail. Check provider delivery/error reports without copying recipients, links,
  tokens or provider response bodies into logs or issues. A generic `202` deliberately conceals
  eligibility and delivery failures. Sanitized `kanbun.auth.delivery_failed` and
  `kanbun.auth.delivery_cleanup_failed` console events indicate internal delivery/cleanup failures;
  correlate their generated `errorId` and invocation time. Never expose private test transports.
- **Link unavailable or sign-in expired:** use the newest link in the same browser that requested
  it. Another browser, an expired or consumed link, a replaced request cookie, or revoked eligibility
  requires a fresh request. The session expires one hour after the original request, not an hour
  after confirmation. A signed-in person with `403` needs a valid workspace invitation/admission;
  repeated sign-in does not restore removed access. See the [email flow](ux/email-sign-in.md).
- **D1 connectivity:** inspect the accounts database binding and Cloudflare D1 status. The health
  query reads no account or issue rows. Do not recreate the database or apply unreviewed migrations.
- **Unknown or stale deployed source:** inspect the latest successful main CI and
  [Deploy preview runs](https://github.com/sidmohan0/kanbun/actions/workflows/deploy-preview.yml).
  Follow the release receipt and [deployment recovery instructions](hosted-preview.md#recovery).
  Schema/storage rollouts require compatibility review; a failed automatic preflight must not be
  bypassed with an unsafe rollback.
- **Version changed during the check:** inspect active deployments and rerun after the release or
  manual operation finishes. Automatic release and health jobs serialize; avoid concurrent manual
  deployments.
- **Unexpected application error:** inspect Cloudflare Workers Logs for
  `event=kanbun.request.failed`, correlate the response's `errorId`, and use the invocation timestamp
  and deployed version to reproduce locally. The application logs only an internal category and
  generated correlation id, never the thrown exception, SQL, issue text, credentials, or headers.
  Cloudflare's platform-generated invocation metadata is separate from application console events.

Only restore a known compatible Worker version; rollback never reverses database changes. Preserve
workspace data and retained evidence while investigating. Rerun the health workflow after a fix,
then verify the affected authenticated flow in the application.

## Local execution

Use the devcontainer with the existing deployment credential and a repository token with
`contents:read` and `actions:read`, supplied through the environment rather than a committed file.
From a checkout with complete main history, run:

```sh
./scripts/devcontainer.sh exec --remote-env "CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN" --remote-env "GITHUB_TOKEN=$GITHUB_TOKEN" node scripts/preview-health.mjs
```

Inspect `artifacts/preview-health/receipt.json` and `summary.md`. The files contain check names,
public deployment identifiers, and bounded failure categories; they exclude API response bodies,
authentication response bodies, redirect URLs, database rows and credentials. They are ignored by Git and retained as
workflow artifacts. Health and deployment probes use the same implementation in
[`scripts/preview-checks.mjs`](../scripts/preview-checks.mjs).

The daily job adds one devcontainer startup and short read-only probes to Actions usage. The
existing repository Actions budget applies; no additional spend cap or paid service is configured.
Cloudflare Workers Logs are already enabled in the preview configuration. See the official
[Workers Logs documentation](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
for platform fields and log access.
