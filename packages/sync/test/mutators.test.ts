import { expect, it } from "vitest";
import { z } from "zod";
import { defineEventMutator, executeMutator, MemoryStore } from "../src";

it("keeps JSON extrema reads isolated from the state used by a decision", () => {
  const store = new MemoryStore();
  const now = "2026-10-29T12:00:00.000Z";
  store.insert("agent", {
    id: "agent-1",
    name: "Triage agent",
    description: null,
    avatarUrl: null,
    ownerId: "alice",
    mode: "commit",
    scopes: { teamIds: ["visible-team"], projectIds: ["visible-project"], mutators: ["issueCreate"] },
    rateBudget: 600,
    active: true,
    lastActiveAt: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  });
  const command = defineEventMutator({
    args: z.object({}),
    description: "Inspect configured scopes without emitting events",
    decide(ctx) {
      const maximum = ctx.store.maxOf("agent", "scopes");
      const minimum = ctx.store.minOf("agent", "scopes");
      if (!maximum || !minimum) throw new Error("Missing fixture scopes");
      maximum.teamIds.push("unrecorded-team");
      minimum.projectIds.push("unrecorded-project");
      return [];
    },
    apply() {
      throw new Error("A decision without events must not apply a reducer");
    },
  });

  executeMutator(command, { store, actor: { id: "alice", type: "user" }, actorId: "alice", now, server: false }, {});

  expect(store.get("agent", "agent-1")?.scopes).toEqual({
    teamIds: ["visible-team"],
    projectIds: ["visible-project"],
    mutators: ["issueCreate"],
  });
});
