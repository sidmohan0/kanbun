import { useState, type FormEvent } from "react";
import type { Row } from "@kanbun/model";
import { issueIdentifier } from "@kanbun/mutators";
import { workspace, type WorkspaceSnapshot } from "./workspace";

/** All choices come from the current authorized working set, never stored relation labels. */
export function IssueRelationships({ issue, snapshot }: { issue: Row<"issue">; snapshot: WorkspaceSnapshot }) {
  const [error, setError] = useState<string | null>(null);
  const [childTitle, setChildTitle] = useState("");
  const [relatedId, setRelatedId] = useState("");
  const [kind, setKind] = useState<"blocks" | "blockedBy" | "related">("blocks");
  const issues = snapshot.issues;
  const label = (row: Row<"issue">) => {
    const team = snapshot.teams.find((team) => team.id === row.teamId);
    return `${team ? issueIdentifier(team, row) : "Issue"} · ${row.title}`;
  };
  const children = issues
    .filter((row) => row.parentId === issue.id)
    .sort((a, b) => (a.subIssueSortOrder ?? "").localeCompare(b.subIssueSortOrder ?? "") || a.id.localeCompare(b.id));
  const parent = issues.find((row) => row.id === issue.parentId);
  const eligibleParents = issues.filter((candidate) => {
    const seen = new Set<string>([issue.id]);
    let current: Row<"issue"> | undefined = candidate;
    while (current) {
      if (seen.has(current.id)) return false;
      seen.add(current.id);
      current = issues.find((row) => row.id === current!.parentId);
    }
    return true;
  });
  const relations = snapshot.issueRelations.flatMap((link) => {
    const outgoing = link.issueId === issue.id;
    if (!outgoing && link.relatedIssueId !== issue.id) return [];
    const target = issues.find((row) => row.id === (outgoing ? link.relatedIssueId : link.issueId));
    if (!target) return [];
    const text =
      link.type === "blocks"
        ? outgoing
          ? "Blocks"
          : "Blocked by"
        : link.type === "duplicate"
          ? "Duplicate of"
          : link.type === "similar"
            ? "Similar to"
            : "Related to";
    return [{ link, target, text }];
  });
  function change(action: () => void): boolean {
    try {
      action();
      setError(null);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "This relationship could not be saved.");
      return false;
    }
  }
  function createChild(event: FormEvent) {
    event.preventDefault();
    const title = childTitle.trim();
    if (title && change(() => workspace.createIssue(issue.teamId, title, undefined, issue.id))) setChildTitle("");
  }
  function addRelation(event: FormEvent) {
    event.preventDefault();
    if (!relatedId) return;
    if (
      change(() =>
        kind === "blockedBy"
          ? workspace.addIssueRelation(relatedId, issue.id, "blocks")
          : workspace.addIssueRelation(issue.id, relatedId, kind),
      )
    )
      setRelatedId("");
  }
  return (
    <section className="issue-relationships" aria-label="Issue relationships">
      <h3>Structure and dependencies</h3>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <label htmlFor="issue-parent">Parent issue</label>
      <select
        id="issue-parent"
        value={issue.parentId ?? ""}
        onChange={(event) => change(() => workspace.setIssueParent(issue.id, event.target.value || null))}
      >
        <option value="">No parent</option>
        {issue.parentId && !parent && (
          <option value={issue.parentId} disabled>
            Parent outside the active view
          </option>
        )}
        {eligibleParents.map((row) => (
          <option key={row.id} value={row.id}>
            {label(row)}
          </option>
        ))}
      </select>
      {parent && <a href={`#issues/${parent.id}`}>Open parent: {label(parent)}</a>}
      <h4>Sub-issues</h4>
      {children.length ? (
        <ul>
          {children.map((child) => (
            <li key={child.id}>
              <a href={`#issues/${child.id}`}>{label(child)}</a>
              <button
                className="button quiet compact"
                aria-label={`Detach sub-issue ${label(child)}`}
                onClick={() => change(() => workspace.setIssueParent(child.id, null))}
              >
                Detach
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="members-description">No sub-issues yet.</p>
      )}
      <form className="relationship-create" onSubmit={createChild}>
        <label htmlFor="sub-issue-title">New sub-issue title</label>
        <input
          id="sub-issue-title"
          value={childTitle}
          maxLength={500}
          onChange={(event) => setChildTitle(event.target.value)}
        />
        <button className="button quiet compact" disabled={!childTitle.trim()}>
          Create sub-issue
        </button>
      </form>
      <h4>Dependencies and related work</h4>
      {relations.length ? (
        <ul>
          {relations.map(({ link, target, text }) => (
            <li key={link.id}>
              <span>{text} </span>
              <a href={`#issues/${target.id}`}>{label(target)}</a>
              <button
                className="button quiet compact"
                aria-label={`Remove ${text.toLowerCase()} ${label(target)}`}
                onClick={() => change(() => workspace.removeIssueRelation(link.id))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="members-description">No linked issues yet.</p>
      )}
      <form className="relationship-create" onSubmit={addRelation}>
        <label htmlFor="relationship-kind">Relationship</label>
        <select id="relationship-kind" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
          <option value="blocks">Blocks</option>
          <option value="blockedBy">Blocked by</option>
          <option value="related">Related to</option>
        </select>
        <label htmlFor="related-issue">Link issue</label>
        <select id="related-issue" value={relatedId} onChange={(event) => setRelatedId(event.target.value)}>
          <option value="">Choose an issue</option>
          {issues
            .filter((row) => row.id !== issue.id)
            .map((row) => (
              <option key={row.id} value={row.id}>
                {label(row)}
              </option>
            ))}
        </select>
        <button className="button quiet compact" disabled={!relatedId}>
          Add relationship
        </button>
      </form>
    </section>
  );
}
