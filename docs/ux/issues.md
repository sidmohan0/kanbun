# Local issue list flow

Before this flow, the web app was a brand shell with placeholder navigation and no working issue
controls. The local Worker supports a seeded REC team, issue creation, and title updates. This
screen connects those existing capabilities without adding another mutation vocabulary.

## Screen and interaction

Use the Bone & Cinnabar palette, Inter for interface text, Shippori Mincho for the kanbun name and
page heading, the existing theme-aware mark, and the compact row spacing from the brand kit.
The sidebar has one working destination, All issues, with an explicit Local workspace label.

The Issues page shows a title field and team selector for creation, followed by a table of issue
identifiers, titles, and save state. A new issue appears immediately with a pending identifier;
the server replaces that placeholder with its REC number. Title edits happen in the row, with
explicit Save and Cancel controls, Enter to submit, and Escape to cancel. Focus returns to the
title control after editing. Inputs have visible
labels and feedback. Empty titles cannot be submitted.

The header shows connection state and the number of pending changes. Refresh and window focus
request current data; reconnect retries the queued changes. Cached data remains editable while
offline. Rejected changes show an alert with the affected issue and the server reason, and the
list returns to the authoritative value. Storage failures are visible, rather than presented as a
successful local save. Loading, empty, and first-use initialization states have direct next actions.

Use a stable IndexedDB record for the local user and main branch. One tab owns its write lease;
another tab waits with a clear explanation and automatically continues after the first closes.
This preserves the queue across reloads and future tab openings without letting two clients
overwrite one persisted outbox. Independent browser contexts can sync concurrently.

The local identity is explicitly Alice. Initializing the local workspace is a separate action when
the Worker has no fixture members. Production sign-in, workspace switching, branch review, issue
details, filtering, rich text, and WebSocket notifications remain later flows.

## Proof

Playwright drives the actual React app and Worker to create and rename issues, refresh two browser
contexts into convergence, recover an offline edit after reload, display a real server rejection,
and hand a saved queue between tabs safely. Verify the light, dark, and narrow layouts against the
brand tokens. The complete devcontainer verifier and required PR checks must pass.
