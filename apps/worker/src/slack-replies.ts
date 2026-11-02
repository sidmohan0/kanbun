import { uuidv7 } from "@kanbun/model";
import { issueIncarnation, type Store } from "@kanbun/sync";
import type { SqlDriver, SyncServer } from "@kanbun/sync/server";
import { z } from "zod";

export const SLACK_REPLY_JOB = "slack-issue-reply";
export const slackReplyDeliverySchema = z.strictObject({
  eventId: z.string().min(1),
  teamId: z.string().min(1),
  version: z.string().regex(/^[a-f0-9]{64}$/),
  channel: z.string().regex(/^C[A-Z0-9]+$/),
  thread: z.string().regex(/^\d+\.\d{6}$/),
  identifiers: z.array(z.string().regex(/^[A-Z][A-Z0-9]{0,6}-[1-9]\d*$/)).max(20),
});
const jobSchema = slackReplyDeliverySchema.omit({ identifiers: true }).extend({
  receipt: z.string(),
  reservation: z.string(),
  issueId: z.string().uuid(),
  incarnation: z.string(),
  identifier: z.string(),
});

/** Parse the received text in memory; only bounded identifiers cross the private DO boundary. */
export function slackIssueIdentifiers(text: string): string[] {
  const result = new Set<string>();
  for (const match of text.matchAll(/(?<![A-Za-z0-9_-])([A-Za-z][A-Za-z0-9]{0,6})-([1-9]\d*)(?![A-Za-z0-9_-])/g)) {
    if (!Number.isSafeInteger(Number(match[2]))) continue;
    result.add(`${match[1]!.toUpperCase()}-${match[2]}`);
    if (result.size === 20) break;
  }
  return [...result];
}

function publicIssue(store: Store, id: string, incarnation?: string, identifier?: string) {
  const issue = store.get("issue", id);
  const team = issue && store.get("team", issue.teamId);
  const canonical = team && issue && `${team.key.toUpperCase()}-${issue.number}`;
  return issue &&
    !issue.trashed &&
    team?.visibility === "public" &&
    !team.archivedAt &&
    !team.retiredAt &&
    issue.number > 0 &&
    (!incarnation || issueIncarnation(issue) === incarnation) &&
    (!identifier || identifier === canonical)
    ? { issue, identifier: canonical! }
    : null;
}

/** Event receipt, pending reservations and job inserts commit before the signed event is acknowledged. */
export function queueSlackReplies(driver: SqlDriver, server: SyncServer, input: unknown, enabled: boolean) {
  const delivery = slackReplyDeliverySchema.parse(input);
  return driver.transaction(() => {
    const receipt = `reply:${delivery.teamId}:${delivery.eventId}`;
    if (driver.all("SELECT id FROM slack_delivery WHERE id=?", [receipt]).length) return { queued: 0 };
    const now = new Date().toISOString();
    const wanted = new Set(delivery.identifiers);
    let queued = 0;
    if (enabled && wanted.size)
      for (const row of server.store.list("issue")) {
        const current = publicIssue(server.store, row.id);
        if (!current || !wanted.has(current.identifier)) continue;
        const incarnation = issueIncarnation(row);
        const reservation = JSON.stringify([delivery.teamId, delivery.channel, delivery.thread, row.id, incarnation]);
        const previous = driver.all("SELECT pending_job_id,last_sent_at FROM slack_issue_reply WHERE id=?", [
          reservation,
        ])[0];
        if (
          previous?.["pending_job_id"] ||
          (previous?.["last_sent_at"] && Date.parse(now) - Date.parse(String(previous["last_sent_at"])) < 3_600_000)
        )
          continue;
        const id = uuidv7();
        driver.run(
          "INSERT INTO slack_issue_reply(id,pending_job_id,last_sent_at) VALUES (?,?,NULL) ON CONFLICT(id) DO UPDATE SET pending_job_id=excluded.pending_job_id",
          [reservation, id],
        );
        driver.run("INSERT INTO scheduled_job(id,fire_at,kind,payload,dedup_key,created_at) VALUES (?,?,?,?,?,?)", [
          id,
          now,
          SLACK_REPLY_JOB,
          JSON.stringify({
            eventId: delivery.eventId,
            teamId: delivery.teamId,
            version: delivery.version,
            channel: delivery.channel,
            thread: delivery.thread,
            receipt,
            reservation,
            issueId: row.id,
            incarnation,
            identifier: current.identifier,
          }),
          `slack-reply:${reservation}`,
          now,
        ]);
        queued++;
      }
    driver.run("INSERT INTO slack_delivery(id,created_at,completed_at) VALUES (?,?,?)", [
      receipt,
      now,
      queued ? null : now,
    ]);
    return { queued };
  });
}

/** Successful POST followed by a process crash before this checkpoint can produce a duplicate reply. */
export async function consumeSlackReply(
  driver: SqlDriver,
  server: SyncServer,
  job: Record<string, unknown>,
  origin: string,
  deliver: (
    teamId: string,
    version: string,
    channel: string,
    thread: string,
    resolve: () => string | null,
  ) => Promise<boolean>,
) {
  const payload = jobSchema.parse(JSON.parse(String(job["payload"])));
  const sent = await deliver(payload.teamId, payload.version, payload.channel, payload.thread, () => {
    const current = publicIssue(server.store, payload.issueId, payload.incarnation, payload.identifier);
    if (!current) return null;
    return `${current.identifier} ${origin}/#issues/${current.issue.id}`;
  });
  driver.transaction(() => {
    const now = new Date().toISOString();
    driver.run(
      sent
        ? "UPDATE slack_issue_reply SET pending_job_id=NULL,last_sent_at=? WHERE id=? AND pending_job_id=?"
        : "UPDATE slack_issue_reply SET pending_job_id=NULL WHERE id=? AND pending_job_id=?",
      sent ? [now, payload.reservation, String(job["id"])] : [payload.reservation, String(job["id"])],
    );
    driver.run("DELETE FROM scheduled_job WHERE id=?", [String(job["id"])]);
    if (
      !driver.all("SELECT id FROM scheduled_job WHERE kind=? AND json_extract(payload,'$.receipt')=?", [
        SLACK_REPLY_JOB,
        payload.receipt,
      ]).length
    )
      driver.run("UPDATE slack_delivery SET completed_at=? WHERE id=?", [now, payload.receipt]);
  });
}
