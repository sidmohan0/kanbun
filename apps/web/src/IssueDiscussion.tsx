import { useEffect, useRef, useState, type FormEvent } from "react";
import type { DomainEvent } from "@kanbun/events";
import type { Row } from "@kanbun/model";
import { DEFAULT_EVENT_PAGE_SIZE, type WorkspaceContext } from "@kanbun/sync";
import { workspace, type WorkspaceSnapshot } from "./workspace";

function actorName(actor: DomainEvent["actor"], snapshot: WorkspaceSnapshot): string {
  if (actor.type === "system") return "Kanbun";
  if (actor.type === "integration") return "Integration";
  if (actor.type === "agent") return snapshot.knownAgents.find((agent) => agent.id === actor.id)?.name ?? "Agent";
  const member = snapshot.knownMembers.find((member) => member.id === actor.id);
  return member
    ? `${member.displayName || member.name}${member.active && !member.archivedAt ? "" : " (inactive)"}`
    : "Former member";
}

function activityText(event: DomainEvent, snapshot: WorkspaceSnapshot): string {
  switch (event.type) {
    case "IssueCreated":
      return "created the issue";
    case "IssueTitled":
      return `renamed the issue to “${event.payload.title}”`;
    case "IssueDescribed":
      return "updated the description";
    case "IssuePrioritized":
      return `changed priority to ${["None", "Urgent", "High", "Medium", "Low"][event.payload.priority]}`;
    case "HumanAssertedStatus":
      return event.payload.stateId === null
        ? "cleared the status override"
        : `set status to ${snapshot.workflowStates.find((state) => state.id === event.payload.effectiveStateId)?.name ?? "another status"}`;
    case "IssueAssigned":
      return `assigned the issue to ${actorName({ id: event.payload.assigneeId, type: "user" }, snapshot)}`;
    case "IssueUnassigned":
      return "removed the assignee";
    case "LabelAdded":
      return `added ${snapshot.labels.find((label) => label.id === event.payload.labelId)?.name ?? "a label"}`;
    case "LabelRemoved":
      return `removed ${snapshot.labels.find((label) => label.id === event.payload.labelId)?.name ?? "a label"}`;
    case "IssueArchived":
      return "archived the issue";
    case "IssueRestored":
      return "restored the issue from the archive";
    case "SubscriberAdded":
      return "subscribed to issue updates";
    case "CommentPosted":
      return event.payload.parentId ? "replied to a comment" : "posted a comment";
    case "CommentEdited":
      return "edited a comment";
    case "CommentResolved":
      return event.payload.resolved ? "resolved the thread" : "reopened the thread";
    default:
      return "updated the issue";
  }
}

function CommentCard({
  comment,
  replies,
  context,
  snapshot,
}: {
  comment: Row<"comment">;
  replies?: Row<"comment">[];
  context: WorkspaceContext;
  snapshot: WorkspaceSnapshot;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = actorName({ id: comment.userId ?? comment.agentId!, type: comment.userId ? "user" : "agent" }, snapshot);
  const pending = snapshot.pendingCommentIds.includes(comment.id);
  function change(action: () => void) {
    try {
      action();
      setError(null);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "This comment could not be saved.");
      return false;
    }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (draft !== null && change(() => workspace.editComment(comment.id, draft))) setDraft(null);
  }
  function sendReply(event: FormEvent) {
    event.preventDefault();
    if (reply !== null && change(() => workspace.postComment(comment.issueId!, reply, comment.id))) setReply(null);
  }
  return (
    <article className="comment-card" aria-label={`Comment by ${name}`}>
      <header className="comment-meta">
        <strong>{name}</strong>
        <time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString()}</time>
        {comment.editedAt && <span>Edited</span>}
        {pending && <span role="status">Pending</span>}
        {comment.resolvedAt && <span>Resolved</span>}
      </header>
      {draft === null ? (
        <p className="comment-body">{comment.body}</p>
      ) : (
        <form onSubmit={save}>
          <label className="field-label" htmlFor={`edit-${comment.id}`}>
            Edit comment
          </label>
          <textarea
            id={`edit-${comment.id}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={20_000}
          />
          <div className="comment-actions">
            <button className="button compact" disabled={!draft.trim()}>
              Save comment
            </button>
            <button type="button" className="button quiet compact" onClick={() => setDraft(null)}>
              Cancel edit
            </button>
          </div>
        </form>
      )}
      <div className="comment-actions">
        {comment.userId === context.actor.id && draft === null && (
          <button className="button quiet compact" onClick={() => setDraft(comment.body)}>
            Edit comment
          </button>
        )}
        {!comment.parentId && (
          <>
            <button className="button quiet compact" onClick={() => setReply(reply === null ? "" : null)}>
              {reply === null ? "Reply" : "Cancel reply"}
            </button>
            <button
              className="button quiet compact"
              onClick={() => change(() => workspace.resolveComment(comment.id, !comment.resolvedAt))}
            >
              {comment.resolvedAt ? "Reopen thread" : "Resolve thread"}
            </button>
          </>
        )}
      </div>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {replies?.map((reply) => (
        <CommentCard key={reply.id} comment={reply} context={context} snapshot={snapshot} />
      ))}
      {reply !== null && (
        <form className="comment-reply" onSubmit={sendReply}>
          <label className="field-label" htmlFor={`reply-${comment.id}`}>
            Reply to {name}
          </label>
          <textarea
            id={`reply-${comment.id}`}
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            maxLength={20_000}
          />
          <button className="button compact" disabled={!reply.trim()}>
            Post reply
          </button>
        </form>
      )}
    </article>
  );
}

export function IssueDiscussion({
  issue,
  context,
  snapshot,
}: {
  issue: Row<"issue">;
  context: WorkspaceContext;
  snapshot: WorkspaceSnapshot;
}) {
  const [body, setBody] = useState("");
  const [commentStatus, setCommentStatus] = useState("Loading comments…");
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<DomainEvent[]>([]);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const activityLoaded = useRef(false);
  const newestSeen = useRef(0);
  const comments = snapshot.comments
    .filter((comment) => comment.issueId === issue.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  useEffect(() => {
    let current = true;
    void workspace.loadComments(issue.id).then(
      () => {
        if (current) setCommentStatus("");
      },
      () => {
        if (current)
          setCommentStatus(
            "Earlier comments could not be loaded. Reconnect and retry; saved work stays in this browser.",
          );
      },
    );
    return () => {
      current = false;
    };
  }, [issue.id, snapshot.status]);
  useEffect(() => {
    const controller = new AbortController();
    async function refreshActivity() {
      const since = newestSeen.current;
      let page = await workspace.issueEvents(issue.id, { signal: controller.signal, since });
      const facts = [...page];
      // Initial history stays paginated. Subsequent refreshes fill every intervening new fact.
      if (activityLoaded.current)
        while (page.length === DEFAULT_EVENT_PAGE_SIZE) {
          page = await workspace.issueEvents(issue.id, { signal: controller.signal, since, before: page.at(-1)!.seq });
          facts.push(...page);
        }
      if (controller.signal.aborted) return;
      setEvents((previous) =>
        [...new Map([...previous, ...facts].map((event) => [event.seq, event])).values()].sort((a, b) => b.seq - a.seq),
      );
      if (!activityLoaded.current) {
        setHasOlder(facts.length === DEFAULT_EVENT_PAGE_SIZE);
        activityLoaded.current = true;
      }
      newestSeen.current = Math.max(since, facts[0]?.seq ?? 0);
      setActivityError(null);
    }
    void refreshActivity().catch(() => {
      if (!controller.signal.aborted) setActivityError("Activity is unavailable. Reconnect and try again.");
    });
    return () => controller.abort();
  }, [issue.id, issue.updatedSeq, snapshot.status]);
  function post(event: FormEvent) {
    event.preventDefault();
    try {
      workspace.postComment(issue.id, body);
      setBody("");
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "This comment could not be posted.");
    }
  }
  async function older() {
    setLoadingOlder(true);
    try {
      const page = await workspace.issueEvents(issue.id, events.length ? { before: events.at(-1)!.seq } : {});
      setEvents((previous) =>
        [...new Map([...previous, ...page].map((event) => [event.seq, event])).values()].sort((a, b) => b.seq - a.seq),
      );
      setHasOlder(page.length === DEFAULT_EVENT_PAGE_SIZE);
      setActivityError(null);
    } catch {
      setActivityError("Activity is unavailable. Reconnect and try again.");
    } finally {
      setLoadingOlder(false);
    }
  }
  return (
    <div className="issue-discussion">
      <section aria-label="Comments">
        <h3>Comments</h3>
        {commentStatus && (
          <p className="description-help" role="status">
            {commentStatus}
          </p>
        )}
        {commentStatus && (
          <button
            className="button quiet compact"
            onClick={() => {
              void workspace.loadComments(issue.id).then(
                () => setCommentStatus(""),
                () => setCommentStatus("Earlier comments could not be loaded. Reconnect and retry."),
              );
            }}
          >
            Retry comments
          </button>
        )}
        {!commentStatus && !comments.length && (
          <p className="description-help">No comments yet. Start the discussion.</p>
        )}
        {comments
          .filter((comment) => !comment.parentId)
          .map((comment) => (
            <CommentCard
              key={comment.id}
              comment={comment}
              replies={comments.filter((reply) => reply.parentId === comment.id)}
              context={context}
              snapshot={snapshot}
            />
          ))}
        <form className="comment-compose" onSubmit={post}>
          <label className="field-label" htmlFor="new-comment">
            Add a comment
          </label>
          <textarea
            id="new-comment"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={20_000}
            placeholder="Share context, a decision, or a question."
          />
          <button className="button compact" disabled={!body.trim() || issue.number <= 0}>
            Post comment
          </button>
          {issue.number <= 0 && (
            <p className="description-help">Comments become available after this issue finishes syncing.</p>
          )}
        </form>
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
      </section>
      <section aria-label="Activity">
        <h3>Activity</h3>
        {!events.length && !activityError && <p className="description-help">No recorded activity yet.</p>}
        <ol className="issue-activity">
          {events.map((event) => (
            <li key={event.seq}>
              <strong>{actorName(event.actor, snapshot)}</strong> {activityText(event, snapshot)}
              <time dateTime={new Date(event.ts).toISOString()}>{new Date(event.ts).toLocaleString()}</time>
            </li>
          ))}
        </ol>
        {activityError && (
          <p className="notice" role="alert">
            {activityError}
          </p>
        )}
        {(hasOlder || activityError) && (
          <button
            className="button quiet compact"
            disabled={loadingOlder}
            onClick={() => {
              void older();
            }}
          >
            {loadingOlder
              ? "Loading activity…"
              : activityError && !events.length
                ? "Retry activity"
                : "Load older activity"}
          </button>
        )}
      </section>
    </div>
  );
}
