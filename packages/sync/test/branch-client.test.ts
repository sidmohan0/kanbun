import { expect, it } from "vitest";
import type { PullRequest, Transport } from "../src";
import { MemoryPersister, SyncClient, type PersistedState } from "../src/client";

const actor = { id: "alice", type: "user" } as const;

it.each([
  { savedBranch: "branch-a", selectedBranch: "branch-b" },
  { savedBranch: "branch-a", selectedBranch: "main" },
  { savedBranch: undefined, selectedBranch: "branch-a" },
])("does not route saved $savedBranch mutations through $selectedBranch", async ({ savedBranch, selectedBranch }) => {
  const persister = new MemoryPersister();
  const saved: PersistedState = {
    clientId: "saved-client",
    userId: actor.id,
    ...(savedBranch === undefined ? {} : { branchId: savedBranch }),
    seq: 4,
    lastMutationId: 0,
    pending: [{ id: 1, name: "createIssue", args: {}, ts: "2026-10-29T12:00:00.000Z" }],
    rows: {},
  };
  await persister.save(saved);
  let calls = 0;
  const unexpected = async (): Promise<never> => {
    calls++;
    throw new Error("A mismatched saved branch must not reach the transport");
  };
  const transport: Transport = { bootstrap: unexpected, push: unexpected, pull: unexpected, load: unexpected };
  const client = new SyncClient({ actor, branchId: selectedBranch, mutators: {}, persister, transport });
  const originalClientId = client.clientId;

  await expect(client.start()).rejects.toThrow(/another branch/);
  expect(calls).toBe(0);
  expect(client.clientId).toBe(originalClientId);
  expect(client.pendingCount()).toBe(0);
  expect(await persister.load()).toEqual(saved);
});

it("restores an older main-only state and persists its explicit branch identity", async () => {
  const persister = new MemoryPersister();
  await persister.save({
    clientId: "old-main-client",
    userId: actor.id,
    seq: 4,
    lastMutationId: 0,
    pending: [],
    rows: {},
  });
  const pulls: PullRequest[] = [];
  const unexpected = async (): Promise<never> => {
    throw new Error("Saved main state should restore and pull");
  };
  const transport: Transport = {
    bootstrap: unexpected,
    push: unexpected,
    load: unexpected,
    async pull(request) {
      pulls.push(request);
      return { seq: 4, lastMutationId: 0, entries: [], reset: false };
    },
  };
  const client = new SyncClient({ actor, mutators: {}, persister, transport });

  await client.start();
  expect(client.branchId).toBe("main");
  expect(client.clientId).toBe("old-main-client");
  expect(pulls).toHaveLength(1);
  expect(pulls[0]).toMatchObject({ clientId: "old-main-client", since: 4 });
  expect(pulls[0]?.branchId ?? "main").toBe("main");
  expect(await persister.load()).toMatchObject({ branchId: "main", clientId: "old-main-client" });
});

it("rejects a legacy transport's main bootstrap before adopting its rows or cursor for a branch", async () => {
  const persister = new MemoryPersister();
  const unexpected = async (): Promise<never> => {
    throw new Error("Only bootstrap should be attempted");
  };
  const transport: Transport = {
    async bootstrap() {
      // A transport that ignored bootstrap's new branch argument answers as main.
      return {
        seq: 100,
        lastMutationId: 7,
        rows: {
          user: [
            {
              id: "wrong-main-user",
              name: "Main user",
              email: "main@example.com",
              createdAt: "2026-10-29T12:00:00.000Z",
              updatedAt: "2026-10-29T12:00:00.000Z",
            },
          ],
        },
      };
    },
    push: unexpected,
    pull: unexpected,
    load: unexpected,
  };
  const client = new SyncClient({ actor, branchId: "branch-a", mutators: {}, persister, transport });

  await expect(client.start()).rejects.toThrow(/response belongs to another branch/);
  expect(client.canonical.tables.size).toBe(0);
  expect(client.getSeq()).toBe(0);
  expect(client.pendingCount()).toBe(0);
  expect(await persister.load()).toBeNull();
});
