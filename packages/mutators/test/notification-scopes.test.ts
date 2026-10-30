import { describe, expect, it } from "vitest";
import type { Row } from "@kanbun/model";
import { issueIncarnation, type Actor, type PushResponse } from "@kanbun/sync";
import { SyncServer } from "@kanbun/sync/server";
import { openWorkspaceDb } from "@kanbun/sync/server/node";
import { MemoryPersister, SyncClient } from "@kanbun/sync/client";
import { mutators } from "../src";

const id = (value: number) => `019a0000-0000-7000-8000-${value.toString(16).padStart(12, "0")}`;
const ALICE = { id: "alice", type: "user" } as const;
const BOB = { id: "bob", type: "user" } as const;
const TEAM = id(2),
  ISSUE = id(10),
  COMMENT = id(20);
const NOW = "2026-10-30T12:00:00.000Z";

function fixture() {
  const { db, driver } = openWorkspaceDb();
  const server = new SyncServer({ driver, mutators, now: () => NOW });
  server.system("workspaceInit", {
    organization: { id: id(1), name: "Kanbun", urlKey: "kanbun" },
    owner: { id: ALICE.id, name: "Alice", email: "alice@example.com" },
  });
  for (const user of [BOB.id, "carol"])
    server.system("memberSync", { id: user, name: user, email: `${user}@example.com` });
  const counters = new Map<string, number>();
  function push(actor: Actor, name: string, args: unknown): PushResponse {
    const next = (counters.get(actor.id) ?? 0) + 1;
    counters.set(actor.id, next);
    return server.push(actor, {
      clientId: `notification-scope-${actor.id}`,
      mutations: [{ id: next, name, args, ts: NOW }],
    });
  }
  function accepted(actor: Actor, name: string, args: unknown) {
    expect(push(actor, name, args)).toMatchObject({ ok: true, rejected: [] });
  }
  accepted(ALICE, "teamCreate", {
    id: TEAM,
    name: "Launch",
    key: "LAUNCH",
    membershipId: id(8),
    stateIds: { backlog: id(3), todo: id(4), inProgress: id(5), done: id(6), canceled: id(7) },
  });
  const createIssue = () =>
    accepted(ALICE, "issueCreate", { id: ISSUE, teamId: TEAM, title: "Launch", subscriptionId: id(11) });
  createIssue();
  let nextNotification = 100;
  function notification(userId: string = BOB.id, overrides: Partial<Row<"notification">> = {}) {
    const issue = server.store.get("issue", ISSUE)!;
    const row = {
      id: id(nextNotification++),
      userId,
      teamId: TEAM,
      issueId: ISSUE,
      sourceEventSeq: issue.createdSeq,
      issueIncarnation: issueIncarnation(issue),
      recipientAdmissionId: server.store.get("user", userId)!.directoryAdmissionId,
      type: "mention",
      category: "mentions",
      title: `Private notification for ${userId}`,
      groupingKey: `issue:${ISSUE}`,
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    } as Row<"notification">;
    server.store.insert("notification", row);
    return server.store.get("notification", row.id)!;
  }
  return { db, driver, server, push, accepted, createIssue, notification };
}

describe("notification identity and current access boundaries", () => {
  it("records deduplicated stable mention IDs and rejects inactive or currently inaccessible recipients", () => {
    const f = fixture();
    try {
      f.accepted(ALICE, "commentCreate", {
        id: COMMENT,
        issueId: ISSUE,
        body: "A display name is not an identity.",
        mentionedUserIds: [BOB.id, BOB.id],
      });
      expect(f.server.store.get("comment", COMMENT)?.mentionedUserIds).toEqual([BOB.id]);
      expect(
        f.server.events(ALICE, { issueId: ISSUE }).find((event) => event.type === "CommentPosted")?.payload,
      ).toMatchObject({ mentionedUserIds: [BOB.id], addedMentionedUserIds: [BOB.id] });
      f.server.system("memberSync", { id: "carol", name: "Carol", email: "carol@example.com", active: false });
      for (const recipient of ["carol", "nonexistent"])
        expect(
          f.push(ALICE, "commentCreate", {
            id: id(30),
            issueId: ISSUE,
            body: "Rejected",
            mentionedUserIds: [recipient],
          }),
        ).toMatchObject({ ok: true, rejected: [{ error: expect.any(String) }] });
      f.accepted(ALICE, "teamUpdate", { id: TEAM, patch: { visibility: "private" } });
      expect(
        f.push(ALICE, "commentCreate", { id: id(31), issueId: ISSUE, body: "Private", mentionedUserIds: [BOB.id] }),
      ).toMatchObject({ ok: true, rejected: [{ error: expect.any(String) }] });
      expect(f.server.store.list("comment")).toHaveLength(1);
      f.accepted(ALICE, "teamMembershipCreate", { id: id(32), teamId: TEAM, userId: BOB.id });
      f.accepted(ALICE, "commentCreate", {
        id: id(33),
        issueId: ISSUE,
        body: "An authorized private mention",
        mentionedUserIds: [BOB.id],
      });
    } finally {
      f.db.close();
    }
  });

  it("preserves omitted mentions, clears explicit empty IDs, and derives additions rather than trusting forged deltas", () => {
    const f = fixture();
    try {
      f.accepted(ALICE, "commentCreate", { id: COMMENT, issueId: ISSUE, body: "Initial", mentionedUserIds: [BOB.id] });
      f.accepted(ALICE, "commentUpdate", { id: COMMENT, body: "Keep mentions", addedMentionedUserIds: ["carol"] });
      expect(f.server.store.get("comment", COMMENT)?.mentionedUserIds).toEqual([BOB.id]);
      f.accepted(ALICE, "commentUpdate", { id: COMMENT, body: "Clear mentions", mentionedUserIds: [] });
      expect(f.server.store.get("comment", COMMENT)?.mentionedUserIds).toEqual([]);
      f.accepted(ALICE, "commentUpdate", {
        id: COMMENT,
        body: "Mention again",
        mentionedUserIds: [BOB.id, BOB.id],
        addedMentionedUserIds: ["carol"],
      });
      const edits = f.server.events(ALICE, { issueId: ISSUE }).filter((event) => event.type === "CommentEdited");
      expect(edits.map((event) => event.payload.addedMentionedUserIds)).toEqual([[], [], [BOB.id]]);
      expect(edits.map((event) => event.payload.mentionedUserIds)).toEqual([[BOB.id], [], [BOB.id]]);
      f.server.system("memberSync", { id: BOB.id, name: "Bob", email: "bob@example.com", active: false });
      f.accepted(ALICE, "commentUpdate", {
        id: COMMENT,
        body: "Update wording, retaining historical mention",
        mentionedUserIds: [BOB.id],
      });
      expect(f.server.events(ALICE, { issueId: ISSUE }).at(-1)?.payload).toMatchObject({
        mentionedUserIds: [BOB.id],
        addedMentionedUserIds: [],
      });
      f.accepted(ALICE, "commentUpdate", { id: COMMENT, body: "Remove historical mention", mentionedUserIds: [] });
      expect(
        f.push(ALICE, "commentUpdate", {
          id: COMMENT,
          body: "Inactive member is a new mention again",
          mentionedUserIds: [BOB.id],
        }),
      ).toMatchObject({ ok: true, rejected: [{ error: expect.any(String) }] });
      expect(f.server.store.get("comment", COMMENT)?.mentionedUserIds).toEqual([]);
    } finally {
      f.db.close();
    }
  });

  it("allows only the recipient to change read state while current team and issue incarnation remain visible", () => {
    const f = fixture();
    try {
      const row = f.notification();
      expect(f.push(ALICE, "notificationRead", { id: row.id, read: true })).toMatchObject({
        ok: true,
        rejected: [{ error: expect.any(String) }],
      });
      f.accepted(BOB, "notificationRead", { id: row.id, read: true });
      expect(f.server.store.get("notification", row.id)?.readAt).toBe(NOW);
      f.accepted(ALICE, "teamUpdate", { id: TEAM, patch: { visibility: "private" } });
      expect(f.push(BOB, "notificationRead", { id: row.id, read: false })).toMatchObject({
        ok: true,
        rejected: [{ error: expect.any(String) }],
      });
      f.accepted(ALICE, "teamUpdate", { id: TEAM, patch: { visibility: "public" } });
      f.accepted(ALICE, "issueTrash", { id: ISSUE, trashed: true });
      f.accepted(ALICE, "issueDelete", { id: ISSUE });
      f.createIssue();
      expect(f.server.store.get("notification", row.id)).toBeUndefined();
      // A delayed or restored row from the prior incarnation must also stay unavailable.
      f.notification(BOB.id, row);
      expect(f.push(BOB, "notificationRead", { id: row.id, read: false })).toMatchObject({
        ok: true,
        rejected: [{ error: expect.any(String) }],
      });
      expect(f.server.bootstrap(BOB, "recreated-inbox").rows.notification ?? []).toEqual([]);
    } finally {
      f.db.close();
    }
  });

  it("scopes bootstrap, incremental patches and raw activity to the recipient and current team access", () => {
    const f = fixture();
    try {
      const baseline = f.server.bootstrap(BOB, "bob-inbox");
      const owned = f.notification(),
        other = f.notification(ALICE.id);
      const bootstrap = f.server.bootstrap(BOB, "bob-new-inbox");
      expect(bootstrap.rows.notification?.map((row) => row["id"])).toEqual([owned.id]);
      const pull = f.server.pull(BOB, { clientId: "bob-inbox", since: baseline.seq });
      expect(pull.entries).toContainEqual(
        expect.objectContaining({ model: "notification", id: owned.id, op: "upsert" }),
      );
      expect(pull.entries.some((entry) => entry.id === other.id && entry.patch !== null)).toBe(false);
      expect(JSON.stringify(f.server.activity(BOB, { model: "notification" }))).toContain(owned.title);
      expect(JSON.stringify(f.server.activity(BOB, { model: "notification" }))).not.toContain(other.title);
      f.accepted(ALICE, "teamUpdate", { id: TEAM, patch: { visibility: "private" } });
      expect(f.server.bootstrap(BOB, "private-inbox").rows.notification ?? []).toEqual([]);
      expect(f.server.activity(BOB, { model: "notification" })).toEqual([]);
      expect(f.server.pull(BOB, { clientId: "bob-inbox", since: pull.seq }).reset).toBe(true);
    } finally {
      f.db.close();
    }
  });

  it("retires inbox rows and filters on a changed admission and rejects public membership forgery", () => {
    const f = fixture();
    try {
      const oldAdmission = id(80),
        newAdmission = id(81);
      f.server.system("memberSync", {
        id: BOB.id,
        name: "Bob",
        email: "bob@example.com",
        directoryAdmissionId: oldAdmission,
      });
      const row = f.notification();
      f.server.store.insert("notificationSubscription", {
        id: id(82),
        subscriberId: BOB.id,
        active: true,
        scope: { kind: "workspace" },
        eventTypes: [],
        actors: [],
        teamId: null,
        userId: null,
        archivedAt: null,
        projectId: null,
        initiativeId: null,
        cycleId: null,
        labelId: null,
        customViewId: null,
        customerId: null,
        contextViewType: null,
        createdAt: NOW,
        updatedAt: NOW,
      } as Row<"notificationSubscription">);
      expect(f.server.bootstrap(BOB, "old-admission").rows.notification?.map((row) => row["id"])).toEqual([row.id]);
      expect(f.server.activity(BOB, { model: "notificationSubscription" })).toHaveLength(1);
      const floor = f.server.events(ALICE).at(-1)!.seq;
      f.server.system("memberSync", {
        id: BOB.id,
        name: "Bob",
        email: "bob@example.com",
        directoryAdmissionId: newAdmission,
        notificationEventFloor: floor,
      });
      expect(f.server.store.list("notification", { userId: BOB.id })).toEqual([]);
      expect(f.server.store.list("notificationSubscription", { subscriberId: BOB.id })).toEqual([]);
      expect(f.server.activity(BOB, { model: "notificationSubscription" })).toEqual([]);
      expect(
        f.push(BOB, "memberSync", {
          id: BOB.id,
          name: "Bob",
          email: "bob@example.com",
          directoryAdmissionId: oldAdmission,
          notificationEventFloor: 0,
        }),
      ).toMatchObject({ ok: true, rejected: [{ error: expect.stringMatching(/system-only/) }] });
      f.notification(BOB.id, { recipientAdmissionId: oldAdmission, sourceEventSeq: floor + 1 });
      f.notification(BOB.id, { recipientAdmissionId: newAdmission, sourceEventSeq: floor });
      expect(f.server.bootstrap(BOB, "new-admission").rows.notification ?? []).toEqual([]);
      expect(f.server.bootstrap(BOB, "new-filter-admission").rows.notificationSubscription ?? []).toEqual([]);
      expect(f.server.activity(BOB, { model: "notification" })).toEqual([]);
      expect(f.server.store.get("user", BOB.id)).toMatchObject({
        directoryAdmissionId: newAdmission,
        notificationEventFloor: floor,
      });
    } finally {
      f.db.close();
    }
  });

  it("restores legacy browser JSON with real array and scope defaults before an offline pull", async () => {
    const persister = new MemoryPersister();
    // These rows predate mention/filter columns; the serialized cache contains no new defaults.
    await persister.save(
      JSON.parse(
        JSON.stringify({
          clientId: "legacy-inbox-cache",
          userId: BOB.id,
          branchId: "main",
          seq: 1,
          lastMutationId: 0,
          pending: [],
          rows: {
            comment: [
              {
                id: COMMENT,
                issueId: ISSUE,
                teamId: TEAM,
                body: "Cached discussion",
                userId: ALICE.id,
                createdAt: NOW,
                updatedAt: NOW,
              },
            ],
            notificationSubscription: [
              { id: id(90), subscriberId: BOB.id, active: true, createdAt: NOW, updatedAt: NOW },
            ],
          },
        }),
      ),
    );
    const offline = async (): Promise<never> => {
      throw new Error("offline");
    };
    const client = new SyncClient({
      actor: BOB,
      mutators,
      persister,
      transport: { bootstrap: offline, pull: offline, push: offline, load: offline },
    });
    await expect(client.start()).rejects.toThrow("offline");
    expect(client.get("comment", COMMENT)?.mentionedUserIds).toEqual([]);
    expect(client.get("notificationSubscription", id(90))).toMatchObject({
      scope: { kind: "workspace" },
      eventTypes: [],
      actors: [],
    });
    await client.flushPersistence();
    expect((await persister.load())?.rows.notificationSubscription).toMatchObject([
      { scope: { kind: "workspace" }, eventTypes: [], actors: [] },
    ]);
  });
});
