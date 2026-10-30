# Inbox and mentions

Inbox shows assignments, explicit comment mentions, replies to a person's thread, and new comments
on followed issues. Each recipient gets one update per source event; a mention takes precedence
when the same event is also a reply or followed comment. The sender receives no self-notification.
Issue creation with an initial assignee also produces an assignment update.

Mention teammate records a selected member's stable identifier alongside the comment. A typed name
by itself remains plain text. Comments retain selected identifiers through offline edits and reload;
an unchanged mention does not send another update when wording changes. Removing and adding a
mention again is a new mention and requires the recipient's current active access.

Read and unread changes use the ordinary durable browser outbox. The server permits a person to
change only their own currently visible notification. Inbox links resolve issue titles from the
current authorized workspace projection. Stored notification text contains a generic action, not
the source comment or description.

## Background projection

Main-branch semantic facts feed a background consumer through the workspace's existing alarm and
scheduled-job dispatcher. Authoritative commands schedule durable wake intent; the alarm performs
fan-out after commit. Initialization records the current main-event head, so installing Inbox does
not send old history. Subsequent scans use the existing event page size. A durable checkpoint and
delivery key make retries idempotent; projection writes and checkpoint advancement share a SQL
transaction. Backup and notification jobs can progress independently when another job fails.

Eligibility requires the recipient's active directory and local membership, the current admission,
and access to the current issue incarnation and team. Re-invitation clears the old inbox and filter
rows and captures an event floor, preventing delayed facts from restoring a previous membership's
private history. Bootstrap, pull, read changes, and raw activity enforce the same current scope.

`NotificationSubscription` stores `{scope, eventTypes, actors}` filters. A workspace with no explicit
filters uses the initial assignment, mention, reply, and followed-comment rules. Subscription
membership for a followed comment is determined using source log order, so following an issue
later does not produce notifications for an earlier pending comment.

Workspace backups include inbox rows, read state, filters, and the consumer checkpoint. Isolated
restore targets suspend alarm maintenance; restored deliveries remain idempotent when normal
maintenance resumes. Delivery in this slice is in-app; external delivery remains a later step.
