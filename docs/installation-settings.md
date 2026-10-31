# Installation settings

[Cloudflare deployment](cloudflare-deployment.md) uses a separate root Wrangler configuration.
`installation.local.json` is the input to `pnpm install:cloudflare configure`; the generated
`wrangler.install.json` is ignored by Git. The official button uses `wrangler.json` at the repository
root. Initial public identity keys are omitted so the deployment wizard does not turn them into
required blank inputs. The setup deployment cannot admit a synthetic user.

## Public configuration

| Settings-file key    | Wrangler field                         | Requirement                                                     |
| -------------------- | -------------------------------------- | --------------------------------------------------------------- |
| `name`               | `name`                                 | Dedicated lowercase Worker name; letters, digits and hyphens    |
| `account_id`         | `account_id`                           | Your Cloudflare account ID                                      |
| `origin`             | `vars.APP_ORIGIN`                      | Exact HTTPS origin, without path or trailing slash              |
| `owner_email`        | `vars.PREVIEW_OWNER_EMAIL`             | Owner's verified mailbox within the invitation domain           |
| `email_domain`       | `vars.AUTH_EMAIL_DOMAIN`               | Domain eligible for sign-in and invitations                     |
| `from_email`         | `vars.AUTH_FROM_EMAIL`                 | Verified Resend sender formatted `Kanbun <address@domain>`      |
| `turnstile_site_key` | `vars.TURNSTILE_SITE_KEY`              | Production site key for the application's hostname              |
| `workspace_name`     | `vars.PREVIEW_WORKSPACE_NAME`          | Nonempty name, at most 160 characters                           |
| `workspace_id`       | `vars.PREVIEW_WORKSPACE_ID`            | Optional UUIDv7; generated once if absent and retained on rerun |
| `database_id`        | `d1_databases[ACCOUNTS].database_id`   | ID returned when your dedicated database is provisioned         |
| `database_name`      | `d1_databases[ACCOUNTS].database_name` | Your dedicated accounts database name                           |
| `backup_bucket`      | `r2_buckets[BACKUPS].bucket_name`      | Your dedicated private R2 bucket                                |

`LOCAL_DEV=false`, `AUTH_MODE=email`, authenticated asset routing, source metadata and the maintained
migrations remain mandatory. `INSTALLATION_STAGE=setup` permits only the explicitly inert setup
profile with every public identity value absent or empty; the shipped template omits those keys.
`ready` requires complete public identity settings. Partial nonempty settings fail installation
validation. Do not use placeholder identities, site keys or secret values to bypass the setup flow.

The deployment script accepts `APP_ORIGIN`, `AUTH_EMAIL_DOMAIN`, `AUTH_FROM_EMAIL`,
`TURNSTILE_SITE_KEY`, `PREVIEW_OWNER_EMAIL`, `PREVIEW_WORKSPACE_ID` and `PREVIEW_WORKSPACE_NAME`
from the build environment. It copies only those public values into deployment configuration.
Keep the public values in your reviewed fork configuration for repeatable subsequent deployments.
Runtime secrets must be stored using the provider's Worker secret interface.

## Private Worker secrets

| Secret                     | Source                                  | Required when              |
| -------------------------- | --------------------------------------- | -------------------------- |
| `RESEND_API_KEY`           | Resend API key for the verified sender  | Email sign-in              |
| `TURNSTILE_SECRET_KEY`     | Turnstile widget secret                 | Email sign-in              |
| `GITHUB_APP_CLIENT_SECRET` | Your GitHub App                         | GitHub integration enabled |
| `GITHUB_APP_PRIVATE_KEY`   | Your GitHub App PKCS8 PEM               | GitHub integration enabled |
| `GITHUB_WEBHOOK_SECRET`    | Random secret matching your App webhook | GitHub integration enabled |

GitHub's public App ID, client ID and slug are documented in [GitHub setup](github-integration.md).
Add them only after the initial installation succeeds. Public site keys and App identifiers are
configuration; API keys, private keys, session tokens and webhook secrets belong outside Git.

The tracked `.dev.vars.example` contains comments-only guidance. Keep active sample credential
assignments out of it: the deployment wizard treats such assignments as required secret inputs.
After deploying the inert setup shell, supply actual runtime secrets to the target Worker through
Cloudflare. Actual local credentials belong in ignored local files or private process input.

## Provider access

A deployment credential needs access to the selected account's Workers and required D1 resources;
initial resource provisioning additionally needs the corresponding creation permissions. A custom
domain requires permissions for its zone/route. Prefer an installation-scoped credential and review
Cloudflare's available permission scopes. The installer validates configuration before invoking
Wrangler; the provider remains responsible for authorization and binding/resource existence.
