/**
 * The client side of the sync engine.
 *
 *   canonical = MemoryStore of server-confirmed rows (bootstrap + pulled log)
 *   layers    = named OverlayStores stacked on canonical, each holding the
 *               effect of a batch of mutations replayed on top of the layer below
 *
 * Layer 0 is always "pending": the mutations this client has made and not yet
 * had confirmed. Further layers are proposals: batches (typically from an
 * agent) that render as a labelled optimistic view and are not pushed until
 * accepted. Accepting a proposal replays its mutations through mutate().
 *
 * pull(): apply the log to canonical, drop confirmed mutations, then rebuild
 * every layer by replaying its mutations. That rebuild is the rebase.
 *
 * Every replay runs in a scratch overlay that is absorbed into the layer only
 * if the mutator succeeds, so a failing mutation never leaves half its writes
 * behind. A pending mutation that fails to replay is still pushed: the local
 * run is a prediction and the server's verdict is the one that counts, and
 * skipping it would open a gap in the mutation sequence.
 */
import { modelNames, type ModelName, type Row } from "@kanbun/model";
import {
  executeMutator,
  MutationError,
  parseArgs,
  type Actor,
  type ArgsOf,
  type MutatorContext,
  type MutatorMap,
} from "../mutators";
import type { LogEntry, Mutation, Transport } from "../protocol";
import { normalizeRow } from "../rows";
import { MemoryStore, OverlayStore, type PoolChange, type ReadableStore, type Where } from "../store";
import type { Persister, PersistedState } from "./persister";

export type ClientOptions<M extends MutatorMap> = {
  transport: Transport;
  mutators: M;
  actor: Actor;
  persister?: Persister;
  clientId?: string;
  /** Fixed for this client's lifetime; use a separate client and persister per branch. */
  branchId?: string;
  now?: () => string;
  /** Debounce before a push after a mutation, ms. */
  pushDelayMs?: number;
  onError?: (e: unknown) => void;
  onRejected?: (m: Mutation, error: string) => void;
};

export type SyncStatus = "idle" | "bootstrapping" | "syncing" | "offline" | "error";

export type MutateOptions = { reason?: string; causationSeq?: number };

type Listener = () => void;

type Layer = { name: string; store: OverlayStore; mutations: Mutation[]; actor: Actor };

export const PENDING = "pending";

export class SyncClient<M extends MutatorMap> {
  readonly canonical = new MemoryStore();
  readonly branchId: string;
  /** Stable per installation: recovered from the persister on start() unless the caller fixed it. */
  clientId: string;

  private layers: Layer[] = [];
  private nextMutationId = 1;
  private seq = 0;
  private lastConfirmed = 0;
  private status: SyncStatus = "idle";
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private pushing: Promise<void> | null = null;
  private pulling: Promise<void> | null = null;
  private pullAgain = false;
  private readonly now: () => string;
  private readonly pushDelayMs: number;
  private modelVersions = new Map<ModelName, number>();
  private modelListeners = new Map<ModelName, Set<Listener>>();
  private statusListeners = new Set<Listener>();
  private loaded = new Set<string>();

  constructor(private readonly opts: ClientOptions<M>) {
    this.clientId = opts.clientId ?? cryptoId();
    this.branchId = opts.branchId ?? "main";
    if (!this.branchId) throw new MutationError("branchId must not be empty");
    this.now = opts.now ?? (() => new Date().toISOString());
    this.pushDelayMs = opts.pushDelayMs ?? 10;
    this.layers = [{ name: PENDING, store: new OverlayStore(this.canonical), mutations: [], actor: opts.actor }];
  }

  // ---- public state ------------------------------------------------------------

  /** The top of the stack: canonical + pending + every proposal layer. */
  get view(): ReadableStore {
    return this.layers.at(-1)!.store;
  }
  /** The view up to and including a named layer ("pending" = without proposals). */
  viewAt(layerName: string): ReadableStore {
    const l = this.layers.find((x) => x.name === layerName);
    if (!l) throw new Error(`no layer ${layerName}`);
    return l.store;
  }
  get<N extends ModelName>(model: N, id: string): Row<N> | undefined {
    return this.view.get(model, id);
  }
  list<N extends ModelName>(model: N, where?: Where<N>): Row<N>[] {
    return this.view.list(model, where);
  }
  getStatus(): SyncStatus {
    return this.status;
  }
  getSeq(): number {
    return this.seq;
  }
  pendingCount(): number {
    return this.pending.mutations.length;
  }
  layerNames(): string[] {
    return this.layers.map((l) => l.name);
  }
  private get pending(): Layer {
    return this.layers[0]!;
  }

  /** Version counter per model; bumps on any change. For useSyncExternalStore. */
  version(model: ModelName): number {
    return this.modelVersions.get(model) ?? 0;
  }
  subscribe(model: ModelName, l: Listener): () => void {
    let s = this.modelListeners.get(model);
    if (!s) {
      s = new Set();
      this.modelListeners.set(model, s);
    }
    s.add(l);
    return () => s!.delete(l);
  }
  subscribeStatus(l: Listener): () => void {
    this.statusListeners.add(l);
    return () => this.statusListeners.delete(l);
  }

  // ---- lifecycle ------------------------------------------------------------------

  /**
   * Restore from the persister if possible, otherwise bootstrap from the server.
   * The persisted client id is adopted when the caller did not pin one, so the
   * server's per-client mutation counter carries across page loads.
   */
  async start(): Promise<void> {
    const saved = await this.opts.persister?.load();
    const sameUser = saved?.userId === this.opts.actor.id;
    if (saved && sameUser && (saved.branchId ?? "main") !== this.branchId) {
      this.setStatus("error");
      throw new MutationError("Persisted state belongs to another branch; use a separate persister", "conflict");
    }
    if (saved && sameUser && !this.opts.clientId) this.clientId = saved.clientId;
    if (saved && sameUser && saved.clientId === this.clientId) {
      this.restore(saved);
      await this.pull();
    } else {
      await this.bootstrap();
    }
    if (this.pending.mutations.length) this.schedulePush();
  }

  private restore(s: PersistedState): void {
    this.seq = s.seq;
    this.lastConfirmed = s.lastMutationId;
    this.pending.mutations = s.pending;
    this.nextMutationId = (s.pending.at(-1)?.id ?? s.lastMutationId) + 1;
    for (const [model, rows] of Object.entries(s.rows) as [ModelName, Record<string, unknown>[]][]) {
      for (const r of rows) this.canonical.put(model, r as never);
    }
    this.rebase(modelNames);
  }

  private assertBranch(response: { branchId?: string }): void {
    if ((response.branchId ?? "main") !== this.branchId)
      throw new MutationError("Sync response belongs to another branch", "conflict");
  }

  async bootstrap(): Promise<void> {
    this.setStatus("bootstrapping");
    try {
      const b = await this.opts.transport.bootstrap(this.clientId, this.branchId);
      this.assertBranch(b);
      this.canonical.tables.clear();
      this.loaded.clear();
      for (const [model, rows] of Object.entries(b.rows) as [ModelName, Record<string, unknown>[]][]) {
        for (const r of rows) this.canonical.put(model, r as never);
      }
      this.seq = b.seq;
      this.lastConfirmed = b.lastMutationId;
      this.dropConfirmed();
      this.rebase(modelNames);
      this.setStatus("idle");
      await this.persist();
    } catch (e) {
      this.setStatus("error");
      this.opts.onError?.(e);
      throw e;
    }
  }

  // ---- mutations -----------------------------------------------------------------------

  /** Apply a mutation optimistically and queue it for push. Throws if it fails locally. */
  mutate<K extends keyof M & string>(name: K, args: ArgsOf<M, K>, options: MutateOptions = {}): void {
    const m: Mutation = { id: this.nextMutationId, name, args, ts: this.now(), ...options };
    const changes = this.runInLayer(this.pending, m);
    this.nextMutationId++;
    this.pending.mutations.push(m);
    // Layers above pending were built on the old pending state.
    changes.push(...this.rebuildFrom(1));
    this.notify(changes);
    this.schedulePush();
    void this.persist();
  }

  /**
   * Run one mutation against a layer, in a scratch overlay. On success the
   * scratch is absorbed and the rows it touched are returned; on failure
   * nothing is kept and the error propagates.
   */
  private runInLayer(layer: Layer, m: Mutation): PoolChange[] {
    const def = this.opts.mutators[m.name];
    if (!def) throw new MutationError(`unknown mutator ${m.name}`);
    const scratch = new OverlayStore(layer.store);
    const ctx: MutatorContext = {
      store: scratch,
      actor: layer.actor,
      actorId: layer.actor.id,
      now: m.ts,
      server: false,
      branchId: this.branchId,
      ...(m.reason !== undefined ? { reason: m.reason } : {}),
      ...(m.causationSeq !== undefined ? { causationSeq: m.causationSeq } : {}),
    };
    executeMutator(def, ctx, parseArgs(m.name, def, m.args));
    layer.store.absorb(scratch);
    return scratch.touched();
  }

  // ---- proposals (named layers) ----------------------------------------------------------

  /** Create an empty layer on top of the stack. */
  addLayer(name: string, actor: Actor = this.opts.actor): void {
    if (this.layers.some((l) => l.name === name)) throw new Error(`layer ${name} exists`);
    const below = this.layers.at(-1)!.store;
    this.layers.push({ name, store: new OverlayStore(below), mutations: [], actor });
  }

  /** Apply a mutation inside a named layer without queueing it for push. Layers above it are rebuilt. */
  mutateIn<K extends keyof M & string>(
    layerName: string,
    name: K,
    args: ArgsOf<M, K>,
    options: MutateOptions = {},
  ): void {
    const i = this.layers.findIndex((l) => l.name === layerName);
    const layer = this.layers[i];
    if (!layer || layer.name === PENDING) throw new Error(`no proposal layer ${layerName}`);
    const m: Mutation = { id: layer.mutations.length + 1, name, args, ts: this.now(), ...options };
    const changes = this.runInLayer(layer, m);
    layer.mutations.push(m);
    changes.push(...this.rebuildFrom(i + 1));
    this.notify(changes);
  }

  /** Discard a layer and everything it changed. */
  removeLayer(name: string): void {
    if (name === PENDING) throw new Error("cannot remove the pending layer");
    const i = this.layers.findIndex((l) => l.name === name);
    if (i < 0) return;
    this.layers.splice(i, 1);
    this.rebase(modelNames);
  }

  /** Accept a layer: replay its mutations through mutate() so they are pushed, then drop the layer. */
  acceptLayer(name: string): void {
    const layer = this.layers.find((l) => l.name === name);
    if (!layer || name === PENDING) throw new Error(`no proposal layer ${name}`);
    const batch = [...layer.mutations];
    this.removeLayer(name);
    for (const m of batch) {
      const opts: MutateOptions = {};
      if (m.reason !== undefined) opts.reason = m.reason;
      if (m.causationSeq !== undefined) opts.causationSeq = m.causationSeq;
      this.mutate(m.name as keyof M & string, m.args as never, opts);
    }
  }

  layerMutations(name: string): readonly Mutation[] {
    return this.layers.find((l) => l.name === name)?.mutations ?? [];
  }

  // ---- push --------------------------------------------------------------------------------

  private schedulePush(): void {
    if (this.pushTimer) return;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.push();
    }, this.pushDelayMs);
  }

  async push(): Promise<void> {
    if (this.pushing) return this.pushing;
    if (this.pending.mutations.length === 0) return;
    const run = async () => {
      try {
        let gaps = 0;
        while (this.pending.mutations.length) {
          const batch = this.pending.mutations.slice(0, 200);
          this.setStatus("syncing");
          const res = await this.opts.transport.push({
            clientId: this.clientId,
            mutations: batch,
            branchId: this.branchId,
          });
          if (!res.ok) {
            // The server is ahead of us (another tab, or a lost response): resync and retry, but not forever.
            if (res.code === "gap" && ++gaps <= 3) {
              await this.pull();
              continue;
            }
            throw new Error(`push failed: ${res.error}`);
          }
          this.assertBranch(res);
          for (const r of res.rejected) {
            const m = this.pending.mutations.find((p) => p.id === r.id);
            if (m) this.opts.onRejected?.(m, r.error);
          }
          this.lastConfirmed = Math.max(this.lastConfirmed, res.lastMutationId);
          if (res.seq > this.seq) await this.pull();
          else {
            this.dropConfirmed();
            this.rebase([]);
          }
        }
        this.setStatus("idle");
      } catch (e) {
        this.setStatus("offline");
        this.opts.onError?.(e);
      }
    };
    // The promise is assigned before its finally can run (finally is always a microtask),
    // so a synchronously-completing body cannot leave a stale promise behind.
    const p: Promise<void> = run().finally(() => {
      if (this.pushing === p) this.pushing = null;
    });
    this.pushing = p;
    return p;
  }

  // ---- pull / rebase ---------------------------------------------------------------------

  /**
   * Called on a poke or after a push. Coalesces concurrent calls. Rejects on
   * failure (after reporting it) so callers that depend on being up to date,
   * such as a push recovering from a gap, do not carry on with stale state.
   */
  async pull(): Promise<void> {
    if (this.pulling) {
      this.pullAgain = true;
      return this.pulling;
    }
    const run = async () => {
      try {
        do {
          this.pullAgain = false;
          const res = await this.opts.transport.pull({
            clientId: this.clientId,
            since: this.seq,
            branchId: this.branchId,
          });
          this.assertBranch(res);
          if (res.reset) {
            await this.bootstrap();
            continue;
          }
          this.lastConfirmed = Math.max(this.lastConfirmed, res.lastMutationId);
          const touched = this.applyLog(res.entries);
          this.seq = res.seq;
          this.dropConfirmed();
          this.rebase(touched);
          await this.persist();
        } while (this.pullAgain);
        if (this.status !== "syncing") this.setStatus("idle");
      } catch (e) {
        this.setStatus("offline");
        this.opts.onError?.(e);
        throw e;
      }
    };
    const p: Promise<void> = run().finally(() => {
      if (this.pulling === p) this.pulling = null;
    });
    this.pulling = p;
    return p;
  }

  private applyLog(entries: LogEntry[]): Set<ModelName> {
    const touched = new Set<ModelName>();
    for (const e of entries) {
      touched.add(e.model);
      if (e.op === "delete") this.canonical.delete(e.model, e.id);
      else if (e.patch) {
        if (this.canonical.get(e.model, e.id)) this.canonical.applyUpsert(e.model, e.id, e.patch);
        else {
          // A row we never saw: materialise only if the patch is a full row (an insert).
          try {
            this.canonical.put(e.model, normalizeRow(e.model, e.patch) as never);
          } catch {
            /* partial patch for an unknown row (an unloaded on-demand model): ignore until loaded */
          }
        }
      }
    }
    return touched;
  }

  private dropConfirmed(): void {
    this.pending.mutations = this.pending.mutations.filter((m) => m.id > this.lastConfirmed);
  }

  /** Rebuild every layer from canonical by replaying its mutations in order. */
  private rebase(touchedModels: Iterable<ModelName>): void {
    const changes = this.rebuildFrom(0);
    for (const model of touchedModels) changes.push({ model, id: "*", op: "upsert" });
    this.notify(changes);
  }

  /**
   * Rebuild layers `from` and above on top of whatever is below them, replaying
   * each layer's mutations. Returns the rows touched before and after.
   *
   * A pending mutation that no longer applies stays queued (the server decides;
   * removing it would leave a hole in the sequence) and is reported through
   * onRejected as a prediction. A proposal mutation that fails is dropped.
   */
  private rebuildFrom(from: number): PoolChange[] {
    const changes: PoolChange[] = [];
    let below: ReadableStore = from === 0 ? this.canonical : this.layers[from - 1]!.store;
    for (let i = from; i < this.layers.length; i++) {
      const layer = this.layers[i]!;
      changes.push(...layer.store.touched());
      layer.store = new OverlayStore(below);
      const survivors: Mutation[] = [];
      for (const m of layer.mutations) {
        try {
          changes.push(...this.runInLayer(layer, m));
          survivors.push(m);
        } catch (e) {
          this.opts.onRejected?.(m, e instanceof Error ? e.message : String(e));
          if (layer.name === PENDING) survivors.push(m);
        }
      }
      layer.mutations = survivors;
      below = layer.store;
    }
    return changes;
  }

  // ---- on-demand loading -------------------------------------------------------------------

  /**
   * Fetch an on-demand model's rows for one parent. The rows are a snapshot at
   * the server's `seq`; if a pull moved us past it while the request was in
   * flight the snapshot could overwrite newer state, so it is fetched again.
   */
  async load(model: ModelName, parentId: string): Promise<void> {
    const key = `${model}/${parentId}`;
    if (this.loaded.has(key)) return;
    for (let attempt = 0; ; attempt++) {
      const res = await this.opts.transport.load({ model, parentId, branchId: this.branchId });
      this.assertBranch(res);
      if (res.seq >= this.seq || attempt >= 3) {
        for (const r of res.rows) this.canonical.put(model, r as never);
        break;
      }
    }
    this.loaded.add(key);
    this.rebase([model]);
  }
  isLoaded(model: ModelName, parentId: string): boolean {
    return this.loaded.has(`${model}/${parentId}`);
  }

  // ---- internals -------------------------------------------------------------------------------

  private notify(changes: PoolChange[]): void {
    const touched = new Set<ModelName>();
    for (const c of changes) touched.add(c.model);
    for (const model of touched) {
      this.modelVersions.set(model, (this.modelVersions.get(model) ?? 0) + 1);
      for (const l of this.modelListeners.get(model) ?? []) l();
    }
  }

  private setStatus(s: SyncStatus): void {
    if (this.status === s) return;
    this.status = s;
    for (const l of this.statusListeners) l();
  }

  private async persist(): Promise<void> {
    if (!this.opts.persister) return;
    const rows: PersistedState["rows"] = {};
    for (const [model, t] of this.canonical.tables) rows[model] = [...t.values()];
    await this.opts.persister.save({
      clientId: this.clientId,
      userId: this.opts.actor.id,
      branchId: this.branchId,
      seq: this.seq,
      lastMutationId: this.lastConfirmed,
      pending: this.pending.mutations,
      rows,
    });
  }
}

function cryptoId(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
