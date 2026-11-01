import { Textarea } from "./components/ui/textarea";
import { Button } from "./components/ui/button";
import { useState, useSyncExternalStore } from "react";
import type { Row } from "@kanbun/model";
import type { WorkspaceContext } from "@kanbun/sync";
import { descriptionSession } from "./description";
import { IssueProperties } from "./IssueProperties";
import { IssueRelationships } from "./IssueRelationships";
import { IssueDiscussion } from "./IssueDiscussion";
import { IssueDevelopment } from "./GitHubContext";
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
      <div className="issue-detail-layout">
        <div className="issue-detail-content">
          <div className="description-heading">
            <label htmlFor="issue-description">Description</label>
            <span role="status" aria-label="Description status" aria-live="polite">
              {snapshot.status}
            </span>
          </div>
          <Textarea
            className="description-editor w-full rounded-md border border-border bg-transparent text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
            id="issue-description"
            value={snapshot.text}
            onChange={(event) => session.edit(event.target.value)}
            disabled={!snapshot.ready || snapshot.blocked}
            placeholder="Add a description…"
            aria-describedby={snapshot.error ? "description-error" : "description-help"}
          />
          <span id="description-help" className="visually-hidden">
            Changes save automatically.
          </span>
          {snapshot.error && (
            <div className="notice" role="alert" id="description-error">
              <span>{snapshot.error}</span>
              {!snapshot.blocked && (
                <Button variant="ghost" size="sm" onClick={session.refresh}>
                  Retry description sync
                </Button>
              )}
            </div>
          )}
          <details className="relationships-disclosure">
            <summary>Structure and dependencies</summary>
            <IssueRelationships issue={issue} snapshot={workspaceSnapshot} />
          </details>
          <IssueDevelopment issue={issue} snapshot={workspaceSnapshot} />
          <IssueDiscussion issue={issue} context={context} snapshot={workspaceSnapshot} />
        </div>
        <aside className="issue-detail-sidebar">
          <h3>Properties</h3>
          <IssueProperties issue={issue} snapshot={workspaceSnapshot} onArchive={onArchive} />
        </aside>
      </div>
    </section>
  );
}
