import type { PendingEvent } from "@kanbun/events";
import type { Row } from "@kanbun/model";
import { MutationError, defineEventMutator, defineMutator, issueIncarnation, type DecideContext } from "@kanbun/sync";
import { z } from "zod";
import { requireIssue } from "./issues";
import { id, nullable, pmDoc } from "./schema";
import { applyCommentEvent } from "./commentEvents";
import { requireTeamAccess } from "./teams";

/** The issue a comment belongs to, after checking the caller may see it. */
function requireCommentIssue(ctx: DecideContext, c: Row<"comment">): Row<"issue"> {
  if (!c.issueId) throw new MutationError("comment is not on an issue", "invalid");
  return requireIssue(ctx, c.issueId);
}

function requireActiveAuthor(ctx: DecideContext) {
  const agent = ctx.actor.type === "agent" ? ctx.store.get("agent", ctx.actorId) : null;
  const user = ctx.store.get("user", agent?.ownerId ?? ctx.actorId);
  if (
    (ctx.actor.type !== "user" && ctx.actor.type !== "agent") ||
    !user?.active ||
    user.archivedAt ||
    (ctx.actor.type === "agent" && (!agent?.active || agent.archivedAt))
  )
    throw new MutationError("Comments require an active author", "forbidden");
}

function commentSubject(issue: Row<"issue">, commentId: string) {
  return { entityType: "comment" as const, entityId: commentId, teamId: issue.teamId, scopeUserId: null };
}

function mentionIds(ctx: DecideContext, teamId: string, ids: string[]): string[] {
  return [...new Set(ids)].filter((userId) => {
    const user = ctx.store.get("user", userId);
    if (!user?.active || user.archivedAt) throw new MutationError("Mentioned member is unavailable", "invalid");
    requireTeamAccess({ ...ctx, actor: { id: userId, type: "user" }, actorId: userId }, teamId);
    return true;
  });
}

export const mutators = {
  commentCreate: defineEventMutator({
    args: z.object({
      id,
      issueId: id,
      /** Browser outboxes bind drafts to the issue incarnation they were written against. */
      issueIncarnation: z.string().optional(),
      /** Plain-text rendering, for search and previews. */
      body: z.string().max(20_000),
      mentionedUserIds: z.array(z.string().min(1)).optional(),
      /** ProseMirror document; optional for agents and API callers who send plain text. */
      bodyData: nullable(pmDoc).optional(),
      parentId: nullable(id).optional(),
      quotedText: nullable(z.string().max(2000)).optional(),
      /** Subscribe the author to the issue; caller supplies the id. */
      subscriptionId: id.optional(),
    }),
    description: "Comment on an issue, optionally as a reply in a thread.",
    decide(ctx, args) {
      requireActiveAuthor(ctx);
      const issue = requireIssue(ctx, args.issueId);
      if (args.issueIncarnation !== undefined && args.issueIncarnation !== issueIncarnation(issue))
        throw new MutationError("This issue was replaced; the comment was not posted", "conflict");
      if (!args.body.trim()) throw new MutationError("comment is empty", "invalid");
      if (ctx.store.get("comment", args.id)) throw new MutationError("comment already exists", "conflict");
      const parent = args.parentId ? ctx.store.get("comment", args.parentId) : undefined;
      if (args.parentId) {
        if (!parent || parent.issueId !== args.issueId)
          throw new MutationError("parent comment not on this issue", "invalid");
        if (parent.parentId) throw new MutationError("replies cannot be nested", "invalid");
      }
      const mentioned = mentionIds(ctx, issue.teamId, args.mentionedUserIds ?? []);
      const events: PendingEvent[] = [
        {
          ...commentSubject(issue, args.id),
          type: "CommentPosted",
          payload: {
            issueId: issue.id,
            body: args.body,
            mentionedUserIds: mentioned,
            addedMentionedUserIds: mentioned,
            bodyData: args.bodyData ?? null,
            parentId: args.parentId ?? null,
            replyToUserId:
              parent?.userId ?? (parent?.agentId ? (ctx.store.get("agent", parent.agentId)?.ownerId ?? null) : null),
            quotedText: args.quotedText ?? null,
            userId: ctx.actor.type === "user" ? ctx.actorId : null,
            agentId: ctx.actor.type === "agent" ? ctx.actorId : null,
          },
        },
      ];
      if (
        args.subscriptionId &&
        ctx.actor.type === "user" &&
        !ctx.store.list("issueSubscription", { issueId: issue.id, userId: ctx.actorId }).length
      )
        events.push({
          entityType: "issue",
          entityId: issue.id,
          teamId: issue.teamId,
          scopeUserId: null,
          type: "SubscriberAdded",
          payload: { id: args.subscriptionId, userId: ctx.actorId },
        });
      return events;
    },
    apply: applyCommentEvent,
  }),

  commentUpdate: defineEventMutator({
    args: z.object({
      id,
      body: z.string().min(1).max(20_000),
      bodyData: nullable(pmDoc).optional(),
      mentionedUserIds: z.array(z.string().min(1)).optional(),
    }),
    description: "Edit your own comment.",
    decide(ctx, args) {
      requireActiveAuthor(ctx);
      const c = ctx.store.get("comment", args.id);
      if (!c) throw new MutationError("comment not found", "not_found");
      const issue = requireCommentIssue(ctx, c);
      const mine = ctx.actor.type === "agent" ? c.agentId === ctx.actorId : c.userId === ctx.actorId;
      if (!mine) throw new MutationError("only the author can edit a comment", "forbidden");
      if (!args.body.trim()) throw new MutationError("comment is empty", "invalid");
      const mentioned = args.mentionedUserIds === undefined ? c.mentionedUserIds : [...new Set(args.mentionedUserIds)];
      mentionIds(
        ctx,
        issue.teamId,
        mentioned.filter((userId) => !c.mentionedUserIds.includes(userId)),
      );
      return [
        {
          ...commentSubject(issue, c.id),
          type: "CommentEdited",
          payload: {
            issueId: issue.id,
            body: args.body,
            bodyData: args.bodyData ?? c.bodyData,
            mentionedUserIds: mentioned,
            addedMentionedUserIds: mentioned.filter((userId) => !c.mentionedUserIds.includes(userId)),
          },
        },
      ];
    },
    apply: applyCommentEvent,
  }),

  commentDelete: defineMutator({
    args: z.object({ id }),
    description: "Delete a comment and its replies (author or admin).",
    run(ctx, args) {
      const c = ctx.store.get("comment", args.id);
      if (!c) return;
      requireCommentIssue(ctx, c);
      const me = ctx.store.get("user", ctx.actorId);
      const mine = ctx.actor.type === "agent" ? c.agentId === ctx.actorId : c.userId === ctx.actorId;
      if (!mine && me?.role !== "admin" && me?.role !== "owner")
        throw new MutationError("only the author or an admin can delete a comment", "forbidden");
      for (const r of ctx.store.list("reaction", { commentId: args.id })) ctx.store.delete("reaction", r.id);
      for (const reply of ctx.store.list("comment", { parentId: args.id })) ctx.store.delete("comment", reply.id);
      ctx.store.delete("comment", args.id);
    },
  }),

  commentResolve: defineEventMutator({
    args: z.object({ id, resolved: z.boolean(), resolvingCommentId: nullable(id).optional() }),
    description: "Resolve or reopen a comment thread.",
    decide(ctx, args) {
      requireActiveAuthor(ctx);
      const c = ctx.store.get("comment", args.id);
      if (!c) throw new MutationError("comment not found", "not_found");
      const issue = requireCommentIssue(ctx, c);
      if (c.parentId) throw new MutationError("only a thread's top comment can be resolved", "invalid");
      if (args.resolved && args.resolvingCommentId) {
        const resolving = ctx.store.get("comment", args.resolvingCommentId);
        if (!resolving || (resolving.id !== c.id && resolving.parentId !== c.id))
          throw new MutationError("resolving comment must be in the thread", "invalid");
      }
      return [
        {
          ...commentSubject(issue, c.id),
          type: "CommentResolved",
          payload: {
            issueId: issue.id,
            resolved: args.resolved,
            resolvingUserId: args.resolved ? ctx.actorId : null,
            resolvingCommentId: args.resolved ? (args.resolvingCommentId ?? null) : null,
          },
        },
      ];
    },
    apply: applyCommentEvent,
  }),

  reactionToggle: defineMutator({
    args: z.object({
      id,
      emoji: z.string().min(1).max(32),
      issueId: nullable(id).optional(),
      commentId: nullable(id).optional(),
    }),
    description: "Add a reaction to an issue or comment, or remove it if the caller already reacted with that emoji.",
    run(ctx, args) {
      // Resolve the target to an issue the caller may see; a reaction to a comment still belongs to the issue.
      let issue: Row<"issue">;
      if (args.commentId) {
        const c = ctx.store.get("comment", args.commentId);
        if (!c) throw new MutationError("comment not found", "not_found");
        issue = requireCommentIssue(ctx, c);
      } else if (args.issueId) issue = requireIssue(ctx, args.issueId);
      else throw new MutationError("reaction needs a target", "invalid");
      const where = args.commentId ? { commentId: args.commentId } : { issueId: issue.id, commentId: null };
      const mine = ctx.store.list("reaction", { ...where, userId: ctx.actorId }).filter((r) => r.emoji === args.emoji);
      if (mine.length) {
        for (const r of mine) ctx.store.delete("reaction", r.id);
        return;
      }
      ctx.store.insert("reaction", {
        id: args.id,
        teamId: issue.teamId,
        emoji: args.emoji,
        userId: ctx.actorId,
        issueId: issue.id,
        commentId: args.commentId ?? null,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      } as Row<"reaction">);
    },
  }),
};
