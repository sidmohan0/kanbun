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

The checks also verify anonymous HTTPS and WebSocket requests are redirected to the configured
Cloudflare Access issuer, alternative Worker URLs remain disabled, and Access verification keys
are available. A read-only `SELECT 1 AS healthy` query checks connectivity to the configured accounts
D1 database. The active version must remain unchanged through the check.

An Access redirect proves the edge gate is reachable; it does **not** execute the protected
application behind it. A D1 control-plane query does **not** prove the Worker's D1 binding or
WorkspaceDO/DocumentDO behavior. These checks do not authenticate as a teammate, read issue data,
exercise an actual document, or prove durable storage integrity. Authenticated application flows
and offline/concurrent recovery remain covered by the real-runtime PR verifier. Live authenticated
checks require a normal authorized session; no test authentication bypass is installed.

## Finding and handling failures

A failed check exits nonzero so GitHub can notify repository watchers through their configured
Actions notification settings. Delivery depends on those settings; this setup does not add a
separate email or paging channel. Open the failed run, read its summary, and download the
`preview-health-<run>-<attempt>` artifact. Setup failures may have only workflow logs and the
fallback summary. The report is operational evidence and is not a required PR check.

- **Credential or API failure:** check the Actions secret and its existing scoped permissions.
  The deployment token expires January 28, 2027. Rotate it before expiry without broadening access.
  An unavailable Cloudflare or GitHub control plane can prevent checks while the app remains usable.
- **Access gate, keys, or alternative URLs:** inspect the hostname-based Access application for
  `kanbun.ai`, its configured issuer and owner/team policy, and the Worker's custom domain.
  Keep workers.dev and version preview URLs disabled. Do not bypass Access to make a probe green.
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
Access redirect URLs, database rows, and credentials. They are ignored by Git and retained as
workflow artifacts. Health and deployment probes use the same implementation in
[`scripts/preview-checks.mjs`](../scripts/preview-checks.mjs).

The daily job adds one devcontainer startup and short read-only probes to Actions usage. The
existing repository Actions budget applies; no additional spend cap or paid service is configured.
Cloudflare Workers Logs are already enabled in the preview configuration. See the official
[Workers Logs documentation](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
for platform fields and log access.
