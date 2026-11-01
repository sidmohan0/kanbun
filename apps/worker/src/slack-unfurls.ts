import { uuidv7 } from "@kanbun/model";
import { issueIncarnation, type Store } from "@kanbun/sync";
import type { SqlDriver, SyncServer } from "@kanbun/sync/server";
import { z } from "zod";

export const SLACK_UNFURL_JOB = "slack-issue-unfurl";
export const slackDestinationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("message"),
    channel: z.string().regex(/^[CGD][A-Z0-9]+$/),
    ts: z.string().regex(/^\d+\.\d+$/),
  }),
  z.strictObject({
    kind: z.literal("unfurl"),
    id: z.string().min(1),
    source: z.enum(["composer", "conversations_history"]),
  }),
]);
export const slackUnfurlDeliverySchema = z.strictObject({
  eventId: z.string().min(1),
  teamId: z.string().min(1),
  version: z.string().regex(/^[a-f0-9]{64}$/),
  destination: slackDestinationSchema,
  urls: z.array(z.string()),
});
export type SlackUnfurlDelivery = z.infer<typeof slackUnfurlDeliverySchema>;
const targetSchema = z.strictObject({ url: z.string(), issueId: z.string().uuid(), incarnation: z.string() });
const jobSchema = slackUnfurlDeliverySchema.omit({ urls: true }).extend({
  receipt: z.string(),
  targets: z.array(targetSchema),
});
export type SlackUnfurls = Record<
  string,
  { fallback: string; blocks: { type: "section"; text: { type: "plain_text"; text: string; emoji: false } }[] }
>;

/** Only the application's canonical issue route is supported, never arbitrary web fetches. */
export function slackIssueId(value: string, origin: string): string | null {
  try {
    const url = new URL(value);
    const match = /^#issues\/([a-fA-F0-9-]+)$/.exec(url.hash);
    const id = match && z.string().uuid().safeParse(match[1]);
    if (
      !id ||
      !id.success ||
      value !== `${origin}/#issues/${id.data}` ||
      url.username ||
      url.password ||
      url.search ||
      url.pathname !== "/" ||
      url.origin !== origin
    )
      return null;
    return id.data;
  } catch {
    return null;
  }
}

function publicIssue(store: Store, id: string, incarnation?: string) {
  const issue = store.get("issue", id);
  const team = issue && store.get("team", issue.teamId);
  return issue &&
    !issue.trashed &&
    team &&
    team.visibility === "public" &&
    !team.archivedAt &&
    !team.retiredAt &&
    (!incarnation || issueIncarnation(issue) === incarnation)
    ? { issue, team }
    : null;
}

/** Slack text objects require escaping &, < and >; section text has a 3,000 character maximum. */
export function slackLiteral(value: string): string {
  const parts: string[] = [];
  let length = 0;
  for (const character of value) {
    const next = character === "&" ? "&amp;" : character === "<" ? "&lt;" : character === ">" ? "&gt;" : character;
    if (length + next.length > 3000) {
      while (length > 2999) length -= parts.pop()!.length;
      return parts.join("") + "…";
    }
    parts.push(next);
    length += next.length;
  }
  return parts.join("");
}

export function slackIssueUnfurls(store: Store, targets: z.infer<typeof targetSchema>[], origin: string): SlackUnfurls {
  const result: SlackUnfurls = {};
  for (const target of targets) {
    if (slackIssueId(target.url, origin) !== target.issueId) continue;
    const current = publicIssue(store, target.issueId, target.incarnation);
    if (!current) continue;
    const { issue, team } = current;
    const state = store.get("workflowState", issue.stateId);
    const person = issue.assigneeId && store.get("user", issue.assigneeId);
    const title = `${team.key}-${issue.number} ${issue.title}`;
    const values = [
      title,
      issue.description ?? "",
      `Status: ${state?.teamId === team.id ? state.name : "Unknown"}\nAssignee: ${person ? person.displayName || person.name : "Unassigned"}\nCreated: ${issue.createdAt}`,
    ].filter(Boolean);
    result[target.url] = {
      fallback: slackLiteral(title),
      blocks: values.map((value) => ({
        type: "section",
        text: { type: "plain_text", text: slackLiteral(value), emoji: false },
      })),
    };
  }
  return result;
}

/** Receipt and candidate incarnation are committed before the edge acknowledges Slack's event. */
export function queueSlackUnfurl(
  driver: SqlDriver,
  server: SyncServer,
  input: SlackUnfurlDelivery,
  origin: string,
  enabled: boolean,
) {
  const delivery = slackUnfurlDeliverySchema.parse(input);
  return driver.transaction(() => {
    const receipt = `${delivery.teamId}:${delivery.eventId}`;
    if (driver.all("SELECT id FROM slack_delivery WHERE id=?", [receipt]).length) return { queued: false };
    const targets: z.infer<typeof targetSchema>[] = [];
    if (enabled)
      for (const url of new Set(delivery.urls)) {
        const id = slackIssueId(url, origin);
        const current = id && publicIssue(server.store, id);
        if (current) targets.push({ url, issueId: current.issue.id, incarnation: issueIncarnation(current.issue) });
      }
    const now = new Date().toISOString();
    driver.run("INSERT INTO slack_delivery(id,created_at,completed_at) VALUES (?,?,?)", [
      receipt,
      now,
      targets.length ? null : now,
    ]);
    if (targets.length)
      driver.run("INSERT INTO scheduled_job(id,fire_at,kind,payload,dedup_key,created_at) VALUES (?,?,?,?,?,?)", [
        uuidv7(),
        now,
        SLACK_UNFURL_JOB,
        JSON.stringify({
          eventId: delivery.eventId,
          teamId: delivery.teamId,
          version: delivery.version,
          destination: delivery.destination,
          receipt,
          targets,
        }),
        `slack:${receipt}`,
        now,
      ]);
    return { queued: !!targets.length };
  });
}

/** chat.unfurl updates the same message attachment if a crash requires retry after a successful POST. */
export async function consumeSlackUnfurl(
  driver: SqlDriver,
  server: SyncServer,
  job: Record<string, unknown>,
  origin: string,
  deliver: (
    teamId: string,
    version: string,
    destination: z.infer<typeof slackDestinationSchema>,
    resolve: () => SlackUnfurls,
  ) => Promise<void>,
) {
  const payload = jobSchema.parse(JSON.parse(String(job["payload"])));
  await deliver(payload.teamId, payload.version, payload.destination, () =>
    slackIssueUnfurls(server.store, payload.targets, origin),
  );
  driver.transaction(() => {
    driver.run("UPDATE slack_delivery SET completed_at=? WHERE id=?", [new Date().toISOString(), payload.receipt]);
    driver.run("DELETE FROM scheduled_job WHERE id=?", [String(job["id"])]);
  });
}
