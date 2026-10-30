# Issue detail and collaborative description

The current Issues screen provides a compact list, creation, and inline title editing. Issue
identifiers are plain cells; there is no place to capture a work description or a URL that opens
one issue. Keep the existing list and title controls while adding identifier links.

An issue link opens `#issues/<issue-id>`. The detail view shows the team identifier, title, a Back
to issues link, and a labelled Description editor. Browser navigation and direct reload open the
same issue. Unknown or inaccessible issue IDs show a clear unavailable state without exposing
cached content from another identity.

The first editor uses plain text in a Yjs document. Local changes persist before network delivery;
the interface distinguishes pending, offline, saved, and failed storage or authorization states.
Two people editing from the same starting description retain both contributions after reconnect,
including when either browser reloads with pending work. A save acknowledgement means the document
and its workspace mirror are durable. The workspace log contains attributed mirror/hash events,
while the document body remains in its own Durable Object.

Use the existing Bone & Cinnabar tokens, typography, visible focus, labelled controls, and narrow
layout behavior. Description editing is initially on main for human members; this view does not
introduce branch review, rich formatting controls, or agent document writes.
