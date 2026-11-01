import { NativeSelect } from "./components/ui/native-select";
import { useEffect, useRef, useState } from "react";
import type { Row } from "@kanbun/model";
import { issueIdentifier } from "./issueViews";
import { workspace, type WorkspaceSnapshot } from "./workspace";
import { GitHubPullRequestChips } from "./GitHubContext";
import { groupPullRequests } from "./github";
import "./styles/board.css";

/** Columns stay scoped to a team: similarly named states are not interchangeable across teams. */
export function IssueBoard({ issues, snapshot }: { issues: Row<"issue">[]; snapshot: WorkspaceSnapshot }) {
  const dragging = useRef<string | null>(null);
  const statusControls = useRef(new Map<string, HTMLSelectElement>());
  const restoreFocus = useRef<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = new Set(snapshot.pendingIssueIds);
  const pullRequestsByIssue = groupPullRequests(snapshot.issuePullRequests);
  useEffect(() => {
    if (restoreFocus.current) {
      statusControls.current.get(restoreFocus.current)?.focus();
      restoreFocus.current = null;
    }
  }, [issues]);
  function move(issue: Row<"issue">, state: Row<"workflowState">) {
    if (issue.teamId !== state.teamId || issue.stateId === state.id) return;
    try {
      // A status change moves the card between column parents and recreates its controls.
      if (document.activeElement === statusControls.current.get(issue.id)) restoreFocus.current = issue.id;
      workspace.updateIssue(issue.id, { stateId: state.id });
      setError(null);
      setFeedback(`${issueIdentifier(issue, snapshot.teams)} moved to ${state.name}. Changes sync when connected.`);
    } catch (failure) {
      restoreFocus.current = null;
      setError(failure instanceof Error ? failure.message : "This status could not be changed.");
    }
  }
  return (
    <div className="issue-board" role="region" aria-label="Issue board">
      <p className="board-help">Drag a card to change its status, or use the card’s Status menu.</p>
      <p className="board-feedback" role="status">
        {feedback}
      </p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {snapshot.teams
        .filter((team) => issues.some((issue) => issue.teamId === team.id))
        .map((team) => {
          const teamIssues = issues.filter((issue) => issue.teamId === team.id);
          const states = snapshot.workflowStates.filter((state) => state.teamId === team.id);
          const knownStateIds = new Set(states.map((state) => state.id));
          const unavailable = teamIssues.filter((issue) => !knownStateIds.has(issue.stateId));
          const columns: { state: Row<"workflowState"> | null; name: string; rows: Row<"issue">[] }[] = states.map(
            (state) => ({ state, name: state.name, rows: teamIssues.filter((issue) => issue.stateId === state.id) }),
          );
          if (unavailable.length) columns.push({ state: null, name: "Unavailable status", rows: unavailable });
          return (
            <section className="team-board" aria-label={`${team.name} board`} key={team.id}>
              <h3>
                {team.name} <span>{team.key}</span>
              </h3>
              <div className="board-columns">
                {columns.map(({ state, name, rows }) => (
                  <section
                    className={dropTarget === state?.id ? "board-column drop-target" : "board-column"}
                    aria-label={`${team.key}: ${name}`}
                    key={state?.id ?? "unavailable"}
                    onDragOver={(event) => {
                      if (state && teamIssues.some((issue) => issue.id === dragging.current)) {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        if (dropTarget !== state.id) setDropTarget(state.id);
                      }
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const issue = teamIssues.find((candidate) => candidate.id === dragging.current);
                      dragging.current = null;
                      setDraggingId(null);
                      setDropTarget(null);
                      if (issue && state) move(issue, state);
                    }}
                  >
                    <h4>
                      {name} <span>{rows.length}</span>
                    </h4>
                    <ul className="board-cards">
                      {rows.map((issue) => {
                        const identifier = issueIdentifier(issue, snapshot.teams);
                        const assignee = snapshot.members.find((member) => member.id === issue.assigneeId);
                        return (
                          <li
                            className={draggingId === issue.id ? "board-card dragging" : "board-card"}
                            aria-label={identifier}
                            key={issue.id}
                            draggable
                            onDragStart={(event) => {
                              dragging.current = issue.id;
                              setDraggingId(issue.id);
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/plain", issue.id);
                            }}
                            onDragEnd={() => {
                              dragging.current = null;
                              setDraggingId(null);
                              setDropTarget(null);
                            }}
                          >
                            <a href={`#issues/${issue.id}`} aria-label={`Open ${identifier}`}>
                              <span className="board-identifier">{identifier}</span>
                              <span className="board-title">{issue.title}</span>
                            </a>
                            <p className="board-properties">
                              {["None", "Urgent", "High", "Medium", "Low"][issue.priority]} priority ·{" "}
                              {issue.assigneeId
                                ? assignee?.displayName || assignee?.name || "Unavailable member"
                                : "Unassigned"}
                            </p>
                            <label>
                              Status
                              <NativeSelect
                                ref={(control) => {
                                  if (control) statusControls.current.set(issue.id, control);
                                  else statusControls.current.delete(issue.id);
                                }}
                                value={issue.stateId}
                                aria-label={`Status for ${identifier}`}
                                onChange={(event) => {
                                  const next = states.find((candidate) => candidate.id === event.target.value);
                                  if (next) move(issue, next);
                                }}
                              >
                                {!knownStateIds.has(issue.stateId) && (
                                  <option value={issue.stateId} disabled>
                                    Unavailable status
                                  </option>
                                )}
                                {states.map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.name}
                                  </option>
                                ))}
                              </NativeSelect>
                            </label>
                            {(pullRequestsByIssue.get(issue.id)?.length ?? 0) > 0 && (
                              <GitHubPullRequestChips
                                pullRequests={pullRequestsByIssue.get(issue.id)!}
                                repositories={snapshot.githubRepositories}
                              />
                            )}
                            <span className={pending.has(issue.id) ? "row-state pending" : "row-state"}>
                              {pending.has(issue.id)
                                ? "Pending"
                                : snapshot.status === "error"
                                  ? "Unsaved"
                                  : snapshot.status === "offline"
                                    ? "Cached"
                                    : snapshot.status === "idle"
                                      ? "Saved"
                                      : "Saving"}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            </section>
          );
        })}
    </div>
  );
}
