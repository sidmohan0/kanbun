/**
 * Every write in kanbun. Each mutator declares its args as a Zod schema and
 * runs on the client (optimistic) and in the workspace DO (authoritative);
 * see @kanbun/sync for the contract. The same schemas become the agent tool
 * catalogue via `tools()`.
 */
import { defineMutators, toolDefinitions } from "@kanbun/sync";
import * as github from "./github";
import * as comments from "./comments";
import * as issues from "./issues";
import * as teams from "./teams";
import * as views from "./views";
import * as workspace from "./workspace";
import * as notifications from "./notifications";

export const mutators = defineMutators({
  ...github.mutators,
  ...workspace.mutators,
  ...teams.mutators,
  ...issues.mutators,
  ...comments.mutators,
  ...views.mutators,
  ...notifications.mutators,
});

export type Mutators = typeof mutators;

/** Mutators that only the system actor may call; never exposed as agent tools. */
export const SYSTEM_ONLY = [
  "workspaceInit",
  "memberSync",
  "issueDescribe",
  "workspaceNameSync",
  "githubRepositoryConfigure",
  "githubRepositoryDisconnect",
  "githubPullRequestLink",
  "githubPullRequestObserve",
] as const;

/** Agent tool definitions (JSON schema), optionally restricted to an allow-list. */
export function tools(only?: string[]) {
  return toolDefinitions(mutators, only).filter((t) => !(SYSTEM_ONLY as readonly string[]).includes(t.name));
}

export { issueIdentifier, requireIssue } from "./issues";
export { branchName, gitBranchFormatSchema, DEFAULT_GIT_BRANCH_FORMAT, validGitBranchName } from "./branch-names";
export { DEFAULT_STATES } from "./teams";
export * from "./ordering";

export { applyIssueEvent } from "./issueEvents";
export { applyCommentEvent } from "./commentEvents";

export { applyGitHubEvent, canonicalGitHubSnapshot } from "./github";
