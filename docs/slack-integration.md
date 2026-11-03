# Slack workspace connection

Connect one Slack workspace, preview public-team issue links, and let the Kanbun owner disable
previews or revoke the connection in Settings. Owners can also opt in to deterministic issue-ID
replies in public Slack channels. A message shortcut hands a copied Slack message link to Kanbun,
where a signed-in member chooses an existing accessible issue. It does not enable thread sync,
channel notifications, project links, an agent, slash commands, Asks, Slackbot MCP or Enterprise
Grid. Slack authorization is separate from Kanbun sign-in.

## App setup

Create a Slack app for the installation's HTTPS origin and configure:

- OAuth redirect: `<APP_ORIGIN>/api/integrations/slack/callback`
- Bot token scopes: `chat:write`, `links:read`, `links:write`
- Events request URL: `<APP_ORIGIN>/api/integrations/slack/events`
- Bot events: `app_uninstalled`, `link_shared`
- App unfurl domain: the installation's application hostname
- Interactivity request URL: `<APP_ORIGIN>/api/integrations/slack/interactions`
- A message shortcut named **Link to an existing Kanbun issue**

For the optional public-channel issue-ID replies, also subscribe to `message.channels`. Enable
**Reply to issue IDs in public Slack channels** and then **Update Slack authorization**: only this
opt-in adds `channels:history` to the OAuth request. Existing grants need reauthorization. The app
must participate in the public channel; this slice does not auto-join channels. No private-channel
or DM event subscription/scope is requested, and no history API is called. Disabling replies stops
delivery but does not remove previously granted Slack permissions; remove/reinstall the app to
change the provider grant if necessary.

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

## Message links without synchronization

Open an issue and use **Slack message links** to paste a message URL copied from Slack, optionally
with a descriptive title. Kanbun stores the link as an attachment; it does not fetch the message,
copy its text, synchronize comments, or post to Slack. No Slack app connection or additional scopes
are needed. Opening the link still requires the viewer to have access to the original Slack channel.

Supported links use `https://<workspace>.slack.com/archives/<channel>/p<message timestamp>`.
Copied `thread_ts` context is retained; the redundant `cid` is validated and removed. Adding the same
message again, with or without copied thread context, leaves one attachment. Arbitrary external
URLs and unsupported query parameters are refused. Removing the attachment leaves Slack unchanged.

Attachments inherit the issue's team visibility and move with the issue. Any active member with
access to an active issue can add or remove a link, including on a private team. Saved mutation drafts
are bound to that issue incarnation so deleting and recreating its UUID cannot attach an old draft
to the replacement. Archived or trashed issues cannot receive link edits. Bidirectional synced
threads are a separate feature.

## Link an existing issue from Slack (row 114)

Enable interactivity and add the **Link to an existing Kanbun issue** message shortcut. Selecting it
returns an ephemeral **Choose an issue** button. The button opens Kanbun's issue picker with the
selected message permalink prefilled. The user must sign in to Kanbun and have access to the chosen
issue; the normal issue attachment mutation enforces current membership and visibility. A Slack
account is not automatically treated as a Kanbun identity, and people without Kanbun access cannot
attach the message. The interaction request is verified with Slack's signing secret and five-minute
replay window before its payload is read.

The action attaches only a canonical Slack URL and the generic title “Slack message”. It does not
read or copy message text, create a new issue, sync a thread, or post a reply. It needs no additional
OAuth scopes. Slack's permalink lookup can fail for a message the connected app cannot access; in
that case Slack shows instructions to paste the link into Kanbun instead. Removing the attachment
in Kanbun does not change the Slack message.

## Public-channel issue-ID replies

This is the public-channel portion of physical spreadsheet row128. Private Slack channels and DMs
remain approved follow-up work. It is deterministic and does not enable an agent. The independent
owner setting defaults off; turning unfurls off does not turn replies off, or vice versa.

When an ordinary human message mentions an existing identifier such as `ENG-123`, Kanbun replies
in its parent thread with only the canonical identifier and issue link. Anyone in that Slack channel
can see them. Only issues in public, active Kanbun teams are eligible; private-team issues are never
disclosed. Bot/app/own messages, message subtypes, edits, private channels and DMs are ignored.
Identifiers are case-insensitive. Only the first 20 distinct well-formed identifiers in a message are
considered; malformed, zero-padded and nonexistent identifiers do not produce replies. Messages with
no identifiers create no durable receipt or job. The app
does not import, store or log the message text. No title, description or arbitrary user text is posted.

A private durable receipt and pending reservation are committed before acknowledging the signed
event. Pending work suppresses duplicate mentions even during a long provider outage. After a
successful delivery/checkpoint, the same issue is suppressed in that thread for 60 minutes; a different
issue or thread is independent. Jobs contain identifiers, issue incarnation, channel/thread IDs and
an opaque connection/configuration version, never raw message bodies or credentials. Delivery
rechecks current credentials, scope, owner preference, issue incarnation, current identifier and
public visibility immediately before posting. Disabling/reconnecting retires previous pending work.

Provider outages/rate limits leave jobs pending for retry. Revoked credentials are removed using a
current-token comparison; known inaccessible/archived channel or missing-thread failures retire the
job. A successful `chat.postMessage` followed by a process crash before the local checkpoint can
produce a duplicate on retry. Delivery is at least once; the 60-minute suppression is not an exactly-once
guarantee. Existing posted replies remain in Slack after privacy or preference changes.

See Slack's [public-channel message event](https://docs.slack.dev/reference/events/message.channels/)
and [posting/thread contract](https://docs.slack.dev/reference/methods/chat.postMessage/). Apply the
accounts 0007 and workspace 0011 migrations under the normal compatibility review before deployment.

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
