import { eventSchema } from "@kanbun/events";
import { uuidv7, type Row } from "@kanbun/model";
import { mutators } from "@kanbun/mutators";
import {
  isPoke,
  issueIncarnation,
  notificationVisible,
  type Mutation,
  type Transport,
  type WorkspaceContext,
} from "@kanbun/sync";
import ReconnectingWebSocket from "partysocket/ws";
import {
  IndexedDbPersister,
  PENDING,
  SyncClient,
  httpTransport,
  type Persister,
  type SyncStatus,
} from "@kanbun/sync/client";
import { resolveWorkspaceContext, workspacePersistenceKey, WorkspaceContextError } from "./context";

export type WorkspaceRejection = { id: string; issueId: string | null; message: string };
export type WorkspaceSnapshot = {
  phase: "starting" | "ready" | "waiting" | "failed";
  status: SyncStatus;
  pending: number;
  pendingIssueIds: string[];
  issues: Row<"issue">[];
  comments: Row<"comment">[];
  notifications: Row<"notification">[];
  unreadNotificationCount: number;
  knownMembers: Row<"user">[];
  knownAgents: Row<"agent">[];
  pendingCommentIds: string[];
  teams: Row<"team">[];
  workflowStates: Row<"workflowState">[];
  members: Row<"user">[];
  labels: Row<"issueLabel">[];
  labelLinks: Row<"issueLabelLink">[];
  teamMemberships: Row<"teamMembership">[];
  rejections: WorkspaceRejection[];
  error: string | null;
  context: WorkspaceContext | null;
  authenticationRequired: boolean;
};

let context: WorkspaceContext | null = null;
let authenticationRequired = false;
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
let socket: ReconnectingWebSocket | null = null;
let realtimeTask: Promise<void> | null = null;
let realtimeRequested = false;
let latestPokeSeq = 0;
let persistenceWrites = 0;
let rejections: WorkspaceRejection[] = [];
let snapshot: WorkspaceSnapshot = {
  phase,
  status: "idle",
  pending: 0,
  pendingIssueIds: [],
  issues: [],
  comments: [],
  notifications: [],
  unreadNotificationCount: 0,
  knownMembers: [],
  knownAgents: [],
  pendingCommentIds: [],
  teams: [],
  workflowStates: [],
  members: [],
  labels: [],
  labelLinks: [],
  teamMemberships: [],
  rejections,
  error,
  context,
  authenticationRequired,
};

const message = (value: unknown) => (value instanceof Error ? value.message : String(value));
const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

function issueId(mutation: Mutation): string | null {
  const args = mutation.args;
  if (args === null || typeof args !== "object") return null;
  if ("issueId" in args && typeof args.issueId === "string") return args.issueId;
  if (!("id" in args) || typeof args.id !== "string") return null;
  return mutation.name.startsWith("comment") ? (client?.get("comment", args.id)?.issueId ?? null) : args.id;
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
  const status =
    authenticationRequired || storageError
      ? "error"
      : !navigator.onLine
        ? "offline"
        : refreshTask || persistenceWrites > 0
          ? "syncing"
          : (client?.getStatus() ?? "idle");
  const visibleTeamIds = authenticationRequired
    ? []
    : (client
        ?.list("team")
        .filter(
          (team) =>
            !team.archivedAt &&
            (team.visibility === "public" ||
              client!
                .list("teamMembership", { teamId: team.id })
                .some((membership) => membership.userId === context?.actor.id && !membership.archivedAt)),
        )
        .map((team) => team.id) ?? []);
  const notifications =
    authenticationRequired || !client || !context
      ? []
      : client
          .list("notification")
          .filter((row) => !row.archivedAt && notificationVisible(client!.view, context!.actor.id, visibleTeamIds, row))
          .sort(
            (left, right) =>
              right.sourceEventSeq - left.sourceEventSeq ||
              compare(right.createdAt, left.createdAt) ||
              compare(right.id, left.id),
          );
  snapshot = {
    phase,
    status,
    context: authenticationRequired ? null : context,
    authenticationRequired,
    pending: authenticationRequired ? 0 : pending.length,
    pendingIssueIds: authenticationRequired
      ? []
      : [...new Set(pending.map(issueId).filter((id): id is string => id !== null))],
    notifications,
    unreadNotificationCount: notifications.filter((row) => !row.readAt).length,
    comments: authenticationRequired ? [] : (client?.list("comment").filter((comment) => !comment.archivedAt) ?? []),
    knownMembers: authenticationRequired ? [] : (client?.list("user") ?? []),
    knownAgents: authenticationRequired ? [] : (client?.list("agent") ?? []),
    pendingCommentIds: authenticationRequired
      ? []
      : [
          ...new Set(
            pending
              .filter((mutation) => mutation.name.startsWith("comment"))
              .flatMap((mutation) => {
                const args = mutation.args;
                return args !== null && typeof args === "object" && "id" in args && typeof args.id === "string"
                  ? [args.id]
                  : [];
              }),
          ),
        ],
    issues:
      (authenticationRequired ? undefined : client)
        ?.list("issue")
        .filter((issue) => !issue.trashed && !issue.archivedAt)
        .sort((a, b) => compare(a.sortOrder, b.sortOrder) || compare(a.id, b.id)) ?? [],
    teams:
      (authenticationRequired ? undefined : client)
        ?.list("team")
        .filter((team) => !team.archivedAt && !team.retiredAt)
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)) ?? [],
    workflowStates:
      (authenticationRequired ? undefined : client)
        ?.list("workflowState")
        .filter((state) => !state.archivedAt)
        .sort((a, b) => a.position - b.position || compare(a.id, b.id)) ?? [],
    members:
      (authenticationRequired ? undefined : client)
        ?.list("user")
        .filter((member) => member.active && !member.archivedAt)
        .sort((a, b) => a.displayName.localeCompare(b.displayName) || compare(a.id, b.id)) ?? [],
    labels:
      (authenticationRequired ? undefined : client)
        ?.list("issueLabel")
        .filter((label) => !label.archivedAt && !label.retiredAt)
        .sort((a, b) => a.name.localeCompare(b.name) || compare(a.id, b.id)) ?? [],
    labelLinks:
      (authenticationRequired ? undefined : client)?.list("issueLabelLink").filter((link) => !link.archivedAt) ?? [],
    teamMemberships:
      (authenticationRequired ? undefined : client)
        ?.list("teamMembership")
        .filter((membership) => !membership.archivedAt) ?? [],
    rejections: authenticationRequired ? [] : rejections,
    error,
  };
  for (const listener of listeners) listener();
}

function changed() {
  if (
    !authenticationRequired &&
    client?.getStatus() === "idle" &&
    client.pendingCount() === 0 &&
    !storageError &&
    !refreshTask &&
    !persistenceWrites
  )
    error = null;
  publish();
}

function blockAuthentication(message = "Your session is no longer authorized. Sign in again and reload this page.") {
  authenticationRequired = true;
  phase = "failed";
  error = message;
  realtimeRequested = false;
  socket?.close(1000, "Authentication required");
  publish();
}

async function workspaceFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (authenticationRequired) throw new Error(error ?? "Authentication required");
  const headers = new Headers(init?.headers);
  if (context?.admissionId) headers.set("X-Kanbun-Admission", context.admissionId);
  const response = await fetch(input, { ...init, headers, redirect: "manual" });
  if (
    context?.mode === "hosted" &&
    (response.status === 401 ||
      response.status === 403 ||
      response.type === "opaqueredirect" ||
      (response.status >= 300 && response.status < 400))
  )
    blockAuthentication();
  if (authenticationRequired) throw new Error(error ?? "Authentication required");
  return response;
}

function workspaceTransport(): Transport {
  const transport = httpTransport(location.origin, workspaceFetch);
  return {
    ...transport,
    async push(request) {
      const result = await transport.push(request);
      if (context?.mode === "hosted" && !result.ok && result.code === "unauthorized") {
        blockAuthentication();
        throw new Error(error!);
      }
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
  const selected = context!;
  const persister = new IndexedDbPersister("kanbun", workspacePersistenceKey(selected));
  return {
    async load() {
      try {
        const saved = await persister.load();
        storageReadFailed = false;
        cachedStateAvailable = saved?.userId === selected.actor.id && (saved.branchId ?? "main") === "main";
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
    actor: context!.actor,
    mutators,
    branchId: "main",
    transport: workspaceTransport(),
    persister: persistentState(),
    onError(failure) {
      error = message(failure);
      publish();
    },
  });
  client.subscribe("issue", changed);
  client.subscribe("team", changed);
  for (const model of [
    "workflowState",
    "user",
    "issueLabel",
    "issueLabelLink",
    "teamMembership",
    "comment",
    "agent",
  ] as const)
    client.subscribe(model, changed);
  client.subscribeStatus(changed);
  try {
    await client.start();
    initialized = true;
    phase = authenticationRequired ? "failed" : "ready";
  } catch (failure) {
    error = message(failure);
    initialized = !authenticationRequired && cachedStateAvailable;
    phase = initialized ? "ready" : "failed";
  }
  connectRealtime();
  publish();
}

function requestRealtimeRefresh() {
  if (authenticationRequired) return;
  realtimeRequested = true;
  if (realtimeTask) return;
  const run = async () => {
    // An already-running pull may have read before this hint or socket open.
    // Queue a fresh pass after it, and retain hints received during that pass.
    if (refreshTask) await refreshTask;
    while (realtimeRequested && !authenticationRequired) {
      realtimeRequested = false;
      await refresh();
    }
  };
  realtimeTask = run().finally(() => {
    realtimeTask = null;
    if (realtimeRequested) requestRealtimeRefresh();
  });
}

function connectRealtime() {
  if (authenticationRequired || socket || !leaseHeld || !initialized || !client || storageReadFailed) return;
  const url = new URL("/sync/connect", location.origin);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("clientId", client.clientId);
  url.searchParams.set("branchId", "main");
  if (context?.admissionId) url.searchParams.set("admissionId", context.admissionId);
  // PartySocket supplies its existing bounded reconnect delay. Socket availability
  // does not change whether an HTTP mutation has been saved.
  socket = new ReconnectingWebSocket(url.toString());
  socket.addEventListener("open", requestRealtimeRefresh);
  socket.addEventListener("close", (event) => {
    // A server policy close may revoke access while a push is still offline or in flight.
    // Hide hosted caches immediately rather than waiting behind that unacknowledged outbox.
    if (event.code !== 1008) return;
    if (context?.mode === "hosted") blockAuthentication();
    else requestRealtimeRefresh();
  });
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    let value: unknown;
    try {
      value = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!isPoke(value) || value.seq <= client!.getSeq() || value.seq <= latestPokeSeq) return;
    latestPokeSeq = value.seq;
    requestRealtimeRefresh();
  });
}

/** A page owns its client for its whole lifetime, including React StrictMode remounts. */
function start(): Promise<void> {
  if (startTask) return startTask;
  let started!: () => void;
  startTask = new Promise<void>((resolve) => {
    started = resolve;
  });
  void (async () => {
    try {
      context = await resolveWorkspaceContext();
      if (!navigator.locks)
        throw new Error("This browser cannot safely open the workspace because Web Locks are unavailable.");
      window.addEventListener("focus", () => void refresh());
      window.addEventListener("online", () => void refresh());
      window.addEventListener("offline", publish);
      const ownLease = async () => {
        leaseHeld = true;
        phase = "starting";
        publish();
        await initialize();
        started();
        // Only a page close releases this identity's lease and its active client.
        await new Promise<void>(() => {});
      };
      const lockName = `kanbun:${workspacePersistenceKey(context)}`;
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
    } catch (failure) {
      if (failure instanceof WorkspaceContextError && failure.authenticationRequired)
        blockAuthentication(message(failure));
      phase = "failed";
      error = message(failure);
      publish();
      started();
    }
  })();
  return startTask;
}

function refresh(): Promise<void> {
  if (refreshTask) return refreshTask;
  const run = async () => {
    await start();
    if (authenticationRequired || !leaseHeld || !client) return;
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
      phase = authenticationRequired ? "failed" : "ready";
    } catch (failure) {
      error = message(failure);
      if (!authenticationRequired) initialized ||= cachedStateAvailable;
      phase = !authenticationRequired && initialized ? "ready" : "failed";
    } finally {
      connectRealtime();
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
  if (authenticationRequired || !leaseHeld || !initialized || phase !== "ready" || !client)
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
  requireAuthentication: blockAuthentication,
  createIssue(teamId: string, title: string, assigneeId?: string): void {
    const active = editableClient();
    active.mutate("issueCreate", {
      id: uuidv7(),
      teamId,
      title,
      subscriptionId: uuidv7(),
      ...(assigneeId ? { assigneeId } : {}),
    });
    publish();
    flush(active);
  },
  renameIssue(id: string, title: string): void {
    const active = editableClient();
    active.mutate("issueUpdate", { id, patch: { title } });
    publish();
    flush(active);
  },
  updateIssue(id: string, patch: { stateId?: string; priority?: 0 | 1 | 2 | 3 | 4; assigneeId?: string | null }): void {
    const active = editableClient();
    active.mutate("issueUpdate", { id, patch, ...(patch.assigneeId ? { assigneeSubscriptionId: uuidv7() } : {}) });
    publish();
    flush(active);
  },
  clearIssueStatus(id: string): void {
    const active = editableClient();
    active.mutate("issueAssertStatus", { id, stateId: null });
    publish();
    flush(active);
  },
  setIssueLabel(issueId: string, labelId: string, applied: boolean): void {
    const active = editableClient();
    active.mutate("issueLabelsSet", {
      issueId,
      add: applied ? [{ labelId, linkId: uuidv7() }] : [],
      remove: applied ? [] : [labelId],
    });
    publish();
    flush(active);
  },
  createIssueLabel(issueId: string, teamId: string, name: string): void {
    const active = editableClient();
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 60) throw new Error("Enter a label name between 1 and 60 characters.");
    const labelId = uuidv7();
    active.mutate("issueLabelCreate", { id: labelId, teamId, name: trimmed, color: "#C2321F" });
    active.mutate("issueLabelsSet", { issueId, add: [{ labelId, linkId: uuidv7() }], remove: [] });
    publish();
    flush(active);
  },
  archiveIssue(id: string, archived: boolean): void {
    const active = editableClient();
    active.mutate("issueArchive", { id, archived });
    publish();
    flush(active);
  },
  async loadComments(issueId: string): Promise<void> {
    const active = editableClient();
    await active.load("comment", issueId);
    publish();
  },
  async issueEvents(issueId: string, options: { before?: number; since?: number; signal?: AbortSignal } = {}) {
    const query = new URLSearchParams({ issueId, order: "desc" });
    if (options.before !== undefined) query.set("before", String(options.before));
    if (options.since !== undefined) query.set("since", String(options.since));
    const response = await workspaceFetch(`/sync/events?${query}`, {
      cache: "no-store",
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) throw new Error("Issue activity could not be loaded. Try again when connected.");
    return eventSchema.array().parse(await response.json());
  },
  markNotificationRead(id: string, read: boolean): void {
    const active = editableClient();
    active.mutate("notificationRead", { id, read });
    publish();
    flush(active);
  },
  postComment(issueId: string, body: string, parentId?: string, mentionedUserIds: string[] = []): void {
    const active = editableClient();
    const issue = active.get("issue", issueId);
    if (!issue || issue.number <= 0) throw new Error("Wait for issue creation to finish syncing before commenting.");
    active.mutate("commentCreate", {
      id: uuidv7(),
      issueId,
      issueIncarnation: issueIncarnation(issue),
      body,
      subscriptionId: uuidv7(),
      mentionedUserIds,
      ...(parentId ? { parentId } : {}),
    });
    publish();
    flush(active);
  },
  editComment(id: string, body: string, mentionedUserIds?: string[]): void {
    const active = editableClient();
    active.mutate("commentUpdate", { id, body, ...(mentionedUserIds ? { mentionedUserIds } : {}) });
    publish();
    flush(active);
  },
  resolveComment(id: string, resolved: boolean): void {
    const active = editableClient();
    active.mutate("commentResolve", { id, resolved });
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
