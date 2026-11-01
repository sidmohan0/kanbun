import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { modelNames, uuidv7 } from "@kanbun/model";
import { MemoryStore, type Actor } from "@kanbun/sync";
import { SyncServer } from "@kanbun/sync/server";
import { openWorkspaceDb } from "@kanbun/sync/server/node";
import { branchName, DEFAULT_GIT_BRANCH_FORMAT, gitBranchFormatSchema, mutators } from "../src";

it("generates valid git branches from human names and titles without losing the issue identifier", () => {
  expect(branchName(DEFAULT_GIT_BRANCH_FORMAT, "Sid Mohan", "KAN-123", "Fix search / ranking!")).toBe(
    "sid-mohan/kan-123-fix-search-ranking",
  );
  for (const [name, title] of [
    ["../User@{", "!!!"],
    ["山田", "検索を直す"],
    ["- / .lock", "A".repeat(100)],
    ["", ""],
  ]) {
    const result = branchName(DEFAULT_GIT_BRANCH_FORMAT, name!, "KAN-123", title!);
    expect(result).toContain("kan-123");
    const checked = spawnSync("git", ["check-ref-format", "--branch", result], { encoding: "utf8" });
    expect(checked.status, checked.stderr).toBe(0);
  }
  expect(branchName("fix/{issueIdentifier}/{issueIdentifier}", "User", "NEW-1", "Title")).toBe("fix/new-1/new-1");
  expect(branchName(DEFAULT_GIT_BRANCH_FORMAT, "User", "", "Pending issue")).toBe("");
});

it("rejects unsupported tokens, missing identifiers and invalid git refs before persisting a format", () => {
  for (const format of [
    "{issueTitle}",
    "{unknown}/{issueIdentifier}",
    "-fix/{issueIdentifier}",
    "/{issueIdentifier}",
    "{issueIdentifier}/",
    "fix//{issueIdentifier}",
    "{issueIdentifier}.lock",
    "{issueIdentifier}..",
    "fix branch/{issueIdentifier}",
    "{issueIdentifier}@{username}",
  ])
    expect(gitBranchFormatSchema.safeParse(format).success, format).toBe(false);
  for (const format of [DEFAULT_GIT_BRANCH_FORMAT, "fix/{issueIdentifier}", "{issueIdentifier}_{issueTitle}"])
    expect(gitBranchFormatSchema.safeParse(format).success, format).toBe(true);
});

it("allows only workspace admins to change the shared format and converges in memory and SQLite", () => {
  const database = openWorkspaceDb(":memory:");
  const now = "2026-11-01T20:00:00.000Z";
  const server = new SyncServer({ driver: database.driver, mutators, now: () => now });
  const owner: Actor = { id: "owner", type: "user" };
  const organizationId = uuidv7();
  try {
    server.system("workspaceInit", {
      organization: { id: organizationId, name: "Workspace", urlKey: "workspace" },
      owner: { id: owner.id, name: "Owner", email: "owner@example.com" },
    });
    server.system("memberSync", { id: "member", name: "Member", email: "member@example.com" });
    server.system("memberSync", { id: "admin", name: "Admin", email: "admin@example.com", role: "admin" });
    const push = (actor: Actor, format: string) =>
      server.push(actor, {
        clientId: uuidv7(),
        mutations: [{ id: 1, name: "organizationGitBranchFormatUpdate", args: { format }, ts: now }],
      });
    expect(push({ id: "member", type: "user" }, "fix/{issueIdentifier}")).toMatchObject({
      rejected: [{ error: "Workspace admin required" }],
    });
    expect(() =>
      mutators.organizationGitBranchFormatUpdate.run(
        { store: server.store, actor: { id: owner.id, type: "agent" }, actorId: owner.id, now, server: true },
        { format: "fix/{issueIdentifier}" },
      ),
    ).toThrow("Workspace admin required");
    expect(push(owner, "bad/{title}")).toMatchObject({ rejected: [{}] });
    expect(server.store.get("organization", organizationId)!.gitBranchFormat).toBe(DEFAULT_GIT_BRANCH_FORMAT);
    const memory = new MemoryStore();
    for (const model of modelNames) for (const row of server.store.list(model)) memory.insert(model, row);
    const args = { format: "fix/{issueIdentifier}-{issueTitle}" };
    mutators.organizationGitBranchFormatUpdate.run(
      { store: memory, actor: owner, actorId: owner.id, now, server: false },
      args,
    );
    expect(push(owner, args.format)).toMatchObject({ rejected: [] });
    expect(memory.list("organization")).toEqual(server.store.list("organization"));
    expect(push({ id: "admin", type: "user" }, "{issueIdentifier}")).toMatchObject({ rejected: [] });
    expect(server.store.get("organization", organizationId)!.gitBranchFormat).toBe("{issueIdentifier}");
  } finally {
    database.db.close();
  }
});
