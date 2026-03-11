# Operations Runbook

This runbook covers the common operator and maintainer checks for Kanbun.

## Common Failure Modes

### Google or Microsoft shows connected but cannot sync

Check:

- token scopes changed and the account needs reconnect
- provider health notes in Settings
- connector issues in Reviews
- worker logs for `reconnect_required` or `degraded` classification

Action:

- reconnect the provider account
- rerun sync from Settings

### Todoist task mirroring is stale

Check:

- `TODOIST_API_TOKEN` is present
- task row shows `queued`, `degraded`, or `synced`
- worker is processing Todoist sync jobs

Action:

- retry mirror from Tasks
- rerun Todoist reconcile from Settings

### Sequence drafts are not sending

Check:

- provider account is still send-capable
- sequence is active
- enrollment is active
- send window and daily cap are not blocking dispatch
- approval queue item is not still in `draft`

Action:

- approve or requeue the draft
- reconnect provider if scopes or tokens are stale

### Replies are not stopping sequences

Check:

- provider connection has the newer reply-read scopes
- worker is running
- reply signals appear on the contact page
- provider notes in Settings mention reply tracking mode and last scan

Action:

- reconnect the provider
- run provider sync manually
- verify the outbound message has provider thread or message metadata

## Routine Checks

Daily:

- review connector issues in `/reviews`
- review failed or blocked outbound messages in `/sequences`
- review degraded Todoist mirror tasks in `/tasks`

Weekly:

- verify webhook subscriptions or Gmail watches are being renewed
- inspect worker logs for repeated retry loops
- confirm backups are completing successfully

## Safe Recovery

When in doubt:

1. do not delete canonical contacts
2. prefer reconnect + resync over manual DB edits
3. prefer requeueing a failed send over fabricating a sent state
4. use merge/split tools instead of editing source records directly
