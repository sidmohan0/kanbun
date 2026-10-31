import { z } from "zod";
import { MutationError } from "@kanbun/sync";
import { RequestError } from "./requests";
import { githubRepositorySourceSchema, githubPullRequestSnapshotSchema } from "@kanbun/events";
export const githubIssueLookupSchema = z.strictObject({
  issueId: z.string().min(1),
  issueIncarnation: z.string().min(1),
  repositoryBindingId: z.string().min(1),
});
export const githubLinkSchema = githubIssueLookupSchema.extend({
  snapshot: githubPullRequestSnapshotSchema,
  revision: z.number().int().positive().safe(),
  expectedLinkId: z.string().min(1).optional(),
});
export const githubRepositoryConfigureSchema = z.strictObject({
  teamId: z.string().min(1),
  source: githubRepositorySourceSchema,
});

/** Plain data survives the Worker/DO boundary; Error subclasses do not. */
export type GitHubRpcResult<T> =
  { ok: true; value: T } | { ok: false; error: { status: number; message: string; code?: string; errorId?: string } };

export async function githubRpc<T>(operation: () => Promise<T>): Promise<GitHubRpcResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    if (error instanceof RequestError) return { ok: false, error: { status: error.status, message: error.message } };
    if (error instanceof MutationError) {
      const status =
        error.code === "forbidden" ? 403 : error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : 400;
      return { ok: false, error: { status, message: error.message, code: error.code } };
    }
    if (error instanceof z.ZodError) return { ok: false, error: { status: 400, message: "Invalid request" } };
    const errorId = crypto.randomUUID();
    // Never serialize the exception: it may contain SQL, credentials or provider responses.
    console.error({ event: "kanbun.github.rpc.failed", category: "internal", errorId });
    return { ok: false, error: { status: 500, message: "Internal workspace error", errorId } };
  }
}

export class GitHubRpcError extends RequestError {
  readonly code: string | undefined;
  readonly errorId: string | undefined;
  constructor(error: { status: number; message: string; code?: string; errorId?: string }) {
    super(error.message, error.status);
    this.code = error.code;
    this.errorId = error.errorId;
  }
}
export async function githubRpcValue<T>(result: Promise<GitHubRpcResult<T>>): Promise<T> {
  const settled = await result;
  if (!settled.ok) throw new GitHubRpcError(settled.error);
  return settled.value;
}
