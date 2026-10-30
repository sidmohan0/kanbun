/**
 * Every write in kanbun. Each mutator declares its args as a Zod schema and
 * runs on the client (optimistic) and in the workspace DO (authoritative);
 * see @kanbun/sync for the contract. The same schemas become the agent tool
 * catalogue via `tools()`.
 */
import { defineMutators, toolDefinitions } from "@kanbun/sync";
import * as comments from "./comments";
import * as issues from "./issues";
import * as teams from "./teams";
import * as views from "./views";
import * as workspace from "./workspace";

export const mutators = defineMutators({
  ...workspace.mutators,
  ...teams.mutators,
  ...issues.mutators,
  ...comments.mutators,
  ...views.mutators,
});

export type Mutators = typeof mutators;

/** Mutators that only the system actor may call; never exposed as agent tools. */
export const SYSTEM_ONLY = ["workspaceInit", "memberSync", "issueDescribe"] as const;

/** Agent tool definitions (JSON schema), optionally restricted to an allow-list. */
export function tools(only?: string[]) {
  return toolDefinitions(mutators, only).filter((t) => !(SYSTEM_ONLY as readonly string[]).includes(t.name));
}

export { issueIdentifier, branchName, requireIssue } from "./issues";
export { DEFAULT_STATES } from "./teams";
export * from "./ordering";

export { applyIssueEvent } from "./issueEvents";
