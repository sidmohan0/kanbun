import { uuidv7, type Row } from "@kanbun/model";
import {
  githubWebhookDeliverySchema,
  type GitHubWebhookDelivery,
  type GitHubPullRequestSnapshot,
  type GitHubRepositorySource,
} from "@kanbun/events";
import { issueIncarnation } from "@kanbun/sync";
import type { SyncServer, SqlDriver } from "@kanbun/sync/server";
import { z } from "zod";

export const GITHUB_JOB = "github-observation";
const targetSchema = z.strictObject({
  bindingId: z.string(),
  number: z.number().int().positive().safe(),
  linkIds: z.array(z.string()),
});
const jobSchema = z.strictObject({
  deliveryKey: z.string(),
  targets: z.array(targetSchema),
  completed: z.array(z.string()),
});
export function githubSource(binding: Row<"githubRepository">): GitHubRepositorySource {
  return {
    installationId: binding.installationId,
    repositoryId: binding.repositoryId,
    owner: binding.owner,
    name: binding.name,
    url: binding.url,
    private: binding.private,
  };
}
export function reserveGitHubRevision(driver: SqlDriver): number {
  const row = driver.all(
    "INSERT INTO github_observation_cursor (id,last_revision) VALUES ('github',1) ON CONFLICT(id) DO UPDATE SET last_revision = last_revision + 1 RETURNING last_revision",
  )[0];
  const revision = Number(row?.["last_revision"]);
  if (!Number.isSafeInteger(revision) || revision <= 0)
    throw new Error("GitHub observation revision cannot be represented safely");
  return revision;
}
export function requireReservedGitHubRevision(driver: SqlDriver, revision: number) {
  const current = Number(
    driver.all("SELECT last_revision FROM github_observation_cursor WHERE id = 'github'")[0]?.["last_revision"] ?? 0,
  );
  if (!Number.isSafeInteger(revision) || revision <= 0 || revision > current)
    throw new Error("GitHub observation has no reserved revision");
}
/** A delivery owns only bindings and associations that existed when it was admitted. */
export function queueGitHubDelivery(
  driver: SqlDriver,
  server: SyncServer,
  input: GitHubWebhookDelivery,
): { queued: boolean } {
  const delivery = githubWebhookDeliverySchema.parse(input);
  return driver.transaction(() => {
    const key = `${delivery.installationId}:${delivery.deliveryId}`;
    if (driver.all("SELECT id FROM github_delivery WHERE id = ?", [key]).length) return { queued: false };
    const bindings = server.store
      .list("githubRepository", { installationId: delivery.installationId })
      .filter(
        (row) =>
          !row.archivedAt &&
          (delivery.kind === "revoke"
            ? !delivery.repositoryIds || delivery.repositoryIds.includes(row.repositoryId)
            : row.repositoryId === delivery.repositoryId),
      );
    if (!bindings.length) return { queued: false };
    const now = new Date().toISOString();
    driver.run("INSERT INTO github_delivery (id,created_at,completed_at) VALUES (?,?,?)", [
      key,
      now,
      delivery.kind === "revoke" ? now : null,
    ]);
    if (delivery.kind === "revoke") {
      for (const binding of bindings)
        server.github(
          "githubRepositoryDisconnect",
          { id: binding.id },
          { id: `github:${binding.id}`, type: "integration" },
        );
      return { queued: true };
    }
    const targets: z.infer<typeof targetSchema>[] = [];
    for (const binding of bindings) {
      const links = server.store
        .list("issuePullRequest", { repositoryBindingId: binding.id })
        .filter((row) =>
          delivery.kind === "pull_request" ? row.number === delivery.number : row.headSha === delivery.headSha,
        );
      for (const number of new Set(links.map((row) => row.number)))
        targets.push({
          bindingId: binding.id,
          number,
          linkIds: links.filter((row) => row.number === number).map((row) => row.id),
        });
    }
    if (!targets.length) {
      driver.run("UPDATE github_delivery SET completed_at = ? WHERE id = ?", [now, key]);
      return { queued: true };
    }
    driver.run("INSERT INTO scheduled_job (id,fire_at,kind,payload,dedup_key,created_at) VALUES (?,?,?,?,?,?)", [
      uuidv7(),
      now,
      GITHUB_JOB,
      JSON.stringify({ deliveryKey: key, targets, completed: [] }),
      `github:${key}`,
      now,
    ]);
    return { queued: true };
  });
}
/** Each successful target and its checkpoint commit together; platform alarm retries keep failures durable. */
export async function consumeGitHubJob(
  driver: SqlDriver,
  server: SyncServer,
  job: Record<string, unknown>,
  fetchSnapshot: (source: GitHubRepositorySource, number: number) => Promise<GitHubPullRequestSnapshot>,
): Promise<void> {
  const payload = jobSchema.parse(JSON.parse(String(job["payload"])));
  for (const target of payload.targets) {
    const key = `${target.bindingId}:${target.number}`;
    if (payload.completed.includes(key)) continue;
    const binding = server.store.get("githubRepository", target.bindingId);
    const links = target.linkIds.flatMap((id) => {
      const row = server.store.get("issuePullRequest", id);
      const issue = row ? server.store.get("issue", row.issueId) : null;
      return row &&
        issue &&
        binding &&
        !binding.archivedAt &&
        row.repositoryBindingId === binding.id &&
        row.number === target.number &&
        binding.teamId === issue.teamId &&
        issueIncarnation(issue) === row.issueIncarnation
        ? [row]
        : [];
    });
    const revision = binding && links.length ? driver.transaction(() => reserveGitHubRevision(driver)) : null;
    const snapshot = binding && revision ? await fetchSnapshot(githubSource(binding), target.number) : null;
    driver.transaction(() => {
      if (snapshot && revision)
        for (const row of links)
          server.github(
            "githubPullRequestObserve",
            {
              id: row.id,
              issueId: row.issueId,
              issueIncarnation: row.issueIncarnation,
              repositoryBindingId: row.repositoryBindingId,
              revision,
              snapshot,
            },
            { id: `github:${row.repositoryBindingId}`, type: "integration" },
            snapshot.url,
          );
      payload.completed.push(key);
      driver.run("UPDATE scheduled_job SET payload = ? WHERE id = ?", [JSON.stringify(payload), String(job["id"])]);
    });
  }
  driver.transaction(() => {
    driver.run("UPDATE github_delivery SET completed_at = ? WHERE id = ?", [
      new Date().toISOString(),
      payload.deliveryKey,
    ]);
    driver.run("DELETE FROM scheduled_job WHERE id = ?", [String(job["id"])]);
  });
}
