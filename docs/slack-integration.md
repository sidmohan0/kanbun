# Slack workspace connection

Connect one Slack workspace, preview public-team issue links, and let the Kanbun owner disable
previews or revoke the connection in Settings. Issue actions, channel notifications, project links,
and thread sync are subsequent slices. It does not enable an agent, slash commands, Asks, Slackbot MCP or Enterprise
Grid. Slack authorization is separate from Kanbun sign-in.

## App setup

Create a Slack app for the installation's HTTPS origin and configure:

- OAuth redirect: `<APP_ORIGIN>/api/integrations/slack/callback`
- Bot token scopes: `chat:write`, `links:read`, `links:write`
- Events request URL: `<APP_ORIGIN>/api/integrations/slack/events`
- Bot events: `app_uninstalled`, `link_shared`
- App unfurl domain: the installation's application hostname

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

Apply the accounts and workspace migrations before deploying this slice using the existing manual
compatibility review process. Do not bypass the automated code-only deployment guard.

## Issue previews

Only exact canonical `<APP_ORIGIN>/#issues/<issue UUID>` links are supported. Kanbun previews the
issue identifier, title, description, status, assignee and creation date. It never fetches arbitrary
URLs. User text is rendered literally so issue content cannot inject Slack mentions or actions.
Issues must belong to a public, active team and must not be trashed. Project and document previews
and issue write actions are not included.

The owner controls **Preview public issue links in Slack**. Existing connections with only the old
`chat:write` grant display a request to update Slack authorization; previews require both link scopes.
Slack may require an administrator to approve the additional permissions. No message-history scopes
are requested. Disabling previews or reconnecting retires pending work for the previous configuration.
Previously posted previews remain visible in Slack, including after an issue becomes private.

Signed events are durably admitted and deduplicated before acknowledgement. A private workspace
receipt and scheduled job survive retries and provider outages. Jobs contain issue identifiers and
an opaque connection version, never tokens or issue content. Delivery rechecks the current issue
incarnation and public visibility after credential reads, immediately before posting. Preference,
connection and revocation changes are serialized with delivery. A failed Slack request retains its
job for retry; retrying a successful request after a checkpoint failure updates the same Slack unfurl.
Composer and posted-message link events are supported. Slack's
[link event reference](https://docs.slack.dev/reference/events/link_shared/) and
[unfurl method](https://docs.slack.dev/reference/methods/chat.unfurl/) describe the provider contract.

## Connection and recovery

Sign in with native email as the workspace owner, open Settings, and select Connect Slack. Slack
must approve installation; local authorization does not override Slack administrator policies.
Only one Slack workspace can be connected to a Kanbun workspace. Disconnect before switching.
Update Slack authorization reconnects the same workspace.

In the desktop app, choose **Manage Slack in browser** and sign in there before connecting.
The handoff opens only integration settings; authorization starts in the browser so its session
and OAuth state remain together. Reload the desktop app after updating the connection.
If an older installed build does not open the browser, copy the settings address shown in the panel
into your browser's address bar. One-click handoff requires a desktop build with the browser-settings
handler; the selectable address also works with earlier builds.

OAuth state is one-use and bound to the browser cookie, native owner session and workspace. Bot
credentials are encrypted with AES-GCM and workspace-bound associated data in accounts D1; the
browser receives only the connection name and identifier. Credentials are never synced to members.
Disconnect revokes the bot token before deleting the connection. Signed uninstall events remove
connections only after checking that the stored token is inactive; credential checks prevent delayed
events from deleting a valid reconnection without relying on local and provider clocks agreeing.
Provider failures leave the connection intact and cause Slack to retry delivery.

Isolated recovery targets cannot manage Slack or receive events. Restoring a directory leaves
Slack connections and pending OAuth states empty: reconnect explicitly after recovery activation.
A successful synthetic integration test does not prove a production Slack installation; validate
real owner consent and a disconnect against a disposable workspace before claiming live readiness.
