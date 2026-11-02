import { z } from "zod";
import type { DomainEvent } from "@kanbun/events";
import type { Row } from "@kanbun/model";
import {
  defineEventMutator,
  issueIncarnation,
  MutationError,
  type DecideContext,
  type MutatorContext,
} from "@kanbun/sync";
import { requireIssue } from "./issues";
import { id } from "./schema";

/** A user-entered link only: never fetch or import content from the destination. */
export function canonicalSlackMessageUrl(input: string): string {
  try {
    const url = new URL(input);
    const route = /^\/archives\/([CGD][A-Z0-9]+)\/p\d{16}$/.exec(url.pathname);
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      url.hash ||
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.slack\.com$/.test(url.hostname) ||
      !route
    )
      throw new Error();
    for (const name of url.searchParams.keys())
      if (!["thread_ts", "cid"].includes(name) || url.searchParams.getAll(name).length !== 1) throw new Error();
    const thread = url.searchParams.get("thread_ts");
    const channel = url.searchParams.get("cid");
    if ((thread !== null && !/^\d+\.\d{6}$/.test(thread)) || (channel !== null && channel !== route[1]))
      throw new Error();
    url.search = thread ? new URLSearchParams({ thread_ts: thread }).toString() : "";
    return url.href;
  } catch {
    throw new MutationError("Enter a Slack message link copied from a workspace", "invalid");
  }
}

function subject(ctx: DecideContext, issueId: string, incarnation: string) {
  const user = ctx.actor.type === "user" && ctx.store.get("user", ctx.actorId);
  if (!user || !user.active || user.archivedAt || (ctx.branchId ?? "main") !== "main")
    throw new MutationError("Slack message links require an active member on main", "forbidden");
  const issue = requireIssue(ctx, issueId);
  if (issue.trashed || issue.archivedAt || issueIncarnation(issue) !== incarnation)
    throw new MutationError("This issue is unavailable or was replaced", "conflict");
  return { entityType: "issue" as const, entityId: issue.id, teamId: issue.teamId, scopeUserId: null };
}

/** Apply recorded attachment facts without provider calls, permission checks or generated IDs. */
export function applyAttachmentEvent(ctx: MutatorContext, event: DomainEvent): void {
  if (event.type !== "SlackMessageAttached" && event.type !== "SlackMessageDetached")
    throw new MutationError("Not an attachment event", "invalid");
  const issue = ctx.store.get("issue", event.entityId);
  if (
    (ctx.branchId ?? "main") !== event.branchId ||
    event.branchId !== "main" ||
    !issue ||
    issue.teamId !== event.teamId ||
    issueIncarnation(issue) !== event.payload.issueIncarnation
  )
    throw new MutationError("Attachment issue does not match recorded scope", "invalid");
  if (event.type === "SlackMessageAttached") {
    const now = new Date(event.ts).toISOString();
    ctx.store.insert("attachment", {
      id: event.payload.id,
      issueId: issue.id,
      teamId: issue.teamId,
      creatorId: event.payload.creatorId,
      title: event.payload.title,
      url: event.payload.url,
      subtitle: "Slack message · not synced",
      sourceType: "slack",
      metadata: { issueIncarnation: event.payload.issueIncarnation },
      groupBySource: false,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    } as Row<"attachment">);
  } else {
    const row = ctx.store.get("attachment", event.payload.id);
    if (row && (row.issueId !== issue.id || row.teamId !== issue.teamId || row.sourceType !== "slack"))
      throw new MutationError("Recorded attachment does not belong to this issue", "invalid");
    ctx.store.delete("attachment", event.payload.id);
  }
}

export const mutators = {
  issueSlackMessageAttach: defineEventMutator({
    args: z.strictObject({
      id,
      issueId: id,
      issueIncarnation: z.string().min(1),
      url: z.string().max(2048),
      title: z.string().trim().min(1).max(500),
    }),
    description: "Attach a Slack message URL to an issue without importing or syncing its thread.",
    decide(ctx, args) {
      const scope = subject(ctx, args.issueId, args.issueIncarnation);
      const url = canonicalSlackMessageUrl(args.url);
      const key = url.split("?")[0];
      if (
        ctx.store
          .list("attachment", { issueId: args.issueId })
          .some((row) => !row.archivedAt && row.sourceType === "slack" && row.url.split("?")[0] === key)
      )
        return [];
      if (ctx.store.get("attachment", args.id)) throw new MutationError("Attachment ID already exists", "conflict");
      return [
        {
          ...scope,
          type: "SlackMessageAttached",
          payload: {
            id: args.id,
            issueIncarnation: args.issueIncarnation,
            url,
            title: args.title,
            creatorId: ctx.actorId,
          },
        },
      ];
    },
    apply: applyAttachmentEvent,
  }),
  issueSlackMessageDetach: defineEventMutator({
    args: z.strictObject({ id, issueId: id, issueIncarnation: z.string().min(1) }),
    description: "Remove a Slack message link from an issue; the original Slack message is unchanged.",
    decide(ctx, args) {
      const scope = subject(ctx, args.issueId, args.issueIncarnation);
      const row = ctx.store.get("attachment", args.id);
      if (!row) return [];
      if (row.issueId !== args.issueId || row.teamId !== scope.teamId || row.sourceType !== "slack")
        throw new MutationError("Attachment does not belong to this issue", "forbidden");
      return [
        { ...scope, type: "SlackMessageDetached", payload: { id: args.id, issueIncarnation: args.issueIncarnation } },
      ];
    },
    apply: applyAttachmentEvent,
  }),
};
