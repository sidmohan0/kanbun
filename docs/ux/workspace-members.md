# Workspace members and invitation entry

The hosted application admits its configured owner and explicitly invited members. Sign-in alone
does not grant access. A verified person opening the root URL without membership sees "Workspace
access required", instructions to ask the owner for the complete invitation link, and a Check access
again action. Expired sign-in has a separate Sign in to Kanbun screen. Neither failure opens cached
workspace data or submits pending work.

An owner sees a Members destination in workspace navigation. It lists current people and targeted
email invitations, with controls to invite a person, revoke a pending invitation, and remove a member.
The owner cannot remove the owner. Nonowners do not see management navigation and a direct Members
URL explains that workspace ownership is required, without fetching the membership list.

Creating an invitation presents its link once, with a Copy invitation link action. The link remains
only in the current page's memory; invitation lists never disclose tokens. The owner shares the link
through their chosen channel. Creating or sharing actual pilot invitations is a separate action.

The shareable `#invite/<token>` route opens an invitation screen before the workspace client starts.
The server checks the person's existing verified Access identity and targeted email before revealing
invitation details. Acceptance binds that identity to a member account and reloads a fresh workspace
context. Invalid, revoked, expired, already-used, or wrong-recipient invitations show actionable
errors without opening previous cached issues or descriptions. The flow adds no native sign-in or
authentication bypass.

Owner instructions explicitly explain that creating an invitation does not send email. Invitees
need the complete link and the invited email, rather than a separate Kanbun registration. A failed
inspection can be retried after selecting the correct account. An expired session during inspection
or acceptance provides a sign-in action that reloads the same invitation fragment; the token is
removed only after successful acceptance. To select another account without changing an existing
browser session, the invitation screen suggests opening the link in a private browser window.

Members use their own actor-scoped mutation queues and description storage. Removal blocks later
workspace reads, writes, notifications, and description access; a rejected browser session hides
cached rows and descriptions while preserving its unsent local drafts for recovery. Owner and member
roles are server authority rather than browser preferences.

Use existing brand tokens, labelled native form fields, visible loading and error states, keyboard
focus, and a single-column narrow layout. Member removal and invitation revocation are direct owner
actions with explicit names; pending actions disable duplicate submission and success refreshes the
current list.
