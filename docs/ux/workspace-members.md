# Workspace members and invitation entry

The hosted application currently admits only its configured owner. The browser starts its workspace
client on page load, so an invited person without membership receives an authorization failure
before seeing any invitation controls. Member administration and invitation acceptance need distinct
entry points without changing the existing issue flow.

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

Members use their own actor-scoped mutation queues and description storage. Removal blocks later
workspace reads, writes, notifications, and description access; a rejected browser session hides
cached rows and descriptions while preserving its unsent local drafts for recovery. Owner and member
roles are server authority rather than browser preferences.

Use existing brand tokens, labelled native form fields, visible loading and error states, keyboard
focus, and a single-column narrow layout. Member removal and invitation revocation are direct owner
actions with explicit names; pending actions disable duplicate submission and success refreshes the
current list.
