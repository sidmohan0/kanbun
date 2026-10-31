# GitHub integration setup and recovery

The integration reads selected repositories' PR, branch, review and CI metadata and publishes
issue-linked context. The [user flow](ux/github-context.md) describes its placement and privacy
contract. Native email remains Kanbun authentication; GitHub authorization is a separate owner-only
setup step. Setup does not ask for a personal access token, and the public sign-in screen has no
GitHub login button.

## App and Worker configuration

Register the GitHub App with these hosted destinations:

| Setting                     | Destination                                          |
| --------------------------- | ---------------------------------------------------- |
| Homepage                    | `https://kanbun.ai`                                  |
| User authorization callback | `https://kanbun.ai/api/integrations/github/callback` |
| Setup after installation    | `https://kanbun.ai/#settings`                        |
| Active webhook              | `https://kanbun.ai/api/integrations/github/webhook`  |

Use selected-repository installation and read-only repository permissions for **Metadata**,
**Pull requests**, **Checks** and **Commit statuses**. The implementation requests no source-code
write permission and imports no PR bodies, diffs or code. Subscribe to `pull_request`,
`pull_request_review`, `check_run`, `check_suite` and `status`. The handler also consumes App
installation and installation-repository revocation deliveries. Keep webhook TLS verification enabled. Follow GitHub's
[App registration guidance](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
for the provider settings; do not expand permissions to work around a failed connection.

| Worker configuration       | Classification                                        |
| -------------------------- | ----------------------------------------------------- |
| `GITHUB_APP_ID`            | Public App ID                                         |
| `GITHUB_APP_CLIENT_ID`     | Public OAuth client ID                                |
| `GITHUB_APP_SLUG`          | Public installation slug                              |
| `GITHUB_APP_CLIENT_SECRET` | Private Worker secret                                 |
| `GITHUB_APP_PRIVATE_KEY`   | Private Worker secret containing PKCS8 PEM            |
| `GITHUB_WEBHOOK_SECRET`    | Private Worker secret matching the App webhook secret |

The provider's downloaded RSA key must be converted to PKCS8 before storing it for `importPKCS8`.
Keep the downloaded and converted private files outside Git, restrict their local permissions,
and never print key contents or secrets into chat, logs or retained artifacts. Public identifiers
belong in the reviewed hosted configuration; private values belong only in Worker secret storage.
Production uses GitHub HTTPS endpoints. `GITHUB_TRANSPORT` is a private test service binding, not a
public test route or production provider bypass.

## Owner authorization and linking

Sign in normally as the Kanbun owner, then open Settings. Install the App for the repositories to
share, choose **Connect GitHub**, approve the intended provider access and return to Settings.
The browser follows only the configured GitHub authorization destination. OAuth uses S256 PKCE,
one-use state and a Secure/HttpOnly/SameSite=Lax host cookie tied to the current owner account,
workspace and native session. The callback rechecks ownership and returns to `/#settings` without
putting provider errors or credentials in query parameters.

The temporary GitHub user token is used to discover authorized App installations and selected
repositories, then discarded. D1 `github_setups` retains a private catalog/error result bound to the
authorizing native session; `oauth_states` stores the one-use handshake state. No user token is
stored there or sent to the browser. Another or expired owner session must authorize again before
changing mappings. Existing repository bindings continue to support observations through short-lived
App installation tokens restricted to their repository and read permissions.

Map each chosen repository explicitly to a Kanbun team. Only authorized issue/team members receive
the synced `githubRepository` and `issuePullRequest` projections. Connecting an owner's private
GitHub repository does not silently put it in every team's working set. Link a PR from the issue's
Development section; its issue ID, incarnation, binding, repository and canonical PR identity are
checked independently at the Worker and DO boundaries. Unlink is a normal human mutation rather
than a browser-supplied provider-state write.

## Signed observations and recovery

The webhook endpoint is public to GitHub and does not require a browser session. It validates
`X-Hub-Signature-256` with HMAC-SHA256 over the original request bytes before processing them,
following [GitHub's signature contract](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).
It then validates installation/repository identity and delivery type. Invalid signatures are denied;
the public endpoint does not let a caller supply trusted projection state. PR/review/check/status
deliveries enqueue canonical API reads for existing linked PRs. Installation suspension/deletion or
repository removal retires the affected bindings. Unrelated deliveries do not create new links.

The DO deduplicates by installation and delivery ID and persists jobs in `scheduled_job`. A job
captures the association IDs that existed when admitted. Each successful target and its checkpoint
commit atomically. Failures remain durable and use the existing Cloudflare alarm retry contract;
there is no added application retry quota or silent success after an arbitrary attempt count.
The normal maintenance scheduler can rearm retained jobs after an interrupted or exhausted alarm.
Inspect provider availability, installation permissions and sanitized observer errors before
retrying; do not discard a durable job to make its error disappear.

Captured jobs recheck binding, issue scope, incarnation and active association after canonical
fetches. Unlink, disconnect, repository revocation and hard deletion prevent a delayed job from
recreating an old association or applying its evidence to a replacement issue. Reserved monotonic
observation revisions prevent an older in-flight fetch from overwriting a newer observation.
Current-head CI/review evidence never becomes a passing/approval signal for another commit.

Workspace backup bundles retain the integration projections, revision/delivery state and scheduled
jobs. Directory restoration deliberately leaves `github_setups` and `oauth_states` empty, alongside
sessions and magic links, so historical setup authority cannot revive. Normal email sign-in and
fresh owner authorization are required after restoration. Isolated recovery targets disable GitHub
management and webhook/observer effects; follow the [data recovery procedure](data-recovery.md)
before any separately reviewed activation.

## Deployment and operational proof

The first rollout adds accounts and workspace migrations plus authentication-sensitive integration
configuration. Apply those through the existing manual compatibility-review path for the exact
green commit. The ordinary automatic code-release guard must continue to reject an incompatible
schema/configuration transition; do not bypass it or roll code back across that transition.
After the reviewed rollout, resume normal CI-gated code deployments.

Verify a real owner connection, selected-repository mapping, canonical PR link, signed delivery and
updated context in another authorized browser. Check that an uninvited/nonowner cannot read the
owner catalog and that current private-team scope controls projection and history access. Retain
bounded receipts without OAuth codes, state/verifier cookies, private keys, tokens, raw provider
payloads or private PR text. Anonymous deployment/health checks do not prove GitHub authorization,
webhook processing or provider availability; those require the separate authenticated flow.

For a failed connection, recheck the exact callback URL, App installation and native owner session,
then use **Update GitHub authorization**. For stale context, inspect App permissions and webhook
delivery status, then **Refresh** the linked PR. A refresh failure leaves the last confirmed facts
and timestamp; it does not fabricate current evidence. Check sanitized
`kanbun.github.authorization_failed` and `workspace_github_observer_failed` events without exposing
provider response bodies. Do not broaden repository permissions or disable webhook validation as a
repair.
