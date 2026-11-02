# Google Sheets command

Hosted workspace owners can open **Commands** in the sidebar or press **Cmd/Ctrl+K** outside
editors and other dialogs. The accessible dialog currently offers one implemented action:
**Sync to Google Sheets**. It reads current connection status when opened and uses the existing
manual-sync endpoint only when the owner activates the action. Opening Commands never starts
Google authorization or writes to a spreadsheet.

The command shows progress, confirms a successful export, and reports a generic failure without
provider diagnostics. A disconnected or unconfigured installation shows guidance and a link to
**Settings → Integrations**. Desktop sessions can run manual sync directly; Google connection setup
continues through the existing browser-settings handoff. Members and local sessions do not receive
this hosted integration command.

Escape dismisses the dialog and returns focus. Editor-owned shortcuts, prevented events, composition,
and existing modals retain their keyboard behavior. Export scope and overwrite behavior are unchanged:
only public-team data is exported, and Kanbun owns the Issues and configured Projects sheet tabs.
