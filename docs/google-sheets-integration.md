# Google Sheets export

The workspace owner can connect one Google account under **Settings → Integrations → Google Sheets**.
Kanbun creates a spreadsheet named **Kanbun Issues** with owned **Issues** and **Projects** tabs.
Issues are exported by default; enable **Include projects** to populate Projects. An empty Projects
header remains when projects are disabled. Other tabs are left alone.

**Update now** overwrites edits to the owned tabs. Automatic refresh checks hourly and writes only
when workspace data changed. Removed, deleted, and newly private records disappear on the next
successful refresh. Previously exported data can remain in Google until that refresh succeeds;
Google sharing and version history are managed in Google. Keep custom analytics in another tab or
spreadsheet, using formulas such as `IMPORTRANGE`. User text is written as literal strings, never
evaluated as spreadsheet formulas.

Only issues in active public teams and projects attached to at least one active public team export.
Private-only project references, private parent issues, private team names, and private-team labels
are excluded from related columns. Archived issues/projects remain available with archive timestamps;
trashed objects do not export. Timestamps are the stored UTC ISO timestamps; blanks represent missing
values. Export does not invent timestamp transitions or alter application status behavior.

The spreadsheet ID is retained across refreshes and reconnection, so renaming the spreadsheet or
moving it does not create another file. Keep the app's access when moving to a shared drive; a Google
permission failure is shown in settings and can be retried after access is restored. Do not delete the
owned tabs; if removed, Google rejects the refresh and settings shows a recoverable error. Disconnect
stops scheduled updates and deletes Kanbun's stored refresh credential. It leaves the exported
spreadsheet and its sharing intact. The owner can also revoke the app in Google account permissions.

## Installer configuration

Enable the [Google Sheets API](https://developers.google.com/workspace/sheets/api/quickstart/js) in
the OAuth application's Google Cloud project. Configure a **Web application** OAuth client with this
exact authorized redirect URI, replacing the origin for independent installations:

```text
https://kanbun.ai/api/integrations/google-sheets/callback
```

Configure the OAuth consent screen, authorized test users while in testing mode, and production
publishing as appropriate. Google testing-mode refresh credentials may expire; a production rollout
must use the intended consent-screen publishing state. The app requests only
`https://www.googleapis.com/auth/drive.file`, Google's recommended non-sensitive per-file scope,
which permits Sheets operations on files created by this app. It does not request access to all files
in the account. See [Google's scope guidance](https://developers.google.com/workspace/sheets/api/scopes)
and [web-server authorization flow](https://developers.google.com/identity/protocols/oauth2/web-server).

| Worker configuration          | Storage                                                             |
| ----------------------------- | ------------------------------------------------------------------- |
| `GOOGLE_SHEETS_CLIENT_ID`     | OAuth client ID, installation configuration                         |
| `GOOGLE_SHEETS_CLIENT_SECRET` | Worker secret                                                       |
| `GOOGLE_SHEETS_TOKEN_KEY`     | Worker secret, base64 encoding of 32 cryptographically random bytes |

Apply the accounts D1 migration before deploying this code. Refresh credentials are AES-GCM
encrypted with the token key and workspace ID as authenticated context, stored only in D1, and never
synced to browsers. Keep the encryption key outside Git and logs and retain it across ordinary code
deployments. Replacing it requires Google reconnection. Backup directory snapshots contain encrypted
credentials, but restore deliberately empties the connection table alongside native session and OAuth
state tables. Isolated recovery targets disable both management and outbound sync; restored production
workspaces require a fresh Google connection.

OAuth uses state bound to the native owner session, a secure HTTP-only browser cookie, PKCE, and
one-use state consumption. Google integration authorization is separate from Kanbun sign-in. Manual
and scheduled commands share the DO's serialized queue, so an in-flight refresh cannot recreate
authorization after disconnect. Failed jobs remain durable and retry through Cloudflare alarms;
status responses contain sanitized errors, never Google tokens or provider payloads.
The refresh intent and alarm are persisted before the separate D1 connection commit. An interruption
after that commit therefore retains an automatic wakeup without requiring another user request;
an interrupted attempt that never stores a connection is safely cleaned up by the alarm.

## Scope and validation

This slice implements connection, issue/project export, optional project data, hourly/manual refresh,
literal text writes, privacy filtering, and disconnect/reconnect. Initiative export is pending the
initiative domain model. Export columns reflect currently implemented fields; initiatives, roadmaps,
derived SLA status, customer revenue/count, project members, and project updates are not fabricated.
CSV export and an analytics template are separate follow-ups in the integration roadmap.

The provider contract is exercised against a private synthetic Google service in workerd, including
OAuth isolation, plaintext credential exclusion, public-to-private removal, formula-like text,
unchanged hourly refresh, failed refresh recovery, and refresh/disconnect ordering. Live OAuth consent
and a real Google spreadsheet must be verified after installer credentials are configured; fixture
tests do not establish production access or shared-drive policies.
