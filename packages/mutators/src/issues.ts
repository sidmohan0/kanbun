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

/** Acting on another user's rows under an issue takes a team admin. */
function requireTeamAdminOrSelf(ctx: MutatorContext, issueId: string): void {
  const issue = ctx.store.get("issue", issueId);
  if (!issue) throw new MutationError("issue not found", "not_found");
  requireTeamAdmin(ctx, issue.teamId);
}

/** Rows that hang off an issue and carry its team; moved with it. */
export const ISSUE_CHILD_MODELS = [
  "issueLabelLink",
  "issueSubscription",
  "issueRelation",
  "comment",
  "reaction",
  "attachment",
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

export const mutators = {
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
      if (ctx.store.get("issue", args.id)) throw new MutationError("issue already exists", "conflict");
      const title = args.title.trim();
      if (!title) throw new MutationError("title is required", "invalid");
      const stateId = args.stateId ?? (team.triageEnabled ? team.triageIssueStateId : null) ?? team.defaultIssueStateId;
      if (!stateId) throw new MutationError("team has no default state", "invalid");
      const state = ctx.store.get("workflowState", stateId);
      if (!state || state.teamId !== team.id) throw new MutationError("state not in team", "invalid");
      if (args.parentId && !ctx.store.get("issue", args.parentId))
        throw new MutationError("parent not found", "not_found");
      if ((args.labelIds?.length ?? 0) !== (args.labelLinkIds?.length ?? 0))
        throw new MutationError("labelLinkIds must match labelIds", "invalid");

      const labelLinks: { id: string; labelId: string }[] = [];
      const seen = new Set<string>();
      (args.labelIds ?? []).forEach((labelId, i) => {
        if (seen.has(labelId)) return;
        seen.add(labelId);
        const label = ctx.store.get("issueLabel", labelId);
        if (!label || label.archivedAt) throw new MutationError("label not found", "not_found");
        if (label.teamId && label.teamId !== team.id)
          throw new MutationError("label belongs to another team", "invalid");
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
    args: z.object({ id, patch: issuePatch, assigneeSubscriptionId: id.optional() }),
    description:
      "Update one or more fields of an issue: title, state, priority, assignee, dates, parent, project, cycle, ordering.",
    replayArgs(event) {
      return event.type === "IssueTitled" ? { id: event.entityId, patch: { title: event.payload.title } } : undefined;
    },
    decide(ctx, args) {
      // Other fields retain the existing mutation path until their event vocabulary is implemented.
      if (
        args.patch.title === undefined ||
        Object.entries(args.patch).some(([key, value]) => key !== "title" && value !== undefined)
      )
        return null;
      const issue = requireIssue(ctx, args.id);
      const title = args.patch.title.trim();
      if (!title) throw new MutationError("title is required", "invalid");
      return [
        {
          type: "IssueTitled",
          entityType: "issue",
          entityId: issue.id,
          teamId: issue.teamId,
          scopeUserId: null,
          payload: { title },
        },
      ];
    },
    apply: applyIssueEvent,
    run(ctx, args) {
      const issue = requireIssue(ctx, args.id);
      const p = { ...args.patch };
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
        if (!state || state.teamId !== teamForState.id) throw new MutationError("state not in team", "invalid");
        const prev = ctx.store.get("workflowState", issue.stateId);
        if (
          prev?.type === "triage" &&
          teamForState.requirePriorityToLeaveTriage &&
          (p.priority ?? issue.priority) === 0
        ) {
          throw new MutationError("set a priority before leaving triage", "invalid");
        }
        patch.stateId = state.id;
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
      if (p.parentId !== undefined && p.parentId !== issue.parentId) {
        if (p.parentId) {
          if (p.parentId === issue.id) throw new MutationError("an issue cannot be its own parent", "invalid");
          let cursor = ctx.store.get("issue", p.parentId);
          if (!cursor) throw new MutationError("parent not found", "not_found");
          for (let depth = 0; cursor && depth < 64; depth++) {
            if (cursor.id === issue.id) throw new MutationError("cycle in parent chain", "invalid");
            cursor = cursor.parentId ? ctx.store.get("issue", cursor.parentId) : undefined;
          }
          patch.subIssueSortOrder =
            p.subIssueSortOrder ??
            afterMax(ctx.store.maxOf("issue", "subIssueSortOrder", { parentId: p.parentId }) ?? undefined);
        } else patch.subIssueSortOrder = null;
        patch.parentId = p.parentId;
      } else if (p.subIssueSortOrder !== undefined) patch.subIssueSortOrder = p.subIssueSortOrder;
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
    },
  }),

  issueArchive: defineMutator({
    args: z.object({ id, archived: z.boolean() }),
    description: "Archive or unarchive an issue.",
    run(ctx, args) {
      requireIssue(ctx, args.id);
      ctx.store.patch("issue", args.id, {
        archivedAt: args.archived ? ctx.now : null,
        autoArchivedAt: null,
        updatedAt: ctx.now,
      });
    },
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

  issueLabelsSet: defineMutator({
    args: z.object({ issueId: id, add: z.array(z.object({ labelId: id, linkId: id })), remove: z.array(id) }),
    description: "Add and remove labels on an issue. Single-select groups keep one child label at a time.",
    run(ctx, args) {
      const issue = requireIssue(ctx, args.issueId);
      // `current` tracks the links as this call changes them, so two labels from
      // one single-select group in the same `add` still end with one child.
      const current = new Map(ctx.store.list("issueLabelLink", { issueId: args.issueId }).map((l) => [l.labelId, l]));
      const unlink = (labelId: string) => {
        const l = current.get(labelId);
        if (!l) return false;
        ctx.store.delete("issueLabelLink", l.id);
        current.delete(labelId);
        return true;
      };
      let changed = false;
      for (const { labelId, linkId } of args.add) {
        if (current.has(labelId)) continue;
        const label = ctx.store.get("issueLabel", labelId);
        if (!label || label.archivedAt) throw new MutationError("label not found", "not_found");
        if (label.teamId && label.teamId !== issue.teamId)
          throw new MutationError("label belongs to another team", "invalid");
        if (label.isGroup) throw new MutationError("a label group cannot be applied directly", "invalid");
        if (label.parentId) {
          const group = ctx.store.get("issueLabel", label.parentId);
          if (group?.groupType === "single") {
            for (const l of [...current.values()]) {
              const sibling = ctx.store.get("issueLabel", l.labelId);
              if (sibling?.parentId === label.parentId) unlink(l.labelId);
            }
          }
        }
        const link = {
          id: linkId,
          teamId: issue.teamId,
          issueId: args.issueId,
          labelId,
          createdAt: ctx.now,
          updatedAt: ctx.now,
        } as Row<"issueLabelLink">;
        ctx.store.insert("issueLabelLink", link);
        current.set(labelId, link);
        if (ctx.server) ctx.store.patch("issueLabel", labelId, { lastAppliedAt: ctx.now });
        changed = true;
      }
      for (const labelId of args.remove) if (unlink(labelId)) changed = true;
      if (changed) ctx.store.patch("issue", args.issueId, { updatedAt: ctx.now });
    },
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

  issueRelationCreate: defineMutator({
    args: z.object({
      id,
      issueId: id,
      relatedIssueId: id,
      type: z.enum(["blocks", "duplicate", "related", "similar"]),
    }),
    description: "Relate two issues (blocks, duplicate, related, similar).",
    run(ctx, args) {
      if (args.issueId === args.relatedIssueId) throw new MutationError("an issue cannot relate to itself", "invalid");
      const issue = requireIssue(ctx, args.issueId);
      requireIssue(ctx, args.relatedIssueId);
      const dup = ctx.store
        .list("issueRelation", { issueId: args.issueId, relatedIssueId: args.relatedIssueId })
        .some((r) => r.type === args.type);
      if (dup) return;
      ctx.store.insert("issueRelation", {
        id: args.id,
        teamId: issue.teamId,
        issueId: args.issueId,
        relatedIssueId: args.relatedIssueId,
        type: args.type,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      } as Row<"issueRelation">);
    },
  }),

  issueRelationDelete: defineMutator({
    args: z.object({ id }),
    description: "Remove an issue relation.",
    run(ctx, args) {
      const r = ctx.store.get("issueRelation", args.id);
      if (!r) return;
      requireIssue(ctx, r.issueId);
      ctx.store.delete("issueRelation", args.id);
    },
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
      if (args.teamId) requireTeamAccess(ctx, args.teamId);
      const clash = ctx.store
        .list("issueLabel", { teamId: args.teamId ?? null, parentId: args.parentId ?? null })
        .some((l) => l.name.toLowerCase() === name.toLowerCase() && !l.archivedAt);
      if (clash) throw new MutationError(`label "${name}" already exists`, "conflict");
      if (args.parentId) {
        const parent = ctx.store.get("issueLabel", args.parentId);
        if (!parent?.isGroup) throw new MutationError("parent must be a label group", "invalid");
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
