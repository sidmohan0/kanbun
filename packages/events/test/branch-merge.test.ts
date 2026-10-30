import { expect, it } from "vitest";
import { branchConflictResolvedPayloadSchema, eventSchema } from "../src";

it("decodes historical branch creation facts without inventing a patch baseline", () => {
  const historical = {
    seq: 6,
    eventIndex: 0,
    branchId: "branch-1",
    txnId: "creation-1",
    type: "BranchCreated",
    entityType: "workspaceBranch",
    entityId: "branch-1",
    teamId: null,
    scopeUserId: "alice",
    actor: { id: "alice", type: "user" },
    clientId: null,
    mutationId: null,
    sessionId: null,
    sourceRef: null,
    causationSeq: null,
    reason: null,
    ts: 1793275200000,
    payload: {
      name: "Existing draft",
      baseSeq: 5,
      ownerId: "alice",
      ownerType: "user",
      ownerUserId: "alice",
      scope: { teamIds: ["team-1"], projectIds: [] },
    },
  };
  expect(eventSchema.parse(JSON.parse(JSON.stringify(historical)))).toEqual(historical);
  const current = { ...historical, payload: { ...historical.payload, baseSyncSeq: 91 } };
  expect(eventSchema.parse(current)).toEqual(current);
});

it("requires explicit edit text and forbids text on main or branch conflict choices", () => {
  const metadata = { mergeId: "merge-1", issueId: "issue-1", mainSyncSeq: 91 };
  for (const choice of ["main", "branch"])
    expect(branchConflictResolvedPayloadSchema.parse({ ...metadata, choice })).toEqual({ ...metadata, choice });
  const edited = { ...metadata, choice: "edit", title: "Reviewed title" };
  expect(branchConflictResolvedPayloadSchema.parse(edited)).toEqual(edited);
  for (const invalid of [
    { ...metadata, choice: "edit" },
    { ...metadata, choice: "edit", title: "   " },
    { ...metadata, choice: "edit", title: " Untrimmed " },
    { ...metadata, choice: "main", title: "Unexpected edit" },
    { ...metadata, choice: "branch", title: "Unexpected edit" },
    { ...metadata, choice: "automatic" },
  ])
    expect(branchConflictResolvedPayloadSchema.safeParse(invalid).success).toBe(false);
});
