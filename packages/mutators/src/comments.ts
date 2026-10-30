import type { Row } from "@kanbun/model";
import { MutationError, defineMutator, type MutatorContext } from "@kanbun/sync";
import { z } from "zod";
import { requireIssue } from "./issues";
import { id, nullable, pmDoc } from "./schema";

/** The issue a comment belongs to, after checking the caller may see it. */
function requireCommentIssue(ctx: MutatorContext, c: Row<"comment">): Row<"issue"> {
  if (!c.issueId) throw new MutationError("comment is not on an issue", "invalid");
  return requireIssue(ctx, c.issueId);
}

export const mutators = {
  commentCreate: defineMutator({
    args: z.object({
      id,
      issueId: id,
      /** Plain-text rendering, for search and previews. */
      body: z.string().max(20_000),
      /** ProseMirror document; optional for agents and API callers who send plain text. */
      bodyData: nullable(pmDoc).optional(),
      parentId: nullable(id).optional(),
      quotedText: nullable(z.string().max(2000)).optional(),
      /** Subscribe the author to the issue; caller supplies the id. */
      subscriptionId: id.optional(),
    }),
    description: "Comment on an issue, optionally as a reply in a thread.",
    run(ctx, args) {
      const issue = requireIssue(ctx, args.issueId);
      if (ctx.actor.type !== "user" && ctx.actor.type !== "agent")
        throw new MutationError("comments need a user or agent author", "forbidden");
      if (!args.body.trim()) throw new MutationError("comment is empty", "invalid");
      if (args.parentId) {
        const parent = ctx.store.get("comment", args.parentId);
        if (!parent || parent.issueId !== args.issueId)
          throw new MutationError("parent comment not on this issue", "invalid");
        if (parent.parentId) throw new MutationError("replies cannot be nested", "invalid");
      }
      ctx.store.insert("comment", {
        id: args.id,
        teamId: issue.teamId,
        issueId: args.issueId,
        body: args.body,
        bodyData: args.bodyData ?? null,
        parentId: args.parentId ?? null,
        quotedText: args.quotedText ?? null,
        userId: ctx.actor.type === "user" ? ctx.actorId : null,
        agentId: ctx.actor.type === "agent" ? ctx.actorId : null,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      } as Row<"comment">);
      ctx.store.patch("issue", args.issueId, { updatedAt: ctx.now });
      if (
        args.subscriptionId &&
        ctx.actor.type === "user" &&
        !ctx.store.list("issueSubscription", { issueId: args.issueId, userId: ctx.actorId }).length
      ) {
        ctx.store.insert("issueSubscription", {
          id: args.subscriptionId,
          teamId: issue.teamId,
          issueId: args.issueId,
          userId: ctx.actorId,
          createdAt: ctx.now,
          updatedAt: ctx.now,
        } as Row<"issueSubscription">);
      }
    },
  }),

  commentUpdate: defineMutator({
    args: z.object({ id, body: z.string().min(1).max(20_000), bodyData: nullable(pmDoc).optional() }),
    description: "Edit your own comment.",
    run(ctx, args) {
      const c = ctx.store.get("comment", args.id);
      if (!c) throw new MutationError("comment not found", "not_found");
      requireCommentIssue(ctx, c);
      const mine = ctx.actor.type === "agent" ? c.agentId === ctx.actorId : c.userId === ctx.actorId;
      if (!mine) throw new MutationError("only the author can edit a comment", "forbidden");
      ctx.store.patch("comment", args.id, {
        body: args.body,
        bodyData: args.bodyData ?? c.bodyData,
        editedAt: ctx.now,
        updatedAt: ctx.now,
      });
    },
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

  commentResolve: defineMutator({
    args: z.object({ id, resolved: z.boolean(), resolvingCommentId: nullable(id).optional() }),
    description: "Resolve or reopen a comment thread.",
    run(ctx, args) {
      const c = ctx.store.get("comment", args.id);
      if (!c) throw new MutationError("comment not found", "not_found");
      requireCommentIssue(ctx, c);
      if (c.parentId) throw new MutationError("only a thread's top comment can be resolved", "invalid");
      if (args.resolved && args.resolvingCommentId) {
        const rc = ctx.store.get("comment", args.resolvingCommentId);
        if (!rc || (rc.id !== c.id && rc.parentId !== c.id))
          throw new MutationError("resolving comment must be in the thread", "invalid");
      }
      ctx.store.patch("comment", args.id, {
        resolvedAt: args.resolved ? ctx.now : null,
        resolvingUserId: args.resolved ? ctx.actorId : null,
        resolvingCommentId: args.resolved ? (args.resolvingCommentId ?? null) : null,
        updatedAt: ctx.now,
      });
    },
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
