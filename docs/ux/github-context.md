# GitHub context in issues

GitHub context appears where work is discussed. Linked pull requests add repository, branch, PR
state, review and check chips below issue titles in list and board layouts. The chips open the
source pull request without nesting links inside the existing title editor. Existing issue filters,
sorting and board status controls keep their behavior.

## Development cards and activity

Issue details include a **Development** section. Each linked PR shows its repository and number,
title, head and base branches, Draft/Open/Closed/Merged state, current-commit review/check signals,
and **Last confirmed** timestamp. Source links open the pull request, its checks and commit on
GitHub. Metadata is rendered as text; PR bodies, diffs and repository source code are not imported.

**Link pull request** accepts a GitHub PR URL from a repository connected to the issue's team.
The client identifies the visible repository binding; the server independently checks the issue,
its current incarnation, that binding and the canonical provider response. Linking and refreshing
require connectivity. **Refresh** fetches current provider facts. **Unlink** uses the normal durable
mutation queue, so its intent can survive offline reload without trusting client-supplied GitHub
state. Existing sync and rejection feedback applies.

Linking, unlinking and confirmed GitHub observations appear in the existing attributed Activity
feed. Provider observations are labelled **GitHub** and link to their source PR. Facts group by the
same transaction intent as other issue changes. Signed webhooks trigger canonical provider reads;
they do not turn webhook body fields directly into visible truth. Automatic observations update
other open browsers through the existing synchronization stream.

## What the signals mean

- **Approval recorded** means at least one effective approval on the represented current head,
  with no effective change request. It does not mean every required reviewer or branch protection
  condition is satisfied. The latest effective approval/change-request/dismissal per reviewer is
  considered; earlier votes on an old commit cannot approve a new head.
- **No current-commit review** means no effective approval/change-request vote on that head.
  **Review unknown** means no matching-head review result is available.
- **Checks passing**, **Checks pending** and **Checks failing** describe the aggregate evidence for
  the represented head. No check/status evidence is **Checks unknown**, rather than a green badge.
  Evidence associated with another SHA cannot make a new head look approved or passing.
- **Last confirmed** identifies the recorded observation. A provider failure leaves that last
  confirmed view; it does not pretend a refresh succeeded or guarantee GitHub has not changed since.

These are source facts, not merge permission. GitHub remains the authority for merging its PRs.
A merged PR does not automatically mark a Kanbun issue Done in this slice; human issue status and
GitHub context stay separate. The integration does not create branches, write code, post reviews,
merge PRs or modify GitHub issues.

## Owner connection and team scope

The workspace owner uses **Settings → GitHub** to install the GitHub App for selected repositories
and complete **Connect GitHub**. This OAuth/PKCE authorization discovers the repositories available
to that owner and App installation; Kanbun sign-in remains native email. It is not another public
sign-in method. The private connection catalog is never fetched or rendered for nonowners.

The owner explicitly maps each repository to a Kanbun team. A repository may be connected to more
than one team. The form distinguishes private teams from teams available to all workspace members
and explains that linked metadata becomes visible to people with access to issues in that team.
This is a deliberate metadata disclosure scope, not a grant of GitHub source-code access. GitHub's
own permissions still determine whether a person can open an external source link.

Authorized team members can link and refresh PRs for issues in that team. A public issue cannot
borrow a private-team repository binding. Cards and previously loaded Activity are filtered by the
current issue, team, incarnation and active repository binding. Moving an issue away hides
incompatible context; returning to the original team with the same incarnation can restore it.
Archive/Undo similarly preserves valid associations while hiding archived work. Hard deletion and
recreation cannot reuse old associations. Disconnecting or revoking a repository removes its cards
and redacts its GitHub history; an old queued delivery cannot resurrect them.

The [setup and recovery guide](../github-integration.md) covers credentials, webhook verification,
durable observation jobs and the reviewed storage rollout. Browser qualification must exercise
owner connection, linking, a signed-webhook update in a second browser, source chips and context
revocation using actual product APIs and private provider fixtures. No production auth bypass is
needed. Native controls support keyboard operation, and original subtle card transitions respect
`prefers-reduced-motion`.
