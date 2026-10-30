import { expect, it } from "vitest";
import { uuidv7, type Row } from "@kanbun/model";
import { mutators } from "@kanbun/mutators";
import { issueIncarnation, normalizeRow, type Actor } from "@kanbun/sync";
import { SyncServer } from "@kanbun/sync/server";
import { openWorkspaceDb } from "@kanbun/sync/server/node";
import { consumeNotifications, scheduleNotifications } from "../src/notifications";

const ALICE = { id: "alice", type: "user" } as const,
  BOB = { id: "bob", type: "user" } as const;
const NOW = "2026-10-30T12:00:00.000Z";
function fixture() {
  const { db, driver } = openWorkspaceDb();
  const server = new SyncServer({ driver, mutators, now: () => NOW });
  server.system("workspaceInit", {
    organization: { id: uuidv7(), name: "Kanbun", urlKey: "kanbun" },
    owner: { id: ALICE.id, name: "Alice", email: "alice@example.com" },
  });
  const admission = uuidv7();
  server.system("memberSync", { id: BOB.id, name: "Bob", email: "bob@example.com", directoryAdmissionId: admission });
  const teamId = uuidv7(),
    issueId = uuidv7();
  const counters = new Map<string, number>();
  function push(actor: Actor, name: string, args: unknown) {
    const sequence = (counters.get(actor.id) ?? 0) + 1;
    counters.set(actor.id, sequence);
    return server.push(actor, {
      clientId: `notification-${actor.id}`,
      mutations: [{ id: sequence, name, args, ts: NOW }],
    });
  }
  expect(
    push(ALICE, "teamCreate", {
      id: teamId,
      name: "Public",
      key: "PUB",
      membershipId: uuidv7(),
      stateIds: { backlog: uuidv7(), todo: uuidv7(), inProgress: uuidv7(), done: uuidv7(), canceled: uuidv7() },
    }),
  ).toMatchObject({ ok: true, rejected: [] });
  scheduleNotifications(driver, server);
  server.onCommit(() => {
    scheduleNotifications(driver, server);
  });
  const create = (assigneeId?: string) =>
    push(ALICE, "issueCreate", {
      id: issueId,
      teamId,
      title: "Review a decision",
      subscriptionId: uuidv7(),
      ...(assigneeId ? { assigneeId, assigneeSubscriptionId: uuidv7() } : {}),
    });
  const consume = (directory = async () => true) => consumeNotifications(driver, server, directory);
  const inbox = (actor: Actor) => server.bootstrap(actor, `read-${actor.id}`).rows.notification ?? [];
  return { db, driver, server, teamId, issueId, admission, push, create, consume, inbox };
}

it("consumes assignment, selected mentions and mandatory legacy-thread replies once, with durable owner-only read state", async () => {
  const f = fixture();
  try {
    expect(f.create(BOB.id)).toMatchObject({ ok: true, rejected: [] });
    await f.consume();
    expect(f.inbox(BOB)).toMatchObject([{ type: "assignment", actorId: ALICE.id, sourceEventSeq: 1 }]);
    expect(f.inbox(ALICE)).toEqual([]);
    const assignment = f.server.store.list("notification")[0]!;
    expect(f.push(ALICE, "notificationRead", { id: assignment.id, read: true })).toMatchObject({
      ok: true,
      rejected: [expect.anything()],
    });
    expect(f.push(BOB, "notificationRead", { id: assignment.id, read: true })).toMatchObject({
      ok: true,
      rejected: [],
    });
    await f.consume();
    expect(f.server.store.get("notification", assignment.id)?.readAt).toBe(NOW);
    const root = uuidv7();
    expect(f.push(BOB, "issueUnsubscribe", { issueId: f.issueId })).toMatchObject({ ok: true, rejected: [] });
    expect(
      f.push(BOB, "commentCreate", {
        id: root,
        issueId: f.issueId,
        body: "Alice please review",
        mentionedUserIds: [ALICE.id, ALICE.id, BOB.id],
      }),
    ).toMatchObject({ ok: true, rejected: [] });
    await f.consume();
    expect(f.inbox(ALICE)).toMatchObject([{ type: "mention", commentId: root }]);
    expect(f.inbox(BOB)).toHaveLength(1);
    expect(
      f.push(ALICE, "commentCreate", {
        id: uuidv7(),
        issueId: f.issueId,
        parentId: root,
        body: "Reply without a mention or subscription",
      }),
    ).toMatchObject({ ok: true, rejected: [] });
    await f.consume();
    expect(
      f
        .inbox(BOB)
        .map((row) => row["type"])
        .sort(),
    ).toEqual(["assignment", "reply"]);
    const reply = uuidv7();
    expect(
      f.push(ALICE, "commentCreate", {
        id: reply,
        issueId: f.issueId,
        parentId: root,
        body: "Reply and mention",
        mentionedUserIds: [BOB.id],
      }),
    ).toMatchObject({ ok: true, rejected: [] });
    await f.consume();
    expect(
      f
        .inbox(BOB)
        .map((row) => row["type"])
        .sort(),
    ).toEqual(["assignment", "mention", "reply"]);
    expect(f.push(ALICE, "commentUpdate", { id: reply, body: "Corrected wording" })).toMatchObject({
      ok: true,
      rejected: [],
    });
    expect(f.server.store.get("comment", reply)?.mentionedUserIds).toEqual([BOB.id]);
    await f.consume();
    expect(f.inbox(BOB)).toHaveLength(3);
    await f.consume();
    expect(f.inbox(BOB)).toHaveLength(3);
    expect(f.server.store.get("notification", assignment.id)?.readAt).toBe(NOW);
  } finally {
    f.db.close();
  }
});

it("rolls back fan-out and its checkpoint together, and retries a directory failure without losing or duplicating delivery", async () => {
  const f = fixture();
  try {
    f.create(BOB.id);
    const before = f.driver.all("SELECT * FROM notification_cursor");
    f.driver.run(
      "CREATE TRIGGER fail_notification BEFORE INSERT ON notification BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
    );
    await expect(f.consume()).rejects.toThrow("fixture failure");
    expect(f.driver.all("SELECT * FROM notification_cursor")).toEqual(before);
    expect(f.server.store.list("notification")).toEqual([]);
    f.driver.run("DROP TRIGGER fail_notification");
    await expect(
      f.consume(async () => {
        throw new Error("directory unavailable");
      }),
    ).rejects.toThrow("directory unavailable");
    expect(f.driver.all("SELECT * FROM notification_cursor")).toEqual(before);
    await f.consume();
    const delivered = f.server.store.list("notification");
    expect(delivered).toHaveLength(1);
    await f.consume();
    expect(f.server.store.list("notification")).toEqual(delivered);
  } finally {
    f.db.close();
  }
});

it("uses stable source ordering for subscriptions and applies scope/event/actor notification filters", async () => {
  const f = fixture();
  try {
    f.create();
    const root = uuidv7();
    f.push(ALICE, "commentCreate", { id: root, issueId: f.issueId, body: "Before Bob followed" });
    f.push(BOB, "issueSubscribe", { issueId: f.issueId, subscriptionId: uuidv7() });
    await f.consume();
    expect(f.inbox(BOB)).toEqual([]);
    f.push(ALICE, "commentCreate", { id: uuidv7(), issueId: f.issueId, body: "After Bob followed" });
    await f.consume();
    expect(f.inbox(BOB)).toMatchObject([{ type: "comment" }]);
    f.server.store.insert(
      "notificationSubscription",
      normalizeRow("notificationSubscription", {
        id: uuidv7(),
        subscriberId: BOB.id,
        scope: { kind: "issue", issueId: f.issueId },
        eventTypes: ["CommentEdited"],
        actors: [ALICE.id],
        createdAt: NOW,
        updatedAt: NOW,
      }) as Row<"notificationSubscription">,
    );
    f.push(ALICE, "commentCreate", {
      id: uuidv7(),
      issueId: f.issueId,
      body: "Excluded event type",
      mentionedUserIds: [BOB.id],
    });
    await f.consume();
    expect(f.inbox(BOB)).toHaveLength(1);
    f.push(ALICE, "commentUpdate", { id: root, body: "Included stable mention edit", mentionedUserIds: [BOB.id] });
    await f.consume();
    expect(f.inbox(BOB)).toHaveLength(2);
    expect(f.inbox(BOB).some((row) => row["type"] === "mention")).toBe(true);
  } finally {
    f.db.close();
  }
});

it("keeps private, retired and previous-admission notifications out of every ordinary read path", async () => {
  const f = fixture();
  try {
    f.create(BOB.id);
    await f.consume();
    const old = f.server.store.list("notification")[0]!;
    const baseline = f.server.bootstrap(BOB, "scope-reader");
    const privateTeam = uuidv7();
    expect(
      f.push(ALICE, "teamCreate", {
        id: privateTeam,
        name: "Private",
        key: "PRI",
        visibility: "private",
        membershipId: uuidv7(),
        stateIds: { backlog: uuidv7(), todo: uuidv7(), inProgress: uuidv7(), done: uuidv7(), canceled: uuidv7() },
      }),
    ).toMatchObject({ ok: true, rejected: [] });
    expect(
      f.push(ALICE, "issueUpdate", { id: f.issueId, patch: { teamId: privateTeam, assigneeId: null } }),
    ).toMatchObject({ ok: true, rejected: [] });
    expect(f.inbox(BOB)).toEqual([]);
    expect(
      f.server
        .pull(BOB, { clientId: "scope-reader", since: baseline.seq })
        .entries.filter((row) => row.model === "notification"),
    ).toMatchObject([{ op: "delete", id: old.id, patch: null }]);
    expect(f.server.activity(BOB, { model: "notification" })).toEqual([]);
    expect(f.push(BOB, "notificationRead", { id: old.id, read: true })).toMatchObject({
      ok: true,
      rejected: [expect.anything()],
    });
    f.server.system("memberSync", {
      id: BOB.id,
      name: "Bob",
      email: "bob@example.com",
      directoryAdmissionId: uuidv7(),
      notificationEventFloor: Number(f.driver.all("SELECT MAX(seq) AS seq FROM event_log")[0]?.["seq"]),
    });
    expect(f.server.store.list("notification", { userId: BOB.id })).toEqual([]);
    expect(f.server.activity(BOB, { model: "notification" })).toEqual([]);
    const incarnation = issueIncarnation(f.server.store.get("issue", f.issueId)!);
    f.push(ALICE, "issueTrash", { id: f.issueId, trashed: true });
    f.push(ALICE, "issueDelete", { id: f.issueId });
    f.create();
    expect(issueIncarnation(f.server.store.get("issue", f.issueId)!)).not.toBe(incarnation);
    f.driver.run("UPDATE notification_cursor SET last_event_seq = 0");
    await f.consume();
    expect(f.server.store.list("notification")).toEqual([]);
  } finally {
    f.db.close();
  }
});

it("does not notify old history or branches, and rejects stale admission during asynchronous recipient checks", async () => {
  const f = fixture();
  try {
    f.create(BOB.id);
    f.driver.run("DELETE FROM notification_cursor");
    scheduleNotifications(f.driver, f.server);
    await f.consume();
    expect(f.server.store.list("notification")).toEqual([]);
    const branch = uuidv7();
    f.server.createBranch(ALICE, { id: branch, name: "Speculative" });
    expect(
      f.server.push(ALICE, {
        clientId: "draft-assign",
        branchId: branch,
        mutations: [
          {
            id: 1,
            name: "issueCreate",
            ts: NOW,
            args: {
              id: uuidv7(),
              teamId: f.teamId,
              title: "Draft assigned",
              assigneeId: BOB.id,
              subscriptionId: uuidv7(),
            },
          },
        ],
      }),
    ).toMatchObject({ ok: true, rejected: [] });
    await f.consume();
    expect(f.server.store.list("notification")).toEqual([]);
    f.push(ALICE, "issueUpdate", { id: f.issueId, patch: { assigneeId: null } });
    f.push(ALICE, "issueUpdate", { id: f.issueId, patch: { assigneeId: BOB.id } });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let checked!: () => void;
    const checking = new Promise<void>((resolve) => {
      checked = resolve;
    });
    const pending = f.consume(async () => {
      checked();
      await held;
      return true;
    });
    await checking;
    const floor = Number(f.driver.all("SELECT MAX(seq) AS seq FROM event_log")[0]?.["seq"]);
    f.server.system("memberSync", {
      id: BOB.id,
      name: "Bob",
      email: "bob@example.com",
      directoryAdmissionId: uuidv7(),
      notificationEventFloor: floor,
    });
    release();
    await pending;
    expect(f.inbox(BOB)).toEqual([]);
    f.push(ALICE, "issueUpdate", { id: f.issueId, patch: { assigneeId: null } });
    f.push(ALICE, "issueUpdate", { id: f.issueId, patch: { assigneeId: BOB.id } });
    await f.consume();
    expect(f.inbox(BOB)).toHaveLength(1);
    expect(f.inbox(BOB)[0]?.["sourceEventSeq"]).toBeGreaterThan(floor);
  } finally {
    f.db.close();
  }
});
