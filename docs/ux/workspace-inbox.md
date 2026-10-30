# Workspace inbox and explicit mentions

Comments and assignments currently update the shared issue, but there is no personal destination for
work that needs someone's attention. Add an Inbox navigation item for every admitted person, with an
unread count that updates through the existing workspace synchronization. Keep All issues and the
owner's Members destination unchanged.

The inbox shows newest updates first with the initiating person's name, a short notification kind,
the current authorized issue title, and time. Opening an issue and marking an update read are
separate actions; every row offers Mark read or Mark unread. Read state updates optimistically through
the existing durable outbox and global save indicator. Empty inboxes explain that assignments,
mentions, replies, and subscribed comments will appear here. Do not promise email or push delivery.

A notification never supplies a cached issue title or comment excerpt. Resolve links and titles only
against the current authorized issue and creation incarnation. Authentication loss, removed team
access, and a new membership admission hide prior private notifications along with other workspace
rows. Unknown notification kinds use a generic update label.

Comment, reply, and edit forms include a labelled teammate selector and removable mention recipients.
Choices use active people who can access the issue's team. The picker displays names but submits
stable user IDs separately from the plain comment text: typing a name alone does not notify anyone.
Edits begin with existing recipients selected. Renaming a person does not change the selected
identity; unavailable recipients can be removed and cannot be added. Clear recipients only after a
successful local submission or an explicit cancel. Submitted comments and their recipients share the
same offline queue and acknowledgment behavior as other discussion changes.

Use the existing Bone & Cinnabar surfaces, compact controls, visible keyboard focus, and responsive
navigation. Verify two real browser identities receive only their own updates, explicit mentions
survive offline reload and produce one delivery, read state survives reload, and access removal hides
private inbox content. Notification fan-out remains a server consumer responsibility.
