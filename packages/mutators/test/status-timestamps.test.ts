import { expect, it } from "vitest";
import { uuidv7 } from "@kanbun/model";
import { SyncServer } from "@kanbun/sync/server";
import { openWorkspaceDb } from "@kanbun/sync/server/node";
import { mutators } from "../src";

const actor = { id: "alice", type: "user" } as const;
const FIRST = "2026-11-01T00:00:00.000Z";
const SECOND = "2026-11-02T00:00:00.000Z";
const THIRD = "2026-11-03T00:00:00.000Z";
function fixture() {
  let now = FIRST,
    mutation = 0;
  const { db, driver } = openWorkspaceDb();
  const server = new SyncServer({ driver, mutators, now: () => now });
  server.system("workspaceInit", {
    organization: { id: uuidv7(), name: "Test", urlKey: "test" },
    owner: { id: actor.id, name: "Alice", email: "alice@example.com" },
  });
  function push(name: string, args: unknown) {
    expect(
      server.push(actor, { clientId: "timestamps", mutations: [{ id: ++mutation, name, args, ts: now }] }),
    ).toMatchObject({ ok: true, rejected: [] });
  }
  function team(key: string) {
    const id = uuidv7();
    const states = { backlog: uuidv7(), todo: uuidv7(), inProgress: uuidv7(), done: uuidv7(), canceled: uuidv7() };
    push("teamCreate", { id, key, name: key, membershipId: uuidv7(), stateIds: states });
    return { id, states };
  }
  const source = team("ONE"),
    target = team("TWO");
  function extra(type: "completed" | "canceled") {
    const id = uuidv7();
    push("workflowStateCreate", { id, teamId: source.id, name: `Another ${type}`, type, color: "#123456" });
    return id;
  }
  const extras = { completed: extra("completed"), canceled: extra("canceled") };
  function issue(stateId: string) {
    const id = uuidv7();
    push("issueCreate", { id, teamId: source.id, stateId, title: "Timestamp history", subscriptionId: uuidv7() });
    return id;
  }
  return {
    db,
    server,
    push,
    source,
    target,
    extras,
    issue,
    time: (value: string) => {
      now = value;
    },
  };
}
for (const path of ["human events", "system legacy"] as const) {
  for (const category of ["completed", "canceled"] as const) {
    for (const missing of [false, true]) {
      it(`${path} preserves ${category} ${missing ? "null" : "timestamp"} within category and records only category entry`, () => {
        const f = fixture();
        try {
          const field = category === "completed" ? "completedAt" : "canceledAt";
          const other = category === "completed" ? "canceledAt" : "completedAt";
          const initial = category === "completed" ? f.source.states.done : f.source.states.canceled;
          const id = f.issue(initial);
          if (missing) f.server.store.patch("issue", id, { [field]: null }); // Historical missing data must remain missing.
          f.time(SECOND);
          const update = (stateId: string) =>
            path === "human events"
              ? f.push("issueUpdate", { id, patch: { stateId } })
              : f.server.system("issueUpdate", { id, patch: { stateId } });
          update(f.extras[category]);
          expect(f.server.store.get("issue", id)?.[field]).toBe(missing ? null : FIRST);
          if (path === "human events") {
            const event = f.server.events(actor, { issueId: id, order: "desc", limit: 1 })[0]!;
            expect(event.type).toBe("HumanAssertedStatus");
            expect(event.payload).toMatchObject({ [field]: missing ? null : FIRST });
          }
          update(f.source.states.todo);
          expect(f.server.store.get("issue", id)).toMatchObject({ completedAt: null, canceledAt: null });
          f.time(THIRD);
          update(initial);
          expect(f.server.store.get("issue", id)).toMatchObject({ [field]: THIRD, [other]: null });
          update(category === "completed" ? f.source.states.canceled : f.source.states.done);
          expect(f.server.store.get("issue", id)).toMatchObject({ [field]: null, [other]: THIRD });
        } finally {
          f.db.close();
        }
      });
    }
  }
}
for (const category of ["completed", "canceled"] as const) {
  for (const missing of [false, true]) {
    it(`workflow deletion preserves ${category} ${missing ? "null" : "timestamp"} for same-category replacement`, () => {
      const f = fixture();
      try {
        const field = category === "completed" ? "completedAt" : "canceledAt";
        const state = category === "completed" ? f.source.states.done : f.source.states.canceled;
        const id = f.issue(state);
        if (missing) f.server.store.patch("issue", id, { [field]: null });
        f.time(SECOND);
        f.push("workflowStateDelete", { id: state, moveIssuesToStateId: f.extras[category] });
        expect(f.server.store.get("issue", id)?.[field]).toBe(missing ? null : FIRST);
        f.push("workflowStateDelete", { id: f.extras[category], moveIssuesToStateId: f.source.states.todo });
        expect(f.server.store.get("issue", id)).toMatchObject({ completedAt: null, canceledAt: null });
      } finally {
        f.db.close();
      }
    });
    it(`team moves preserve ${category} ${missing ? "null" : "timestamp"} but clear it when fallback changes category`, () => {
      const f = fixture();
      try {
        const field = category === "completed" ? "completedAt" : "canceledAt";
        const sourceState = category === "completed" ? f.source.states.done : f.source.states.canceled;
        const targetState = category === "completed" ? f.target.states.done : f.target.states.canceled;
        const id = f.issue(sourceState);
        if (missing) f.server.store.patch("issue", id, { [field]: null });
        f.time(SECOND);
        f.push("issueUpdate", { id, patch: { teamId: f.target.id } });
        expect(f.server.store.get("issue", id)).toMatchObject({
          stateId: targetState,
          [field]: missing ? null : FIRST,
        });
        f.push("issueUpdate", { id, patch: { teamId: f.source.id } });
        f.push("workflowStateDelete", { id: targetState, moveIssuesToStateId: f.target.states.todo });
        f.push("issueUpdate", { id, patch: { teamId: f.target.id } });
        expect(f.server.store.get("issue", id)).toMatchObject({
          stateId: f.target.states.backlog,
          completedAt: null,
          canceledAt: null,
        });
      } finally {
        f.db.close();
      }
    });
  }
}
it("team fallback entering a terminal category records the entry time", () => {
  const f = fixture();
  try {
    const id = f.issue(f.source.states.todo);
    f.push("workflowStateDelete", { id: f.target.states.todo, moveIssuesToStateId: f.target.states.done });
    f.server.store.patch("team", f.target.id, { defaultIssueStateId: f.target.states.done });
    f.time(SECOND);
    f.push("issueUpdate", { id, patch: { teamId: f.target.id } });
    expect(f.server.store.get("issue", id)).toMatchObject({
      stateId: f.target.states.done,
      completedAt: SECOND,
      canceledAt: null,
    });
  } finally {
    f.db.close();
  }
});
