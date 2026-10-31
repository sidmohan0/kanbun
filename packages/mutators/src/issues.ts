import type { PendingEvent } from "@kanbun/events";
import type { Row } from "@kanbun/model";
import {
  MutationError,
  defineEventMutator,
  defineMutator,
  type DecideContext,
  type MutatorContext,
} from "@kanbun/sync";
import { z } from "zod";
import { afterMax, beforeMin } from "./ordering";
import { applyIssueEvent } from "./issueEvents";
import { color, date, id, iso, nullable, priority } from "./schema";
import { requireTeamAccess, requireTeamAdmin } from "./teams";

/** `DF-123`, derived at read time from the team key and the DO-assigned number. */
export function issueIdentifier(team: Pick<Row<"team">, "key">, issue: Pick<Row<"issue">, "number">): string {
  return issue.number > 0 ? `${team.key}-${issue.number}` : "";
}

/** Git branch name per the organization's format; derived at read time. */
export function branchName(format: string, username: string, identifier: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return format
    .replace("{username}", username.toLowerCase())
    .replace("{issueIdentifier}", identifier.toLowerCase())
    .replace("{issueTitle}", slug);
}

export function requireIssue(ctx: DecideContext, issueId: string): Row<"issue"> {
  const issue = ctx.store.get("issue", issueId);
  if (!issue) throw new MutationError("issue not found", "not_found");
  requireTeamAccess(ctx, issue.teamId);
  return issue;
}

/** Validate the whole parent chain, without a depth cap or revealing inaccessible ancestors. */
function requireParent(ctx: DecideContext, issueId: string, parentId: string): void {
  if (issueId === parentId) throw new MutationError("an issue cannot be its own parent", "invalid");
  requireIssue(ctx, parentId);
  const seen = new Set([issueId]);
  let cursor: Row<"issue"> | undefined = ctx.store.get("issue", parentId);
  while (cursor) {
    if (seen.has(cursor.id)) throw new MutationError("cycle in parent chain", "invalid");
    seen.add(cursor.id);
    cursor = cursor.parentId ? ctx.store.get("issue", cursor.parentId) : undefined;
  }
}

/** Acting on another user's rows under an issue takes a team admin. */
function requireTeamAdminOrSelf(ctx: MutatorContext, issueId: string): void {
  const issue = ctx.store.get("issue", issueId);
  if (!issue) throw new MutationError("issue not found", "not_found");
  requireTeamAdmin(ctx, issue.teamId);
}

/** Rows that hang off an issue and carry its team; moved with it. */
export const ISSUE_CHILD_MODELS = [
  "issuePullRequest",
  "issueLabelLink",
  "issueSubscription",
  "issueRelation",
  "comment",
  "reaction",
  "attachment",
  "documentContent",
  "notification",
] as const;

/** The workflow state of `type` in a team, chosen deterministically (lowest position, then id) so both runs agree. */
export function stateOfType(ctx: MutatorContext, teamId: string, type: string): Row<"workflowState"> | undefined {
  return ctx.store
    .list("workflowState", { teamId, type: type as Row<"workflowState">["type"] })
    .filter((s) => !s.archivedAt)
    .sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1))[0];
}

const issuePatch = z
  .object({
    title: z.string().max(500),
    description: nullable(z.string()),
    priority,
    estimate: nullable(z.number().min(0)),
    dueDate: nullable(date),
    stateId: id,
    assigneeId: nullable(z.string().min(1)),
    delegateId: nullable(z.string().min(1)),
    parentId: nullable(id),
    projectId: nullable(id),
    projectMilestoneId: nullable(id),
    cycleId: nullable(id),
    sortOrder: z.string().min(1),
    boardOrder: z.string().min(1),
    subIssueSortOrder: nullable(z.string().min(1)),
    prioritySortOrder: z.string().min(1),
    snoozedUntilAt: nullable(iso),
    teamId: id,
  })
  .partial();

const issueUpdateArgs = z.object({ id, patch: issuePatch, assigneeSubscriptionId: id.optional() });
type IssueUpdateArgs = z.infer<typeof issueUpdateArgs>;

function requireAssignee(ctx: DecideContext, team: Row<"team">, userId: string): void {
  const user = ctx.store.get("user", userId);
  if (!user) throw new MutationError("assignee not found", "not_found");
  if (!user.active || user.archivedAt) throw new MutationError("assignee is not an active member", "forbidden");
  if (
    team.visibility === "private" &&
    !ctx.store.list("teamMembership", { teamId: team.id, userId }).some((member) => !member.archivedAt)
  )
    throw new MutationError("assignee is not a member of this private team", "forbidden");
}

function statusAssertion(
  ctx: DecideContext,
  issue: Row<"issue">,
  assertedStateId: string | null,
  chosenPriority = issue.priority,
  chosenBoardOrder?: string,
): PendingEvent {
  if ((ctx.branchId ?? "main") !== "main") throw new MutationError("This event is not supported on branches");
  if (ctx.actor.type !== "user") throw new MutationError("Only people can assert status", "forbidden");
  const team = requireTeamAccess(ctx, issue.teamId);
  const baselineId = issue.derivedStateId ?? issue.stateId;
  const baseline = ctx.store.get("workflowState", baselineId);
  if (!baseline || baseline.teamId !== team.id || baseline.archivedAt)
    throw new MutationError("baseline state is unavailable", "invalid");
  const state = ctx.store.get("workflowState", assertedStateId ?? baseline.id);
  if (!state || state.teamId !== team.id || state.archivedAt) throw new MutationError("state not in team", "invalid");
  const previous = ctx.store.get("workflowState", issue.stateId);
  const changed = state.id !== issue.stateId;
  if (changed && previous?.type === "triage" && team.requirePriorityToLeaveTriage && chosenPriority === 0)
    throw new MutationError("set a priority before leaving triage", "invalid");
  const boardOrder =
    chosenBoardOrder ??
    (!changed
      ? issue.boardOrder
      : team.setIssueSortOrderOnStateChange === "top"
        ? beforeMin(ctx.store.minOf("issue", "boardOrder", { teamId: team.id, stateId: state.id }))
        : afterMax(ctx.store.maxOf("issue", "boardOrder", { teamId: team.id, stateId: state.id })));
  return {
    type: "HumanAssertedStatus",
    entityType: "issue",
    entityId: issue.id,
    teamId: team.id,
    scopeUserId: null,
    payload: {
      stateId: assertedStateId,
      derivedStateId: baseline.id,
      effectiveStateId: state.id,
      boardOrder,
      startedAt: changed && state.type === "started" ? (issue.startedAt ?? ctx.now) : issue.startedAt,
      completedAt: !changed ? issue.completedAt : state.type === "completed" ? ctx.now : null,
      canceledAt: !changed ? issue.canceledAt : state.type === "canceled" ? ctx.now : null,
      triagedAt: changed && previous?.type === "triage" && state.type !== "triage" ? ctx.now : issue.triagedAt,
      startedTriageAt: changed && state.type === "triage" ? ctx.now : issue.startedTriageAt,
    },
  };
}

function runLegacyIssueUpdate(ctx: MutatorContext, args: IssueUpdateArgs, combinedPriority?: number): void {
  const issue = requireIssue(ctx, args.id);
  const p = { ...args.patch };
  if (p.description !== undefined)
    throw new MutationError("Descriptions must be edited through the document endpoint", "forbidden");
  const now = ctx.now;
  const patch: Partial<Row<"issue">> = { updatedAt: now };
  let teamForState = ctx.store.get("team", issue.teamId)!;

  if (p.title !== undefined) {
    const t = p.title.trim();
    if (!t) throw new MutationError("title is required", "invalid");
    patch.title = t;
  }
  if (p.description !== undefined) patch.description = p.description;
  if (p.teamId !== undefined && p.teamId !== issue.teamId) {
    const target = requireTeamAccess(ctx, p.teamId);
    const curState = ctx.store.get("workflowState", issue.stateId);
    const sameType = stateOfType(ctx, target.id, curState?.type ?? "backlog");
    const stateId = sameType?.id ?? target.defaultIssueStateId;
    if (!stateId) throw new MutationError("target team has no default state", "invalid");
    patch.teamId = target.id;
    patch.stateId = stateId;
    const baselineType = ctx.store.get("workflowState", issue.derivedStateId ?? issue.stateId)?.type ?? "backlog";
    patch.derivedStateId = stateOfType(ctx, target.id, baselineType)?.id ?? target.defaultIssueStateId ?? stateId;
    patch.assertedStateId = issue.assertedStateId ? stateId : null;
    patch.addedToTeamAt = now;
    patch.cycleId = null;
    // Team labels do not travel; workspace labels do.
    for (const link of ctx.store.list("issueLabelLink", { issueId: issue.id })) {
      const label = ctx.store.get("issueLabel", link.labelId);
      if (label?.teamId && label.teamId !== target.id) ctx.store.delete("issueLabelLink", link.id);
    }
    // Everything hanging off the issue moves with it, so scope filtering stays one column per row.
    for (const m of ISSUE_CHILD_MODELS) {
      for (const r of ctx.store.list(m, { issueId: issue.id } as never))
        ctx.store.patch(m, r.id, { teamId: target.id, updatedAt: now } as never);
    }
    if (ctx.server) {
      patch.number = target.issueCounter + 1;
      ctx.store.patch("team", target.id, { issueCounter: patch.number });
    }
    teamForState = target;
    delete p.stateId;
  }
  if (p.stateId !== undefined && p.stateId !== issue.stateId) {
    const state = ctx.store.get("workflowState", p.stateId);
    if (!state || state.teamId !== teamForState.id || state.archivedAt)
      throw new MutationError("state not in team", "invalid");
    const prev = ctx.store.get("workflowState", issue.stateId);
    if (
      prev?.type === "triage" &&
      teamForState.requirePriorityToLeaveTriage &&
      (p.priority ?? combinedPriority ?? issue.priority) === 0
    ) {
      throw new MutationError("set a priority before leaving triage", "invalid");
    }
    patch.stateId = state.id;
    patch.derivedStateId = state.id;
    patch.assertedStateId = null;
    patch.startedAt = state.type === "started" ? (issue.startedAt ?? now) : issue.startedAt;
    patch.completedAt = state.type === "completed" ? now : null;
    patch.canceledAt = state.type === "canceled" ? now : null;
    if (prev?.type === "triage" && state.type !== "triage") patch.triagedAt = now;
    if (state.type === "triage") patch.startedTriageAt = now;
    if (p.boardOrder === undefined) {
      const where = { teamId: teamForState.id, stateId: state.id };
      patch.boardOrder =
        teamForState.setIssueSortOrderOnStateChange === "top"
          ? beforeMin(ctx.store.minOf("issue", "boardOrder", where))
          : afterMax(ctx.store.maxOf("issue", "boardOrder", where));
    }
  }
  if (p.priority !== undefined) patch.priority = p.priority;
  if (p.estimate !== undefined) patch.estimate = p.estimate;
  if (p.dueDate !== undefined) patch.dueDate = p.dueDate;
  if (p.assigneeId !== undefined && p.assigneeId !== issue.assigneeId) {
    if (p.assigneeId && !ctx.store.get("user", p.assigneeId))
      throw new MutationError("assignee not found", "not_found");
    patch.assigneeId = p.assigneeId;
    if (
      p.assigneeId &&
      args.assigneeSubscriptionId &&
      !ctx.store.list("issueSubscription", { issueId: issue.id, userId: p.assigneeId }).length
    ) {
      ctx.store.insert("issueSubscription", {
        id: args.assigneeSubscriptionId,
        teamId: teamForState.id,
        issueId: issue.id,
        userId: p.assigneeId,
        createdAt: now,
        updatedAt: now,
      } as Row<"issueSubscription">);
    }
  }
  if (p.delegateId !== undefined) patch.delegateId = p.delegateId;
  if (p.subIssueSortOrder !== undefined) patch.subIssueSortOrder = p.subIssueSortOrder;
  if (p.projectId !== undefined && p.projectId !== issue.projectId) {
    patch.projectId = p.projectId;
    patch.addedToProjectAt = p.projectId ? now : null;
    if (!p.projectId) patch.projectMilestoneId = null;
  }
  if (p.projectMilestoneId !== undefined) patch.projectMilestoneId = p.projectMilestoneId;
  if (p.cycleId !== undefined && p.cycleId !== issue.cycleId) {
    patch.cycleId = p.cycleId;
    patch.addedToCycleAt = p.cycleId ? now : null;
  }
  if (p.sortOrder !== undefined) patch.sortOrder = p.sortOrder;
  if (p.boardOrder !== undefined) patch.boardOrder = p.boardOrder;
  if (p.prioritySortOrder !== undefined) patch.prioritySortOrder = p.prioritySortOrder;
  if (p.snoozedUntilAt !== undefined) {
    patch.snoozedUntilAt = p.snoozedUntilAt;
    patch.snoozedById = p.snoozedUntilAt ? ctx.actorId : null;
  }
  ctx.store.patch("issue", issue.id, patch);
}

export const mutators = {
  issueDescribe: defineEventMutator({
    args: z.strictObject({ id, description: z.string(), contentState: z.string().regex(/^[a-f0-9]{64}$/) }),
    description: "Publish an authoritative collaborative description mirror from the Document DO.",
    decide(ctx, args) {
      if (!ctx.server || !ctx.documentAuthority || ctx.actor.type !== "user" || (ctx.branchId ?? "main") !== "main")
        throw new MutationError("Descriptions must be edited through the document endpoint", "forbidden");
      const issue = requireIssue(ctx, args.id);
      if (issue.trashed || issue.archivedAt) throw new MutationError("Issue is not editable", "forbidden");
      const existing = ctx.store.get("documentContent", issue.id);
      if (existing?.contentState === args.contentState && issue.description === args.description) return [];
      return [
        {
          type: "IssueDescribed",
          entityType: "issue",
          entityId: issue.id,
          teamId: issue.teamId,
          scopeUserId: null,
          payload: { description: args.description, descriptionContentId: issue.id, contentState: args.contentState },
        },
      ];
    },
    apply: applyIssueEvent,
  }),
  issueCreate: defineEventMutator({
    args: z.object({
      id,
      teamId: id,
      title: z.string().min(1).max(500),
      description: nullable(z.string()).optional(),
      descriptionContentId: nullable(id).optional(),
      stateId: nullable(id).optional(),
      priority: priority.optional(),
      estimate: nullable(z.number().min(0)).optional(),
      dueDate: nullable(date).optional(),
      assigneeId: nullable(z.string().min(1)).optional(),
      parentId: nullable(id).optional(),
      projectId: nullable(id).optional(),
      projectMilestoneId: nullable(id).optional(),
      cycleId: nullable(id).optional(),
      labelIds: z.array(id).optional(),
      /** One per labelIds entry, caller-generated. */
      labelLinkIds: z.array(id).optional(),
      sourceCommentId: nullable(id).optional(),
      /** Id for the creator's subscription row. */
      subscriptionId: id,
      /** Id for the assignee's subscription row, when assigning to someone else. */
      assigneeSubscriptionId: id.optional(),
      position: z.enum(["top", "bottom"]).optional(),
    }),
    description: "Create an issue in a team. The DO assigns its number; the identifier KEY-N is derived from it.",
    replayArgs(event) {
      if (event.type !== "IssueCreated") return undefined;
      const fields = event.payload;
      const creatorSubscription = fields.subscriptions.find((subscription) => subscription.userId === fields.creatorId);
      if (!creatorSubscription) throw new MutationError("Recorded issue has no creator subscription", "invalid");
      const assigneeSubscription = fields.subscriptions.find(
        (subscription) => subscription.userId === fields.assigneeId && subscription.id !== creatorSubscription.id,
      );
      return {
        id: event.entityId,
        teamId: event.teamId,
        title: fields.title,
        description: fields.description,
        descriptionContentId: fields.descriptionContentId,
        stateId: fields.stateId,
        priority: fields.priority,
        estimate: fields.estimate,
        dueDate: fields.dueDate,
        assigneeId: fields.assigneeId,
        parentId: fields.parentId,
        projectId: fields.projectId,
        projectMilestoneId: fields.projectMilestoneId,
        cycleId: fields.cycleId,
        sourceCommentId: fields.sourceCommentId,
        labelIds: fields.labelLinks.map((link) => link.labelId),
        labelLinkIds: fields.labelLinks.map((link) => link.id),
        subscriptionId: creatorSubscription.id,
        ...(assigneeSubscription ? { assigneeSubscriptionId: assigneeSubscription.id } : {}),
        // Older facts predate recorded placement intent; append rather than reusing branch keys.
        position: fields.position ?? "bottom",
      };
    },
    decide(ctx, args) {
      const team = requireTeamAccess(ctx, args.teamId);
      if (args.descriptionContentId && args.descriptionContentId !== args.id)
        throw new MutationError("Description must belong to this issue", "invalid");
      if (ctx.store.get("issue", args.id)) throw new MutationError("issue already exists", "conflict");
      const title = args.title.trim();
      if (!title) throw new MutationError("title is required", "invalid");
      const baselineStateId = (team.triageEnabled ? team.triageIssueStateId : null) ?? team.defaultIssueStateId;
      const stateId = args.stateId ?? baselineStateId;
      if (!stateId) throw new MutationError("team has no default state", "invalid");
      const state = ctx.store.get("workflowState", stateId);
      if (!state || state.teamId !== team.id || state.archivedAt)
        throw new MutationError("state not in team", "invalid");
      if (args.assigneeId) requireAssignee(ctx, team, args.assigneeId);
      if (args.parentId) requireParent(ctx, args.id, args.parentId);
      if ((args.labelIds?.length ?? 0) !== (args.labelLinkIds?.length ?? 0))
        throw new MutationError("labelLinkIds must match labelIds", "invalid");

      const labelLinks: { id: string; labelId: string }[] = [];
      const seen = new Set<string>();
      const singleGroups = new Set<string>();
      (args.labelIds ?? []).forEach((labelId, i) => {
        if (seen.has(labelId)) return;
        seen.add(labelId);
        const label = ctx.store.get("issueLabel", labelId);
        if (!label || label.archivedAt || label.retiredAt) throw new MutationError("label not found", "not_found");
        if (label.teamId && label.teamId !== team.id)
          throw new MutationError("label belongs to another team", "invalid");
        if (label.isGroup) throw new MutationError("a label group cannot be applied directly", "invalid");
        if (label.parentId) {
          const group = ctx.store.get("issueLabel", label.parentId);
          if (!group?.isGroup || group.archivedAt || group.retiredAt || (group.teamId && group.teamId !== team.id))
            throw new MutationError("label group is unavailable", "invalid");
          if (group.groupType === "single") {
            if (singleGroups.has(group.id))
              throw new MutationError("only one label per single-select group", "invalid");
            singleGroups.add(group.id);
          }
        }
        labelLinks.push({ id: args.labelLinkIds![i]!, labelId });
      });
      const subscriptions = [{ id: args.subscriptionId, userId: ctx.actorId }];
      if (args.assigneeId && args.assigneeId !== ctx.actorId && args.assigneeSubscriptionId)
        subscriptions.push({ id: args.assigneeSubscriptionId, userId: args.assigneeId });

      const now = ctx.now;
      return [
        {
          type: "IssueCreated",
          entityType: "issue",
          entityId: args.id,
          teamId: team.id,
          scopeUserId: null,
          payload: {
            // Numbers are resolved while deciding on the authority and stored as facts for replay.
            number: ctx.server && (ctx.branchId ?? "main") === "main" ? team.issueCounter + 1 : 0,
            position: args.position ?? "bottom",
            title,
            description: args.description ?? null,
            descriptionContentId: args.descriptionContentId ?? null,
            priority: args.priority ?? 0,
            prioritySortOrder: afterMax(ctx.store.maxOf("issue", "prioritySortOrder", { teamId: team.id })),
            estimate: args.estimate ?? null,
            dueDate: args.dueDate ?? null,
            sortOrder:
              args.position === "top"
                ? beforeMin(ctx.store.minOf("issue", "sortOrder", { teamId: team.id }))
                : afterMax(ctx.store.maxOf("issue", "sortOrder", { teamId: team.id })),
            boardOrder: afterMax(ctx.store.maxOf("issue", "boardOrder", { teamId: team.id, stateId })),
            subIssueSortOrder: args.parentId
              ? afterMax(ctx.store.maxOf("issue", "subIssueSortOrder", { parentId: args.parentId }) ?? undefined)
              : null,
            stateId,
            assertedStateId: ctx.actor.type === "user" ? (args.stateId ?? null) : null,
            derivedStateId: ctx.actor.type === "user" ? (baselineStateId ?? stateId) : stateId,
            assigneeId: args.assigneeId ?? null,
            creatorId: ctx.actorId,
            parentId: args.parentId ?? null,
            projectId: args.projectId ?? null,
            projectMilestoneId: args.projectMilestoneId ?? null,
            cycleId: args.cycleId ?? null,
            sourceCommentId: args.sourceCommentId ?? null,
            startedAt: state.type === "started" ? now : null,
            completedAt: state.type === "completed" ? now : null,
            canceledAt: state.type === "canceled" ? now : null,
            triagedAt: state.type === "triage" ? null : team.triageEnabled ? now : null,
            startedTriageAt: state.type === "triage" ? now : null,
            addedToTeamAt: now,
            addedToProjectAt: args.projectId ? now : null,
            addedToCycleAt: args.cycleId ? now : null,
            labelLinks,
            subscriptions,
          },
        },
      ];
    },
    apply: applyIssueEvent,
  }),

  issueUpdate: defineEventMutator({
    args: issueUpdateArgs,
    description:
      "Update one or more fields of an issue: title, state, priority, assignee, dates, parent, project, cycle, ordering.",
    replayArgs(event) {
      return event.type === "IssueTitled" ? { id: event.entityId, patch: { title: event.payload.title } } : undefined;
    },
    decide(ctx, args) {
      const issue = requireIssue(ctx, args.id);
      const p = args.patch;
      if (
        (ctx.branchId ?? "main") !== "main" &&
        (p.title === undefined || Object.entries(p).some(([key, value]) => key !== "title" && value !== undefined))
      )
        throw new MutationError("This command is not supported on branches");
      if (p.description !== undefined)
        throw new MutationError("Descriptions must be edited through the document endpoint", "forbidden");
      const moving = p.teamId !== undefined && p.teamId !== issue.teamId;
      const team = requireTeamAccess(ctx, moving ? p.teamId! : issue.teamId);
      const effectiveAssignee = p.assigneeId !== undefined ? p.assigneeId : issue.assigneeId;
      if (moving && effectiveAssignee) requireAssignee(ctx, team, effectiveAssignee);
      const subject = { entityType: "issue" as const, entityId: issue.id, teamId: team.id, scopeUserId: null };
      const events: PendingEvent[] = [];
      if (p.parentId) requireParent(ctx, issue.id, p.parentId);
      if (p.parentId !== undefined && p.parentId !== issue.parentId) {
        events.push({
          ...subject,
          type: "IssueParentChanged",
          payload: {
            parentId: p.parentId,
            subIssueSortOrder: p.parentId
              ? (p.subIssueSortOrder ??
                afterMax(ctx.store.maxOf("issue", "subIssueSortOrder", { parentId: p.parentId }) ?? undefined))
              : null,
          },
        });
      }
      if (p.title !== undefined) {
        const title = p.title.trim();
        if (!title) throw new MutationError("title is required", "invalid");
        events.push({ ...subject, type: "IssueTitled", payload: { title } });
      }
      if (p.priority !== undefined && p.priority !== issue.priority)
        events.push({ ...subject, type: "IssuePrioritized", payload: { priority: p.priority } });
      // Existing team moves select the destination's matching state and intentionally ignore patch.stateId.
      if (!moving && p.stateId !== undefined && ctx.actor.type === "user")
        events.push(statusAssertion(ctx, issue, p.stateId, p.priority ?? issue.priority, p.boardOrder));
      if (p.assigneeId !== undefined && p.assigneeId !== issue.assigneeId) {
        if (p.assigneeId) requireAssignee(ctx, team, p.assigneeId);
        events.push(
          p.assigneeId
            ? { ...subject, type: "IssueAssigned", payload: { assigneeId: p.assigneeId } }
            : { ...subject, type: "IssueUnassigned", payload: {} },
        );
        if (
          p.assigneeId &&
          args.assigneeSubscriptionId &&
          !ctx.store.list("issueSubscription", { issueId: issue.id, userId: p.assigneeId }).length
        )
          events.push({
            ...subject,
            type: "SubscriberAdded",
            payload: { id: args.assigneeSubscriptionId, userId: p.assigneeId },
          });
      }
      return events;
    },
    apply: applyIssueEvent,
    beforeEvents(ctx, args) {
      const patch = { ...args.patch };
      delete patch.title;
      delete patch.priority;
      delete patch.assigneeId;
      if (patch.parentId !== undefined) {
        if (patch.parentId !== ctx.store.get("issue", args.id)?.parentId) delete patch.subIssueSortOrder;
        delete patch.parentId;
      }
      if (ctx.actor.type === "user") delete patch.stateId;
      if (!Object.values(patch).some((value) => value !== undefined)) return;
      if ((ctx.branchId ?? "main") !== "main") throw new MutationError("This command is not supported on branches");
      runLegacyIssueUpdate(ctx, { ...args, patch }, args.patch.priority);
    },
  }),

  issueAssertStatus: defineEventMutator({
    args: z.strictObject({ id, stateId: nullable(id) }),
    description: "Assert a human status, or clear that assertion to return to the preserved baseline.",
    decide(ctx, args) {
      return [statusAssertion(ctx, requireIssue(ctx, args.id), args.stateId)];
    },
    apply: applyIssueEvent,
  }),

  issueArchive: defineEventMutator({
    args: z.object({ id, archived: z.boolean() }),
    description: "Archive or unarchive an issue.",
    decide(ctx, args) {
      if ((ctx.branchId ?? "main") !== "main") throw new MutationError("This event is not supported on branches");
      const issue = requireIssue(ctx, args.id);
      if (Boolean(issue.archivedAt) === args.archived) return [];
      const subject = { entityType: "issue" as const, entityId: issue.id, teamId: issue.teamId, scopeUserId: null };
      return args.archived
        ? [{ ...subject, type: "IssueArchived", payload: {} }]
        : [{ ...subject, type: "IssueRestored", payload: { from: "archive" } }];
    },
    apply: applyIssueEvent,
  }),

  issueTrash: defineMutator({
    args: z.object({ id, trashed: z.boolean() }),
    description: "Move an issue to the trash or restore it.",
    run(ctx, args) {
      requireIssue(ctx, args.id);
      ctx.store.patch("issue", args.id, { trashed: args.trashed, updatedAt: ctx.now });
    },
  }),

  issueDelete: defineMutator({
    args: z.object({ id }),
    description: "Permanently delete a trashed issue and its comments, links and reactions.",
    run(ctx, args) {
      const issue = ctx.store.get("issue", args.id);
      if (!issue) return;
      requireTeamAccess(ctx, issue.teamId);
      if (!issue.trashed) throw new MutationError("only trashed issues can be deleted", "invalid");
      for (const m of ISSUE_CHILD_MODELS) {
        for (const r of ctx.store.list(m, { issueId: args.id } as never)) ctx.store.delete(m, r.id);
      }
      for (const r of ctx.store.list("issueRelation", { relatedIssueId: args.id }))
        ctx.store.delete("issueRelation", r.id);
      for (const child of ctx.store.list("issue", { parentId: args.id }))
        ctx.store.patch("issue", child.id, { parentId: null, subIssueSortOrder: null, updatedAt: ctx.now });
      ctx.store.delete("issue", args.id);
    },
  }),

  issueLabelsSet: defineEventMutator({
    args: z.object({ issueId: id, add: z.array(z.object({ labelId: id, linkId: id })), remove: z.array(id) }),
    description: "Add and remove labels on an issue. Single-select groups keep one child label at a time.",
    decide(ctx, args) {
      if ((ctx.branchId ?? "main") !== "main") throw new MutationError("This event is not supported on branches");
      const issue = requireIssue(ctx, args.issueId);
      const subject = { entityType: "issue" as const, entityId: issue.id, teamId: issue.teamId, scopeUserId: null };
      const current = new Map(
        ctx.store.list("issueLabelLink", { issueId: issue.id }).map((link) => [link.labelId, link]),
      );
      const events: PendingEvent[] = [];
      const unlink = (labelId: string) => {
        const link = current.get(labelId);
        if (!link) return;
        events.push({ ...subject, type: "LabelRemoved", payload: { labelId, linkId: link.id } });
        current.delete(labelId);
      };
      for (const { labelId, linkId } of args.add) {
        if (current.has(labelId)) continue;
        const label = ctx.store.get("issueLabel", labelId);
        if (!label || label.archivedAt || label.retiredAt) throw new MutationError("label not found", "not_found");
        if (label.teamId && label.teamId !== issue.teamId)
          throw new MutationError("label belongs to another team", "invalid");
        if (label.isGroup) throw new MutationError("a label group cannot be applied directly", "invalid");
        const group = label.parentId ? ctx.store.get("issueLabel", label.parentId) : undefined;
        if (
          label.parentId &&
          (!group?.isGroup || group.archivedAt || group.retiredAt || (group.teamId && group.teamId !== issue.teamId))
        )
          throw new MutationError("label group is unavailable", "invalid");
        if (group?.groupType === "single") {
          for (const sibling of [...current.values()]) {
            if (ctx.store.get("issueLabel", sibling.labelId)?.parentId === label.parentId) unlink(sibling.labelId);
          }
        }
        events.push({ ...subject, type: "LabelAdded", payload: { labelId, linkId } });
        current.set(labelId, { id: linkId, labelId } as Row<"issueLabelLink">);
      }
      for (const labelId of args.remove) unlink(labelId);
      return events;
    },
    apply: applyIssueEvent,
  }),

  issueSubscribe: defineMutator({
    args: z.object({ issueId: id, subscriptionId: id, userId: z.string().min(1).optional() }),
    description: "Subscribe a user (default: the caller) to an issue's notifications.",
    run(ctx, args) {
      const userId = args.userId ?? ctx.actorId;
      const issue = requireIssue(ctx, args.issueId);
      if (!ctx.store.get("user", userId)) throw new MutationError("user not found", "not_found");
      if (ctx.store.list("issueSubscription", { issueId: args.issueId, userId }).length) return;
      ctx.store.insert("issueSubscription", {
        id: args.subscriptionId,
        teamId: issue.teamId,
        issueId: args.issueId,
        userId,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      } as Row<"issueSubscription">);
    },
  }),

  issueUnsubscribe: defineMutator({
    args: z.object({ issueId: id, userId: z.string().min(1).optional() }),
    description: "Unsubscribe a user (default: the caller) from an issue.",
    run(ctx, args) {
      const userId = args.userId ?? ctx.actorId;
      requireIssue(ctx, args.issueId);
      if (userId !== ctx.actorId) requireTeamAdminOrSelf(ctx, args.issueId);
      for (const s of ctx.store.list("issueSubscription", { issueId: args.issueId, userId }))
        ctx.store.delete("issueSubscription", s.id);
    },
  }),

  issueRelationCreate: defineEventMutator({
    args: z.object({
      id,
      issueId: id,
      relatedIssueId: id,
      type: z.enum(["blocks", "duplicate", "related", "similar"]),
    }),
    description: "Relate two accessible issues. Blocks is directed; other relationships are symmetric.",
    decide(ctx, args) {
      if ((ctx.branchId ?? "main") !== "main") throw new MutationError("This command is not supported on branches");
      if (args.issueId === args.relatedIssueId) throw new MutationError("An issue cannot relate to itself", "invalid");
      const issue = requireIssue(ctx, args.issueId);
      requireIssue(ctx, args.relatedIssueId);
      const links = ctx.store.list("issueRelation");
      if (
        links.some(
          (r) =>
            r.type === args.type &&
            ((r.issueId === args.issueId && r.relatedIssueId === args.relatedIssueId) ||
              (args.type !== "blocks" && r.issueId === args.relatedIssueId && r.relatedIssueId === args.issueId)),
        )
      )
        return [];
      if (args.type === "blocks") {
        const visited = new Set<string>();
        const remaining = [args.relatedIssueId];
        while (remaining.length) {
          const current = remaining.pop()!;
          if (current === args.issueId) throw new MutationError("This dependency would create a cycle", "invalid");
          if (visited.has(current)) continue;
          visited.add(current);
          for (const link of links)
            if (link.type === "blocks" && link.issueId === current) remaining.push(link.relatedIssueId);
        }
      }
      return [
        {
          type: "IssueRelationAdded",
          entityType: "issue",
          entityId: issue.id,
          teamId: issue.teamId,
          scopeUserId: null,
          payload: { linkId: args.id, relatedIssueId: args.relatedIssueId, relationType: args.type },
        },
      ];
    },
    apply: applyIssueEvent,
  }),

  issueRelationDelete: defineEventMutator({
    args: z.object({ id }),
    description: "Remove a relation only when both endpoints are accessible.",
    decide(ctx, args) {
      if ((ctx.branchId ?? "main") !== "main") throw new MutationError("This command is not supported on branches");
      const link = ctx.store.get("issueRelation", args.id);
      if (!link) return [];
      const issue = requireIssue(ctx, link.issueId);
      requireIssue(ctx, link.relatedIssueId);
      return [
        {
          type: "IssueRelationRemoved",
          entityType: "issue",
          entityId: issue.id,
          teamId: issue.teamId,
          scopeUserId: null,
          payload: { linkId: link.id, relatedIssueId: link.relatedIssueId },
        },
      ];
    },
    apply: applyIssueEvent,
  }),

  issueLabelCreate: defineMutator({
    args: z.object({
      id,
      name: z.string().min(1).max(60),
      color,
      teamId: nullable(id).optional(),
      parentId: nullable(id).optional(),
      isGroup: z.boolean().optional(),
      groupType: nullable(z.enum(["single", "multi"])).optional(),
      description: nullable(z.string()).optional(),
    }),
    description: "Create a label (workspace-wide or per team), optionally inside a label group.",
    run(ctx, args) {
      const name = args.name.trim();
      if (!name) throw new MutationError("label name is required", "invalid");
      if (args.teamId) requireTeamAccess(ctx, args.teamId);
      const clash = ctx.store
        .list("issueLabel", { teamId: args.teamId ?? null, parentId: args.parentId ?? null })
        .some((l) => l.name.toLowerCase() === name.toLowerCase() && !l.archivedAt);
      if (clash) throw new MutationError(`label "${name}" already exists`, "conflict");
      if (args.parentId) {
        const parent = ctx.store.get("issueLabel", args.parentId);
        if (!parent?.isGroup || parent.archivedAt || parent.retiredAt)
          throw new MutationError("parent must be an active label group", "invalid");
        if (parent.teamId && parent.teamId !== (args.teamId ?? null))
          throw new MutationError("parent label group belongs to another team", "invalid");
        if (parent.teamId) requireTeamAccess(ctx, parent.teamId);
      }
      ctx.store.insert("issueLabel", {
        id: args.id,
        name,
        color: args.color,
        teamId: args.teamId ?? null,
        parentId: args.parentId ?? null,
        isGroup: args.isGroup ?? false,
        groupType: args.isGroup ? (args.groupType ?? "multi") : null,
        description: args.description ?? null,
        creatorId: ctx.actorId,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      } as Row<"issueLabel">);
    },
  }),

  issueLabelUpdate: defineMutator({
    args: z.object({
      id,
      patch: z
        .object({
          name: z.string().min(1).max(60),
          color,
          description: nullable(z.string()),
          parentId: nullable(id),
          groupType: nullable(z.enum(["single", "multi"])),
          retiredAt: nullable(iso),
        })
        .partial(),
    }),
    description: "Rename, recolour, move or retire a label.",
    run(ctx, args) {
      const l = ctx.store.get("issueLabel", args.id);
      if (!l) throw new MutationError("label not found", "not_found");
      if (l.teamId) requireTeamAccess(ctx, l.teamId);
      ctx.store.patch("issueLabel", args.id, { ...args.patch, updatedAt: ctx.now });
    },
  }),

  issueLabelDelete: defineMutator({
    args: z.object({ id }),
    description: "Archive a label and remove it from all issues.",
    run(ctx, args) {
      const l = ctx.store.get("issueLabel", args.id);
      if (!l) return;
      if (l.teamId) requireTeamAccess(ctx, l.teamId);
      for (const link of ctx.store.list("issueLabelLink", { labelId: args.id }))
        ctx.store.delete("issueLabelLink", link.id);
      for (const child of ctx.store.list("issueLabel", { parentId: args.id }))
        ctx.store.patch("issueLabel", child.id, { parentId: null, updatedAt: ctx.now });
      ctx.store.patch("issueLabel", args.id, { archivedAt: ctx.now, updatedAt: ctx.now });
    },
  }),
};
