import type { DomainEvent } from "@kanbun/events";
import type { Row } from "@kanbun/model";
import { MutationError, type MutatorContext } from "@kanbun/sync";
import { applyIssueEvent } from "./issueEvents";

/** Discussion facts contain finalized bodies, authors, and references; replay performs no decisions. */
export function applyCommentEvent(ctx: MutatorContext, event: DomainEvent): void {
  if (event.type === "SubscriberAdded") return applyIssueEvent(ctx, event);
  if (event.entityType !== "comment") throw new MutationError("Not a comment event", "invalid");
  if (event.branchId !== "main" || (ctx.branchId ?? "main") !== "main")
    throw new MutationError("Comments are not supported on branches", "invalid");
  const issue = ctx.store.get("issue", event.payload.issueId);
  if (!issue || issue.teamId !== event.teamId)
    throw new MutationError("Recorded comment issue is unavailable", "invalid");
  const now = new Date(event.ts).toISOString();
  if (event.type === "CommentPosted") {
    ctx.store.insert("comment", {
      ...event.payload,
      id: event.entityId,
      teamId: event.teamId,
      createdAt: now,
      updatedAt: now,
    } as Row<"comment">);
  } else {
    const comment = ctx.store.get("comment", event.entityId);
    if (!comment || comment.issueId !== issue.id) throw new MutationError("Recorded comment is unavailable", "invalid");
    if (event.type === "CommentEdited")
      ctx.store.patch("comment", comment.id, {
        body: event.payload.body,
        bodyData: event.payload.bodyData,
        editedAt: now,
        updatedAt: now,
      });
    else
      ctx.store.patch("comment", comment.id, {
        resolvedAt: event.payload.resolved ? now : null,
        resolvingUserId: event.payload.resolvingUserId,
        resolvingCommentId: event.payload.resolvingCommentId,
        updatedAt: now,
      });
  }
  ctx.store.patch("issue", issue.id, { updatedAt: now, updatedSeq: event.seq });
}
