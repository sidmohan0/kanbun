import type { DomainEvent } from "@kanbun/events";
import type { Row } from "@kanbun/model";
import { MutationError, type MutatorContext } from "@kanbun/sync";

/** Apply recorded issue facts without permissions, clocks, generated ids, or counter allocation. */
export function applyIssueEvent(ctx: MutatorContext, event: DomainEvent): void {
  if (event.entityType !== "issue") throw new MutationError("Not an issue event", "invalid");
  if ((ctx.branchId ?? "main") !== event.branchId)
    throw new MutationError("Issue event belongs to a different branch", "invalid");
  if (event.branchId !== "main" && event.type !== "IssueCreated" && event.type !== "IssueTitled")
    throw new MutationError("This event is not supported on branches", "invalid");
  if (event.type === "IssueCreated" && event.branchId !== "main" && event.payload.number !== 0)
    throw new MutationError("Branch issues cannot allocate numbers", "invalid");
  const now = new Date(event.ts).toISOString();
  if (event.type === "IssueCreated") {
    const { labelLinks, subscriptions, ...fields } = event.payload;
    delete fields.position;
    if (fields.number > 0) ctx.store.patch("team", event.teamId, { issueCounter: fields.number });
    ctx.store.insert("issue", {
      ...fields,
      assertedStateId: fields.assertedStateId ?? null,
      derivedStateId: fields.derivedStateId ?? fields.stateId,
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
  if (event.type === "IssueDescribed") {
    if (event.branchId !== "main") throw new MutationError("Descriptions are not supported on branches", "invalid");
    const { description, descriptionContentId, contentState } = event.payload;
    const content = ctx.store.get("documentContent", descriptionContentId);
    if (content && content.issueId !== issue.id) throw new MutationError("Description owner does not match", "invalid");
    if (content)
      ctx.store.patch("documentContent", descriptionContentId, { content: description, contentState, updatedAt: now });
    else
      ctx.store.insert("documentContent", {
        id: descriptionContentId,
        issueId: issue.id,
        teamId: issue.teamId,
        content: description,
        contentState,
        createdAt: now,
        updatedAt: now,
      } as Row<"documentContent">);
    ctx.store.patch("issue", issue.id, { description, descriptionContentId, updatedAt: now, updatedSeq: event.seq });
    return;
  }
  let patch: Partial<Row<"issue">> = {};
  switch (event.type) {
    case "IssueTitled":
      patch = { title: event.payload.title };
      break;
    case "IssuePrioritized":
      patch = { priority: event.payload.priority };
      break;
    case "HumanAssertedStatus": {
      const { stateId, effectiveStateId, ...fields } = event.payload;
      patch = { ...fields, assertedStateId: stateId, stateId: effectiveStateId };
      break;
    }
    case "IssueAssigned":
      patch = { assigneeId: event.payload.assigneeId };
      break;
    case "IssueUnassigned":
      patch = { assigneeId: null };
      break;
    case "SubscriberAdded":
      ctx.store.insert("issueSubscription", {
        id: event.payload.id,
        issueId: issue.id,
        teamId: issue.teamId,
        userId: event.payload.userId,
        createdAt: now,
        updatedAt: now,
      } as Row<"issueSubscription">);
      break;
    case "LabelAdded":
      ctx.store.insert("issueLabelLink", {
        id: event.payload.linkId,
        issueId: issue.id,
        teamId: issue.teamId,
        labelId: event.payload.labelId,
        createdAt: now,
        updatedAt: now,
      } as Row<"issueLabelLink">);
      ctx.store.patch("issueLabel", event.payload.labelId, { lastAppliedAt: now });
      break;
    case "LabelRemoved": {
      const link = ctx.store.get("issueLabelLink", event.payload.linkId);
      if (!link || link.issueId !== issue.id || link.labelId !== event.payload.labelId)
        throw new MutationError("Recorded label link does not match its issue", "invalid");
      ctx.store.delete("issueLabelLink", link.id);
      break;
    }
    case "IssueArchived":
      patch = { archivedAt: now, autoArchivedAt: null };
      break;
    case "IssueRestored":
      patch = { archivedAt: null, autoArchivedAt: null };
      break;
  }
  ctx.store.patch("issue", event.entityId, { ...patch, updatedAt: now, updatedSeq: event.seq });
}
