import { z } from "zod";

export const githubRepositorySourceSchema = z.strictObject({
  installationId: z.number().int().positive().safe(),
  repositoryId: z.number().int().positive().safe(),
  owner: z.string().min(1),
  name: z.string().min(1),
  url: z.url(),
  private: z.boolean(),
});
export type GitHubRepositorySource = z.infer<typeof githubRepositorySourceSchema>;
export const githubPullRequestSnapshotSchema = z.strictObject({
  number: z.number().int().positive().safe(),
  title: z.string().min(1),
  url: z.url(),
  state: z.enum(["draft", "open", "closed", "merged"]),
  headRef: z.string().min(1),
  baseRef: z.string().min(1),
  headSha: z.string().min(1),
  reviewStatus: z.enum(["unknown", "pending", "approved", "changes_requested"]),
  reviewHeadSha: z.string().min(1).nullable(),
  checksStatus: z.enum(["unknown", "pending", "passing", "failing"]),
  checksHeadSha: z.string().min(1).nullable(),
  checksUrl: z.url().nullable(),
  providerUpdatedAt: z.iso.datetime({ offset: true }),
  observedAt: z.iso.datetime({ offset: true }),
});
export type GitHubPullRequestSnapshot = z.infer<typeof githubPullRequestSnapshotSchema>;
const delivery = { deliveryId: z.string().min(1), installationId: z.number().int().positive().safe() };
export const githubWebhookDeliverySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...delivery,
    kind: z.literal("pull_request"),
    repositoryId: z.number().int().positive().safe(),
    number: z.number().int().positive().safe(),
  }),
  z.strictObject({
    ...delivery,
    kind: z.literal("checks"),
    repositoryId: z.number().int().positive().safe(),
    headSha: z.string().min(1),
  }),
  z.strictObject({
    ...delivery,
    kind: z.literal("revoke"),
    repositoryIds: z.array(z.number().int().positive().safe()).optional(),
  }),
]);
export type GitHubWebhookDelivery = z.infer<typeof githubWebhookDeliverySchema>;
