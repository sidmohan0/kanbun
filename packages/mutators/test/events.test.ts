import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@kanbun/events";
import { modelNames } from "@kanbun/model";
import { MemoryStore, issueIncarnation, type MutatorContext, type Store } from "@kanbun/sync";
import { SyncServer, SYSTEM_ACTOR } from "@kanbun/sync/server";
import { MemoryPersister, SyncClient } from "@kanbun/sync/client";
import { openWorkspaceDb } from "@kanbun/sync/server/node";
import { applyCommentEvent, applyIssueEvent, mutators } from "../src";

const id = (n: number) => `019a0000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const ALICE = { id: "alice", type: "user" } as const;
const BOB = { id: "bob", type: "user" } as const;
const TEAM = id(2);
const LABEL = id(9);
const ISSUE = id(10);
const CREATED = "2026-10-29T12:00:00.000Z";
const TITLED = "2026-10-29T13:00:00.000Z";
const STATES = { backlog: id(3), todo: id(4), inProgress: id(5), done: id(6), canceled: id(7) };

/** Configuration is the fixed prerequisite; these two issue facts are the replay input. */
const GOLDEN: DomainEvent[] = [
  {
    type: "IssueCreated",
    seq: 41,
    eventIndex: 0,
    branchId: "main",
    txnId: "golden-create",
    entityType: "issue",
    entityId: ISSUE,
    teamId: TEAM,
    scopeUserId: null,
    actor: ALICE,
    clientId: "golden-client",
    mutationId: 1,
    sessionId: null,
    sourceRef: null,
    causationSeq: null,
    reason: "Plan a launch",
    ts: Date.parse(CREATED),
    payload: {
      number: 8,
      title: "Draft launch",
      description: "A recorded initial description",
      descriptionContentId: null,
      priority: 2,
      prioritySortOrder: "a0",
      estimate: 3,
      dueDate: "2026-11-02",
      sortOrder: "a0",
      boardOrder: "a0",
      subIssueSortOrder: null,
      stateId: STATES.backlog,
      assigneeId: BOB.id,
      creatorId: ALICE.id,
      parentId: null,
      projectId: null,
      projectMilestoneId: null,
      cycleId: null,
      sourceCommentId: null,
      startedAt: null,
      completedAt: null,
      canceledAt: null,
      triagedAt: null,
      startedTriageAt: null,
      addedToTeamAt: CREATED,
      addedToProjectAt: null,
      addedToCycleAt: null,
      labelLinks: [{ id: id(11), labelId: LABEL }],
      subscriptions: [
        { id: id(12), userId: ALICE.id },
        { id: id(13), userId: BOB.id },
      ],
    },
  },
  {
    type: "IssueTitled",
    seq: 42,
    eventIndex: 0,
    branchId: "main",
    txnId: "golden-rename",
    entityType: "issue",
    entityId: ISSUE,
    teamId: TEAM,
    scopeUserId: null,
    actor: BOB,
    clientId: "golden-client",
    mutationId: 2,
    sessionId: null,
    sourceRef: null,
    causationSeq: 41,
    reason: null,
    ts: Date.parse(TITLED),
    payload: { title: "Ship launch" },
  },
];

function fixture(path?: string) {
  const { db, driver } = openWorkspaceDb(path);
  const server = new SyncServer({ driver, mutators, now: () => CREATED });
  server.system("workspaceInit", {
    organization: { id: id(1), name: "Kanbun", urlKey: "kanbun" },
    owner: { id: ALICE.id, name: "Alice", email: "alice@example.com" },
  });
  server.system("memberSync", { id: BOB.id, name: "Bob", email: "bob@example.com" });
  const result = server.push(ALICE, {
    clientId: "seed",
    mutations: [
      {
        id: 1,
        name: "teamCreate",
        ts: CREATED,
        args: { id: TEAM, name: "Launch", key: "LAUNCH", stateIds: STATES, membershipId: id(8) },
      },
      {
        id: 2,
        name: "issueLabelCreate",
        ts: CREATED,
        args: { id: LABEL, teamId: TEAM, name: "Release", color: "#123456" },
      },
    ],
  });
  expect(result.ok && result.rejected).toEqual([]);
  return { db, driver, server };
}

function context(store: Store): MutatorContext {
  // Replay must use the recorded event timestamp, sequence, and number, not this context.
  return { store, actor: ALICE, actorId: ALICE.id, now: "2040-01-01T00:00:00.000Z", server: false };
}

function projection(store: Store) {
  return Object.fromEntries(
    modelNames.map((model) => [model, store.list(model).sort((a, b) => a.id.localeCompare(b.id))]),
  );
}

function copyProjection(from: Store, to: MemoryStore) {
  for (const model of modelNames) for (const row of from.list(model)) to.insert(model, structuredClone(row));
}

function create(issueId: string, subscriptionId: string) {
  return { id: issueId, teamId: TEAM, title: "Recorded issue", subscriptionId };
}

function push(server: SyncServer, mutationId: number, name: string, args: unknown) {
  return server.push(ALICE, {
    clientId: "issue-client",
    mutations: [{ id: mutationId, name, args, ts: CREATED }],
  });
}

describe("semantic issue events", () => {
  it("does not deliver an old queued private comment into a recreated public issue", () => {
    const { db, server } = fixture();
    try {
      expect(
        server.push(ALICE, {
          clientId: "older-visible",
          mutations: [{ id: 1, name: "issueCreate", ts: CREATED, args: create(id(852), id(853)) }],
        }),
      ).toMatchObject({ ok: true, rejected: [] });
      push(server, 1, "teamUpdate", { id: TEAM, patch: { visibility: "private" } });
      push(server, 2, "issueCreate", create(ISSUE, id(12)));
      const previous = issueIncarnation(server.store.get("issue", ISSUE)!);
      const queued = {
        id: id(850),
        issueId: ISSUE,
        issueIncarnation: previous,
        body: "Private draft must stay private",
      };
      expect(
        server.push(ALICE, {
          clientId: "old-private-comment",
          mutations: [
            {
              id: 1,
              name: "commentCreate",
              ts: CREATED,
              args: { id: id(851), issueId: ISSUE, body: "Deleted private history" },
            },
          ],
        }),
      ).toMatchObject({ ok: true, rejected: [] });
      push(server, 3, "issueTrash", { id: ISSUE, trashed: true });
      push(server, 4, "issueDelete", { id: ISSUE });
      push(server, 5, "teamUpdate", { id: TEAM, patch: { visibility: "public" } });
      expect(push(server, 6, "issueCreate", create(ISSUE, id(13)))).toMatchObject({ ok: true, rejected: [] });
      expect(issueIncarnation(server.store.get("issue", ISSUE)!)).not.toBe(previous);
      expect(push(server, 7, "commentCreate", queued)).toMatchObject({ ok: true, rejected: [{ id: 7 }] });
      expect(server.store.list("comment", { issueId: ISSUE })).toEqual([]);
      expect(server.events(BOB, { issueId: ISSUE }).some((event) => event.type === "CommentPosted")).toBe(false);
      expect(server.events(ALICE, { issueId: ISSUE }).map((event) => event.type)).toEqual(["IssueCreated"]);
      expect(server.events(ALICE, { order: "desc", limit: 2 }).map((event) => event.entityId)).toEqual([
        ISSUE,
        id(852),
      ]);
      expect(server.activity(ALICE, { model: "issue", limit: 2 }).map((row) => row.id)).toEqual([ISSUE, id(852)]);
    } finally {
      db.close();
    }
  });
  it("rolls back a comment and its fact after a late subscription failure and refuses comment branches", () => {
    const { db, server } = fixture();
    try {
      push(server, 1, "issueCreate", create(ISSUE, id(12)));
      const before = projection(server.store);
      const facts = server.events(ALICE);
      // Alice already owns this identifier; Bob's finalized subscriber write fails after CommentPosted.
      expect(
        server.push(BOB, {
          clientId: "late-comment",
          mutations: [
            {
              id: 1,
              name: "commentCreate",
              ts: CREATED,
              args: { id: id(800), issueId: ISSUE, body: "Must roll back", subscriptionId: id(12) },
            },
          ],
        }),
      ).toMatchObject({ ok: true, rejected: [{ id: 1 }] });
      expect(projection(server.store)).toEqual(before);
      expect(server.events(ALICE)).toEqual(facts);
      const branchId = id(801);
      server.createBranch(ALICE, { id: branchId, name: "Discussion is main only" });
      expect(
        server.push(ALICE, {
          branchId,
          clientId: "branch-comment",
          mutations: [
            { id: 1, name: "commentCreate", ts: CREATED, args: { id: id(802), issueId: ISSUE, body: "Not supported" } },
          ],
        }),
      ).toMatchObject({ ok: true, rejected: [{ id: 1 }] });
      expect(server.store.get("comment", id(802))).toBeUndefined();
      expect(server.events(ALICE, { branchId }).map((event) => event.type)).toEqual(["BranchCreated"]);
    } finally {
      db.close();
    }
  });
  it("replays independent discussion facts and their finalized subscription in memory and SQLite", () => {
    const { db, server } = fixture();
    try {
      server.system("memberSync", { id: "reader", name: "Reader", email: "reader@example.com" });
      const memory = new MemoryStore();
      copyProjection(server.store, memory);
      const base = GOLDEN[1]!;
      if (base.type !== "IssueTitled") throw new Error("Golden title missing");
      const root = id(500),
        reply = id(501);
      const posted: Extract<DomainEvent, { type: "CommentPosted" }> = {
        ...base,
        type: "CommentPosted" as const,
        entityType: "comment" as const,
        entityId: root,
        seq: 43,
        actor: BOB,
        scopeUserId: null,
        payload: {
          issueId: ISSUE,
          body: "A recorded decision",
          bodyData: null,
          parentId: null,
          quotedText: "launch",
          userId: BOB.id,
          agentId: null,
        },
      };
      const facts: DomainEvent[] = [
        GOLDEN[0]!,
        posted,
        {
          ...posted,
          entityId: reply,
          seq: 44,
          actor: ALICE,
          payload: { ...posted.payload, body: "Agreed", parentId: root, userId: ALICE.id, quotedText: null },
        },
        {
          ...posted,
          type: "CommentEdited",
          seq: 45,
          payload: { issueId: ISSUE, body: "A corrected decision", bodyData: null },
        },
        {
          ...posted,
          type: "CommentResolved",
          seq: 46,
          actor: ALICE,
          payload: { issueId: ISSUE, resolved: true, resolvingUserId: ALICE.id, resolvingCommentId: reply },
        },
        { ...base, type: "SubscriberAdded", seq: 47, payload: { id: id(502), userId: "reader" } },
      ];
      for (const event of facts)
        for (const store of [memory, server.store]) {
          if (event.entityType === "comment") applyCommentEvent(context(store), event);
          else applyIssueEvent(context(store), event);
        }
      expect(projection(memory)).toEqual(projection(server.store));
      expect(memory.get("comment", root)).toMatchObject({
        body: "A corrected decision",
        bodyData: null,
        userId: BOB.id,
        agentId: null,
        issueId: ISSUE,
        teamId: TEAM,
        quotedText: "launch",
        parentId: null,
        createdAt: TITLED,
        editedAt: TITLED,
        resolvedAt: TITLED,
        resolvingUserId: ALICE.id,
        resolvingCommentId: reply,
      });
      expect(memory.get("comment", reply)).toMatchObject({ body: "Agreed", parentId: root, userId: ALICE.id });
      expect(memory.get("issueSubscription", id(502))).toMatchObject({
        issueId: ISSUE,
        userId: "reader",
        teamId: TEAM,
      });
      const reopen: DomainEvent = {
        ...posted,
        type: "CommentResolved",
        seq: 48,
        payload: { issueId: ISSUE, resolved: false, resolvingUserId: null, resolvingCommentId: null },
      };
      for (const store of [memory, server.store]) applyCommentEvent(context(store), reopen);
      expect(projection(memory)).toEqual(projection(server.store));
      expect(memory.get("comment", root)).toMatchObject({
        resolvedAt: null,
        resolvingUserId: null,
        resolvingCommentId: null,
      });
      expect(memory.get("issue", ISSUE)).toMatchObject({ updatedSeq: 48, updatedAt: TITLED });
    } finally {
      db.close();
    }
  });

  it("attributes discussion facts, scopes and pages issue history, and rejects invalid edits atomically", () => {
    const { db, server } = fixture();
    try {
      push(server, 1, "issueCreate", create(ISSUE, id(12)));
      push(server, 2, "issueCreate", create(id(600), id(601)));
      const request = {
        clientId: "bob-comments",
        mutations: [
          {
            id: 1,
            name: "commentCreate",
            ts: CREATED,
            args: { id: id(602), issueId: ISSUE, body: "Bob's context", subscriptionId: id(603) },
          },
        ],
      };
      expect(server.push(BOB, request)).toMatchObject({ ok: true, rejected: [] });
      expect(server.push(BOB, request)).toMatchObject({ ok: true, rejected: [] });
      const facts = server.events(ALICE, { issueId: ISSUE });
      expect(facts.map((event) => event.type)).toEqual(["IssueCreated", "CommentPosted", "SubscriberAdded"]);
      expect(facts[1]).toMatchObject({ actor: BOB, entityId: id(602), payload: { userId: BOB.id, issueId: ISSUE } });
      const latest = server.events(ALICE, { issueId: ISSUE, order: "desc", limit: 2 });
      expect(latest.map((event) => event.type)).toEqual(["SubscriberAdded", "CommentPosted"]);
      expect(
        server.events(ALICE, { issueId: ISSUE, order: "desc", before: latest[1]!.seq, limit: 2 }).map((e) => e.type),
      ).toEqual(["IssueCreated"]);
      const before = projection(server.store);
      expect(push(server, 3, "commentUpdate", { id: id(602), body: "Stolen" })).toMatchObject({
        ok: true,
        rejected: [{ id: 3 }],
      });
      expect(
        server.push(BOB, {
          clientId: request.clientId,
          mutations: [{ id: 2, name: "commentUpdate", ts: CREATED, args: { id: id(602), body: "   " } }],
        }),
      ).toMatchObject({ ok: true, rejected: [{ id: 2 }] });
      expect(projection(server.store)).toEqual(before);
      expect(server.events(ALICE, { issueId: ISSUE })).toEqual(facts);
      expect(
        push(server, 4, "commentCreate", { id: id(604), issueId: ISSUE, parentId: id(602), body: "Reply" }),
      ).toMatchObject({ ok: true, rejected: [] });
      expect(
        push(server, 5, "commentCreate", { id: id(605), issueId: ISSUE, parentId: id(604), body: "Too deep" }),
      ).toMatchObject({ ok: true, rejected: [{ id: 5 }] });
      expect(push(server, 6, "commentResolve", { id: id(604), resolved: true })).toMatchObject({
        ok: true,
        rejected: [{ id: 6 }],
      });
      expect(push(server, 7, "commentCreate", { id: id(606), issueId: id(600), body: "Other issue" })).toMatchObject({
        ok: true,
        rejected: [],
      });
      expect(
        push(server, 8, "commentResolve", { id: id(602), resolved: true, resolvingCommentId: id(606) }),
      ).toMatchObject({ ok: true, rejected: [{ id: 8 }] });
      server.system("memberSync", { id: BOB.id, name: "Bob", email: "bob@example.com", active: false });
      expect(
        server.push(BOB, {
          clientId: request.clientId,
          mutations: [
            { id: 3, name: "commentCreate", ts: CREATED, args: { id: id(607), issueId: ISSUE, body: "Inactive" } },
          ],
        }),
      ).toMatchObject({ ok: true, rejected: [{ id: 3 }] });
    } finally {
      db.close();
    }
  });
  it("remaps deleted workflow baseline and assertion references without changing an unrelated effective status", () => {
    const { db, server } = fixture();
    try {
      expect(push(server, 1, "issueCreate", create(ISSUE, id(12)))).toMatchObject({ ok: true, rejected: [] });
      expect(push(server, 2, "issueUpdate", { id: ISSUE, patch: { stateId: STATES.done } })).toMatchObject({
        ok: true,
        rejected: [],
      });
      expect(
        push(server, 3, "workflowStateDelete", { id: STATES.backlog, moveIssuesToStateId: STATES.todo }),
      ).toMatchObject({ ok: true, rejected: [] });
      expect(server.store.get("issue", ISSUE)).toMatchObject({
        derivedStateId: STATES.todo,
        assertedStateId: STATES.done,
        stateId: STATES.done,
        completedAt: CREATED,
      });
      expect(server.store.get("team", TEAM)?.defaultIssueStateId).toBe(STATES.todo);
      expect(push(server, 4, "issueAssertStatus", { id: ISSUE, stateId: null })).toMatchObject({
        ok: true,
        rejected: [],
      });
      expect(server.store.get("issue", ISSUE)).toMatchObject({
        stateId: STATES.todo,
        assertedStateId: null,
        completedAt: null,
      });
      expect(push(server, 5, "issueUpdate", { id: ISSUE, patch: { stateId: STATES.done } })).toMatchObject({
        ok: true,
        rejected: [],
      });
      expect(
        push(server, 6, "workflowStateDelete", { id: STATES.done, moveIssuesToStateId: STATES.inProgress }),
      ).toMatchObject({ ok: true, rejected: [] });
      expect(server.store.get("issue", ISSUE)).toMatchObject({
        stateId: STATES.inProgress,
        assertedStateId: STATES.inProgress,
        derivedStateId: STATES.todo,
        completedAt: null,
        startedAt: CREATED,
      });
      expect(push(server, 7, "issueAssertStatus", { id: ISSUE, stateId: null })).toMatchObject({
        ok: true,
        rejected: [],
      });
      expect(server.store.get("issue", ISSUE)?.stateId).toBe(STATES.todo);
      const archivedTarget = push(server, 8, "workflowStateDelete", {
        id: STATES.todo,
        moveIssuesToStateId: STATES.done,
      });
      expect(archivedTarget.ok && archivedTarget.rejected).toMatchObject([
        { id: 8, error: expect.stringMatching(/active state/) },
      ]);
      const invalidDefault = push(server, 9, "teamUpdate", { id: TEAM, patch: { defaultIssueStateId: STATES.done } });
      expect(invalidDefault.ok && invalidDefault.rejected).toMatchObject([
        { id: 9, error: expect.stringMatching(/active/) },
      ]);
    } finally {
      db.close();
    }
  });

  it("keeps private-team moves atomic with assignment eligibility and remaps the status baseline", () => {
    const { db, server } = fixture();
    try {
      expect(push(server, 1, "issueCreate", create(ISSUE, id(12)))).toMatchObject({ ok: true, rejected: [] });
      expect(push(server, 2, "issueUpdate", { id: ISSUE, patch: { assigneeId: BOB.id } })).toMatchObject({
        ok: true,
        rejected: [],
      });
      const otherTeam = id(100);
      const states = { backlog: id(101), todo: id(102), inProgress: id(103), done: id(104), canceled: id(105) };
      expect(
        push(server, 3, "teamCreate", {
          id: otherTeam,
          name: "Private",
          key: "PRIV",
          visibility: "private",
          membershipId: id(106),
          stateIds: states,
        }),
      ).toMatchObject({ ok: true, rejected: [] });
      const before = projection(server.store);
      const history = server.events(ALICE);
      const denied = push(server, 4, "issueUpdate", { id: ISSUE, patch: { teamId: otherTeam, title: "Cannot move" } });
      expect(denied.ok && denied.rejected).toMatchObject([{ id: 4, error: expect.stringMatching(/private team/) }]);
      expect(projection(server.store)).toEqual(before);
      expect(server.events(ALICE)).toEqual(history);
      expect(
        push(server, 5, "issueUpdate", {
          id: ISSUE,
          patch: { teamId: otherTeam, title: "Moved safely", assigneeId: null, priority: 3 },
        }),
      ).toMatchObject({ ok: true, rejected: [] });
      expect(server.store.get("issue", ISSUE)).toMatchObject({
        teamId: otherTeam,
        title: "Moved safely",
        assigneeId: null,
        priority: 3,
        stateId: states.backlog,
        derivedStateId: states.backlog,
        assertedStateId: null,
      });
      expect(
        server
          .events(ALICE)
          .slice(-3)
          .map((event) => event.teamId),
      ).toEqual([otherTeam, otherTeam, otherTeam]);
      expect(push(server, 6, "issueAssertStatus", { id: ISSUE, stateId: null })).toMatchObject({
        ok: true,
        rejected: [],
      });
    } finally {
      db.close();
    }
  });

  it("discards the optimistic legacy remainder and facts together after a late local failure", async () => {
    const { db, server } = fixture();
    try {
      expect(push(server, 1, "issueCreate", create(ISSUE, id(12)))).toMatchObject({ ok: true, rejected: [] });
      const client = new SyncClient({
        actor: ALICE,
        mutators,
        persister: new MemoryPersister(),
        clientId: "scratch-controls",
        transport: {
          bootstrap: async (clientId) => server.bootstrap(ALICE, clientId),
          push: async (request) => server.push(ALICE, request),
          pull: async (request) => server.pull(ALICE, request),
          load: async (request) => server.load(ALICE, request),
        },
      });
      await client.start();
      const before = projection(client.view);
      expect(() =>
        client.mutate("issueUpdate", {
          id: ISSUE,
          patch: {
            title: "Uncommitted",
            priority: 3,
            stateId: STATES.done,
            assigneeId: BOB.id,
            estimate: 8,
          },
          assigneeSubscriptionId: id(12),
        }),
      ).toThrow(/already exists/);
      expect(projection(client.view)).toEqual(before);
      expect(client.pendingCount()).toBe(0);
    } finally {
      db.close();
    }
  });

  it("rejects unsupported branch controls even when their requested value is already present", () => {
    const { db, server } = fixture();
    try {
      expect(push(server, 1, "issueCreate", create(ISSUE, id(12)))).toMatchObject({ ok: true, rejected: [] });
      const branchId = id(90);
      server.createBranch(ALICE, { id: branchId, name: "Title-only branch" });
      const history = server.events(ALICE, { branchId });
      const result = server.push(ALICE, {
        clientId: "unsupported-controls",
        branchId,
        mutations: [
          {
            id: 1,
            name: "issueUpdate",
            args: { id: ISSUE, patch: { title: "Must not apply", priority: 0 } },
            ts: CREATED,
          },
          { id: 2, name: "issueArchive", args: { id: ISSUE, archived: false }, ts: CREATED },
          { id: 3, name: "issueLabelsSet", args: { issueId: ISSUE, add: [], remove: [] }, ts: CREATED },
          { id: 4, name: "issueAssertStatus", args: { id: ISSUE, stateId: STATES.done }, ts: CREATED },
        ],
      });
      expect(result.ok && result.rejected.map((rejection) => rejection.id)).toEqual([1, 2, 3, 4]);
      expect(server.events(ALICE, { branchId })).toEqual(history);
      expect(server.store.get("issue", ISSUE)?.title).toBe("Recorded issue");
    } finally {
      db.close();
    }
  });

  it("preserves mixed core and legacy issue updates atomically while recording granular human facts", () => {
    const { db, server } = fixture();
    try {
      expect(push(server, 1, "issueCreate", create(ISSUE, id(12)))).toMatchObject({ ok: true, rejected: [] });
      const args = {
        id: ISSUE,
        patch: {
          title: "Mixed update",
          priority: 2,
          stateId: STATES.done,
          assigneeId: BOB.id,
          estimate: 5,
          dueDate: "2026-12-01",
          projectId: id(30),
        },
        assigneeSubscriptionId: id(13),
      };
      expect(push(server, 2, "issueUpdate", args)).toMatchObject({ ok: true, rejected: [] });
      expect(server.store.get("issue", ISSUE)).toMatchObject({
        ...args.patch,
        assertedStateId: STATES.done,
        derivedStateId: STATES.backlog,
        completedAt: CREATED,
      });
      const facts = server.events(ALICE).slice(1);
      expect(facts.map((event) => event.type)).toEqual([
        "IssueTitled",
        "IssuePrioritized",
        "HumanAssertedStatus",
        "IssueAssigned",
        "SubscriberAdded",
      ]);
      expect(
        facts.every(
          (event) => event.actor.id === ALICE.id && event.mutationId === 2 && event.txnId === facts[0]!.txnId,
        ),
      ).toBe(true);
      expect(server.store.get("issueSubscription", id(13))).toMatchObject({ userId: BOB.id, issueId: ISSUE });
      const history = server.events(ALICE);
      expect(push(server, 2, "issueUpdate", args)).toMatchObject({ ok: true, rejected: [] });
      expect(server.events(ALICE)).toEqual(history);
      expect(push(server, 3, "issueAssertStatus", { id: ISSUE, stateId: null })).toMatchObject({
        ok: true,
        rejected: [],
      });
      expect(server.store.get("issue", ISSUE)).toMatchObject({
        assertedStateId: null,
        stateId: STATES.backlog,
        completedAt: null,
      });
    } finally {
      db.close();
    }
  });

  it("rolls back the legacy remainder and every earlier fact after a late subscription failure", () => {
    const { db, server } = fixture();
    try {
      expect(push(server, 1, "issueCreate", create(ISSUE, id(12)))).toMatchObject({ ok: true, rejected: [] });
      const before = projection(server.store);
      const history = server.events(ALICE);
      const cursor = server.currentSeq();
      const result = push(server, 2, "issueUpdate", {
        id: ISSUE,
        patch: {
          title: "Must roll back",
          priority: 3,
          stateId: STATES.done,
          assigneeId: BOB.id,
          estimate: 8,
          dueDate: "2026-12-02",
        },
        assigneeSubscriptionId: id(12),
      });
      expect(result.ok && result.rejected).toMatchObject([
        { id: 2, error: expect.stringMatching(/already exists|UNIQUE/i) },
      ]);
      expect(projection(server.store)).toEqual(before);
      expect(server.events(ALICE)).toEqual(history);
      expect(server.currentSeq()).toBe(cursor);
      const invalidRemainder = push(server, 3, "issueUpdate", {
        id: ISSUE,
        patch: { title: "Also roll back", parentId: ISSUE },
      });
      expect(invalidRemainder.ok && invalidRemainder.rejected).toMatchObject([
        { id: 3, error: expect.stringMatching(/own parent/) },
      ]);
      expect(projection(server.store)).toEqual(before);
      expect(server.events(ALICE)).toEqual(history);
    } finally {
      db.close();
    }
  });

  it("records single-select replacement and archive Undo, and rejects inactive or foreign control values", () => {
    const { db, server } = fixture();
    try {
      expect(push(server, 1, "issueCreate", create(ISSUE, id(12)))).toMatchObject({ ok: true, rejected: [] });
      const group = id(60);
      const first = id(61);
      const second = id(62);
      expect(
        push(server, 2, "issueLabelCreate", {
          id: group,
          name: "Area",
          color: "#123456",
          isGroup: true,
          groupType: "single",
        }),
      ).toMatchObject({ ok: true, rejected: [] });
      expect(
        push(server, 3, "issueLabelCreate", { id: first, name: "Web", parentId: group, color: "#123456" }),
      ).toMatchObject({ ok: true, rejected: [] });
      expect(
        push(server, 4, "issueLabelCreate", { id: second, name: "API", parentId: group, color: "#123456" }),
      ).toMatchObject({ ok: true, rejected: [] });
      expect(
        push(server, 5, "issueLabelsSet", { issueId: ISSUE, add: [{ labelId: first, linkId: id(63) }], remove: [] }),
      ).toMatchObject({ ok: true, rejected: [] });
      expect(
        push(server, 6, "issueLabelsSet", { issueId: ISSUE, add: [{ labelId: second, linkId: id(64) }], remove: [] }),
      ).toMatchObject({ ok: true, rejected: [] });
      expect(
        server
          .events(ALICE)
          .slice(-2)
          .map((event) => event.type),
      ).toEqual(["LabelRemoved", "LabelAdded"]);
      expect(server.store.list("issueLabelLink", { issueId: ISSUE })).toMatchObject([{ labelId: second }]);
      expect(push(server, 7, "issueArchive", { id: ISSUE, archived: true })).toMatchObject({ ok: true, rejected: [] });
      expect(server.store.get("issue", ISSUE)?.archivedAt).toBe(CREATED);
      expect(push(server, 8, "issueArchive", { id: ISSUE, archived: false })).toMatchObject({ ok: true, rejected: [] });
      expect(server.events(ALICE).at(-1)?.type).toBe("IssueRestored");
      expect(server.store.get("issue", ISSUE)?.archivedAt).toBeNull();
      server.system("memberSync", { id: BOB.id, name: "Bob", email: "bob@example.com", active: false });
      const inactive = push(server, 9, "issueUpdate", { id: ISSUE, patch: { assigneeId: BOB.id } });
      expect(inactive.ok && inactive.rejected).toMatchObject([
        { id: 9, error: expect.stringMatching(/active member/) },
      ]);
      server.system("memberSync", { id: BOB.id, name: "Bob", email: "bob@example.com", active: true });
      server.store.patch("team", TEAM, { visibility: "private" });
      const privateAssignee = push(server, 10, "issueUpdate", { id: ISSUE, patch: { assigneeId: BOB.id } });
      expect(privateAssignee.ok && privateAssignee.rejected).toMatchObject([
        { id: 10, error: expect.stringMatching(/private team/) },
      ]);
      server.store.patch("workflowState", STATES.done, { teamId: id(99) });
      const foreignState = push(server, 11, "issueUpdate", { id: ISSUE, patch: { title: "No", stateId: STATES.done } });
      expect(foreignState.ok && foreignState.rejected).toMatchObject([{ id: 11, error: "state not in team" }]);
      server.store.patch("issueLabel", first, { teamId: id(99) });
      const foreignLabel = push(server, 12, "issueLabelsSet", {
        issueId: ISSUE,
        add: [{ labelId: first, linkId: id(65) }],
        remove: [],
      });
      expect(foreignLabel.ok && foreignLabel.rejected).toMatchObject([
        { id: 12, error: expect.stringMatching(/another team/) },
      ]);
      const blankLabel = push(server, 13, "issueLabelCreate", { id: id(66), name: "  ", color: "#123456" });
      expect(blankLabel.ok && blankLabel.rejected).toMatchObject([{ id: 13, error: "label name is required" }]);
    } finally {
      db.close();
    }
  });

  it("replays independently recorded controls, subscription, labels and archive Undo in memory and SQLite", () => {
    const { db, server } = fixture();
    try {
      const created = GOLDEN[0]!;
      const titled = GOLDEN[1]!;
      if (created.type !== "IssueCreated" || titled.type !== "IssueTitled")
        throw new Error("Golden issue input missing");
      const memory = new MemoryStore();
      copyProjection(server.store, memory);
      const base = { ...titled, txnId: "golden-controls" };
      const facts: DomainEvent[] = [
        {
          ...created,
          payload: { ...created.payload, assigneeId: null, subscriptions: [{ id: id(12), userId: ALICE.id }] },
        },
        { ...base, type: "IssuePrioritized", seq: 43, payload: { priority: 3 } },
        {
          ...base,
          type: "HumanAssertedStatus",
          seq: 44,
          payload: {
            stateId: STATES.done,
            derivedStateId: STATES.backlog,
            effectiveStateId: STATES.done,
            boardOrder: "a7",
            startedAt: null,
            completedAt: TITLED,
            canceledAt: null,
            triagedAt: CREATED,
            startedTriageAt: null,
          },
        },
        { ...base, type: "IssueAssigned", seq: 45, payload: { assigneeId: BOB.id } },
        { ...base, type: "SubscriberAdded", seq: 46, payload: { id: id(13), userId: BOB.id } },
        { ...base, type: "LabelRemoved", seq: 47, payload: { labelId: LABEL, linkId: id(11) } },
        { ...base, type: "LabelAdded", seq: 48, payload: { labelId: LABEL, linkId: id(14) } },
        { ...base, type: "IssueArchived", seq: 49, payload: {} },
      ];
      for (const event of facts) {
        applyIssueEvent(context(memory), event);
        applyIssueEvent(context(server.store), event);
      }
      expect(projection(memory)).toEqual(projection(server.store));
      expect(memory.get("issue", ISSUE)).toMatchObject({
        priority: 3,
        assertedStateId: STATES.done,
        derivedStateId: STATES.backlog,
        stateId: STATES.done,
        assigneeId: BOB.id,
        boardOrder: "a7",
        completedAt: TITLED,
        archivedAt: TITLED,
        createdSeq: 41,
        updatedSeq: 49,
      });
      expect(memory.list("issueLabelLink", { issueId: ISSUE })).toMatchObject([
        { id: id(14), labelId: LABEL, teamId: TEAM, createdAt: TITLED },
      ]);
      expect(memory.get("issueSubscription", id(13))).toMatchObject({
        issueId: ISSUE,
        userId: BOB.id,
        teamId: TEAM,
        createdAt: TITLED,
      });
      const undo: DomainEvent[] = [
        { ...base, type: "IssueRestored", seq: 50, payload: { from: "archive" } },
        { ...base, type: "IssueUnassigned", seq: 51, payload: {} },
        {
          ...base,
          type: "HumanAssertedStatus",
          seq: 52,
          payload: {
            stateId: null,
            derivedStateId: STATES.backlog,
            effectiveStateId: STATES.backlog,
            boardOrder: "a8",
            startedAt: null,
            completedAt: null,
            canceledAt: null,
            triagedAt: CREATED,
            startedTriageAt: null,
          },
        },
      ];
      for (const event of undo) {
        applyIssueEvent(context(memory), event);
        applyIssueEvent(context(server.store), event);
      }
      expect(projection(memory)).toEqual(projection(server.store));
      expect(memory.get("issue", ISSUE)).toMatchObject({
        stateId: STATES.backlog,
        assertedStateId: null,
        derivedStateId: STATES.backlog,
        assigneeId: null,
        archivedAt: null,
        completedAt: null,
        updatedSeq: 52,
      });
    } finally {
      db.close();
    }
  });

  it("replays an independently recorded description and deletion mirror identically in memory and SQLite", () => {
    const { db, server } = fixture();
    try {
      const memory = new MemoryStore();
      copyProjection(server.store, memory);
      const titled = GOLDEN[1]!;
      if (titled.type !== "IssueTitled") throw new Error("Golden title event is missing");
      const described: Extract<DomainEvent, { type: "IssueDescribed" }> = {
        ...titled,
        type: "IssueDescribed",
        seq: 43,
        txnId: "golden-description",
        payload: { description: "A jointly authored plan", descriptionContentId: ISSUE, contentState: "a".repeat(64) },
      };
      const cleared: Extract<DomainEvent, { type: "IssueDescribed" }> = {
        ...described,
        seq: 44,
        txnId: "golden-cleared",
        ts: Date.parse("2026-10-29T14:00:00.000Z"),
        payload: { description: "", descriptionContentId: ISSUE, contentState: "b".repeat(64) },
      };
      for (const event of [...structuredClone(GOLDEN), described]) {
        applyIssueEvent(context(memory), event);
        applyIssueEvent(context(server.store), event);
      }
      expect(projection(memory)).toEqual(projection(server.store));
      expect(memory.get("issue", ISSUE)).toMatchObject({
        description: "A jointly authored plan",
        descriptionContentId: ISSUE,
        updatedSeq: 43,
      });
      expect(memory.get("documentContent", ISSUE)).toMatchObject({
        id: ISSUE,
        issueId: ISSUE,
        teamId: TEAM,
        content: "A jointly authored plan",
        contentState: "a".repeat(64),
        createdAt: TITLED,
        updatedAt: TITLED,
      });
      for (const store of [memory, server.store]) applyIssueEvent(context(store), cleared);
      expect(projection(memory)).toEqual(projection(server.store));
      expect(memory.get("documentContent", ISSUE)).toMatchObject({
        content: "",
        contentState: "b".repeat(64),
        createdAt: TITLED,
      });
      expect(memory.get("issue", ISSUE)).toMatchObject({ description: "", updatedSeq: 44 });
    } finally {
      db.close();
    }
  });

  it("rebuilds the same issue projection from a fixed create/rename log in memory and SQLite", () => {
    const { db, server } = fixture();
    try {
      server.store.patch("team", TEAM, { issueCounter: 7 });
      const memory = new MemoryStore();
      copyProjection(server.store, memory);
      for (const event of structuredClone(GOLDEN)) {
        applyIssueEvent(context(memory), event);
        applyIssueEvent(context(server.store), event);
      }
      expect(projection(memory)).toEqual(projection(server.store));
      expect(memory.get("issue", ISSUE)).toMatchObject({
        title: "Ship launch",
        number: 8,
        createdAt: CREATED,
        updatedAt: TITLED,
        createdSeq: 41,
        updatedSeq: 42,
        priority: 2,
        estimate: 3,
        assigneeId: BOB.id,
      });
      expect(memory.get("team", TEAM)?.issueCounter).toBe(8);
      expect(memory.list("issueLabelLink", { issueId: ISSUE })).toMatchObject([
        { id: id(11), labelId: LABEL, teamId: TEAM, createdAt: CREATED },
      ]);
      expect(
        memory
          .list("issueSubscription", { issueId: ISSUE })
          .map((row) => row.userId)
          .sort(),
      ).toEqual([ALICE.id, BOB.id]);
    } finally {
      db.close();
    }
  });

  it("records finalized creation facts and ignores the identical retry after reopening SQLite", () => {
    const directory = mkdtempSync(join(tmpdir(), "kanbun-events-"));
    const path = join(directory, "workspace.sqlite");
    let opened = fixture(path);
    try {
      const replay = new MemoryStore();
      copyProjection(opened.server.store, replay);
      const args = {
        ...create(ISSUE, id(12)),
        title: "  Recorded issue  ",
        description: "Initial text",
        descriptionContentId: ISSUE,
        priority: 2,
        estimate: 5,
        dueDate: "2026-11-03",
        position: "top",
        assigneeId: BOB.id,
        assigneeSubscriptionId: id(13),
        labelIds: [LABEL],
        labelLinkIds: [id(11)],
      };
      expect(push(opened.server, 1, "issueCreate", args)).toMatchObject({ ok: true, rejected: [] });
      expect(
        push(opened.server, 2, "issueUpdate", { id: ISSUE, patch: { title: "Titled from events" } }),
      ).toMatchObject({ ok: true, rejected: [] });
      const events = opened.server.events(ALICE);
      expect(events.map((event) => event.type)).toEqual(["IssueCreated", "IssueTitled"]);
      expect(events[0]).toMatchObject({
        actor: ALICE,
        branchId: "main",
        clientId: "issue-client",
        mutationId: 1,
        ts: Date.parse(CREATED),
        payload: {
          number: 1,
          title: "Recorded issue",
          labelLinks: [{ id: id(11), labelId: LABEL }],
          subscriptions: [
            { id: id(12), userId: ALICE.id },
            { id: id(13), userId: BOB.id },
          ],
        },
      });
      for (const event of events) applyIssueEvent(context(replay), event);
      expect(projection(replay)).toEqual(projection(opened.server.store));
      expect(opened.server.store.get("issue", ISSUE)).toMatchObject({
        title: "Titled from events",
        number: 1,
        description: "Initial text",
        descriptionContentId: ISSUE,
        priority: 2,
        estimate: 5,
        dueDate: "2026-11-03",
        assigneeId: BOB.id,
        createdAt: CREATED,
        updatedAt: CREATED,
        createdSeq: events[0]!.seq,
        updatedSeq: events[1]!.seq,
      });
      const before = projection(opened.server.store);
      const syncCursor = opened.server.currentSeq();
      opened.db.close();
      const reopened = openWorkspaceDb(path);
      opened = { ...reopened, server: new SyncServer({ driver: reopened.driver, mutators, now: () => TITLED }) };
      expect(opened.server.events(ALICE)).toEqual(events);
      expect(push(opened.server, 1, "issueCreate", args)).toMatchObject({ ok: true, lastMutationId: 2, rejected: [] });
      expect(opened.server.events(ALICE)).toEqual(events);
      expect(projection(opened.server.store)).toEqual(before);
      expect(opened.server.currentSeq()).toBe(syncCursor);
      expect(push(opened.server, 3, "issueCreate", create(id(20), id(21)))).toMatchObject({ ok: true, rejected: [] });
      expect(opened.server.store.get("issue", id(20))?.number).toBe(2);
    } finally {
      opened.db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("maps patch causes to semantic events while retaining legacy patch provenance", () => {
    const { db, server } = fixture();
    try {
      expect(push(server, 1, "issueCreate", create(ISSUE, id(12)))).toMatchObject({ ok: true, rejected: [] });
      const created = server.events(ALICE)[0]!;
      const creationPatch = server.activity(ALICE, { model: "issue", rowId: ISSUE })[0]!;
      expect(creationPatch.seq).not.toBe(created.seq);
      const rename = (mutationId: number, title: string, causationSeq: number) =>
        server.push(ALICE, {
          clientId: "issue-client",
          mutations: [
            {
              id: mutationId,
              name: "issueUpdate",
              args: { id: ISSUE, patch: { title } },
              ts: CREATED,
              causationSeq,
            },
          ],
        });

      expect(rename(2, "Caused by creation", creationPatch.seq)).toMatchObject({ ok: true, rejected: [] });
      expect.soft(server.events(ALICE)[1]?.causationSeq).toBe(created.seq);
      expect(server.activity(ALICE, { model: "issue", rowId: ISSUE })[0]?.causationSeq).toBe(creationPatch.seq);

      server.system(
        "issueUpdate",
        { id: ISSUE, patch: { title: "System response to creation" } },
        { causationSeq: creationPatch.seq },
      );
      expect(server.events(ALICE)[2]?.causationSeq).toBe(created.seq);
      expect(server.activity(ALICE, { model: "issue", rowId: ISSUE })[0]?.causationSeq).toBe(creationPatch.seq);

      const legacyPatch = server.activity(ALICE, { model: "workflowState" })[0]!;
      expect(legacyPatch).toBeDefined();
      expect(rename(3, "Caused by configuration", legacyPatch.seq)).toMatchObject({ ok: true, rejected: [] });
      expect.soft(server.events(ALICE)[3]?.causationSeq).toBeNull();
      expect(server.activity(ALICE, { model: "issue", rowId: ISSUE })[0]?.causationSeq).toBe(legacyPatch.seq);
    } finally {
      db.close();
    }
  });

  it("rolls back the event, issue, and counter when a later projection write fails", () => {
    const { db, server } = fixture();
    try {
      expect(push(server, 1, "issueCreate", create(ISSUE, id(12)))).toMatchObject({ ok: true, rejected: [] });
      const before = server.events(ALICE);
      const cursor = server.currentSeq();
      // The subscription id is already used. The failure occurs after event append and issue insertion.
      const failed = push(server, 2, "issueCreate", create(id(20), id(12)));
      expect(failed.ok && failed.rejected).toMatchObject([
        { id: 2, error: expect.stringMatching(/already exists|unique/i) },
      ]);
      expect(server.events(ALICE)).toEqual(before);
      expect(server.currentSeq()).toBe(cursor);
      expect(server.store.get("issue", id(20))).toBeUndefined();
      expect(server.store.get("team", TEAM)?.issueCounter).toBe(1);
      expect(push(server, 3, "issueCreate", create(id(22), id(23)))).toMatchObject({ ok: true, rejected: [] });
      expect(server.store.get("issue", id(22))?.number).toBe(2);
      expect(server.events(ALICE).map((event) => event.entityId)).toEqual([ISSUE, id(22)]);
    } finally {
      db.close();
    }
  });

  it("filters semantic event history by private-team membership and an agent's owner and scopes", () => {
    const { db, server } = fixture();
    try {
      const privateTeam = id(30);
      const allTeamsAgent = { id: id(31), type: "agent" } as const;
      const publicOnlyAgent = { id: id(32), type: "agent" } as const;
      const setup = server.push(ALICE, {
        clientId: "seed",
        mutations: [
          {
            id: 3,
            name: "teamCreate",
            ts: CREATED,
            args: {
              id: privateTeam,
              name: "Private",
              key: "PRIVATE",
              visibility: "private",
              stateIds: { backlog: id(33), todo: id(34), inProgress: id(35), done: id(36), canceled: id(37) },
              membershipId: id(38),
            },
          },
          {
            id: 4,
            name: "agentCreate",
            ts: CREATED,
            args: { id: allTeamsAgent.id, name: "Owner permissions", mode: "commit" },
          },
          {
            id: 5,
            name: "agentCreate",
            ts: CREATED,
            args: {
              id: publicOnlyAgent.id,
              name: "Public scope",
              mode: "commit",
              scopes: { teamIds: [TEAM], projectIds: [], mutators: [] },
            },
          },
        ],
      });
      expect(setup.ok && setup.rejected).toEqual([]);
      expect(
        push(server, 1, "issueCreate", { ...create(id(39), id(40)), teamId: privateTeam, title: "Private fact" }),
      ).toMatchObject({ ok: true, rejected: [] });
      expect(push(server, 2, "issueCreate", create(ISSUE, id(12)))).toMatchObject({ ok: true, rejected: [] });
      expect(server.events(ALICE).map((event) => event.entityId)).toEqual([id(39), ISSUE]);
      expect(server.events(BOB).map((event) => event.entityId)).toEqual([ISSUE]);
      expect(server.events(BOB, { entityId: id(39) })).toEqual([]);
      expect(server.events(allTeamsAgent).map((event) => event.entityId)).toEqual([id(39), ISSUE]);
      expect(server.events(publicOnlyAgent).map((event) => event.entityId)).toEqual([ISSUE]);

      const privatePatch = server.activity(ALICE, { model: "issue", rowId: id(39) })[0]!;
      expect(
        server.push(BOB, {
          clientId: "bob-cause",
          mutations: [
            {
              id: 1,
              name: "issueUpdate",
              args: { id: ISSUE, patch: { title: "Public edit with an invisible cause" } },
              ts: CREATED,
              causationSeq: privatePatch.seq,
            },
          ],
        }),
      ).toMatchObject({ ok: true, rejected: [] });
      expect(server.events(BOB).at(-1)?.causationSeq).toBeNull();
      expect(server.activity(BOB, { model: "issue", rowId: ISSUE })[0]?.causationSeq).toBe(privatePatch.seq);

      // Archived memberships may remain after synchronization; admission must agree with history visibility.
      server.store.patch("teamMembership", id(38), { archivedAt: TITLED });
      expect(server.events(ALICE, { entityId: id(39) })).toEqual([]);
      expect(server.events(allTeamsAgent, { entityId: id(39) })).toEqual([]);
      const history = server.events(SYSTEM_ACTOR);
      const before = projection(server.store);
      const deniedCreate = push(server, 3, "issueCreate", { ...create(id(41), id(42)), teamId: privateTeam });
      expect
        .soft(deniedCreate.ok && deniedCreate.rejected)
        .toMatchObject([{ id: 3, error: expect.stringMatching(/not a member/) }]);
      const deniedTitle = push(server, 4, "issueUpdate", { id: id(39), patch: { title: "Revoked edit" } });
      expect
        .soft(deniedTitle.ok && deniedTitle.rejected)
        .toMatchObject([{ id: 4, error: expect.stringMatching(/not a member/) }]);
      expect(server.events(SYSTEM_ACTOR)).toEqual(history);
      expect(projection(server.store)).toEqual(before);
    } finally {
      db.close();
    }
  });

  it("rejects invalid semantic commands without appending facts or changing projections", () => {
    const { db, server } = fixture();
    try {
      expect(push(server, 1, "issueCreate", create(ISSUE, id(12)))).toMatchObject({ ok: true, rejected: [] });
      const before = projection(server.store);
      const history = server.events(ALICE);
      const cursor = server.currentSeq();
      const title = push(server, 2, "issueUpdate", { id: ISSUE, patch: { title: "   " } });
      expect(title.ok && title.rejected).toMatchObject([{ id: 2, error: "title is required" }]);
      const label = push(server, 3, "issueCreate", {
        ...create(id(20), id(21)),
        labelIds: [id(22)],
        labelLinkIds: [id(23)],
      });
      expect(label.ok && label.rejected).toMatchObject([{ id: 3, error: "label not found" }]);
      expect(server.events(ALICE)).toEqual(history);
      expect(server.currentSeq()).toBe(cursor);
      expect(projection(server.store)).toEqual(before);
      expect(push(server, 4, "issueUpdate", { id: ISSUE, patch: { title: "Accepted after rejection" } })).toMatchObject(
        { ok: true, rejected: [] },
      );
      expect(server.events(ALICE).map((event) => event.type)).toEqual(["IssueCreated", "IssueTitled"]);
      expect(server.store.get("issue", ISSUE)?.title).toBe("Accepted after rejection");
    } finally {
      db.close();
    }
  });

  it("rejects an event for a different workspace branch before changing a replay projection", () => {
    const { db, server } = fixture();
    try {
      const memory = new MemoryStore();
      copyProjection(server.store, memory);
      const before = projection(memory);
      const branchEvent = { ...structuredClone(GOLDEN[0]!), branchId: "agent-work" };
      expect(() => applyIssueEvent(context(memory), branchEvent)).toThrow(/different branch/);
      expect(projection(memory)).toEqual(before);
    } finally {
      db.close();
    }
  });
});
