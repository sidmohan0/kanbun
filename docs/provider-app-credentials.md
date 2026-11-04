# Self-hosted provider app credentials

Hosted Kanbun uses provider apps managed by the service. Self-hosted installations can opt in to
workspace-owned GitHub, Slack and Google app registrations. This is separate from each workspace
owner's consent to connect an account or Slack team.

## Enable workspace app setup

Set the Worker variable `INTEGRATION_CREDENTIALS_MODE=workspace` and add the Worker secret
`INTEGRATION_CREDENTIALS_ENCRYPTION_KEY`. Generate a 32-byte random key encoded as base64 in a
private terminal:

```sh
openssl rand -base64 32
```

Store the result directly with the deployment's Worker secret manager. Do not commit it, put it in
the browser, or paste it into the settings UI. The UI accepts provider app credentials; this key is
deployment-owned encryption material and is not workspace data. Keep the key stable across normal
deployments. Replacing it makes saved provider settings undecryptable; configure the provider apps
again with a new key. In this mode the same key can encrypt Google refresh tokens and Slack bot
tokens unless the installation already supplies their dedicated token-encryption keys.

After enabling the mode, an owner opens **Settings → Integrations → Provider app setup**. The form
shows the exact callback and webhook URLs for that workspace. Secret inputs start blank on every
load. Leaving a secret blank preserves its saved value; entering a new value rotates it. The server
validates field format, encrypts the complete configuration with AES-GCM and binds the ciphertext
to the workspace and provider. API responses contain only configured state, timestamps, revision,
OAuth validation state, callback URLs, scopes and webhook URLs. They never contain provider secrets
or ciphertext. The server does not log submitted values. A successful owner OAuth connection marks
that exact saved revision as verified; saving a rotation clears the marker until the next successful
connection.

Provider app credentials are used for app identity and OAuth code exchange. They do not grant Kanbun
access to anyone's account by themselves. After setup, the owner still clicks **Connect** and approves
the requested access in GitHub, Slack or Google. Provider credentials are checked during that OAuth
flow; GitHub also validates that its app ID, slug and private-key signature agree when it reads app
data. A provider's client secret cannot generally be tested without an authorization code. A failed
OAuth exchange gives a safe setup/reconnect message; provider response bodies are not shown.

## Provider registrations

### GitHub App

Create one GitHub App per workspace registration. Enter its numeric App ID, URL slug, OAuth client
ID and secret, PKCS#8 private key, and webhook secret. The callback URI is the workspace's displayed
`/api/integrations/github/callback`. Set the App webhook URL to the displayed
`/api/integrations/github/webhook/<workspace-id>` and use the same webhook secret. Keep the current
read-only repository permissions and event subscriptions listed in the
[GitHub setup guide](github-integration.md). Install the App on the intended repositories, then
authorize from Kanbun and map repositories to teams.

### Slack App

Create a Slack app per workspace. Enter its App ID, OAuth client ID and secret, and signing secret.
Use the displayed `/api/integrations/slack/callback` redirect. Set the Events API request URL and
interactivity request URL to the two displayed workspace-specific URLs. Preserve the required scopes
in the [Slack setup guide](slack-integration.md). Slack validates each endpoint and Kanbun verifies
the exact request bytes with this workspace's signing secret before handling the event.

### Google OAuth client

Create a web application OAuth client. Enter its client ID and secret, enable the Sheets API, and add
the displayed `/api/integrations/google-sheets/callback` as an authorized redirect URI. Kanbun
requests only `drive.file`; see the [Google Sheets guide](google-sheets-integration.md).

## Rotation and removal

Save a replacement value in the relevant secret input to rotate it. The old value is never displayed.
After rotation, reconnect the provider so its authorization code is exchanged using the new client
credentials. Update GitHub or Slack webhook settings to match the replacement webhook/signing secret
before sending deliveries. If provider verification fails, check the exact callback URL, app ID,
client ID/secret pair, required scopes and webhook secret in the provider console.

Deleting provider app settings removes their encrypted app credentials. It does not revoke a grant at
the provider or delete the separately stored Slack/Google authorization. Disconnect that integration
in its settings and revoke the grant in the provider's account/app controls when needed. Existing
GitHub repository mappings also need their normal disconnect action before the app registration is
retired. A deleted app configuration stops new OAuth exchanges and rejects its workspace-specific
webhook endpoint.

The encrypted configuration table is omitted from restored directory data. Restore therefore
requires the owner to re-enter provider app settings and authorize integrations again. Keep the
deployment encryption key available during backups and planned recovery; it is never included in
backup or restore material.
