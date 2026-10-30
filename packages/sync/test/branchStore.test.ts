import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Row } from "@kanbun/model";
import { expect, it } from "vitest";
import { openWorkspaceDb } from "../src/server/node";
import { SqliteBranchStore } from "../src/server/branchStore";
import { SqliteStore, SYSTEM_TAG } from "../src/server/sqliteStore";

const NOW = "2026-10-29T12:00:00.000Z";

function issue(id: string, title: string, number: number): Row<"issue"> {
  return {
    id,
    title,
    number,
    teamId: "team-1",
    stateId: "state-1",
    prioritySortOrder: "a0",
    sortOrder: "a0",
    boardOrder: "a0",
    createdAt: NOW,
    updatedAt: NOW,
  } as Row<"issue">;
}

it("persists only touched branch rows while untouched reads follow live main", () => {
  const directory = mkdtempSync(join(tmpdir(), "kanbun-branch-store-"));
  const databasePath = join(directory, "workspace.sqlite");
  let opened = openWorkspaceDb(databasePath);
  try {
    const main = new SqliteStore(opened.driver);
    main.insert("issue", issue("touched", "Main title", 7));
    main.insert("issue", issue("untouched", "Original live title", 8));
    main.insert("issue", issue("hidden", "Still on main", 9));
    const branch = new SqliteBranchStore(opened.driver, "branch-a");
    const other = new SqliteBranchStore(opened.driver, "branch-b");

    branch.patch("issue", "touched", { title: "Proposed title" });
    branch.delete("issue", "hidden");
    branch.insert("issue", issue("new", "Proposed creation", 0));
    main.patch("issue", "untouched", { title: "New live title" });
    main.patch("issue", "touched", { title: "Main changed independently" });
    main.patch("issue", "hidden", { title: "Main row remains live" });

    expect(branch.get("issue", "untouched")?.title).toBe("New live title");
    expect(branch.get("issue", "touched")?.title).toBe("Proposed title");
    expect(branch.get("issue", "hidden")).toBeUndefined();
    expect(main.get("issue", "new")).toBeUndefined();
    expect(main.get("issue", "touched")?.title).toBe("Main changed independently");
    expect(other.get("issue", "touched")?.title).toBe("Main changed independently");
    expect(other.get("issue", "hidden")?.title).toBe("Main row remains live");
    expect(other.get("issue", "new")).toBeUndefined();
    expect(branch.hasOverlay("issue", "untouched")).toBe(false);
    expect(branch.hasOverlay("issue", "hidden")).toBe(true);
    expect(opened.driver.all("SELECT COUNT(*) AS count FROM branch_row")).toEqual([{ count: 3 }]);

    opened.db.close();
    opened = openWorkspaceDb(databasePath);
    const restored = new SqliteBranchStore(opened.driver, "branch-a");
    expect(
      restored
        .list("issue", { teamId: "team-1" })
        .map(({ id, title, number }) => ({ id, title, number }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual([
      { id: "new", title: "Proposed creation", number: 0 },
      { id: "touched", title: "Proposed title", number: 7 },
      { id: "untouched", title: "New live title", number: 8 },
    ]);
    expect(restored.maxOf("issue", "number")).toBe(8);
    expect(restored.minOf("issue", "number")).toBe(0);
    expect(new SqliteStore(opened.driver).list("issue")).toHaveLength(3);
  } finally {
    opened.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("captures a full first overlay row and branch-scoped incremental changes afterward", () => {
  const { db, driver } = openWorkspaceDb();
  try {
    const main = new SqliteStore(driver);
    main.insert("issue", issue("existing", "Original", 12));
    expect(() => main.withTag({ ...SYSTEM_TAG("bad-route"), branchId: "branch-a" })).toThrow(
      /Non-main writes require a durable branch store/,
    );
    const branch = new SqliteBranchStore(driver, "branch-a").withTag({
      ...SYSTEM_TAG("rename-transaction"),
      // The store is bound to its branch even if a caller supplies another log tag.
      branchId: "main",
      eventSeq: 42,
      ts: NOW,
    });
    branch.patch("issue", "existing", { title: "Proposed" });
    branch.patch("issue", "existing", { priority: 2 });
    branch.patch("issue", "existing", { priority: 2 });
    const logs = driver.all("SELECT * FROM sync_log WHERE branch_id = 'branch-a' ORDER BY seq");
    expect(logs).toHaveLength(2);
    expect(JSON.parse(String(logs[0]!["patch"]))).toMatchObject({
      id: "existing",
      title: "Proposed",
      teamId: "team-1",
      stateId: "state-1",
      number: 12,
    });
    expect(JSON.parse(String(logs[0]!["prev"]))).toEqual({ title: "Original" });
    expect(JSON.parse(String(logs[1]!["patch"]))).toEqual({ priority: 2 });
    expect(JSON.parse(String(logs[1]!["prev"]))).toEqual({ priority: 0 });
    expect(logs.map((row) => [row["event_seq"], row["txn_id"], row["ts"]])).toEqual([
      [42, "rename-transaction", NOW],
      [42, "rename-transaction", NOW],
    ]);
    expect(driver.all("SELECT COUNT(*) AS count FROM sync_log WHERE branch_id = 'main'")).toEqual([{ count: 1 }]);
    expect(main.get("issue", "existing")).toMatchObject({ title: "Original", priority: 0 });

    branch.put("issue", { ...branch.get("issue", "existing")!, title: "Fully replaced on branch" });
    expect(branch.get("issue", "existing")?.title).toBe("Fully replaced on branch");
    expect(main.get("issue", "existing")?.title).toBe("Original");
  } finally {
    db.close();
  }
});
