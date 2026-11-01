# Slack workspace connection

This first Slack integration slice connects one Slack workspace, reports its name in Settings,
and lets the Kanbun owner revoke it. Issue actions, channel notifications, unfurls and thread sync
are subsequent slices. It does not enable an agent, slash commands, Asks, Slackbot MCP or Enterprise
Grid. Slack authorization is separate from Kanbun sign-in.

## App setup

Create a Slack app for the installation's HTTPS origin and configure:

- OAuth redirect: `<APP_ORIGIN>/api/integrations/slack/callback`
- Bot token scope: `chat:write` (for subsequent channel notification delivery)
- Events request URL: `<APP_ORIGIN>/api/integrations/slack/events`
- Bot lifecycle event: `app_uninstalled`

Use workspace installations, not organization-wide installation. Token rotation is not supported
by this slice; leave it disabled. Do not configure commands or advertise unavailable capabilities.
Slack's [OAuth guide](https://docs.slack.dev/authentication/installing-with-oauth/) describes app
installation and scopes; [request verification](https://docs.slack.dev/authentication/verifying-requests-from-slack/)
describes signed events and the five-minute replay window.

Configure `SLACK_APP_ID` and `SLACK_CLIENT_ID` as public identifiers. Store `SLACK_CLIENT_SECRET`,
`SLACK_SIGNING_SECRET`, and `SLACK_TOKEN_ENCRYPTION_KEY` in Worker secret storage. The encryption
key must be an independently generated random 32-byte value encoded as base64. Keep it outside Git
and logs, and retain it in the installation's secret manager. Losing or rotating it requires
reconnecting Slack; it cannot be recovered from D1. `SLACK_TRANSPORT` is a test-only private service
binding, not a public provider override.

Apply the accounts migration before deploying this slice using the existing manual compatibility
review process. Do not bypass the automated code-only deployment guard.

## Connection and recovery

Sign in with native email as the workspace owner, open Settings, and select Connect Slack. Slack
must approve installation; local authorization does not override Slack administrator policies.
Only one Slack workspace can be connected to a Kanbun workspace. Disconnect before switching.
Update Slack authorization reconnects the same workspace.

OAuth state is one-use and bound to the browser cookie, native owner session and workspace. Bot
credentials are encrypted with AES-GCM and workspace-bound associated data in accounts D1; the
browser receives only the connection name and identifier. Credentials are never synced to members.
Disconnect revokes the bot token before deleting the connection. Signed uninstall events remove
connections only after checking that the stored token is revoked; timestamp and credential checks
prevent delayed events from deleting a valid reconnection. Provider failures leave the connection
intact and cause Slack to retry delivery.

Isolated recovery targets cannot manage Slack or receive events. Restoring a directory leaves
Slack connections and pending OAuth states empty: reconnect explicitly after recovery activation.
A successful synthetic integration test does not prove a production Slack installation; validate
real owner consent and a disconnect against a disposable workspace before claiming live readiness.
