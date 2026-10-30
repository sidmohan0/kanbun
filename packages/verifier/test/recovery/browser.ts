import { uuidv7 } from "@kanbun/model";
import { mutators } from "@kanbun/mutators";
import { IndexedDbPersister, SyncClient, httpTransport } from "@kanbun/sync/client";
import type { Actor } from "@kanbun/sync";
import type { RecoveryApi, RecoverySnapshot } from "./contract";

let client: SyncClient<typeof mutators>;
let persister: IndexedDbPersister;
let errors: string[] = [];
let startError: string | null = null;

function snapshot(): RecoverySnapshot {
  if (!client) throw new Error("Start the browser integration harness first.");
  return {
    clientId: client.clientId,
    status: client.getStatus(),
    seq: client.getSeq(),
    pending: client.pendingCount(),
    pendingMutations: client.layerMutations("pending"),
    issues: client.list("issue").sort((a, b) => a.id.localeCompare(b.id)),
    errors: [...errors],
    startError,
  };
}

const api: RecoveryApi = {
  async start(actorName) {
    const response = await fetch("/fixture/session", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actor: actorName }),
    });
    if (!response.ok) throw new Error("Fixture actor selection failed.");
    const actor = (await response.json()) as Actor;
    errors = [];
    startError = null;
    persister = new IndexedDbPersister("kanbun-browser-recovery", `workspace:${actor.id}`);
    client = new SyncClient({
      actor,
      mutators,
      transport: httpTransport(location.origin),
      persister,
      onError(error) {
        errors.push(error instanceof Error ? error.message : String(error));
      },
    });
    try {
      await client.start();
    } catch (error) {
      startError = error instanceof Error ? error.message : String(error);
    }
    return snapshot();
  },
  snapshot,
  mutate(name, args, options) {
    client.mutate(name, args as never, options);
    return snapshot();
  },
  async push() {
    await client.push();
    return snapshot();
  },
  async pull() {
    await client.pull();
    return snapshot();
  },
  persisted: () => persister.load(),
  newId: uuidv7,
};

window.recovery = api;
