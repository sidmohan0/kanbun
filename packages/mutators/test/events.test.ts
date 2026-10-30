import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@kanbun/events";
import { modelNames } from "@kanbun/model";
import { MemoryStore, type MutatorContext, type Store } from "@kanbun/sync";
import { SyncServer, SYSTEM_ACTOR } from "@kanbun/sync/server";
import { openWorkspaceDb } from "@kanbun/sync/server/node";
import { applyIssueEvent, mutators } from "../src";

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
