# Issue properties

The issue detail currently shows a title and collaborative description. It has no visible way to
set status, priority, assignee, or labels, and no archive action. The list remains compact while
the detail view gains a labelled properties section above Description.

Status lists active workflow states for the issue's team. A person's selection is a human status
assertion; clearing the override returns to the stored baseline. This slice does not infer status
from external evidence or claim that automated status ranking is implemented.

Priority uses the existing None, Urgent, High, Medium, and Low values. Assignee offers Unassigned
and active eligible people; a private-team issue cannot be assigned to someone outside that team.
Labels show removable chips and an add selector for active workspace or same-team labels. Group
headings cannot be applied as labels. A simple team-label creation action makes the flow usable in
an initially empty workspace; single-select groups retain their existing replacement behavior.

Changes use the existing persisted mutation queue, optimistic projections, rejection feedback, and
automatic cross-browser synchronization. Errors remain visible alongside the authoritative value.
Description editing continues to use its separate durable Yjs document.

Archiving removes the issue from the active list and returns to All issues with an Undo action.
Undo restores and reopens the issue, including its existing description and any retained draft.
Archive is reversible; this flow adds no permanent deletion control.

Native labelled controls, existing typography and color tokens, visible keyboard focus, and a
single-column narrow layout keep the controls usable without adding a component framework.
