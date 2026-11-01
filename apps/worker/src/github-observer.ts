import { uuidv7, type Row } from "@kanbun/model";
import {
  githubWebhookDeliverySchema,
  type GitHubWebhookDelivery,
  type GitHubPullRequestSnapshot,
  type GitHubRepositorySource,
} from "@kanbun/events";
import { githubIssueIdentifiers } from "@kanbun/mutators";
import { issueIncarnation } from "@kanbun/sync";
import type { SyncServer, SqlDriver } from "@kanbun/sync/server";
import { z } from "zod";

export const GITHUB_JOB = "github-observation";
const targetSchema = z.strictObject({
  bindingId: z.string(),
  number: z.number().int().positive().safe(),
  linkIds: z.array(z.string()),
  /** Absent on pre-discovery jobs, which retain their observation-only behavior. */
  teamId: z.string().optional(),
});
const jobSchema = z.strictObject({
  deliveryKey: z.string(),
  targets: z.array(targetSchema),
  completed: z.array(z.string()),
  admittedEventSeq: z.number().int().nonnegative().safe().optional(),
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
/** Unlink remains a human intent, even if canonical references changed before we observed them. */
function manuallyUnlinked(driver: SqlDriver, issue: Row<"issue">, bindingId: string, number: number): boolean {
  return (
    driver.all(
      `SELECT 1 FROM event_log u JOIN event_log s ON s.seq = (
      SELECT MAX(e.seq) FROM event_log e
      WHERE e.branch_id = 'main' AND e.entity_type = 'issue' AND e.entity_id = u.entity_id
        AND e.type IN ('GitHubPullRequestLinked','ObservedGitHubPullRequest')
        AND json_extract(e.payload,'$.id') = json_extract(u.payload,'$.id') AND e.seq < u.seq
    ) WHERE u.branch_id = 'main' AND u.entity_type = 'issue' AND u.entity_id = ?
      AND u.type = 'GitHubPullRequestUnlinked'
      AND json_extract(u.payload,'$.repositoryBindingId') = ?
      AND json_extract(u.payload,'$.issueIncarnation') = ?
      AND json_extract(s.payload,'$.snapshot.number') = ?
    ORDER BY u.seq DESC LIMIT 1`,
      [issue.id, bindingId, issueIncarnation(issue), number],
    ).length > 0
  );
}

function sameBinding(before: Row<"githubRepository">, after: Row<"githubRepository"> | undefined): boolean {
  return (
    !!after &&
    !after.archivedAt &&
    (["teamId", "installationId", "repositoryId", "owner", "name", "url", "private"] as const).every(
      (key) => before[key] === after[key],
    )
  );
}

/** A delivery owns its admitted bindings, links and issue-creation cutoff. */
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
    const admittedEventSeq = Number(
      driver.all("SELECT COALESCE(MAX(seq),0) AS seq FROM event_log WHERE branch_id='main'")[0]?.["seq"] ?? 0,
    );
    for (const binding of bindings) {
      const links = server.store
        .list("issuePullRequest", { repositoryBindingId: binding.id })
        .filter((row) =>
          delivery.kind === "pull_request" ? row.number === delivery.number : row.headSha === delivery.headSha,
        );
      const numbers = delivery.kind === "pull_request" ? [delivery.number] : new Set(links.map((row) => row.number));
      for (const number of numbers)
        targets.push({
          bindingId: binding.id,
          teamId: binding.teamId,
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
      JSON.stringify({ deliveryKey: key, admittedEventSeq, targets, completed: [] }),
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
    const team = binding ? server.store.get("team", binding.teamId) : undefined;
    const discover =
      payload.admittedEventSeq !== undefined &&
      binding &&
      !binding.archivedAt &&
      target.teamId === binding.teamId &&
      team &&
      !team.archivedAt &&
      !team.retiredAt;
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
    const revision =
      binding && (links.length || discover) ? driver.transaction(() => reserveGitHubRevision(driver)) : null;
    const snapshot = binding && revision ? await fetchSnapshot(githubSource(binding), target.number) : null;
    if (snapshot && snapshot.number !== target.number)
      throw new Error("GitHub observation belongs to a different pull request");
    driver.transaction(() => {
      if (snapshot && revision && binding && sameBinding(binding, server.store.get("githubRepository", binding.id))) {
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
        if (discover && payload.admittedEventSeq !== undefined) {
          const identifiers = githubIssueIdentifiers(snapshot);
          const currentTeam = server.store.get("team", binding.teamId);
          if (currentTeam && !currentTeam.archivedAt && !currentTeam.retiredAt)
            for (const issue of server.store.list("issue", { teamId: binding.teamId })) {
              if (
                issue.createdSeq > payload.admittedEventSeq ||
                issue.archivedAt ||
                issue.trashed ||
                !identifiers.has(`${currentTeam.key.toUpperCase()}-${issue.number}`)
              )
                continue;
              if (manuallyUnlinked(driver, issue, binding.id, snapshot.number)) continue;
              server.github(
                "githubPullRequestAutoLink",
                {
                  id: uuidv7(),
                  issueId: issue.id,
                  issueIncarnation: issueIncarnation(issue),
                  repositoryBindingId: binding.id,
                  revision,
                  snapshot,
                },
                { id: `github:${binding.id}`, type: "integration" },
                snapshot.url,
              );
            }
        }
      }
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
