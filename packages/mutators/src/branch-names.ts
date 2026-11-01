import { z } from "zod";

export const DEFAULT_GIT_BRANCH_FORMAT = "{username}/{issueIdentifier}-{issueTitle}";
const tokens = /\{(username|issueIdentifier|issueTitle)\}/g;

/** The branch form of git-check-ref-format, without invoking a shell. */
export function validGitBranchName(value: string): boolean {
  return (
    !!value &&
    value !== "@" &&
    value !== "HEAD" &&
    !value.startsWith("-") &&
    !value.endsWith(".") &&
    ![...value].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127) &&
    !["~", "^", ":", "?", "*", "[", "\\"].some((character) => value.includes(character)) &&
    !value.includes("..") &&
    !value.includes("@{") &&
    value.split("/").every((part) => !!part && !part.startsWith(".") && !part.endsWith(".lock"))
  );
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Names are derived from the latest team key, title and caller; never stored on issues. */
export function branchName(format: string, username: string, identifier: string, title: string): string {
  if (!identifier) return ""; // The DO has not assigned an optimistic issue's number yet.
  const values = {
    username: slug(username) || "member",
    issueIdentifier: identifier.toLowerCase(),
    issueTitle: slug(title).slice(0, 50).replace(/-+$/g, "") || "issue",
  };
  const result = format.replace(tokens, (_, token: keyof typeof values) => values[token]);
  return validGitBranchName(result) ? result : "";
}

export const gitBranchFormatSchema = z
  .string()
  .refine(
    (format) =>
      format.includes("{issueIdentifier}") &&
      /^[A-Za-z0-9_/-]*$/u.test(format.replace(tokens, "")) &&
      !!branchName(format, "member", "KAN-123", "Issue title"),
    "Use {issueIdentifier}, optional {username} and {issueTitle}, and letters, numbers, hyphens, underscores or slashes. The result must be a valid git branch name.",
  );
