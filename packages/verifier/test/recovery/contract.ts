import type { Actor, Mutation } from "@kanbun/sync";
import type { PersistedState, MutateOptions, SyncStatus } from "@kanbun/sync/client";
import type { mutators } from "@kanbun/mutators";
import type { Row } from "@kanbun/model";

export type ActorName = "alice" | "bob";
export const actors = {
  alice: { id: "user-alice", type: "user" },
  bob: { id: "user-bob", type: "user" },
} satisfies Record<ActorName, Actor>;

export type RecoverySnapshot = {
  clientId: string;
  branchId: string;
  status: SyncStatus;
  seq: number;
  pending: number;
  pendingMutations: readonly Mutation[];
  issues: Row<"issue">[];
  errors: string[];
  startError: string | null;
};

export type RecoveryApi = {
  start(actor: ActorName, branchId?: string): Promise<RecoverySnapshot>;
  snapshot(): RecoverySnapshot;
  mutate(name: keyof typeof mutators, args: unknown, options?: MutateOptions): RecoverySnapshot;
  push(): Promise<RecoverySnapshot>;
  pull(): Promise<RecoverySnapshot>;
  persisted(): Promise<PersistedState | null>;
  newId(): string;
};

declare global {
  interface Window {
    recovery: RecoveryApi;
  }
}
