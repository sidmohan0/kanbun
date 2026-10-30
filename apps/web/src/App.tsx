import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import type { Row } from "@kanbun/model";
import type { SyncStatus } from "@kanbun/sync/client";
import { Mark } from "./brand/Mark";
import { workspace } from "./workspace";
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
function connectionMessage(error: string | null) {
  if (/Web Locks/i.test(error ?? ""))
    return "This browser cannot coordinate local workspace storage. Open kanbun in a browser with Web Locks support.";
  if (/IndexedDB|storage|quota|denied/i.test(error ?? ""))
    return "Browser storage is unavailable. Check this site's storage permissions, then try again.";
  if (error?.includes("HTTP 403"))
    return "The local workspace is unavailable. If this is your first visit, initialize it below.";
  if (error?.includes("HTTP 503"))
    return "The local workspace is disabled. Start the local development stack and try again.";
  return "Check your connection and that the local development stack is running, then choose Refresh to try again.";
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
}: {
  issue: Row<"issue">;
  teams: Row<"team">[];
  pending: boolean;
  status: SyncStatus;
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
      <td className="issue-identifier">{name}</td>
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
          <button ref={editButton} className="issue-title-button" aria-label={`Edit title for ${name}`} onClick={edit}>
            <span>{issue.title}</span>
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

export function App() {
  const snapshot = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [title, setTitle] = useState("");
  const [teamId, setTeamId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(false);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  useEffect(() => {
    void workspace.start();
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
  const ready = snapshot.phase === "ready";
  const canCreate = ready && Boolean(selectedTeam);
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
      workspace.createIssue(selectedTeam, title.trim());
      setTitle("");
      setFormError(null);
    } catch (error) {
      setFormError(message(error));
    }
  }
  async function initialize() {
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
  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar" aria-label="Workspace navigation">
        <a className="brand-lockup" href="#issues">
          <Mark size={26} />
          <span>kanbun</span>
        </a>
        <div className="workspace-label">
          <span className="workspace-avatar" aria-hidden="true">
            L
          </span>
          <div>
            <strong>Local workspace</strong>
            <span>Development</span>
          </div>
        </div>
        <nav>
          <a className="navigation-item" href="#issues" aria-current="page">
            <span className="navigation-symbol" aria-hidden="true">
              ≡
            </span>
            All issues{ready && <span className="navigation-count">{snapshot.issues.length}</span>}
          </a>
        </nav>
        <div className="sidebar-footer">
          <div className="local-person">
            <span className="person-avatar" aria-hidden="true">
              A
            </span>
            <div>
              <strong>Alice</strong>
              <span>Local fixture identity</span>
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
            Local workspace <span aria-hidden="true">/</span> All issues
          </span>
          <div className="sync-actions">
            <span className="sync-indicator" data-state={snapshot.status} role="status" aria-live="polite">
              <span className="sync-dot" aria-hidden="true" />
              {status}
              {snapshot.status === "offline" && snapshot.pending > 0 && <span> · {snapshot.pending} pending</span>}
            </span>
            <button
              className="button quiet compact"
              onClick={() => void workspace.refresh()}
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
              <h1>Issues</h1>
              <p className="page-description">A place for the work ahead.</p>
            </div>
            <span className="local-badge">Local development</span>
          </div>
          {snapshot.phase === "waiting" ? (
            <section className="empty-state" aria-labelledby="waiting-title">
              <h2 id="waiting-title">Workspace open in another tab</h2>
              <p>Close the other kanbun tab to continue here. Your saved changes will be restored.</p>
            </section>
          ) : snapshot.phase === "failed" ? (
            <section className="connection-panel">
              <h2>Couldn’t open this workspace</h2>
              <p role="alert">{initializationError ?? connectionMessage(snapshot.error)}</p>
              <div className="panel-actions">
                <button className="button primary" onClick={() => void workspace.refresh()}>
                  Try again
                </button>
                {snapshot.error?.includes("HTTP 403") && (
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
                  {connectionMessage(snapshot.error)}
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
                  <button className="button primary create-button" type="submit" disabled={!canCreate || !title.trim()}>
                    <span aria-hidden="true">+</span> Create issue
                  </button>
                </form>
                {formError && (
                  <p className="field-error" id="create-error" role="alert">
                    {formError}
                  </p>
                )}
              </section>
              <section className="issue-list" aria-labelledby="list-heading">
                <div className="list-heading">
                  <h2 id="list-heading">
                    All issues <span>{snapshot.issues.length}</span>
                  </h2>
                  <span className="list-help">Select a title to edit</span>
                </div>
                {snapshot.phase === "starting" ? (
                  <div className="empty-state">
                    <p>Opening your workspace…</p>
                  </div>
                ) : snapshot.issues.length === 0 ? (
                  <div className="empty-state">
                    <h3>A little room to begin.</h3>
                    <p>Create your first issue above.</p>
                  </div>
                ) : (
                  <table>
                    <caption className="visually-hidden">Issues in the local workspace</caption>
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
                      {snapshot.issues.map((issue) => (
                        <IssueRow
                          key={issue.id}
                          issue={issue}
                          teams={snapshot.teams}
                          pending={pendingIds.has(issue.id)}
                          status={snapshot.status}
                        />
                      ))}
                    </tbody>
                  </table>
                )}
                <div className="list-footer">
                  {snapshot.issues.length} {snapshot.issues.length === 1 ? "issue" : "issues"}
                  <span>Changes sync when connected.</span>
                </div>
              </section>
            </>
          )}
          <p className="local-footnote">
            This workspace uses local fixture data. Sign-in and deployment are still to come.
          </p>
        </div>
      </main>
    </div>
  );
}
