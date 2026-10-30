import type { Row } from "@kanbun/model";
import { issueIncarnation } from "./context";
import type { ReadableStore } from "./store";

/** Recipient scope is conjunctive with the current issue and membership generation. */
export function notificationVisible(
  store: Pick<ReadableStore, "get">,
  userId: string,
  teams: string[],
  row: Row<"notification">,
): boolean {
  const user = store.get("user", userId);
  if (
    !user?.active ||
    user.archivedAt ||
    row.archivedAt ||
    row.userId !== userId ||
    row.recipientAdmissionId !== user.directoryAdmissionId
  )
    return false;
  if (row.teamId !== null && !teams.includes(row.teamId)) return false;
  if (row.issueId === null) return row.sourceEventSeq === 0;
  const issue = store.get("issue", row.issueId);
  return (
    !!issue &&
    !issue.trashed &&
    !issue.archivedAt &&
    teams.includes(issue.teamId) &&
    row.teamId === issue.teamId &&
    row.issueIncarnation === issueIncarnation(issue) &&
    row.sourceEventSeq > user.notificationEventFloor
  );
}

export function notificationSubscriptionVisible(
  store: Pick<ReadableStore, "get">,
  userId: string,
  teams: string[],
  row: Row<"notificationSubscription">,
): boolean {
  const user = store.get("user", userId);
  if (!user?.active || user.archivedAt) return false;
  if (row.subscriberId !== userId || row.archivedAt || (row.teamId !== null && !teams.includes(row.teamId)))
    return false;
  if (row.scope.kind === "team") return teams.includes(row.scope.teamId);
  if (row.scope.kind === "issue") {
    const issue = store.get("issue", row.scope.issueId);
    return !!issue && teams.includes(issue.teamId);
  }
  return true;
}
