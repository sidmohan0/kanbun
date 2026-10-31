# Deploy Kanbun to Cloudflare

Kanbun runs in your Cloudflare account. Its Worker serves the web application, authenticates users,
and routes work to SQLite-backed Durable Objects. D1 holds the account directory; a private R2
bucket holds recovery bundles. GitHub integration is optional.

The installation profile is [the root Wrangler configuration](../wrangler.json). The maintained
Kanbun pilot uses a separate [preview configuration](../apps/worker/wrangler.preview.json).
Installer commands never select that preview profile.

## Requirements and cost

You need a Cloudflare account with Workers, SQLite Durable Objects, D1 and R2 available, permission
to provision those resources, and a GitHub or GitLab account for the deployment button. Sign-in
requires a verified Resend sender domain and a Turnstile widget for the exact application hostname.
The owner and invited members use addresses in the configured email domain.

Check current [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[R2 pricing](https://developers.cloudflare.com/r2/pricing/), and
[Resend plans](https://resend.com/pricing). CPU, requests, database operations/storage, email volume,
observability and accumulated backups determine cost. Backups have no automatic retention deletion.
Set account usage notifications and review the private bucket's growth. There is no measured
monthly-cost estimate for a real team yet.

## Deploy button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fsidmohan0%2Fkanbun)

The [official button](https://developers.cloudflare.com/workers/platform/deploy-buttons/) copies the
whole repository into your account and uses Workers Builds to provision the configured resources.
Keep the repository root as the build root: the application uses workspace packages outside
`apps/worker`, and Cloudflare's subdirectory flow requires an isolated application.

Use the root build command `pnpm build` and deployment command `pnpm run deploy`. Review the Worker,
database and bucket names before starting. Resource names must be dedicated to this installation.
The root profile enables the Worker's own `workers.dev` hostname and disables version-preview URLs.
It contains no maintainer account, domain, GitHub App, or owner identity.

**Initial completion scope:** the default deployment is a setup shell. It applies the D1 migrations
and deploys application assets, with email authentication selected and all installation identity
settings blank. Workspace and sign-in APIs fail closed until configuration is complete. A successful
build alone does not prove usable sign-in, email delivery, invitations or backup recovery.

The button's independent-account deployment has not yet been rehearsed. The launch report retains
that requirement until an installer records a successful real installation. Cloudflare documents that it writes provisioned IDs into the cloned configuration and supports
applying migrations before `wrangler deploy` in the custom deployment command. This installer
requires that provisioned ID before applying migrations; an unchanged placeholder stops it before
any database operation. The independent-account rehearsal must still confirm this provider flow.

### Complete the installation

1. Open the Worker's assigned URL and record its exact HTTPS origin. For a custom domain, configure
   the domain route instead and disable `workers_dev`; retain only that application's route.
2. Create a managed Turnstile widget for that hostname and a verified Resend sender. Require TLS
   and disable click/open tracking for sign-in mail.
3. Fill every public setting in the root Wrangler `vars` and set `INSTALLATION_STAGE` to `ready`.
   Cloudflare also exposes configuration/build inputs; the deployment script accepts the public
   setting names listed in [the settings reference](installation-settings.md) from build environment
   variables. Persist the public settings in your fork before subsequent deployments so a build
   without those environment variables cannot return the app to setup mode.
4. Set `RESEND_API_KEY` and `TURNSTILE_SECRET_KEY` as Worker secrets. Keep actual values out of Git,
   build logs and launch evidence. The example file supplies prompts, not usable credentials.
5. Redeploy, then complete the acceptance exercise below. Keep GitHub disabled until core sign-in
   and membership are working.

For a `workers.dev` installation, `APP_ORIGIN` must match the Worker name and assigned subdomain.
For a custom domain, it must match the single custom-domain route with `workers_dev` false.
Version-preview URLs remain disabled in both cases. The auth implementation checks the origin;
changing a hostname requires updating the Turnstile hostname and installation origin together.

## Install from the devcontainer

The following path lets you review all public settings before any deployment. It uses the same
root profile and keeps the generated configuration separate from the maintainer pilot.

```sh
./scripts/devcontainer.sh up
./scripts/devcontainer.sh exec pnpm install --frozen-lockfile
./scripts/devcontainer.sh exec pnpm --filter @kanbun/worker exec wrangler login
```

Create a dedicated database and private bucket, substituting your own resource names:

```sh
./scripts/devcontainer.sh exec pnpm --filter @kanbun/worker exec wrangler d1 create kanbun-team-accounts
./scripts/devcontainer.sh exec pnpm --filter @kanbun/worker exec wrangler r2 bucket create kanbun-team-backups
```

Copy [installation.example.json](../installation.example.json) to `installation.local.json`, then
replace every placeholder with your account, resources and sign-in configuration. Copy the
returned D1 database ID into `database_id`. Keep the bucket private in the Cloudflare dashboard.

```sh
./scripts/devcontainer.sh exec pnpm install:cloudflare configure
./scripts/devcontainer.sh exec pnpm install:cloudflare check --config wrangler.install.json
./scripts/devcontainer.sh exec pnpm build
./scripts/devcontainer.sh exec pnpm --filter @kanbun/worker exec wrangler secret put RESEND_API_KEY --config ../../wrangler.install.json
./scripts/devcontainer.sh exec pnpm --filter @kanbun/worker exec wrangler secret put TURNSTILE_SECRET_KEY --config ../../wrangler.install.json
./scripts/devcontainer.sh exec pnpm install:cloudflare deploy --config wrangler.install.json
```

Configuration generation creates a UUIDv7 workspace identity. Repeating it with identical settings
preserves that identity and does not overwrite the profile. Changed settings require explicit review
and editing of the existing profile. The generated profile and local settings are ignored by Git;
keep them in your own secure configuration backup. They contain public settings but include the
owner's email and resource identifiers.

`check` makes no provider requests. `deploy --dry-run` prints a validated deployment plan without
provider calls. `deploy` applies migrations by the `ACCOUNTS` binding, then publishes the Worker.
It does not create or reset resources. Applied migrations are tracked in D1, so resuming a failed
initial deployment reuses existing state. If the provider fails, inspect its output and current
resources before retrying; never delete the database to resolve a deployment error.

## Acceptance exercise

Use a fresh installer-owned account or isolated resources and retain the candidate source commit,
configuration fingerprint, executed steps and outcome. Never include tokens, cookies or real issue
contents in public evidence.

- Verify the configured shell loads, local seed routes are unavailable and anonymous context,
  sync, documents and WebSockets cannot access workspace data.
- Request a real owner sign-in link, confirm it in the requesting browser, and create/edit an issue.
- Invite a second eligible address, accept in a separate session, and confirm appropriate access.
  Invitation creation provides a link; it does not send invitation email.
- Remove the member and confirm renewed requests and live connections lose access.
- Redeploy the same configuration and verify that issue identity and contents persist.
- Follow [backup and recovery](data-recovery.md) in an isolated target and record its result.
- Record provider failures, manual steps and installation problems. A blocked step remains blocked
  in the launch report.

Local automated runtime tests exercise the auth implementation using private test transports;
real mail delivery and independent-account installation require this live exercise.

## Optional GitHub integration

Create your own GitHub App using [the integration guide](github-integration.md), configure its public
identifiers in your installation profile and add its credentials as Worker secrets. Use your
application's callback/webhook URLs and selected repositories. The maintainer's App identifiers in
the pilot profile do not belong in an independent installation.

## Upgrades, recovery and teardown

Before upgrading, preserve a complete backup and retain the previous source/configuration. Apply
only migrations belonging to the reviewed candidate. The deployment command applies migrations
before code deployment; a later deploy failure can leave an advanced schema. Review compatibility
before rollback. Code rollback does not undo migrations or data changes. The first public release
has no established prior supported upgrade baseline; [launch readiness](launch-readiness.md) tracks
that limitation explicitly.

Use [operations](operations.md) for failure categories and [data recovery](data-recovery.md) for the
supported coherent backup and isolated restore procedure. Replace pilot resource names with your
installation's names. Retain metadata needed to match the backup's source and schema. The current
backup format is an operational archive; a general-purpose tracker import/export is not available.

To retire an installation: stop access and writes, preserve and verify the chosen backup, disable
its deployment automation, remove its custom-domain route, and delete its Worker and dedicated
Durable Object namespaces, D1 database and R2 bucket only after confirming their names and retention
requirements. Check remaining R2 objects and provider subscriptions for continued charges. Never
apply teardown commands to shared or maintainer resources.

## Fork automation

The existing preview deployment and daily health workflows retain the maintainer deployment in
`sidmohan0/kanbun`. Forks are **opt-in** through the repository variable
`KANBUN_PREVIEW_ENABLED=true`; with that variable absent, their preview jobs are skipped. The
preview scripts use `GITHUB_REPOSITORY` for release ancestry and Actions reads. Enabling them also
requires an installer-owned, reviewed `wrangler.preview.json` and scoped Actions credentials.
The portable installer is independent of those workflows. Keep preview automation disabled on a
new fork until its configuration has been replaced and reviewed.
