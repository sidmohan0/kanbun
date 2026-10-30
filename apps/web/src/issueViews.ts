import type { Row } from "@kanbun/model";

export type IssueView = "all" | "mine";
export type IssueOrder = "manual" | "priority" | "newest" | "updated" | "title";
export type IssueFilters = {
  search: string;
  stateId: string;
  assigneeId: string;
  priority: string;
  labelId: string;
  order: IssueOrder;
};
export const emptyIssueFilters = (): IssueFilters => ({
  search: "",
  stateId: "",
  assigneeId: "",
  priority: "",
  labelId: "",
  order: "manual",
});
const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
export function issueIdentifier(issue: Row<"issue">, teams: readonly Row<"team">[]): string {
  return issue.number === 0
    ? "Pending issue"
    : `${teams.find((team) => team.id === issue.teamId)?.key ?? "ISSUE"}-${issue.number}`;
}

/** Search only rows already admitted by workspace synchronization; filters never widen visibility. */
export function visibleIssues({
  issues,
  teams,
  labelLinks,
  actorId,
  view,
  filters,
}: {
  issues: readonly Row<"issue">[];
  teams: readonly Row<"team">[];
  labelLinks: readonly Row<"issueLabelLink">[];
  actorId: string | null;
  view: IssueView;
  filters: IssueFilters;
}): Row<"issue">[] {
  const terms = filters.search.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  const labelled = filters.labelId
    ? new Set(
        labelLinks.filter((link) => link.labelId === filters.labelId && !link.archivedAt).map((link) => link.issueId),
      )
    : null;
  const teamKeys = new Map(teams.map((team) => [team.id, team.key]));
  const rows = issues.filter((issue) => {
    if (issue.trashed || issue.archivedAt) return false;
    if (view === "mine" && (!actorId || issue.assigneeId !== actorId)) return false;
    if (filters.stateId && issue.stateId !== filters.stateId) return false;
    if (
      view !== "mine" &&
      filters.assigneeId &&
      (filters.assigneeId === "unassigned" ? issue.assigneeId !== null : issue.assigneeId !== filters.assigneeId)
    )
      return false;
    if (filters.priority && issue.priority !== Number(filters.priority)) return false;
    if (labelled && !labelled.has(issue.id)) return false;
    if (!terms.length) return true;
    const identifier =
      issue.number === 0 ? "pending issue" : `${teamKeys.get(issue.teamId) ?? "ISSUE"}-${issue.number}`;
    const searchable = `${identifier}\n${issue.title}\n${issue.description ?? ""}`.toLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
  const tie = (left: Row<"issue">, right: Row<"issue">) =>
    compare(left.sortOrder, right.sortOrder) || compare(left.id, right.id);
  switch (filters.order) {
    case "priority":
      return rows.sort((left, right) => (left.priority || 5) - (right.priority || 5) || tie(left, right));
    case "newest":
      return rows.sort((left, right) => compare(right.createdAt, left.createdAt) || tie(left, right));
    case "updated":
      return rows.sort((left, right) => compare(right.updatedAt, left.updatedAt) || tie(left, right));
    case "title":
      return rows.sort((left, right) => left.title.localeCompare(right.title) || tie(left, right));
    default:
      return rows.sort(tie);
  }
}
