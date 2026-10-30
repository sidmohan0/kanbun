/** A recreated issue UUID owns a distinct body, even within the same workspace. */
export function documentName(workspaceId: string, issueId: string, incarnation: string) {
  return JSON.stringify([workspaceId, issueId, incarnation]);
}
