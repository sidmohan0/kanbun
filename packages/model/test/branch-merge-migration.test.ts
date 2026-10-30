import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

const sql = (name: string) => readFileSync(new URL(`../migrations/workspace/${name}.sql`, import.meta.url), "utf8");

function existingBranchDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(sql("0000_marvelous_dark_beast"));
  database.exec(sql("0001_legal_amphibian"));
  database.exec(sql("0002_tearful_surge"));
  return database;
}

it("keeps old branch history and overlays while leaving the unknown conflict baseline null", () => {
  const database = existingBranchDatabase();
  try {
    database.exec(`
      INSERT INTO workspace_branch (
        id, name, base_seq, owner_id, owner_type, owner_user_id, status, scope, created_at
      ) VALUES (
        'existing-branch', 'Existing draft', 5, 'alice', 'user', 'alice', 'open',
        '{"teamIds":["existing-team"],"projectIds":[]}', '2026-10-29T12:00:00.000Z'
      );
      INSERT INTO branch_row (branch_id, entity_type, entity_id, row, tombstone)
      VALUES ('existing-branch', 'issue', 'existing-issue', '{"id":"existing-issue","title":"Draft title"}', 0);
      INSERT INTO event_log (
        seq, branch_id, txn_id, event_index, type, entity_type, entity_id, team_id,
        payload, actor, client_id, mutation_id, ts
      ) VALUES (
        7, 'existing-branch', 'existing-transaction', 0, 'IssueTitled', 'issue', 'existing-issue', 'existing-team',
        '{"title":"Draft title"}', '{"id":"alice","type":"user"}', 'existing-client', 1, 1793275200000
      );
      INSERT INTO sync_log (seq, branch_id, model, row_id, op, txn_id, event_seq, ts)
      VALUES (101, 'existing-branch', 'issue', 'existing-issue', 'upsert', 'existing-transaction', 7, '2026-10-29T12:00:00.000Z');
      INSERT INTO sync_client (client_id, user_id, branch_id, last_mutation_id, last_seen_at, visible_teams)
      VALUES ('existing-client', 'alice', 'existing-branch', 1, '2026-10-29T12:00:00.000Z', 'existing-team');
    `);
    const before = Object.fromEntries(
      ["branch_row", "event_log", "sync_log", "sync_client"].map((table) => [
        table,
        database.prepare(`SELECT * FROM ${table}`).all(),
      ]),
    );

    database.exec("BEGIN");
    database.exec(sql("0003_fresh_khan"));
    database.exec("COMMIT");

    expect(database.prepare("SELECT * FROM workspace_branch").all()).toEqual([
      {
        id: "existing-branch",
        name: "Existing draft",
        base_seq: 5,
        base_sync_seq: null,
        owner_id: "alice",
        owner_type: "user",
        owner_user_id: "alice",
        status: "open",
        scope: '{"teamIds":["existing-team"],"projectIds":[]}',
        created_at: "2026-10-29T12:00:00.000Z",
      },
    ]);
    for (const [table, rows] of Object.entries(before))
      expect(database.prepare(`SELECT * FROM ${table}`).all()).toEqual(rows);
    expect(database.prepare("SELECT COUNT(*) AS count FROM branch_merge").get()).toEqual({ count: 0 });
    expect(database.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  } finally {
    database.close();
  }
});

it("preserves merge receipt JSON and rejects duplicate branch or merge identities", () => {
  const database = existingBranchDatabase();
  try {
    database.exec(sql("0003_fresh_khan"));
    const request = JSON.stringify({ branchHeadSeq: 7, resolutions: [] });
    const result = JSON.stringify({
      mergeId: "merge-1",
      mainSyncSeq: 104,
      createdIssues: [{ id: "issue-1", number: 4 }],
    });
    const insert = database.prepare(`
      INSERT INTO branch_merge (branch_id, id, actor_id, request, result) VALUES (?, ?, 'alice', ?, ?)
    `);
    insert.run("branch-a", "merge-1", request, result);
    expect(database.prepare("SELECT * FROM branch_merge WHERE branch_id = 'branch-a'").get()).toEqual({
      branch_id: "branch-a",
      id: "merge-1",
      actor_id: "alice",
      request,
      result,
    });
    expect(() => insert.run("branch-a", "merge-2", request, result)).toThrow(/UNIQUE/);
    expect(() => insert.run("branch-b", "merge-1", request, result)).toThrow(/UNIQUE/);
    expect(database.prepare("SELECT COUNT(*) AS count FROM branch_merge").get()).toEqual({ count: 1 });
  } finally {
    database.close();
  }
});
