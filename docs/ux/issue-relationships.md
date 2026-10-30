# Issue structure and dependencies

Issue details show a parent selector, sub-issues, and linked work. People can create a sub-issue in
its parent's team, assign an existing accessible issue a parent, detach a child, and open linked
issues. A sub-issue has one parent; a parent may have multiple children. The server rejects self
parenting and cycles across the full parent chain, including across teams.

The relationship picker offers Blocks, Blocked by, and Related to. One stored blocking edge is
shown as Blocks at its source and Blocked by at its target. Related links are symmetric: selecting
the inverse does not create a duplicate. Removing a link from either side removes that same edge.
The server rejects self-links and blocking cycles. Existing duplicate and similar relation rows
remain readable, without adding unrelated controls for them in this flow.

Choices come from the current authorized, active issue set. Linking across teams requires access
to both endpoints. Both endpoints are checked again when creating or removing links. A link does
not grant access to another team's work. If an endpoint becomes inaccessible, bootstrap and pull
hide the relationship and omit the inaccessible parent pointer; cached references are refreshed
when an endpoint moves. Historical event and patch APIs also filter inaccessible references.
The canonical relationship remains intact and appears again if access returns. Archived targets
are outside the active picker; restoring one returns it to the active view.

Parent changes and relation additions/removals record IssueParentChanged, IssueRelationAdded and
IssueRelationRemoved facts with shared reducers. The existing issueUpdate parent field uses the
same validation and event path. These commands currently operate on main; branch review remains
a separate feature. Pending changes persist in the existing browser outbox and recover through
ordinary HTTP synchronization and reconnect catch-up.

The flow uses labelled native fields and the existing issue styles. Errors appear in the
relationship panel for optimistic validation; authoritative rejections use the existing workspace
rejection surface. Linked titles are resolved from current authorized issue rows, never copied
into relationship records or historical activity messages.

Proof: graph validation, atomic rejection and memory/SQLite replay in
[mutator tests](../../packages/mutators/test/relationships.test.ts); current-scope privacy, restore
and DO restart through [actual HTTP](../../apps/worker/test/relationships.test.ts); two-browser
convergence, inverse links, cycle errors and offline reload in
[browser recovery tests](../../packages/verifier/test/recovery/app-relationships.spec.ts).
