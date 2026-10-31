import { z } from "zod";
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
