/**
 * Mutators run optimistically on the client and authoritatively on the server.
 * Event mutators decide facts through a read-only store, then apply finalized
 * events through shared reducers. Legacy mutators still write through ctx.store
 * while the vocabulary is migrated. Generated ids always come from arguments.
 *
 * Every mutator declares its args as a Zod schema. The same schema validates
 * on the client, in the DO, and is exported as a JSON-schema tool definition
 * for agents (see toolDefinitions).
 */
import type { ActorType } from "@kanbun/model";
import { eventSchema, pendingEventSchema, type DomainEvent, type PendingEvent } from "@kanbun/events";
import { z } from "zod";
import type { Store } from "./store";

export type Actor = { id: string; type: ActorType };

export type MutatorContext = {
  store: Store;
  /** Who is performing the mutation. */
  actor: Actor;
  /** Convenience alias for actor.id. */
  actorId: string;
  /** ISO timestamp; the server's clock on the server, the client's locally. */
  now: string;
  /** True in the authoritative run. Gate server-only side effects (counters, notifications, jobs) on it. */
  server: boolean;
  /** Workspace branch; omitted means main for existing callers. */
  branchId?: string;
  /** Free-text reason supplied with the mutation (mainly agents). */
  reason?: string;
  /** Sync-log patch that caused this mutation, if any; resolved to an event by the authority. */
  causationSeq?: number;
};

type MutatorDescription<S extends z.ZodType> = {
  args: S;
  /** One line for the tool catalogue. */
  description: string;
};

export type DecideContext = Omit<MutatorContext, "store"> & {
  store: Pick<Store, "get" | "list" | "maxOf" | "minOf">;
};

export type LegacyMutatorDef<S extends z.ZodType = z.ZodType> = MutatorDescription<S> & {
  run(ctx: MutatorContext, args: z.infer<S>): void;
};

export type EventMutatorDef<S extends z.ZodType = z.ZodType> = MutatorDescription<S> & {
  /** A read-only decision. null explicitly selects the transitional legacy path. */
  decide(ctx: DecideContext, args: z.infer<S>): PendingEvent[] | null;
  apply(ctx: MutatorContext, event: DomainEvent): void;
  run?(ctx: MutatorContext, args: z.infer<S>): void;
};

export type MutatorDef<S extends z.ZodType = z.ZodType> = LegacyMutatorDef<S> | EventMutatorDef<S>;

export type MutatorMap = Record<string, MutatorDef>;

export type ArgsOf<M extends MutatorMap, K extends keyof M> = M[K] extends MutatorDef<infer S> ? z.input<S> : never;

export class MutationError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "forbidden" | "invalid" | "conflict" = "invalid",
  ) {
    super(message);
    this.name = "MutationError";
  }
}

export function defineMutator<S extends z.ZodType>(def: LegacyMutatorDef<S>): LegacyMutatorDef<S> {
  return def;
}

export function defineEventMutator<S extends z.ZodType>(def: EventMutatorDef<S>): EventMutatorDef<S> {
  return def;
}

/** Execute the same decision/reducer pair optimistically or in an authoritative transaction. */
export function executeMutator<S extends z.ZodType>(
  def: MutatorDef<S>,
  ctx: MutatorContext,
  args: z.infer<S>,
  commit?: (pending: PendingEvent, index: number, apply: (ctx: MutatorContext, event: DomainEvent) => void) => void,
): void {
  if (!("decide" in def)) {
    if ((ctx.branchId ?? "main") !== "main") throw new MutationError("This command is not supported on branches");
    def.run(ctx, args);
    return;
  }
  const { store } = ctx;
  const events = def.decide(
    {
      ...ctx,
      store: {
        get: (model, id) => structuredClone(store.get(model, id)),
        list: (model, where) => structuredClone(store.list(model, where)),
        maxOf: (model, column, where) => structuredClone(store.maxOf(model, column, where)),
        minOf: (model, column, where) => structuredClone(store.minOf(model, column, where)),
      },
    },
    args,
  );
  if (events === null) {
    if ((ctx.branchId ?? "main") !== "main") throw new MutationError("This command is not supported on branches");
    if (!def.run) throw new MutationError("No legacy implementation for this command");
    def.run(ctx, args);
    return;
  }
  for (const [index, raw] of events.entries()) {
    if (ctx.causationSeq !== undefined && (!Number.isSafeInteger(ctx.causationSeq) || ctx.causationSeq <= 0))
      throw new MutationError("causationSeq must be a positive safe integer");
    const pending = pendingEventSchema.parse(raw);
    if ((ctx.branchId ?? "main") !== "main" && pending.type !== "IssueCreated" && pending.type !== "IssueTitled")
      throw new MutationError("This event is not supported on branches");
    if (commit) commit(pending, index, def.apply);
    else {
      if (ctx.server) throw new Error("Authoritative events require a durable commit");
      def.apply(
        ctx,
        eventSchema.parse({
          ...pending,
          seq: 0,
          branchId: ctx.branchId ?? "main",
          txnId: "optimistic",
          eventIndex: index,
          actor: ctx.actor,
          clientId: null,
          mutationId: null,
          sessionId: null,
          sourceRef: null,
          // Only the authority can translate a patch cursor into an event sequence.
          causationSeq: null,
          reason: ctx.reason ?? null,
          ts: Date.parse(ctx.now),
        }),
      );
    }
  }
}

export function defineMutators<M extends MutatorMap>(m: M): M {
  return m;
}

/** Parse args with the mutator's schema; throws MutationError("invalid") on failure. */
export function parseArgs<S extends z.ZodType>(name: string, def: MutatorDef<S>, raw: unknown): z.infer<S> {
  const r = def.args.safeParse(raw);
  if (!r.success)
    throw new MutationError(
      `${name}: ${r.error.issues.map((i) => `${i.path.join(".") || "args"} ${i.message}`).join("; ")}`,
      "invalid",
    );
  return r.data;
}

export type ToolDefinition = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

/** Agent tool catalogue: one JSON-schema tool per mutator, straight from the Zod schemas. */
export function toolDefinitions(mutators: MutatorMap, only?: string[]): ToolDefinition[] {
  return Object.entries(mutators)
    .filter(([name]) => !only || only.length === 0 || only.includes(name))
    .map(([name, def]) => ({
      name,
      description: def.description,
      input_schema: z.toJSONSchema(def.args, { target: "draft-7", unrepresentable: "any" }) as Record<string, unknown>,
    }));
}
