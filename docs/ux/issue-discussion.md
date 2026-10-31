# Issue discussion and activity

The issue detail includes Comments and Activity below the properties and collaborative description.
These use the existing compact spacing, Bone & Cinnabar palette, Inter text, and visible keyboard
focus. This document describes their interaction and persistence contract.

Comments use plain text. People can post a top-level comment, reply one level deep, edit their own
comments, and resolve or reopen a top-level thread. Keep existing comments visible while a draft is
edited; offer Save and Cancel. Label pending comments and preserve submitted work in the existing
workspace outbox across reconnects and reloads. Show loading and retry feedback when earlier comments
cannot be fetched. An unsent composer is not presented as saved work.

Activity shows the current issue's committed property, description, and discussion changes with
the author's name and time. Render named actions instead of raw patches or JSON. Retain names for
inactive authors already known to the workspace. Fetch recent issue-scoped events and provide Load
older activity; do not fetch another issue's history. Refresh after synchronization without losing
the current comment draft. Cached discussion disappears when authentication or membership is lost,
and a fresh admission uses its own cache and outbox.
