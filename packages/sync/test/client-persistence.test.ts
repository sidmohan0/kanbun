import { setImmediate } from "node:timers/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineMutator, type BootstrapResponse, type Transport } from "../src";
import { IndexedDbPersister, MemoryPersister, SyncClient, type PersistedState, type Persister } from "../src/client";

const actor = { id: "alice", type: "user" } as const;
const mutators = {
  noChange: defineMutator({ args: z.object({}), description: "A valid mutation without row changes", run() {} }),
};
const bootstrap: BootstrapResponse = { seq: 1, lastMutationId: 0, rows: {} };
const saved: PersistedState = {
  clientId: "saved-client",
  userId: actor.id,
  branchId: "main",
  seq: 1,
  lastMutationId: 1,
  pending: [],
  rows: {},
};

const unexpected = async (): Promise<never> => {
  throw new Error("Unexpected transport call");
};
function transport(overrides: Partial<Transport> = {}): Transport {
  return { bootstrap: async () => bootstrap, pull: unexpected, push: unexpected, load: unexpected, ...overrides };
}

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("persists the drained outbox when a rejected batch does not advance the sync sequence", async () => {
  const persister = new MemoryPersister();
  const client = new SyncClient({
    actor,
    mutators,
    persister,
    transport: transport({
      push: async () => ({ ok: true, lastMutationId: 1, seq: 1, rejected: [{ id: 1, error: "Not allowed" }] }),
    }),
  });
  await client.start();
  client.mutate("noChange", {});
  await client.push();

  expect(client.pendingCount()).toBe(0);
  expect(await persister.load()).toMatchObject({ lastMutationId: 1, pending: [] });
});

it("reports a storage load failure before attempting a fresh bootstrap", async () => {
  const failure = new Error("IndexedDB cannot be opened");
  const errors: unknown[] = [];
  let bootstraps = 0;
  const persister: Persister = {
    async load() {
      throw failure;
    },
    async save() {},
    async clear() {},
  };
  const client = new SyncClient({
    actor,
    mutators,
    persister,
    transport: transport({
      async bootstrap() {
        bootstraps++;
        return bootstrap;
      },
    }),
    onError: (error) => errors.push(error),
  });

  await expect(client.start()).rejects.toBe(failure);
  expect(errors).toEqual([failure]);
  expect(client.getStatus()).toBe("error");
  expect(bootstraps).toBe(0);
});

it.each(["load", "save"] as const)("propagates an IndexedDB %s failure to the caller", async (operation) => {
  const failure = new Error("Storage is unavailable");
  vi.stubGlobal("indexedDB", {
    open() {
      throw failure;
    },
  });
  const persister = new IndexedDbPersister("unavailable-database", "workspace:alice:main");

  await expect(operation === "load" ? persister.load() : persister.save(saved)).rejects.toBe(failure);
});

it("reports an asynchronous mutation save failure while retaining the queued mutation", async () => {
  const failure = new Error("Storage quota exceeded");
  let failSaves = false;
  const persister = new MemoryPersister();
  const save = persister.save.bind(persister);
  persister.save = async (state) => {
    if (failSaves) throw failure;
    await save(state);
  };
  const errors: unknown[] = [];
  const client = new SyncClient({
    actor,
    mutators,
    persister,
    transport: transport(),
    onError: (error) => errors.push(error),
  });
  await client.start();
  failSaves = true;
  client.mutate("noChange", {});
  await setImmediate();

  expect(errors).toEqual([failure]);
  await expect(client.flushPersistence()).rejects.toBe(failure);
  expect(client.pendingCount()).toBe(1);
  expect(client.layerMutations("pending")[0]).toMatchObject({ id: 1, name: "noChange" });
});

it("flushes the current outbox snapshot only after its persistence completes", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let holdSaves = false;
  const persister = new MemoryPersister();
  const save = persister.save.bind(persister);
  persister.save = async (state) => {
    if (holdSaves) await gate;
    await save(state);
  };
  const client = new SyncClient({ actor, mutators, persister, transport: transport() });
  await client.start();
  holdSaves = true;
  client.mutate("noChange", {});
  let complete = false;
  const flushed = client.flushPersistence().then(() => {
    complete = true;
  });
  await setImmediate();
  expect(complete).toBe(false);
  release();
  await flushed;

  expect(await persister.load()).toMatchObject({ clientId: client.clientId, pending: [{ id: 1, name: "noChange" }] });
});

it.each(["restore", "bootstrap"] as const)(
  "allocates a fresh mutation id when the server is ahead during %s",
  async (source) => {
    const persister = new MemoryPersister();
    if (source === "restore") await persister.save(saved);
    const client = new SyncClient({
      actor,
      mutators,
      persister,
      ...(source === "bootstrap" ? { clientId: saved.clientId } : {}),
      transport: transport({
        bootstrap: async () => ({ ...bootstrap, lastMutationId: 4 }),
        pull: async () => ({ seq: 1, lastMutationId: 4, entries: [], reset: false }),
      }),
    });
    await client.start();
    client.mutate("noChange", {});

    expect(client.layerMutations("pending")).toMatchObject([{ id: 5 }]);
  },
);
