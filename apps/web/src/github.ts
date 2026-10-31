import {
  githubRepositorySourceSchema,
  type GitHubRepositorySource,
  type GitHubPullRequestSnapshot,
  type DomainEvent,
} from "@kanbun/events";
import type { Row } from "@kanbun/model";
import { issueIncarnation } from "@kanbun/sync";

export type GitHubBinding = GitHubRepositorySource & Pick<Row<"githubRepository">, "id" | "teamId">;
export type GitHubConnection = {
  configured: boolean;
  appName: string | null;
  repositories: GitHubBinding[];
  catalog: GitHubRepositorySource[];
  authorizationRequired: boolean;
  installUrl?: string | null;
  error?: string | null;
};
export function githubConnection(value: unknown): GitHubConnection {
  if (value === null || typeof value !== "object") throw new Error("GitHub connection could not be read.");
  const input = value as Record<string, unknown>;
  if (
    typeof input.configured !== "boolean" ||
    (input.appName !== null && typeof input.appName !== "string") ||
    typeof input.authorizationRequired !== "boolean" ||
    !Array.isArray(input.repositories) ||
    (input.installUrl !== undefined && input.installUrl !== null && typeof input.installUrl !== "string") ||
    (input.error !== undefined && input.error !== null && typeof input.error !== "string")
  )
    throw new Error("GitHub connection could not be read.");
  const catalog = githubRepositorySourceSchema.array().safeParse(input.catalog);
  if (!catalog.success) throw new Error("GitHub repositories could not be read.");
  const repositories = input.repositories.map((value: unknown) => {
    const parsed = githubRepositorySourceSchema.strip().safeParse(value);
    if (
      !parsed.success ||
      value === null ||
      typeof value !== "object" ||
      !("id" in value) ||
      typeof value.id !== "string" ||
      !("teamId" in value) ||
      typeof value.teamId !== "string"
    )
      throw new Error("GitHub repository mappings could not be read.");
    return { ...parsed.data, id: value.id, teamId: value.teamId };
  });
  return {
    configured: input.configured,
    appName: input.appName,
    authorizationRequired: input.authorizationRequired,
    repositories,
    catalog: catalog.data,
    installUrl: typeof input.installUrl === "string" ? input.installUrl : null,
    error: typeof input.error === "string" ? input.error : null,
  };
}
export function githubUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" && !url.username && !url.password && !url.port
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function githubAuthorizationUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const safe = githubUrl(value);
  return safe && new URL(safe).pathname === "/login/oauth/authorize" ? safe : null;
}
export function githubInstallationUrl(value: string | null | undefined): string | null {
  const safe = githubUrl(value);
  return safe && /^\/apps\/[A-Za-z0-9-]+\/installations\/new$/u.test(new URL(safe).pathname) ? safe : null;
}
export function pullRequestLocation(
  value: string,
): { owner: string; name: string; number: number; url: string } | null {
  const safe = githubUrl(value.trim());
  if (!safe) return null;
  const match = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)\/?$/u.exec(new URL(safe).pathname);
  if (!match || !Number.isSafeInteger(Number(match[3]))) return null;
  return {
    owner: match[1]!,
    name: match[2]!,
    number: Number(match[3]),
    url: `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`,
  };
}
export function checksStatus(
  pr: Pick<GitHubPullRequestSnapshot, "headSha" | "checksHeadSha" | "checksStatus">,
): GitHubPullRequestSnapshot["checksStatus"] {
  return pr.checksHeadSha === pr.headSha ? pr.checksStatus : "unknown";
}
export function reviewStatus(
  pr: Pick<GitHubPullRequestSnapshot, "headSha" | "reviewHeadSha" | "reviewStatus">,
): GitHubPullRequestSnapshot["reviewStatus"] {
  return pr.reviewHeadSha === pr.headSha ? pr.reviewStatus : "unknown";
}
export const checksLabel = {
  unknown: "Checks unknown",
  pending: "Checks pending",
  passing: "Checks passing",
  failing: "Checks failing",
};
export const reviewLabel = {
  unknown: "Review unknown",
  pending: "No current-commit review",
  approved: "Approval recorded",
  changes_requested: "Changes requested",
};
export function groupPullRequests(rows: readonly Row<"issuePullRequest">[]) {
  const grouped = new Map<string, Row<"issuePullRequest">[]>();
  for (const row of [...rows].sort(
    (left, right) => right.observedAt.localeCompare(left.observedAt) || left.id.localeCompare(right.id),
  )) {
    const current = grouped.get(row.issueId) ?? [];
    current.push(row);
    grouped.set(row.issueId, current);
  }
  return grouped;
}
export function githubActivityVisible(
  event: DomainEvent,
  issue: Row<"issue">,
  repositories: readonly Row<"githubRepository">[],
): boolean {
  if (
    event.type !== "GitHubPullRequestLinked" &&
    event.type !== "GitHubPullRequestUnlinked" &&
    event.type !== "ObservedGitHubPullRequest"
  )
    return true;
  return (
    event.entityId === issue.id &&
    event.payload.issueIncarnation === issueIncarnation(issue) &&
    repositories.some(
      (binding) =>
        binding.id === event.payload.repositoryBindingId && binding.teamId === issue.teamId && !binding.archivedAt,
    )
  );
}
