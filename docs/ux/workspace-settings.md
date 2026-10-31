# Workspace, team and workflow settings

Workspace owners open **Settings** in the sidebar. Members do not see that destination; opening its
URL directly explains that ownership is required. Server-side authorization also rejects forged
member requests. Existing API rules for workspace administrators and team owners remain intact.

## Workspace name

The owner can rename the hosted workspace without changing its address, identity, membership or
issues. This operation requires connectivity and reports a failed request without pretending it
saved. The directory is authoritative for the name; its configured deployment name is only the
initial default. Every authenticated workspace request reconciles the local organization projection
from the directory, so an interruption between stores is repaired on a later request. Synced name
changes update other open browsers and remain after reload. Native local-development context keeps
its development label; workspace naming is a hosted setting.

## Teams

Choose an existing team, edit its name, key and description, or create a new team with a name and issue
identifier key. A new team is visible to everyone already admitted to this workspace. This does not
make the workspace publicly accessible. The existing default workflow creates Backlog, Todo,
In Progress, Done and Canceled statuses. The creator receives the existing team-owner membership.

Keys contain one to seven letters or digits, starting with a letter, and save in uppercase.
A key must be unique across all teams. Changing a key updates existing issue identifiers (for example,
`KAN-12` becomes `DF-12`) while preserving issue IDs, numbers, links and the next issue number.
Private teams keep their existing membership restrictions; this interface neither changes visibility
nor grants private-team access. Team deletion, retirement and
private-team membership administration are outside this flow.

## Workflow statuses

Rename active statuses, add a status in an existing category, choose a team's default status for new
issues, and move statuses up or down within their category. Keyboard-accessible move buttons avoid
requiring a drag gesture. Categories retain their semantic meaning and existing issue references
remain intact. The status order used by issue controls follows the same category order.

Reordering is one atomic mutation over the exact active category. If another person has added or
removed a status meanwhile, the request is rejected with a refresh instruction rather than silently
omitting a state. Team and status mutations use the existing persisted outbox, optimistic projection,
server checks and rejection notices. Offline changes survive reload and synchronize after reconnect;
the workspace indicator distinguishes pending work from server-confirmed changes.
