import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import type { Row } from "@kanbun/model";
import { issueIncarnation } from "@kanbun/sync";
import type { SyncStatus } from "@kanbun/sync/client";
import { Mark } from "./brand/Mark";
import { workspace } from "./workspace";
import { IssueDetail } from "./IssueDetail";
import { Members } from "./Members";
import { TeamSettings } from "./TeamSettings";
import { Inbox } from "./Inbox";
import { IssueViewToolbar } from "./IssueViewToolbar";
import { emptyIssueFilters, visibleIssues, type IssueFilters, type IssueView } from "./issueViews";
import { refreshDescriptions } from "./description";
import "./styles/issues.css";

type Theme = "light" | "dark" | "system";
function initialTheme(): Theme {
  try {
    const theme = localStorage.getItem("kanbun:theme");
    if (theme === "light" || theme === "dark") return theme;
  } catch {
    /* Theme preferences are optional. */
  }
  return "system";
}
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
function connectionMessage(error: string | null, local: boolean) {
  if (/Web Locks/i.test(error ?? ""))
    return "This browser cannot coordinate local workspace storage. Open kanbun in a browser with Web Locks support.";
  if (/IndexedDB|storage|quota|denied/i.test(error ?? ""))
    return "Browser storage is unavailable. Check this site's storage permissions, then try again.";
  if (local && error?.includes("HTTP 403"))
    return "The local workspace is unavailable. If this is your first visit, initialize it below.";
  if (local && error?.includes("HTTP 503"))
    return "The local workspace is disabled. Start the local development stack and try again.";
  return local
    ? "Check your connection and that the local development stack is running, then choose Refresh to try again."
    : (error ?? "Check your connection and reload to open your workspace.");
}
function identifier(issue: Row<"issue">, teams: Row<"team">[]) {
  return issue.number === 0
    ? "Pending issue"
    : `${teams.find((team) => team.id === issue.teamId)?.key ?? "ISSUE"}-${issue.number}`;
}

function IssueRow({
  issue,
  teams,
  pending,
  status,
  stateName,
  assigneeName,
}: {
  issue: Row<"issue">;
  teams: Row<"team">[];
  pending: boolean;
  status: SyncStatus;
  stateName: string;
  assigneeName: string;
}) {
  const name = identifier(issue, teams);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(issue.title);
  const [error, setError] = useState<string | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!editing && restoreFocus.current) {
      editButton.current?.focus();
      restoreFocus.current = false;
    }
  }, [editing]);
  function finishEditing() {
    restoreFocus.current = true;
    setEditing(false);
  }
  function edit() {
    setTitle(issue.title);
    setError(null);
    setEditing(true);
  }
  function save(event: FormEvent) {
    event.preventDefault();
    try {
      if (!title.trim()) throw new Error("Enter a title before saving.");
      workspace.renameIssue(issue.id, title.trim());
      finishEditing();
      setError(null);
    } catch (cause) {
      setError(message(cause));
    }
  }
  return (
    <tr aria-label={name} className={editing ? "issue-row editing" : "issue-row"}>
      <td className="issue-identifier">
        <a href={`#issues/${issue.id}`} aria-label={`Open ${name}`}>
          {name}
        </a>
      </td>
      <td className="issue-title-cell">
        {editing ? (
          <form className="title-editor" onSubmit={save}>
            <label htmlFor={`title-${issue.id}`}>Title for {name}</label>
            <div className="title-editor-controls">
              <input
                id={`title-${issue.id}`}
                value={title}
                maxLength={500}
                autoFocus
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") finishEditing();
                }}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `error-${issue.id}` : undefined}
              />
              <button className="button primary compact" type="submit">
                Save title
              </button>
              <button className="button quiet compact" type="button" onClick={finishEditing}>
                Cancel
              </button>
            </div>
            {error && (
              <p id={`error-${issue.id}`} className="field-error" role="alert">
                {error}
              </p>
            )}
          </form>
        ) : (
          <button
            ref={editButton}
            className="issue-title-button"
            aria-label={`Edit title for ${name}`}
            aria-describedby={`issue-properties-${issue.id}`}
            onClick={edit}
          >
            <span>{issue.title}</span>
            <span className="row-properties" id={`issue-properties-${issue.id}`}>
              {`Status: ${stateName} · Priority: ${["None", "Urgent", "High", "Medium", "Low"][issue.priority]} · Assignee: ${assigneeName}`}
            </span>
            <span className="edit-hint" aria-hidden="true">
              Edit
            </span>
          </button>
        )}
      </td>
      <td className="issue-save-state">
        <span className={pending ? "row-state pending" : "row-state"}>
          {pending
            ? "Pending"
            : status === "error"
              ? "Unsaved"
              : status === "offline"
                ? "Cached"
                : status === "idle"
                  ? "Saved"
                  : "Saving"}
        </span>
      </td>
    </tr>
  );
}

function selectedIssueId(): string | null {
  const prefix = "#issues/";
  if (!location.hash.startsWith(prefix)) return null;
  try {
    return decodeURIComponent(location.hash.slice(prefix.length));
  } catch {
    return null;
  }
}

export function App() {
  const snapshot = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  const [view, setView] = useState<IssueView>(() => (location.hash === "#my-issues" ? "mine" : "all"));
  const [viewFilters, setViewFilters] = useState<Record<IssueView, IssueFilters>>(() => ({
    all: emptyIssueFilters(),
    mine: emptyIssueFilters(),
  }));
  const [inboxView, setInboxView] = useState(() => location.hash === "#inbox");
  const [teamsView, setTeamsView] = useState(() => location.hash === "#settings");
  const [membersView, setMembersView] = useState(() => location.hash === "#members");
  const [issueId, setIssueId] = useState(selectedIssueId);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [title, setTitle] = useState("");
  const [teamId, setTeamId] = useState("");
  const [archivedIssue, setArchivedIssue] = useState<Row<"issue"> | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(false);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  useEffect(() => {
    void workspace.start();
    const changeRoute = () => {
      setIssueId(selectedIssueId());
      setMembersView(location.hash === "#members");
      setTeamsView(location.hash === "#settings");
      setInboxView(location.hash === "#inbox");
      if (location.hash === "#my-issues") setView("mine");
      else if (location.hash === "#issues" || location.hash === "") setView("all");
    };
    window.addEventListener("hashchange", changeRoute);
    return () => window.removeEventListener("hashchange", changeRoute);
  }, []);
  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset["theme"];
    else document.documentElement.dataset["theme"] = theme;
    try {
      localStorage.setItem("kanbun:theme", theme);
    } catch {
      /* Keep the current page theme. */
    }
  }, [theme]);
  const selectedTeam = teamId || snapshot.teams[0]?.id || "";
  const context = snapshot.context;
  const selectedIssue = snapshot.issues.find((issue) => issue.id === issueId);
  const local = context?.mode === "local";
  const workspaceName = context?.workspaceName ?? "Workspace";
  const userName = context?.name ?? "Not signed in";
  const ready = snapshot.phase === "ready";
  const canManageTeams = context?.role === "owner";
  const canCreate = ready && Boolean(selectedTeam);
  const filters = viewFilters[view];
  const issues = visibleIssues({
    issues: snapshot.issues,
    teams: snapshot.teams,
    labelLinks: snapshot.labelLinks,
    actorId: context?.actor.id ?? null,
    view,
    filters,
  });
  const stateNames = new Map(snapshot.workflowStates.map((state) => [state.id, state.name]));
  const memberNames = new Map(snapshot.members.map((member) => [member.id, member.displayName || member.name]));
  const myIssueCount = snapshot.issues.filter((issue) => issue.assigneeId === context?.actor.id).length;
  const filtersActive = filters.search || filters.stateId || filters.assigneeId || filters.priority || filters.labelId;
  const listName = view === "mine" ? "My Issues" : "All issues";
  const pendingIds = new Set(snapshot.pendingIssueIds);
  const status =
    snapshot.status === "offline"
      ? "Offline"
      : snapshot.status === "error"
        ? "Needs attention"
        : snapshot.pending > 0
          ? `${snapshot.pending} pending`
          : ready && snapshot.status === "idle"
            ? "Saved"
            : "Connecting";
  function create(event: FormEvent) {
    event.preventDefault();
    try {
      if (!title.trim()) throw new Error("Enter an issue title.");
      if (!selectedTeam) throw new Error("Choose an active team.");
      workspace.createIssue(selectedTeam, title.trim(), view === "mine" ? context?.actor.id : undefined);
      setTitle("");
      setFormError(null);
    } catch (error) {
      setFormError(message(error));
    }
  }
  async function initialize() {
    if (!local) return;
    setInitializing(true);
    setInitializationError(null);
    try {
      const response = await fetch("/__local/seed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok)
        throw new Error("The local workspace could not be initialized. Check that the local Worker is running.");
      await workspace.refresh();
    } catch (error) {
      setInitializationError(message(error));
    } finally {
      setInitializing(false);
    }
  }
  function archived(issue: Row<"issue">) {
    setArchivedIssue(issue);
    location.hash = view === "mine" ? "my-issues" : "issues";
  }
  function undoArchive() {
    if (!archivedIssue) return;
    try {
      workspace.archiveIssue(archivedIssue.id, false);
      location.hash = `issues/${archivedIssue.id}`;
      setArchivedIssue(null);
      setFormError(null);
    } catch (failure) {
      setFormError(message(failure));
    }
  }
  function retryWorkspace() {
    if (snapshot.authenticationRequired || !context) location.reload();
    else {
      void workspace.refresh();
      refreshDescriptions();
    }
  }
  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar" aria-label="Workspace navigation">
        <a className="brand-lockup" href="#issues">
          <Mark size={26} />
          <span>kanbun</span>
        </a>
        <div className="workspace-label">
          <span className="workspace-avatar" aria-hidden="true">
            {workspaceName.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{workspaceName}</strong>
            <span>{local ? "Development" : context ? "Signed in" : "Connecting"}</span>
          </div>
        </div>
        <nav>
          <a
            className="navigation-item"
            href="#issues"
            aria-current={!membersView && !inboxView && !teamsView && view === "all" ? "page" : undefined}
          >
            <span className="navigation-symbol" aria-hidden="true">
              ≡
            </span>
            All issues{ready && <span className="navigation-count">{snapshot.issues.length}</span>}
          </a>
          <a
            className="navigation-item my-issues-navigation"
            href="#my-issues"
            aria-current={!membersView && !inboxView && !teamsView && view === "mine" ? "page" : undefined}
          >
            <span className="navigation-symbol" aria-hidden="true">
              ◇
            </span>{" "}
            My Issues{ready && <span className="navigation-count">{myIssueCount}</span>}
          </a>
          <a className="navigation-item inbox-navigation" href="#inbox" aria-current={inboxView ? "page" : undefined}>
            <span className="navigation-symbol" aria-hidden="true">
              ◉
            </span>{" "}
            Inbox
            {ready && snapshot.unreadNotificationCount > 0 && (
              <span
                className="navigation-count"
                aria-label={`${snapshot.unreadNotificationCount} unread notifications`}
              >
                {snapshot.unreadNotificationCount}
              </span>
            )}
          </a>
          {canManageTeams && (
            <a
              className="navigation-item teams-navigation"
              href="#settings"
              aria-current={teamsView ? "page" : undefined}
            >
              <span className="navigation-symbol" aria-hidden="true">
                ▦
              </span>{" "}
              Settings
            </a>
          )}
          {context?.mode === "hosted" && context.role === "owner" && (
            <a
              className="navigation-item members-navigation"
              href="#members"
              aria-current={membersView ? "page" : undefined}
            >
              <span className="navigation-symbol" aria-hidden="true">
                ◎
              </span>{" "}
              Members
            </a>
          )}
        </nav>
        <div className="sidebar-footer">
          <div className="local-person">
            <span className="person-avatar" aria-hidden="true">
              {context ? userName.slice(0, 1).toUpperCase() : "?"}
            </span>
            <div>
              <strong>{userName}</strong>
              <span>{local ? "Local fixture identity" : (context?.email ?? "")}</span>
            </div>
          </div>
          <label className="theme-control">
            Appearance
            <select aria-label="Color theme" value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
      </aside>
      <main className="issues-main" id="issues">
        <header className="workspace-topbar">
          <span className="workspace-breadcrumb">
            {workspaceName} <span aria-hidden="true">/</span>{" "}
            {teamsView
              ? "Settings"
              : inboxView
                ? "Inbox"
                : membersView
                  ? "Members"
                  : selectedIssue
                    ? identifier(selectedIssue, snapshot.teams)
                    : listName}
          </span>
          <div className="sync-actions">
            <span className="sync-indicator" data-state={snapshot.status} role="status" aria-live="polite">
              <span className="sync-dot" aria-hidden="true" />
              {status}
              {snapshot.status === "offline" && snapshot.pending > 0 && <span> · {snapshot.pending} pending</span>}
            </span>
            <button
              className="button quiet compact"
              onClick={retryWorkspace}
              disabled={snapshot.phase === "starting" || snapshot.phase === "waiting"}
            >
              Refresh
            </button>
          </div>
        </header>
        <div className="issues-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">YOUR WORKSPACE</p>
              <h1>
                {teamsView
                  ? "Settings"
                  : inboxView
                    ? "Inbox"
                    : membersView
                      ? "Members"
                      : issueId
                        ? "Issue"
                        : view === "mine"
                          ? "My Issues"
                          : "Issues"}
              </h1>
              <p className="page-description">
                {teamsView
                  ? "Manage your workspace, teams and workflow statuses."
                  : inboxView
                    ? "Your personal workspace updates."
                    : membersView
                      ? "Manage who can access this workspace."
                      : selectedIssue
                        ? identifier(selectedIssue, snapshot.teams)
                        : "A place for the work ahead."}
              </p>
            </div>
            {context && <span className="local-badge">{local ? "Local development" : "Private workspace"}</span>}
          </div>
          {snapshot.phase === "waiting" ? (
            <section className="empty-state" aria-labelledby="waiting-title">
              <h2 id="waiting-title">Workspace open in another tab</h2>
              <p>Close the other kanbun tab to continue here. Your saved changes will be restored.</p>
            </section>
          ) : snapshot.phase === "failed" ? (
            <section className="connection-panel">
              <h2>Couldn’t open this workspace</h2>
              <p role="alert">
                {initializationError ??
                  (snapshot.authenticationRequired
                    ? "Sign in again and reload this page to continue. Pending changes remain saved in this browser."
                    : connectionMessage(snapshot.error, local))}
              </p>
              <div className="panel-actions">
                <button className="button primary" onClick={retryWorkspace}>
                  {snapshot.authenticationRequired ? "Sign in again" : "Try again"}
                </button>
                {local && snapshot.error?.includes("HTTP 403") && (
                  <button className="button" onClick={() => void initialize()} disabled={initializing}>
                    {initializing ? "Initializing…" : "Initialize local workspace"}
                  </button>
                )}
              </div>
            </section>
          ) : (
            <>
              {snapshot.error && (
                <div className="notice" role="alert">
                  <strong>
                    {snapshot.status === "offline" ? "Connection unavailable." : "Changes need attention."}
                  </strong>{" "}
                  {connectionMessage(snapshot.error, local)}
                </div>
              )}
              {snapshot.rejections.map((rejection) => {
                const issue = snapshot.issues.find((row) => row.id === rejection.issueId);
                return (
                  <div className="notice rejection" role="alert" key={rejection.id}>
                    <div>
                      <strong>Change rejected{issue ? ` · ${identifier(issue, snapshot.teams)}` : ""}.</strong>{" "}
                      {rejection.message}
                    </div>
                    <button
                      className="notice-dismiss"
                      aria-label="Dismiss rejection"
                      onClick={() => workspace.dismissRejection(rejection.id)}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              {!teamsView &&
                !membersView &&
                !inboxView &&
                archivedIssue &&
                !snapshot.issues.some((issue) => issue.id === archivedIssue.id) && (
                  <div className="notice archive-notice" role="status" aria-label="Archive status">
                    <span>{identifier(archivedIssue, snapshot.teams)} archived.</span>
                    <button className="button quiet compact" onClick={undoArchive}>
                      Undo archive
                    </button>
                    <button
                      className="notice-dismiss"
                      aria-label="Dismiss archive notice"
                      onClick={() => setArchivedIssue(null)}
                    >
                      ×
                    </button>
                  </div>
                )}
              {teamsView ? (
                ready && canManageTeams ? (
                  <TeamSettings snapshot={snapshot} />
                ) : (
                  <section className="empty-state">
                    <h2>{ready ? "Workspace owner access required" : "Opening team settings…"}</h2>
                    {ready && <p>Only workspace owners can manage teams in this interface.</p>}
                    <a href="#issues">Return to all issues</a>
                  </section>
                )
              ) : inboxView ? (
                ready ? (
                  <Inbox snapshot={snapshot} />
                ) : (
                  <section className="empty-state">
                    <p>Opening your inbox…</p>
                  </section>
                )
              ) : membersView ? (
                ready && context?.mode === "hosted" && context.role === "owner" ? (
                  <Members />
                ) : (
                  <section className="empty-state">
                    <h2>{ready ? "Workspace owner access required" : "Opening members…"}</h2>
                    {ready && <p>Only workspace owners can manage members and invitations.</p>}
                    <a className="back-to-issues" href="#issues">
                      Return to all issues
                    </a>
                  </section>
                )
              ) : issueId ? (
                selectedIssue && context ? (
                  <IssueDetail
                    key={`${context.workspaceId}:${context.actor.id}:${context.admissionId ?? "owner"}:${selectedIssue.id}:${issueIncarnation(selectedIssue)}`}
                    issue={selectedIssue}
                    context={context}
                    workspaceSnapshot={snapshot}
                    onArchive={archived}
                    backHref={view === "mine" ? "#my-issues" : "#issues"}
                    backLabel={listName}
                  />
                ) : (
                  <section className="empty-state">
                    <h2>{ready ? "Issue unavailable" : "Opening issue…"}</h2>
                    {ready && <p>This issue was archived, removed, or is not visible in this workspace.</p>}
                    <a className="back-to-issues" href="#issues">
                      Return to all issues
                    </a>
                  </section>
                )
              ) : (
                <>
                  <section className="create-panel" aria-labelledby="create-heading">
                    <h2 id="create-heading">What needs to get done?</h2>
                    <form className="create-form" onSubmit={create}>
                      <div className="title-field">
                        <label htmlFor="new-issue-title">Issue title</label>
                        <input
                          id="new-issue-title"
                          placeholder="Give the work a clear title"
                          value={title}
                          onChange={(event) => setTitle(event.target.value)}
                          maxLength={500}
                          disabled={!canCreate}
                          aria-invalid={Boolean(formError)}
                          aria-describedby={formError ? "create-error" : undefined}
                        />
                      </div>
                      <div className="team-field">
                        <label htmlFor="new-issue-team">Team</label>
                        <select
                          id="new-issue-team"
                          value={selectedTeam}
                          onChange={(event) => setTeamId(event.target.value)}
                          disabled={!canCreate}
                        >
                          {!snapshot.teams.length && <option value="">No active team</option>}
                          {snapshot.teams.map((team) => (
                            <option key={team.id} value={team.id}>
                              {team.key}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        className="button primary create-button"
                        type="submit"
                        disabled={!canCreate || !title.trim()}
                      >
                        <span aria-hidden="true">+</span> Create issue
                      </button>
                    </form>
                    {formError && (
                      <p className="field-error" id="create-error" role="alert">
                        {formError}
                      </p>
                    )}
                  </section>
                  <IssueViewToolbar
                    view={view}
                    filters={filters}
                    snapshot={snapshot}
                    onChange={(value) => setViewFilters((current) => ({ ...current, [view]: value }))}
                  />
                  <section className="issue-list" aria-labelledby="list-heading">
                    <div className="list-heading">
                      <h2 id="list-heading">
                        {listName} <span>{issues.length}</span>
                      </h2>
                      <span className="list-help">Select a title to edit</span>
                    </div>
                    {snapshot.phase === "starting" ? (
                      <div className="empty-state">
                        <p>Opening your workspace…</p>
                      </div>
                    ) : issues.length === 0 ? (
                      <div className="empty-state">
                        <h3>
                          {filtersActive
                            ? "No matching issues"
                            : view === "mine"
                              ? "No issues assigned to you yet"
                              : "A little room to begin."}
                        </h3>
                        <p>
                          {filtersActive
                            ? "Change or clear the filters above to see more work."
                            : view === "mine"
                              ? "Create an issue above to assign it to yourself, or take ownership of existing work."
                              : "Create your first issue above."}
                        </p>
                      </div>
                    ) : (
                      <table>
                        <caption className="visually-hidden">
                          {listName} in {workspaceName}
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">Identifier</th>
                            <th scope="col">Title</th>
                            <th scope="col" className="issue-save-state">
                              Sync
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {issues.map((issue) => (
                            <IssueRow
                              key={issue.id}
                              issue={issue}
                              teams={snapshot.teams}
                              pending={pendingIds.has(issue.id)}
                              status={snapshot.status}
                              stateName={stateNames.get(issue.stateId) ?? "Unavailable status"}
                              assigneeName={
                                issue.assigneeId
                                  ? (memberNames.get(issue.assigneeId) ?? "Unavailable member")
                                  : "Unassigned"
                              }
                            />
                          ))}
                        </tbody>
                      </table>
                    )}
                    <div className="list-footer">
                      {issues.length} of {snapshot.issues.length} {snapshot.issues.length === 1 ? "issue" : "issues"}
                      <span>Changes sync when connected.</span>
                    </div>
                  </section>
                </>
              )}
            </>
          )}
          <p className="local-footnote">
            {local
              ? "This workspace uses local fixture data."
              : context
                ? `Signed in to ${workspaceName}.`
                : "Connect to open your workspace."}
          </p>
        </div>
      </main>
    </div>
  );
}
