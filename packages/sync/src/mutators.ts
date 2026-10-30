/**
 * Mutator contract. A mutator is a pure function of (ctx, args) that writes
 * through ctx.store. It runs twice: optimistically on the client and
 * authoritatively on the server. It must be deterministic given the store
 * contents, `ctx.now` and `ctx.actor`; anything it needs to generate (ids)
 * must come from args so both runs agree.
 *
 * Every mutator declares its args as a Zod schema. The same schema validates
 * on the client, in the DO, and is exported as a JSON-schema tool definition
 * for agents (see toolDefinitions).
 */
import type { ActorType } from "@kanbun/model";
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
  /** Free-text reason supplied with the mutation (mainly agents). */
  reason?: string;
  /** Log entry that caused this mutation, if any. */
  causationSeq?: number;
};

export type MutatorDef<S extends z.ZodType = z.ZodType> = {
  args: S;
  /** One line for the tool catalogue. */
  description: string;
  run: (ctx: MutatorContext, args: z.infer<S>) => void;
};

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

export function defineMutator<S extends z.ZodType>(def: MutatorDef<S>): MutatorDef<S> {
  return def;
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
