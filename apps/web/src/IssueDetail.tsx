import { useState, useSyncExternalStore } from "react";
import type { Row } from "@kanbun/model";
import type { WorkspaceContext } from "@kanbun/sync";
import { descriptionSession } from "./description";
import { IssueProperties } from "./IssueProperties";
import { IssueDiscussion } from "./IssueDiscussion";
import type { WorkspaceSnapshot } from "./workspace";

export function IssueDetail({
  issue,
  context,
  workspaceSnapshot,
  onArchive,
  backHref = "#issues",
  backLabel = "All issues",
}: {
  issue: Row<"issue">;
  context: WorkspaceContext;
  workspaceSnapshot: WorkspaceSnapshot;
  onArchive(issue: Row<"issue">): void;
  backHref?: string;
  backLabel?: string;
}) {
  const [session] = useState(() => descriptionSession(context, issue));
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return (
    <section className="issue-detail" aria-label="Issue details">
      <a className="back-to-issues" href={backHref}>
        ← {backLabel}
      </a>
      <h2>{issue.title}</h2>
      <IssueProperties issue={issue} snapshot={workspaceSnapshot} onArchive={onArchive} />
      <div className="description-heading">
        <label htmlFor="issue-description">Description</label>
        <span role="status" aria-label="Description status" aria-live="polite">
          {snapshot.status}
        </span>
      </div>
      <textarea
        id="issue-description"
        className="description-editor"
        value={snapshot.text}
        onChange={(event) => session.edit(event.target.value)}
        disabled={!snapshot.ready || snapshot.blocked}
        placeholder="Describe the work, decisions, and what done looks like."
        aria-describedby={snapshot.error ? "description-error" : "description-help"}
      />
      <p id="description-help" className="description-help">
        Changes save automatically and merge with your teammates’ edits.
      </p>
      {snapshot.error && (
        <div className="notice" role="alert" id="description-error">
          <span>{snapshot.error}</span>
          {!snapshot.blocked && (
            <button className="button quiet compact" onClick={session.refresh}>
              Retry description sync
            </button>
          )}
        </div>
      )}
      <IssueDiscussion issue={issue} context={context} snapshot={workspaceSnapshot} />
    </section>
  );
}
