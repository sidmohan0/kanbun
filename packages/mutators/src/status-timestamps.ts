import type { Row } from "@kanbun/model";

/** Terminal timestamps describe category entry, not a change of state within that category. */
export function terminalTimestamps(
  issue: Pick<Row<"issue">, "completedAt" | "canceledAt">,
  previous: Row<"workflowState">["type"] | undefined,
  next: Row<"workflowState">["type"] | undefined,
  now: string,
): Pick<Row<"issue">, "completedAt" | "canceledAt"> {
  if (previous === next) return { completedAt: issue.completedAt, canceledAt: issue.canceledAt };
  return { completedAt: next === "completed" ? now : null, canceledAt: next === "canceled" ? now : null };
}
