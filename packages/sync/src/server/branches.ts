import type { BranchScope, WorkspaceBranch } from "@kanbun/model";
import { branchScopeSchema, type BranchCreatedEvent } from "@kanbun/events";
import { z } from "zod";
import { MutationError, type Actor } from "../mutators";
import type { SqlDriver, SqlRow } from "./driver";
import { appendEvent } from "./eventLog";
import type { SqliteStore } from "./sqliteStore";

const createSchema = z.strictObject({
  id: z.uuidv7(),
  name: z.string().trim().min(1).max(160),
  scope: branchScopeSchema.optional(),
});

export type CreateBranchOptions = {
  id: string;
  name: string;
  scope?: { teamIds?: string[]; projectIds?: string[] };
};

type Permissions = { userId: string; teamIds: string[]; projectIds: string[] };

/** Durable branch metadata and ownership; projection writes live in SqliteBranchStore. */
export class WorkspaceBranches {
  constructor(
    private readonly driver: SqlDriver,
    private readonly store: SqliteStore,
    private readonly permissions: (actor: Actor) => Permissions,
    private readonly now: () => string,
    private readonly newTxnId: () => string,
  ) {}

  private decode(row: SqlRow): WorkspaceBranch {
    return {
      id: String(row["id"]),
      name: String(row["name"]),
      baseSeq: Number(row["base_seq"]),
      baseSyncSeq: row["base_sync_seq"] == null ? null : Number(row["base_sync_seq"]),
      ownerId: String(row["owner_id"]),
      ownerType: row["owner_type"] as WorkspaceBranch["ownerType"],
      ownerUserId: String(row["owner_user_id"]),
      status: row["status"] as WorkspaceBranch["status"],
      scope: branchScopeSchema.parse(JSON.parse(String(row["scope"]))),
      createdAt: String(row["created_at"]),
    };
  }

  get(actor: Actor, id: string): WorkspaceBranch {
    const permission = actor.type === "system" ? null : this.permissions(actor);
    const row = this.driver.all("SELECT * FROM workspace_branch WHERE id = ?", [id])[0];
    if (!row) throw new MutationError("workspace branch not found", "forbidden");
    const branch = this.decode(row);
    const owner =
      branch.ownerId === actor.id && branch.ownerType === actor.type && permission?.userId === branch.ownerUserId;
    const humanOwner = actor.type === "user" && actor.id === branch.ownerUserId;
    if (actor.type !== "system" && !owner && !humanOwner)
      throw new MutationError("workspace branch not found", "forbidden");
    return branch;
  }

  private applyCreated(event: BranchCreatedEvent): WorkspaceBranch {
    const branch: WorkspaceBranch = {
      id: event.entityId,
      ...event.payload,
      baseSyncSeq: event.payload.baseSyncSeq ?? null,
      status: "open",
      createdAt: new Date(event.ts).toISOString(),
    };
    this.driver.run(
      "INSERT INTO workspace_branch (id, name, base_seq, base_sync_seq, owner_id, owner_type, owner_user_id, status, scope, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        branch.id,
        branch.name,
        branch.baseSeq,
        branch.baseSyncSeq,
        branch.ownerId,
        branch.ownerType,
        branch.ownerUserId,
        branch.status,
        JSON.stringify(branch.scope),
        branch.createdAt,
      ],
    );
    return branch;
  }

  create(actor: Actor, input: CreateBranchOptions): WorkspaceBranch {
    if (actor.type !== "user" && actor.type !== "agent")
      throw new MutationError("Only users and agents can create workspace branches", "forbidden");
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) throw new MutationError(`Invalid workspace branch: ${parsed.error.message}`);
    const permission = this.permissions(actor);
    const scope: BranchScope = {
      teamIds: [...new Set(parsed.data.scope?.teamIds ?? [])].sort(),
      projectIds: [...new Set(parsed.data.scope?.projectIds ?? [])].sort(),
    };
    for (const teamId of scope.teamIds) {
      const team = this.store.get("team", teamId);
      if (!team || team.archivedAt || !permission.teamIds.includes(teamId))
        throw new MutationError("Branch team scope is not accessible", "forbidden");
    }
    for (const projectId of scope.projectIds) {
      const project = this.store.get("project", projectId);
      if (
        !project ||
        project.archivedAt ||
        (permission.projectIds.length && !permission.projectIds.includes(projectId))
      )
        throw new MutationError("Branch project scope is not accessible", "forbidden");
    }
    return this.driver.transaction(() => {
      if (this.driver.all("SELECT id FROM workspace_branch WHERE id = ?", [parsed.data.id]).length) {
        const existing = this.get(actor, parsed.data.id);
        if (existing.name !== parsed.data.name || JSON.stringify(existing.scope) !== JSON.stringify(scope))
          throw new MutationError("Branch id already has different settings", "conflict");
        return existing;
      }
      const baseSeq = Number(
        this.driver.all("SELECT COALESCE(MAX(seq), 0) AS seq FROM event_log WHERE branch_id = 'main'")[0]?.["seq"] ?? 0,
      );
      const createdAt = this.now();
      const baseSyncSeq = Number(
        this.driver.all("SELECT COALESCE(MAX(seq), 0) AS seq FROM sync_log WHERE branch_id = 'main'")[0]?.["seq"] ?? 0,
      );
      const event = appendEvent(
        this.driver,
        {
          type: "BranchCreated",
          entityType: "workspaceBranch",
          entityId: parsed.data.id,
          teamId: null,
          scopeUserId: permission.userId,
          payload: {
            name: parsed.data.name,
            baseSeq,
            baseSyncSeq,
            ownerId: actor.id,
            ownerType: actor.type,
            ownerUserId: permission.userId,
            scope,
          },
        },
        {
          actor,
          txnId: this.newTxnId(),
          eventIndex: 0,
          clientId: null,
          mutationId: null,
          ts: Date.parse(createdAt),
          causationSeq: null,
          reason: null,
          branchId: parsed.data.id,
        },
      );
      if (event.type !== "BranchCreated") throw new Error("Expected a branch creation event");
      return this.applyCreated(event);
    });
  }
}
