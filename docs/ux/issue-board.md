# Issue board

All issues and My Issues can each switch between List and Board. Both layouts use the same
authorized working set, search terms, property filters, ordering, result counts, and empty-state
guidance. Each destination retains its layout while opening details or visiting another destination
in the current page; a page reload starts with the list. No workspace data or preferences cross
accounts.

The board groups matching issues by team. Each team has columns for its active workflow states in
workflow order, including empty columns. Cards retain the active issue ordering inside each column.
An issue whose status is unavailable remains visible in a separate column and can be moved to an
available status. The board never maps similarly named statuses between teams.

A card links to issue details and displays its identifier, title, priority, assignee, and save state.
Drag a card to another status column in its own team, or use its labelled native Status menu with
the keyboard or touch input. Both controls use the existing semantic status assertion, local
outbox, and server authorization. Moving to the current status does nothing. The board does not
change issue order or team by dragging. Changes that no longer match the active filters leave the
view, as they do in the list. An announced confirmation identifies the moved issue and destination;
server rejection and pending/offline states remain visible through the existing synchronization UI.

Board columns scroll horizontally inside their team section on narrow screens; the surrounding
page remains within the viewport. Native controls provide the complete status-change flow without
dragging. No external drag-and-drop library or additional service is required.

The actual-application browser suite verifies shared filters and My Issues, layout retention across
details, ordered cards, keyboard and drag changes, automatic second-browser convergence, persisted
offline status edits across reload, and team isolation for similarly named columns.
