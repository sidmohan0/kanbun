import { uuidv7, type Row } from "@kanbun/model";
import type { DomainEvent } from "@kanbun/events";
import { DEFAULT_EVENT_PAGE_SIZE, issueIncarnation } from "@kanbun/sync";
import { decodeEvent, SYSTEM_TAG, type SqlDriver, type SyncServer } from "@kanbun/sync/server";

export const NOTIFICATION_JOB = "notification-consumer";
const CURSOR = "main";
type Kind = "assignment" | "mention" | "reply" | "comment";
type Recipient = { userId: string; admissionId: string | null; kind: Kind };
export type DirectoryCheck = (userId: string, admissionId: string | null) => Promise<boolean>;

const head = (driver: SqlDriver) =>
  Number(driver.all("SELECT COALESCE(MAX(seq),0) AS seq FROM event_log WHERE branch_id = 'main'")[0]?.["seq"] ?? 0);
const cursor = (driver: SqlDriver) =>
  driver.all("SELECT last_event_seq FROM notification_cursor WHERE id = ?", [CURSOR])[0];

/** Initialization deliberately begins at the current head; installing inbox does not notify old history. */
export function scheduleNotifications(driver: SqlDriver, server: SyncServer): boolean {
  if (!server.store.list("organization").length) return false;
  const current = head(driver);
  const previous = cursor(driver);
  if (!previous) {
    driver.run("INSERT INTO notification_cursor (id,last_event_seq) VALUES (?,?)", [CURSOR, current]);
    return false;
  }
  if (current <= Number(previous["last_event_seq"])) return false;
  if (!driver.all("SELECT id FROM scheduled_job WHERE dedup_key = ?", [NOTIFICATION_JOB]).length) {
    const now = new Date().toISOString();
    driver.run("INSERT INTO scheduled_job (id,fire_at,kind,payload,dedup_key,created_at) VALUES (?,?,?,?,?,?)", [
      uuidv7(),
      now,
      NOTIFICATION_JOB,
      "{}",
      NOTIFICATION_JOB,
      now,
    ]);
  }
  return true;
}

function matchesSubscription(server: SyncServer, userId: string, event: DomainEvent, issue: Row<"issue">): boolean {
  const filters = server.store
    .list("notificationSubscription", { subscriberId: userId })
    .filter((row) => !row.archivedAt);
  if (!filters.length) return true;
  return filters.some(
    (filter) =>
      filter.active &&
      (!filter.eventTypes.length || filter.eventTypes.includes(event.type)) &&
      (!filter.actors.length || filter.actors.includes(event.actor.id)) &&
      (filter.scope.kind === "workspace" ||
        (filter.scope.kind === "team" && filter.scope.teamId === issue.teamId) ||
        (filter.scope.kind === "issue" && filter.scope.issueId === issue.id)),
  );
}

function sourceIssue(server: SyncServer, event: DomainEvent) {
  const issueId =
    event.type === "IssueAssigned" || event.type === "IssueCreated"
      ? event.entityId
      : event.type === "CommentPosted" || event.type === "CommentEdited"
        ? event.payload.issueId
        : null;
  const issue = issueId === null ? undefined : server.store.get("issue", issueId);
  return issue &&
    !issue.archivedAt &&
    !issue.trashed &&
    (issue.createdSeq > 0 ? event.seq >= issue.createdSeq : event.ts >= Date.parse(issue.createdAt))
    ? issue
    : null;
}

function recipients(driver: SqlDriver, server: SyncServer, event: DomainEvent, issue: Row<"issue">): Recipient[] {
  const choices = new Map<string, Kind>();
  if (event.type === "IssueAssigned") choices.set(event.payload.assigneeId, "assignment");
  if (event.type === "IssueCreated" && event.payload.assigneeId) choices.set(event.payload.assigneeId, "assignment");
  if (event.type === "CommentPosted") {
    const sourceLogSeq = driver.all("SELECT MIN(seq) AS seq FROM sync_log WHERE event_seq = ? AND branch_id = 'main'", [
      event.seq,
    ])[0]?.["seq"];
    for (const subscription of server.store.list("issueSubscription", { issueId: issue.id })) {
      if (subscription.archivedAt || sourceLogSeq == null) continue;
      const creation = driver.all(
        "SELECT MAX(seq) AS seq FROM sync_log WHERE model = 'issueSubscription' AND row_id = ? AND branch_id = 'main' AND json_type(patch,'$.issueId') = 'text'",
        [subscription.id],
      )[0]?.["seq"];
      if (creation != null && Number(creation) <= Number(sourceLogSeq)) choices.set(subscription.userId, "comment");
    }
    if (event.payload.replyToUserId) choices.set(event.payload.replyToUserId, "reply");
  }
  if (event.type === "CommentPosted" || event.type === "CommentEdited")
    for (const userId of event.payload.addedMentionedUserIds) choices.set(userId, "mention");
  const sender =
    event.actor.type === "agent"
      ? server.store.get("agent", event.actor.id)?.ownerId
      : event.actor.type === "user"
        ? event.actor.id
        : null;
  return [...choices].flatMap(([userId, kind]) => {
    const user = server.store.get("user", userId);
    if (
      userId === sender ||
      !user?.active ||
      user.archivedAt ||
      event.seq <= user.notificationEventFloor ||
      !server.visibleTeamIds({ id: userId, type: "user" }).includes(issue.teamId) ||
      !matchesSubscription(server, userId, event, issue)
    )
      return [];
    return [{ userId, admissionId: user.directoryAdmissionId, kind }];
  });
}

const title: Record<Kind, string> = {
  assignment: "An issue was assigned to you",
  mention: "You were mentioned in a comment",
  reply: "Someone replied to your thread",
  comment: "New comment on a followed issue",
};
const category = (kind: Kind) =>
  kind === "assignment"
    ? ("assignments" as const)
    : kind === "mention"
      ? ("mentions" as const)
      : ("commentsAndReplies" as const);

/** Main-log consumer. Directory calls precede the atomic projection/checkpoint transaction. */
export async function consumeNotifications(
  driver: SqlDriver,
  server: SyncServer,
  directory: DirectoryCheck,
): Promise<boolean> {
  let changed = false;
  for (;;) {
    const checkpoint = cursor(driver);
    if (!checkpoint) return changed;
    const previous = Number(checkpoint["last_event_seq"]);
    const events = driver
      .all("SELECT * FROM event_log WHERE branch_id = 'main' AND seq > ? ORDER BY seq ASC LIMIT ?", [
        previous,
        DEFAULT_EVENT_PAGE_SIZE,
      ])
      .map(decodeEvent);
    if (!events.length) {
      driver.run("DELETE FROM scheduled_job WHERE dedup_key = ?", [NOTIFICATION_JOB]);
      return changed;
    }
    const plans = events.flatMap((event) => {
      const issue = sourceIssue(server, event);
      return issue ? [{ event, issue, recipients: recipients(driver, server, event, issue) }] : [];
    });
    const targets = new Map(
      plans
        .flatMap((plan) => plan.recipients)
        .map((recipient) => [JSON.stringify([recipient.userId, recipient.admissionId]), recipient]),
    );
    const approvals = new Map(
      await Promise.all(
        [...targets].map(
          async ([key, recipient]) => [key, await directory(recipient.userId, recipient.admissionId)] as const,
        ),
      ),
    );
    driver.transaction(() => {
      // Another consumer may have advanced during directory I/O; replay then remains idempotent.
      if (Number(cursor(driver)?.["last_event_seq"]) !== previous) return;
      for (const plan of plans) {
        const issue = sourceIssue(server, plan.event);
        if (!issue || issueIncarnation(issue) !== issueIncarnation(plan.issue)) continue;
        const stillEligible = recipients(driver, server, plan.event, issue);
        for (const recipient of plan.recipients) {
          if (
            !approvals.get(JSON.stringify([recipient.userId, recipient.admissionId])) ||
            !stillEligible.some(
              (current) =>
                current.userId === recipient.userId &&
                current.admissionId === recipient.admissionId &&
                current.kind === recipient.kind,
            )
          )
            continue;
          const deliveryKey = JSON.stringify([plan.event.seq, recipient.userId, recipient.admissionId]);
          if (server.store.list("notification", { deliveryKey }).length) continue;
          const now = new Date(plan.event.ts).toISOString();
          server.store
            .withTag({ ...SYSTEM_TAG(uuidv7()), eventSeq: plan.event.seq, causationSeq: plan.event.seq, ts: now })
            .insert("notification", {
              id: uuidv7(),
              userId: recipient.userId,
              teamId: issue.teamId,
              sourceEventSeq: plan.event.seq,
              issueIncarnation: issueIncarnation(issue),
              recipientAdmissionId: recipient.admissionId,
              deliveryKey,
              actorId: plan.event.actor.id,
              type: recipient.kind,
              category: category(recipient.kind),
              title: title[recipient.kind],
              groupingKey: `issue:${issue.id}`,
              issueId: issue.id,
              commentId: plan.event.entityType === "comment" ? plan.event.entityId : null,
              createdAt: now,
              updatedAt: now,
              createdSeq: plan.event.seq,
              updatedSeq: plan.event.seq,
              archivedAt: null,
              subtitle: null,
              groupingPriority: 0,
              readAt: null,
              emailedAt: null,
              snoozedUntilAt: null,
              unsnoozedAt: null,
              projectId: null,
              projectUpdateId: null,
              initiativeId: null,
              initiativeUpdateId: null,
              documentId: null,
              customerNeedId: null,
            } as Row<"notification">);
          changed = true;
        }
      }
      driver.run("UPDATE notification_cursor SET last_event_seq = ? WHERE id = ?", [events.at(-1)!.seq, CURSOR]);
    });
  }
}
