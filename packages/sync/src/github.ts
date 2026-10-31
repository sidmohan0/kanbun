import type { Row } from "@kanbun/model";
import type { Store } from "./store";
import { issueIncarnation } from "./context";

type View = Pick<Store, "get" | "list">;
export function githubRepositoryVisible(view: View, teams: string[], row: Row<"githubRepository">): boolean {
  const team = view.get("team", row.teamId);
  return !row.archivedAt && !!team && !team.archivedAt && !team.retiredAt && teams.includes(row.teamId);
}
export function issuePullRequestVisible(view: View, teams: string[], row: Row<"issuePullRequest">): boolean {
  const issue = view.get("issue", row.issueId);
  const binding = view.get("githubRepository", row.repositoryBindingId);
  return (
    !row.archivedAt &&
    !!issue &&
    !issue.archivedAt &&
    !issue.trashed &&
    !!binding &&
    issueIncarnation(issue) === row.issueIncarnation &&
    issue.teamId === row.teamId &&
    binding.teamId === issue.teamId &&
    githubRepositoryVisible(view, teams, binding)
  );
}
/** Retired bindings and issue generations cannot disclose old external-provider metadata. */
export function githubEvidenceVisible(
  view: View,
  teams: string[],
  event: { entityType: string; entityId: string; payload: unknown },
): boolean {
  const payload = event.payload as Record<string, unknown>;
  if (event.entityType === "githubRepository") {
    const binding = view.get("githubRepository", event.entityId);
    return !!binding && githubRepositoryVisible(view, teams, binding);
  }
  if (typeof payload["repositoryBindingId"] !== "string") return true;
  const issue = view.get("issue", event.entityId);
  const binding = view.get("githubRepository", payload["repositoryBindingId"]);
  return (
    !!issue &&
    !issue.archivedAt &&
    !issue.trashed &&
    !!binding &&
    binding.teamId === issue.teamId &&
    issueIncarnation(issue) === payload["issueIncarnation"] &&
    githubRepositoryVisible(view, teams, binding)
  );
}
