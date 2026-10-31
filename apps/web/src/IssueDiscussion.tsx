import { useEffect, useRef, useState, type FormEvent } from "react";
import type { DomainEvent } from "@kanbun/events";
import type { Row } from "@kanbun/model";
import { DEFAULT_EVENT_PAGE_SIZE, type WorkspaceContext } from "@kanbun/sync";
import { workspace, type WorkspaceSnapshot } from "./workspace";
import { MentionPicker, validateMentions } from "./MentionPicker";
import { checksLabel, checksStatus, githubActivityVisible, githubUrl, reviewLabel, reviewStatus } from "./github";

function actorName(actor: DomainEvent["actor"], snapshot: WorkspaceSnapshot): string {
  if (actor.type === "system") return "Kanbun";
  if (actor.type === "integration") return actor.id.startsWith("github:") ? "GitHub" : "Integration";
  if (actor.type === "agent") return snapshot.knownAgents.find((agent) => agent.id === actor.id)?.name ?? "Agent";
  const member = snapshot.knownMembers.find((member) => member.id === actor.id);
  return member
    ? `${member.displayName || member.name}${member.active && !member.archivedAt ? "" : " (inactive)"}`
    : "Former member";
}

function activityText(event: DomainEvent, snapshot: WorkspaceSnapshot): string {
  switch (event.type) {
    case "GitHubPullRequestLinked":
      return `linked pull request #${event.payload.snapshot.number}: ${event.payload.snapshot.title}`;
    case "GitHubPullRequestUnlinked":
      return "unlinked a GitHub pull request";
    case "ObservedGitHubPullRequest":
      return `confirmed pull request #${event.payload.snapshot.number}: ${event.payload.snapshot.state}; ${checksLabel[checksStatus(event.payload.snapshot)]}; ${reviewLabel[reviewStatus(event.payload.snapshot)]}`;
    case "IssueCreated":
      return "created the issue";
    case "IssueTitled":
      return `renamed the issue to “${event.payload.title}”`;
    case "IssueParentChanged":
      return event.payload.parentId ? "changed the parent issue" : "removed the parent issue";
    case "IssueRelationAdded":
      return `added a ${event.payload.relationType === "blocks" ? "blocking dependency" : "related issue"}`;
    case "IssueRelationRemoved":
      return "removed an issue relationship";
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
      return event.payload.userId === event.actor.id
        ? "subscribed to issue updates"
        : `subscribed ${actorName({ id: event.payload.userId, type: "user" }, snapshot)} to issue updates`;
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
  const [draftMentions, setDraftMentions] = useState<string[]>([]);
  const [replyMentions, setReplyMentions] = useState<string[]>([]);
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
    if (
      draft !== null &&
      change(() => {
        validateMentions(snapshot, comment.teamId, draftMentions);
        workspace.editComment(comment.id, draft, draftMentions);
      })
    ) {
      setDraft(null);
      setDraftMentions([]);
    }
  }
  function sendReply(event: FormEvent) {
    event.preventDefault();
    if (
      reply !== null &&
      change(() => {
        validateMentions(snapshot, comment.teamId, replyMentions);
        workspace.postComment(comment.issueId!, reply, comment.id, replyMentions);
      })
    ) {
      setReply(null);
      setReplyMentions([]);
    }
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
          <MentionPicker
            id={`edit-${comment.id}`}
            teamId={comment.teamId}
            snapshot={snapshot}
            selected={draftMentions}
            onChange={setDraftMentions}
          />
          <div className="comment-actions">
            <button className="button compact" disabled={!draft.trim()}>
              Save comment
            </button>
            <button
              type="button"
              className="button quiet compact"
              onClick={() => {
                setDraft(null);
                setDraftMentions([]);
              }}
            >
              Cancel edit
            </button>
          </div>
        </form>
      )}
      <div className="comment-actions">
        {comment.userId === context.actor.id && draft === null && (
          <button
            className="button quiet compact"
            onClick={() => {
              setDraft(comment.body);
              setDraftMentions(comment.mentionedUserIds);
            }}
          >
            Edit comment
          </button>
        )}
        {!comment.parentId && (
          <>
            <button
              className="button quiet compact"
              onClick={() => {
                setReply(reply === null ? "" : null);
                setReplyMentions([]);
              }}
            >
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
          <MentionPicker
            id={`reply-${comment.id}`}
            teamId={comment.teamId}
            snapshot={snapshot}
            selected={replyMentions}
            onChange={setReplyMentions}
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
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([]);
  const [commentStatus, setCommentStatus] = useState("Loading comments…");
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<DomainEvent[]>([]);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const activityLoaded = useRef(false);
  const newestSeen = useRef(0);
  // Previously fetched facts must disappear with their repository scope, even before another page fetch.
  const visibleEvents = events.filter((event) => githubActivityVisible(event, issue, snapshot.githubRepositories));
  const groups = [
    ...visibleEvents
      .reduce((groups, event) => {
        const group = groups.get(event.txnId) ?? [];
        group.push(event);
        groups.set(event.txnId, group);
        return groups;
      }, new Map<string, DomainEvent[]>())
      .values(),
  ];
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
      validateMentions(snapshot, issue.teamId, mentionedUserIds);
      workspace.postComment(issue.id, body, undefined, mentionedUserIds);
      setBody("");
      setMentionedUserIds([]);
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
          <MentionPicker
            id={`new-${issue.id}`}
            teamId={issue.teamId}
            snapshot={snapshot}
            selected={mentionedUserIds}
            onChange={setMentionedUserIds}
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
        {!visibleEvents.length && !activityError && <p className="description-help">No recorded activity yet.</p>}
        <ol className="issue-activity">
          {groups.map((group) => {
            const event = group[0]!;
            return (
              <li key={event.txnId}>
                <strong>{actorName(event.actor, snapshot)}</strong>{" "}
                {[...group]
                  .sort((a, b) => a.eventIndex - b.eventIndex)
                  .map((fact) => activityText(fact, snapshot))
                  .join("; ")}
                {event.sourceRef &&
                  (event.type === "ObservedGitHubPullRequest" || event.type === "GitHubPullRequestLinked") &&
                  githubUrl(event.sourceRef) && (
                    <a
                      className="github-activity-source"
                      href={githubUrl(event.sourceRef)!}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View pull request
                    </a>
                  )}
                <time dateTime={new Date(event.ts).toISOString()}>{new Date(event.ts).toLocaleString()}</time>
              </li>
            );
          })}
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
