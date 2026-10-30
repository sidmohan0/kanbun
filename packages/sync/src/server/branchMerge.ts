import { eventSchema, type DomainEvent } from "@kanbun/events";
import type { BranchScope, WorkspaceBranch } from "@kanbun/model";
import { z } from "zod";
import { executeMutator, MutationError, parseArgs, type Actor, type MutatorMap } from "../mutators";
import type { SqlDriver } from "./driver";
import { appendEvent, decodeEvent } from "./eventLog";
import type { SqliteStore } from "./sqliteStore";

const resolutionSchema = z.discriminatedUnion("choice", [
  z.strictObject({ issueId: z.string().min(1), choice: z.literal("branch") }),
  z.strictObject({ issueId: z.string().min(1), choice: z.literal("main") }),
  z.strictObject({
    issueId: z.string().min(1),
    choice: z.literal("edit"),
    title: z.string().trim().min(1).max(500),
  }),
]);
const mergeSchema = z.strictObject({
  branchId: z.uuidv7(),
  mergeId: z.uuidv7(),
  expectedBranchHeadSeq: z.number().int().nonnegative(),
  expectedMainSyncSeq: z.number().int().nonnegative(),
  resolutions: z.array(resolutionSchema).default([]),
});

export type MergeBranchOptions = z.input<typeof mergeSchema>;
export type BranchResolution = z.infer<typeof resolutionSchema>;
export type BranchChange = { issueId: string; title: string; kind: "create" | "rename" };
export type BranchConflict = {
  issueId: string;
  reason: "main_changed" | "issue_missing" | "issue_unavailable" | "issue_exists";
  mainTitle: string | null;
  branchTitle: string;
};
export type BranchPreview = {
  branchId: string;
  branchHeadSeq: number;
  mainSyncSeq: number;
  changes: BranchChange[];
  conflicts: BranchConflict[];
};
export type BranchMergeReceipt = {
  ok: true;
  branchId: string;
  mergeId: string;
  mergeEventSeq: number;
  mainSyncSeq: number;
  appliedEvents: number;
  skippedEntities: number;
};
export type BranchMergeResult = BranchMergeReceipt | { ok: false; preview: BranchPreview };
type IssueEvent = Extract<DomainEvent, { type: "IssueCreated" | "IssueTitled" }>;

type Options = {
  driver: SqlDriver;
  store: SqliteStore;
  mutators: MutatorMap;
  getBranch(actor: Actor, branchId: string): WorkspaceBranch;
  visibleTeamIds(actor: Actor): string[];
  enforceScopes(scope: BranchScope, txnId: string): void;
  currentSeq(): number;
  now(): string;
  newTxnId(): string;
};

/** Human review and atomic replay of the supported branch vocabulary onto main. */
export class BranchMerger {
  constructor(private readonly opts: Options) {}

  private authorize(actor: Actor, branchId: string): WorkspaceBranch {
    if (actor.type !== "user") throw new MutationError("Only a human can merge a workspace branch", "forbidden");
    // getBranch checks active membership and captured ownership even for closed branches.
    return this.opts.getBranch(actor, branchId);
  }

  private delta(branchId: string): { events: IssueEvent[]; head: number } {
    const events: IssueEvent[] = [];
    let head = 0;
    for (const row of this.opts.driver.all("SELECT * FROM event_log WHERE branch_id = ? ORDER BY seq", [branchId])) {
      const event = decodeEvent(row);
      head = event.seq;
      if (event.type === "BranchCreated") continue;
      if (event.type !== "IssueCreated" && event.type !== "IssueTitled")
        throw new MutationError("Branch contains an unsupported event", "invalid");
      events.push(event);
    }
    return { events, head };
  }

  private inspect(actor: Actor, branch: WorkspaceBranch) {
    if (branch.status !== "open") throw new MutationError("Workspace branch is not open", "conflict");
    if (branch.baseSyncSeq === null)
      throw new MutationError("Branch has no reliable patch baseline; recreate it before merging", "conflict");
    const { events, head } = this.delta(branch.id);
    const teams = this.opts.visibleTeamIds(actor);
    const changes = new Map<string, BranchChange>();
    for (const event of events) {
      if (!teams.includes(event.teamId)) throw new MutationError("Branch team is no longer visible", "forbidden");
      const previous = changes.get(event.entityId);
      changes.set(event.entityId, {
        issueId: event.entityId,
        title: event.payload.title,
        kind: event.type === "IssueCreated" || previous?.kind === "create" ? "create" : "rename",
      });
    }
    const conflicts: BranchConflict[] = [];
    for (const change of changes.values()) {
      const main = this.opts.store.get("issue", change.issueId);
      if (main && !teams.includes(main.teamId)) throw new MutationError("Main issue is no longer visible", "forbidden");
      const changed = this.opts.driver.all(
        "SELECT 1 FROM sync_log WHERE branch_id = 'main' AND model = 'issue' AND row_id = ? AND seq > ? LIMIT 1",
        [change.issueId, branch.baseSyncSeq],
      ).length;
      const reason: BranchConflict["reason"] | undefined =
        change.kind === "create" && main
          ? "issue_exists"
          : change.kind === "rename" && !main
            ? "issue_missing"
            : main && (main.trashed || main.archivedAt)
              ? "issue_unavailable"
              : changed
                ? "main_changed"
                : undefined;
      if (reason)
        conflicts.push({ issueId: change.issueId, reason, mainTitle: main?.title ?? null, branchTitle: change.title });
    }
    return {
      events,
      preview: {
        branchId: branch.id,
        branchHeadSeq: head,
        mainSyncSeq: this.opts.currentSeq(),
        changes: [...changes.values()],
        conflicts,
      } satisfies BranchPreview,
    };
  }

  preview(actor: Actor, branchId: string): BranchPreview {
    return this.opts.driver.transaction(() => this.inspect(actor, this.authorize(actor, branchId)).preview);
  }

  merge(actor: Actor, input: MergeBranchOptions): BranchMergeResult {
    const parsed = mergeSchema.safeParse(input);
    if (!parsed.success) throw new MutationError(`Invalid branch merge: ${parsed.error.message}`);
    const request = parsed.data;
    request.resolutions.sort((a, b) => (a.issueId < b.issueId ? -1 : a.issueId > b.issueId ? 1 : 0));
    if (new Set(request.resolutions.map((resolution) => resolution.issueId)).size !== request.resolutions.length)
      throw new MutationError("Only one resolution is allowed per issue");
    const requestJson = JSON.stringify(request);
    return this.opts.driver.transaction(() => {
      const branch = this.authorize(actor, request.branchId);
      const previous = this.opts.driver.all("SELECT * FROM branch_merge WHERE branch_id = ? OR id = ?", [
        branch.id,
        request.mergeId,
      ])[0];
      if (previous) {
        if (previous["actor_id"] !== actor.id || previous["request"] !== requestJson)
          throw new MutationError("Merge id or branch already has a different merge request", "conflict");
        return JSON.parse(String(previous["result"])) as BranchMergeReceipt;
      }
      const { events, preview } = this.inspect(actor, branch);
      if (
        request.expectedBranchHeadSeq !== preview.branchHeadSeq ||
        request.expectedMainSyncSeq !== preview.mainSyncSeq
      )
        throw new MutationError("Workspace changed since preview; review the branch again", "conflict");
      const conflicts = new Map(preview.conflicts.map((conflict) => [conflict.issueId, conflict]));
      for (const resolution of request.resolutions)
        if (!conflicts.has(resolution.issueId)) throw new MutationError("Resolution does not match a current conflict");
      const resolutions = new Map(request.resolutions.map((resolution) => [resolution.issueId, resolution]));
      if (preview.conflicts.some((conflict) => !resolutions.has(conflict.issueId))) return { ok: false, preview };

      const skipped = request.resolutions.filter((resolution) => resolution.choice === "main").map((r) => r.issueId);
      const selected = events.filter((event) => !skipped.includes(event.entityId));
      const txnId = this.opts.newTxnId();
      const now = this.opts.now();
      let eventIndex = 0;
      const provenance = {
        actor,
        txnId,
        clientId: null,
        mutationId: null,
        ts: Date.parse(now),
        reason: null,
        branchId: "main",
      };
      const merge = appendEvent(
        this.opts.driver,
        {
          type: "BranchMerged",
          entityType: "workspaceBranch",
          entityId: branch.id,
          teamId: null,
          scopeUserId: branch.ownerUserId,
          payload: {
            mergeId: request.mergeId,
            branchHeadSeq: preview.branchHeadSeq,
            sourceEventSeqs: selected.map((event) => event.seq),
            skippedEntityIds: skipped,
          },
        },
        { ...provenance, eventIndex: eventIndex++, causationSeq: null },
      );
      for (const resolution of request.resolutions)
        appendEvent(
          this.opts.driver,
          {
            type: "BranchConflictResolved",
            entityType: "workspaceBranch",
            entityId: branch.id,
            teamId: null,
            scopeUserId: branch.ownerUserId,
            payload: { ...resolution, mergeId: request.mergeId, mainSyncSeq: preview.mainSyncSeq },
          },
          { ...provenance, eventIndex: eventIndex++, causationSeq: merge.seq },
        );
      let appliedEvents = 0;
      for (const [index, source] of selected.entries()) {
        const main = this.opts.store.get("issue", source.entityId);
        if (source.type === "IssueTitled" && (!main || main.trashed || main.archivedAt))
          throw new MutationError("Issue is missing, archived, or trashed on main", "conflict");
        // An edit replaces the entity's final proposed title, after preserving its creation/dependencies.
        const resolution = resolutions.get(source.entityId);
        const last = !selected.slice(index + 1).some((later) => later.entityId === source.entityId);
        const replay =
          last && resolution?.choice === "edit"
            ? eventSchema.parse({ ...source, payload: { ...source.payload, title: resolution.title } })
            : source;
        const match = Object.entries(this.opts.mutators)
          .map(([name, def]) => ({ name, def, args: "decide" in def ? def.replayArgs?.(replay) : undefined }))
          .find((candidate) => candidate.args !== undefined);
        if (!match || !("decide" in match.def)) throw new MutationError("No command can replay this branch event");
        let replayed = 0;
        executeMutator(
          match.def,
          {
            store: this.opts.store,
            actor,
            actorId: actor.id,
            now,
            server: true,
            branchId: "main",
          },
          parseArgs(match.name, match.def, match.args),
          (pending, _index, apply) => {
            if (pending.type !== source.type || pending.entityId !== source.entityId)
              throw new MutationError("Replayed decision does not match its branch event");
            const event = appendEvent(this.opts.driver, pending, {
              ...provenance,
              eventIndex: eventIndex++,
              // This is already a semantic sequence, never a patch cursor.
              causationSeq: merge.seq,
            });
            apply(
              {
                store: this.opts.store.withTag({
                  actorId: actor.id,
                  actorType: actor.type,
                  clientId: null,
                  mutationId: null,
                  txnId,
                  eventSeq: event.seq,
                  ts: now,
                  // No source patch caused this operation; semantic causation lives on the event.
                  causationSeq: null,
                  reason: null,
                  branchId: "main",
                }),
                actor,
                actorId: actor.id,
                now,
                server: true,
                branchId: "main",
              },
              event,
            );
            appliedEvents++;
            replayed++;
          },
        );
        if (replayed !== 1) throw new MutationError("Each branch fact must replay as one semantic event");
      }
      this.opts.enforceScopes(branch.scope, txnId);
      this.opts.driver.run("UPDATE workspace_branch SET status = 'merged' WHERE id = ?", [branch.id]);
      this.opts.driver.run("DELETE FROM branch_row WHERE branch_id = ?", [branch.id]);
      const receipt: BranchMergeReceipt = {
        ok: true,
        branchId: branch.id,
        mergeId: request.mergeId,
        mergeEventSeq: merge.seq,
        mainSyncSeq: this.opts.currentSeq(),
        appliedEvents,
        skippedEntities: skipped.length,
      };
      this.opts.driver.run(
        "INSERT INTO branch_merge (branch_id, id, actor_id, request, result) VALUES (?, ?, ?, ?, ?)",
        [branch.id, request.mergeId, actor.id, requestJson, JSON.stringify(receipt)],
      );
      return receipt;
    });
  }
}
