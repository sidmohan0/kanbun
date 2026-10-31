import { z } from "zod";
import {
  githubRepositorySourceSchema,
  githubPullRequestSnapshotSchema,
  type DomainEvent,
  type PendingEvent,
  type GitHubPullRequestSnapshot,
} from "@kanbun/events";
import type { Row } from "@kanbun/model";
import {
  defineEventMutator,
  issueIncarnation,
  MutationError,
  type DecideContext,
  type MutatorContext,
} from "@kanbun/sync";
import { requireIssue } from "./issues";
import { requireTeamAccess } from "./teams";
import { id } from "./schema";

function authority(ctx: DecideContext) {
  if (!ctx.githubAuthority || (ctx.branchId ?? "main") !== "main")
    throw new MutationError("Verified GitHub App authority required", "forbidden");
}
function owner(ctx: DecideContext) {
  if (ctx.actor.type !== "user" || ctx.store.get("user", ctx.actorId)?.role !== "owner")
    throw new MutationError("Workspace owner required", "forbidden");
}
function bindingForIssue(ctx: DecideContext, issueId: string, incarnation: string, bindingId: string) {
  const issue = requireIssue(ctx, issueId);
  const binding = ctx.store.get("githubRepository", bindingId);
  if (
    issue.archivedAt ||
    issue.trashed ||
    issueIncarnation(issue) !== incarnation ||
    !binding ||
    binding.archivedAt ||
    binding.teamId !== issue.teamId
  )
    throw new MutationError("Issue or repository connection is unavailable", "forbidden");
  return { issue, binding };
}
export function canonicalGitHubSnapshot(
  binding: Pick<Row<"githubRepository">, "owner" | "name" | "url">,
  input: GitHubPullRequestSnapshot,
): GitHubPullRequestSnapshot {
  const snapshot = githubPullRequestSnapshotSchema.parse(input);
  const expected = `https://github.com/${binding.owner}/${binding.name}`;
  if (binding.url !== expected || snapshot.url !== `${expected}/pull/${snapshot.number}`)
    throw new MutationError("Pull request does not match its repository connection", "invalid");
  if (snapshot.checksUrl) {
    const url = new URL(snapshot.checksUrl);
    if (
      url.origin !== "https://github.com" ||
      url.username ||
      url.password ||
      !url.pathname.startsWith(`/${binding.owner}/${binding.name}/`)
    )
      throw new MutationError("Checks link does not match its repository", "invalid");
  }
  return {
    ...snapshot,
    reviewStatus: snapshot.reviewHeadSha === snapshot.headSha ? snapshot.reviewStatus : "unknown",
    checksStatus: snapshot.checksHeadSha === snapshot.headSha ? snapshot.checksStatus : "unknown",
  };
}
export function applyGitHubEvent(ctx: MutatorContext, event: DomainEvent): void {
  const now = new Date(event.ts).toISOString();
  if (event.type === "GitHubRepositoryConfigured") {
    const fields = { ...event.payload, teamId: event.teamId, updatedAt: now };
    if (ctx.store.get("githubRepository", event.entityId)) ctx.store.patch("githubRepository", event.entityId, fields);
    else ctx.store.insert("githubRepository", { ...fields, id: event.entityId, createdAt: now, archivedAt: null });
  } else if (event.type === "GitHubRepositoryDisconnected") {
    for (const row of ctx.store.list("issuePullRequest", { repositoryBindingId: event.entityId }))
      ctx.store.delete("issuePullRequest", row.id);
    ctx.store.delete("githubRepository", event.entityId);
  } else if (event.type === "GitHubPullRequestLinked") {
    ctx.store.insert("issuePullRequest", {
      ...event.payload.snapshot,
      id: event.payload.id,
      issueId: event.entityId,
      issueIncarnation: event.payload.issueIncarnation,
      repositoryBindingId: event.payload.repositoryBindingId,
      teamId: event.teamId,
      observationRevision: event.payload.revision,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });
  } else if (event.type === "ObservedGitHubPullRequest") {
    ctx.store.patch("issuePullRequest", event.payload.id, {
      ...event.payload.snapshot,
      observationRevision: event.payload.revision,
      updatedAt: now,
    });
  } else if (event.type === "GitHubPullRequestUnlinked") ctx.store.delete("issuePullRequest", event.payload.id);
  else throw new MutationError("Not a GitHub integration event", "invalid");
}
const snapshotArgs = z.strictObject({
  id,
  issueId: id,
  issueIncarnation: id,
  repositoryBindingId: id,
  revision: z.number().int().positive().safe(),
  snapshot: githubPullRequestSnapshotSchema,
});
const subject = (issue: Row<"issue">) => ({
  entityType: "issue" as const,
  entityId: issue.id,
  teamId: issue.teamId,
  scopeUserId: null,
});

export const mutators = {
  githubRepositoryConfigure: defineEventMutator({
    args: z.strictObject({ id, teamId: id, source: githubRepositorySourceSchema }),
    description: "Connect a GitHub repository to one team's disclosure scope.",
    decide(ctx, args) {
      authority(ctx);
      owner(ctx);
      requireTeamAccess(ctx, args.teamId);
      if (args.source.url !== `https://github.com/${args.source.owner}/${args.source.name}`)
        throw new MutationError("Repository URL does not match GitHub source", "invalid");
      const existing = ctx.store.list("githubRepository", {
        teamId: args.teamId,
        repositoryId: args.source.repositoryId,
      })[0];
      const events: PendingEvent[] = [];
      if (existing && existing.id !== args.id)
        events.push({
          type: "GitHubRepositoryDisconnected",
          entityType: "githubRepository",
          entityId: existing.id,
          teamId: existing.teamId,
          scopeUserId: null,
          payload: {},
        });
      events.push({
        type: "GitHubRepositoryConfigured",
        entityType: "githubRepository",
        entityId: args.id,
        teamId: args.teamId,
        scopeUserId: null,
        payload: args.source,
      });
      return events;
    },
    apply: applyGitHubEvent,
  }),
  githubRepositoryDisconnect: defineEventMutator({
    args: z.strictObject({ id }),
    description: "Disconnect a repository binding and withdraw its projected metadata.",
    decide(ctx, args) {
      authority(ctx);
      const binding = ctx.store.get("githubRepository", args.id);
      if (!binding) return [];
      if (ctx.actor.type !== "integration") {
        owner(ctx);
        requireTeamAccess(ctx, binding.teamId);
      }
      return [
        {
          type: "GitHubRepositoryDisconnected",
          entityType: "githubRepository",
          entityId: binding.id,
          teamId: binding.teamId,
          scopeUserId: null,
          payload: {},
        },
      ];
    },
    apply: applyGitHubEvent,
  }),
  githubPullRequestLink: defineEventMutator({
    args: snapshotArgs,
    description: "Link an authenticated GitHub pull request to an accessible issue.",
    decide(ctx, args) {
      authority(ctx);
      if (ctx.actor.type !== "user") throw new MutationError("A person must link a pull request", "forbidden");
      const { issue, binding } = bindingForIssue(ctx, args.issueId, args.issueIncarnation, args.repositoryBindingId);
      const existing = ctx.store.list("issuePullRequest", {
        issueId: issue.id,
        repositoryBindingId: binding.id,
        number: args.snapshot.number,
      })[0];
      const snapshot = canonicalGitHubSnapshot(binding, args.snapshot);
      const payload = {
        id: existing?.id ?? args.id,
        repositoryBindingId: binding.id,
        issueIncarnation: args.issueIncarnation,
        revision: args.revision,
        snapshot,
      };
      if (existing && args.revision <= existing.observationRevision) return [];
      return [
        ...(!existing ? [{ ...subject(issue), type: "GitHubPullRequestLinked" as const, payload }] : []),
        { ...subject(issue), type: "ObservedGitHubPullRequest" as const, payload },
      ];
    },
    apply: applyGitHubEvent,
  }),
  githubPullRequestObserve: defineEventMutator({
    args: snapshotArgs,
    description: "Record a canonical GitHub observation without overriding a human issue status.",
    decide(ctx, args) {
      authority(ctx);
      if (ctx.actor.type !== "integration") throw new MutationError("GitHub observer required", "forbidden");
      const row = ctx.store.get("issuePullRequest", args.id);
      const issue = ctx.store.get("issue", args.issueId);
      const binding = ctx.store.get("githubRepository", args.repositoryBindingId);
      if (
        !row ||
        !issue ||
        !binding ||
        binding.archivedAt ||
        row.repositoryBindingId !== binding.id ||
        row.issueId !== issue.id ||
        row.issueIncarnation !== args.issueIncarnation ||
        issueIncarnation(issue) !== args.issueIncarnation ||
        binding.teamId !== issue.teamId ||
        args.revision <= row.observationRevision
      )
        return [];
      const snapshot = canonicalGitHubSnapshot(binding, args.snapshot);
      if (snapshot.number !== row.number)
        throw new MutationError("Observation belongs to a different pull request", "invalid");
      return [
        {
          ...subject(issue),
          type: "ObservedGitHubPullRequest",
          payload: {
            id: row.id,
            repositoryBindingId: binding.id,
            issueIncarnation: row.issueIncarnation,
            revision: args.revision,
            snapshot,
          },
        },
      ];
    },
    apply: applyGitHubEvent,
  }),
  issuePullRequestUnlink: defineEventMutator({
    args: z.strictObject({ id }),
    description: "Stop following a pull request on an issue.",
    decide(ctx, args) {
      if ((ctx.branchId ?? "main") !== "main" || ctx.actor.type !== "user")
        throw new MutationError("Only people may unlink pull requests on main", "forbidden");
      const row = ctx.store.get("issuePullRequest", args.id);
      if (!row) return [];
      const { issue } = bindingForIssue(ctx, row.issueId, row.issueIncarnation, row.repositoryBindingId);
      return [
        {
          ...subject(issue),
          type: "GitHubPullRequestUnlinked",
          payload: { id: row.id, repositoryBindingId: row.repositoryBindingId, issueIncarnation: row.issueIncarnation },
        },
      ];
    },
    apply: applyGitHubEvent,
  }),
};
