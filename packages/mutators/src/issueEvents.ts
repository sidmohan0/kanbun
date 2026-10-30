import type { DomainEvent } from "@kanbun/events";
import type { Row } from "@kanbun/model";
import { MutationError, type MutatorContext } from "@kanbun/sync";

/** Apply recorded issue facts without permissions, clocks, generated ids, or counter allocation. */
export function applyIssueEvent(ctx: MutatorContext, event: DomainEvent): void {
  if (event.type !== "IssueCreated" && event.type !== "IssueTitled")
    throw new MutationError("Not an issue event", "invalid");
  if ((ctx.branchId ?? "main") !== event.branchId)
    throw new MutationError("Issue event belongs to a different branch", "invalid");
  if (event.type === "IssueCreated" && event.branchId !== "main" && event.payload.number !== 0)
    throw new MutationError("Branch issues cannot allocate numbers", "invalid");
  const now = new Date(event.ts).toISOString();
  if (event.type === "IssueCreated") {
    const { labelLinks, subscriptions, ...fields } = event.payload;
    delete fields.position;
    if (fields.number > 0) ctx.store.patch("team", event.teamId, { issueCounter: fields.number });
    ctx.store.insert("issue", {
      ...fields,
      id: event.entityId,
      teamId: event.teamId,
      createdAt: now,
      updatedAt: now,
      createdSeq: event.seq,
      updatedSeq: event.seq,
    } as Row<"issue">);
    for (const link of labelLinks)
      ctx.store.insert("issueLabelLink", {
        ...link,
        teamId: event.teamId,
        issueId: event.entityId,
        createdAt: now,
        updatedAt: now,
      } as Row<"issueLabelLink">);
    for (const subscription of subscriptions)
      ctx.store.insert("issueSubscription", {
        ...subscription,
        teamId: event.teamId,
        issueId: event.entityId,
        createdAt: now,
        updatedAt: now,
      } as Row<"issueSubscription">);
    return;
  }
  const issue = ctx.store.get("issue", event.entityId);
  if (!issue || issue.teamId !== event.teamId) throw new MutationError("issue not found in event team", "invalid");
  ctx.store.patch("issue", event.entityId, {
    title: event.payload.title,
    updatedAt: now,
    updatedSeq: event.seq,
  });
}
