import { uuidv7, type Row } from "@kanbun/model";
import { mutators } from "@kanbun/mutators";
import type { Mutation, Transport } from "@kanbun/sync";
import {
  IndexedDbPersister,
  PENDING,
  SyncClient,
  httpTransport,
  type Persister,
  type SyncStatus,
} from "@kanbun/sync/client";

export type WorkspaceRejection = { id: string; issueId: string | null; message: string };
export type WorkspaceSnapshot = {
  phase: "starting" | "ready" | "waiting" | "failed";
  status: SyncStatus;
  pending: number;
  pendingIssueIds: string[];
  issues: Row<"issue">[];
  teams: Row<"team">[];
  rejections: WorkspaceRejection[];
  error: string | null;
};

const actor = { id: "user-alice", type: "user" } as const;
const persistenceKey = "local:user-alice:main";
const lockName = `kanbun:${persistenceKey}`;
const listeners = new Set<() => void>();
const deferredRejections = new Map<number, WorkspaceRejection>();
let client: SyncClient<typeof mutators> | null = null;
let phase: WorkspaceSnapshot["phase"] = "starting";
let error: string | null = null;
let storageError: string | null = null;
let initialized = false;
let leaseHeld = false;
let cachedStateAvailable = false;
let storageReadFailed = false;
let startTask: Promise<void> | null = null;
let refreshTask: Promise<void> | null = null;
let persistenceWrites = 0;
let rejections: WorkspaceRejection[] = [];
let snapshot: WorkspaceSnapshot = {
  phase,
  status: "idle",
  pending: 0,
  pendingIssueIds: [],
  issues: [],
  teams: [],
  rejections,
  error,
};

const message = (value: unknown) => (value instanceof Error ? value.message : String(value));
const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

function issueId(mutation: Mutation): string | null {
  const args = mutation.args;
  return args !== null && typeof args === "object" && "id" in args && typeof args.id === "string" ? args.id : null;
}

function publish() {
  const pending = client?.layerMutations(PENDING) ?? [];
  const pendingIds = new Set(pending.map((mutation) => mutation.id));
  // A server rejection that has left the outbox is ready to show alongside the
  // rolled-back projection, including when a concurrent pull acknowledged it first.
  for (const [id, rejection] of deferredRejections) {
    if (pendingIds.has(id)) continue;
    if (!rejections.some((existing) => existing.id === rejection.id)) rejections = [...rejections, rejection];
    deferredRejections.delete(id);
  }
  const status = storageError
    ? "error"
    : !navigator.onLine
      ? "offline"
      : refreshTask || persistenceWrites > 0
        ? "syncing"
        : (client?.getStatus() ?? "idle");
  snapshot = {
    phase,
    status,
    pending: pending.length,
    pendingIssueIds: [...new Set(pending.map(issueId).filter((id): id is string => id !== null))],
    issues:
      client
        ?.list("issue")
        .filter((issue) => !issue.trashed && !issue.archivedAt)
        .sort((a, b) => compare(a.sortOrder, b.sortOrder) || compare(a.id, b.id)) ?? [],
    teams:
      client
        ?.list("team")
        .filter((team) => !team.archivedAt && !team.retiredAt)
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)) ?? [],
    rejections,
    error,
  };
  for (const listener of listeners) listener();
}

function changed() {
  if (
    client?.getStatus() === "idle" &&
    client.pendingCount() === 0 &&
    !storageError &&
    !refreshTask &&
    !persistenceWrites
  )
    error = null;
  publish();
}

function localTransport(): Transport {
  const transport = httpTransport(location.origin, (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("X-Kanbun-Local-Actor", "alice");
    return fetch(input, { ...init, headers });
  });
  return {
    ...transport,
    async push(request) {
      const result = await transport.push(request);
      if (result.ok) {
        for (const rejection of result.rejected) {
          const mutation = request.mutations.find((candidate) => candidate.id === rejection.id);
          if (mutation)
            deferredRejections.set(rejection.id, {
              id: `${request.clientId}:${mutation.id}`,
              issueId: issueId(mutation),
              message: rejection.error,
            });
        }
        publish();
      }
      return result;
    },
  };
}

function persistentState(): Persister {
  const persister = new IndexedDbPersister("kanbun", persistenceKey);
  return {
    async load() {
      try {
        const saved = await persister.load();
        storageReadFailed = false;
        cachedStateAvailable = saved?.userId === actor.id && (saved.branchId ?? "main") === "main";
        return saved;
      } catch (failure) {
        storageReadFailed = true;
        throw failure;
      }
    },
    async save(state) {
      persistenceWrites++;
      publish();
      try {
        await persister.save(state);
        storageError = null;
      } catch (failure) {
        storageError = message(failure);
        error = storageError;
        throw failure;
      } finally {
        persistenceWrites--;
        changed();
      }
    },
    clear: () => persister.clear(),
  };
}

async function initialize() {
  client = new SyncClient({
    actor,
    mutators,
    branchId: "main",
    transport: localTransport(),
    persister: persistentState(),
    onError(failure) {
      error = message(failure);
      publish();
    },
  });
  client.subscribe("issue", changed);
  client.subscribe("team", changed);
  client.subscribeStatus(changed);
  try {
    await client.start();
    initialized = true;
    phase = "ready";
  } catch (failure) {
    error = message(failure);
    initialized = cachedStateAvailable;
    phase = initialized ? "ready" : "failed";
  }
  publish();
}

/** A page owns its client for its whole lifetime, including React StrictMode remounts. */
function start(): Promise<void> {
  if (startTask) return startTask;
  let started!: () => void;
  startTask = new Promise<void>((resolve) => {
    started = resolve;
  });
  if (!navigator.locks) {
    phase = "failed";
    error = "This browser cannot safely open the local workspace because Web Locks are unavailable.";
    publish();
    started();
    return startTask;
  }
  window.addEventListener("focus", () => void refresh());
  window.addEventListener("online", () => void refresh());
  window.addEventListener("offline", publish);

  const ownLease = async () => {
    leaseHeld = true;
    phase = "starting";
    publish();
    await initialize();
    started();
    // Releasing on a component cleanup would leave the old client's timers active.
    // The browser releases this exclusive lease when the owning page closes.
    await new Promise<void>(() => {});
  };
  void navigator.locks
    .request(lockName, { mode: "exclusive", ifAvailable: true }, async (lock) => {
      if (lock) return ownLease();
      phase = "waiting";
      publish();
      started();
      return navigator.locks.request(lockName, { mode: "exclusive" }, ownLease);
    })
    .catch((failure: unknown) => {
      phase = "failed";
      error = message(failure);
      publish();
      started();
    });
  return startTask;
}

function refresh(): Promise<void> {
  if (refreshTask) return refreshTask;
  const run = async () => {
    await start();
    if (!leaseHeld || !client) return;
    try {
      if (!initialized) {
        phase = "starting";
        publish();
        // A failed storage read must be retried before a bootstrap could replace
        // an unknown, possibly unsent outbox. No client work started in that case.
        if (storageReadFailed) await client.start();
        else await client.bootstrap();
        initialized = true;
      } else {
        await client.push();
        await client.pull();
      }
      phase = "ready";
    } catch (failure) {
      error = message(failure);
      initialized ||= cachedStateAvailable;
      phase = initialized ? "ready" : "failed";
    } finally {
      publish();
    }
  };
  const task = run().finally(() => {
    if (refreshTask === task) refreshTask = null;
    changed();
  });
  refreshTask = task;
  publish();
  return task;
}

function editableClient() {
  if (!leaseHeld || !initialized || phase !== "ready" || !client)
    throw new Error("Wait for the local workspace to finish opening before editing.");
  return client;
}

function flush(active: SyncClient<typeof mutators>) {
  void active.flushPersistence().then(changed, (failure: unknown) => {
    storageError = message(failure);
    error = storageError;
    publish();
  });
}

export const workspace = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: () => snapshot,
  start,
  refresh,
  createIssue(teamId: string, title: string): void {
    const active = editableClient();
    active.mutate("issueCreate", { id: uuidv7(), teamId, title, subscriptionId: uuidv7() });
    publish();
    flush(active);
  },
  renameIssue(id: string, title: string): void {
    const active = editableClient();
    active.mutate("issueUpdate", { id, patch: { title } });
    publish();
    flush(active);
  },
  dismissRejection(id: string): void {
    rejections = rejections.filter((rejection) => rejection.id !== id);
    publish();
  },
};

if (import.meta.hot) {
  // A replacement module cannot take the old module's page-lifetime lease.
  // Keep the original owner's flusher across updates, including a failed save.
  const owner: { flushKnownState(): Promise<boolean> } = (import.meta.hot.data.workspaceOwner ??= {
    async flushKnownState() {
      if (!initialized || !client || storageReadFailed) return true;
      try {
        await client.flushPersistence();
        return true;
      } catch (failure) {
        storageError = message(failure);
        error = storageError;
        publish();
        return false;
      }
    },
  });
  import.meta.hot.accept(async () => {
    if (await owner.flushKnownState()) location.reload();
  });
}
