import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

const sql = (name: string) => readFileSync(new URL(`../migrations/workspace/${name}.sql`, import.meta.url), "utf8");

it("upgrades main history and client cursors without moving data onto a branch", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec(sql("0000_marvelous_dark_beast"));
    database.exec(sql("0001_legal_amphibian"));
    database.exec(`
      INSERT INTO event_log (
        seq, branch_id, txn_id, event_index, type, entity_type, entity_id, team_id,
        payload, actor, client_id, mutation_id, ts
      ) VALUES (
        51, 'main', 'existing-transaction', 0, 'IssueTitled', 'issue', 'existing-issue', 'existing-team',
        '{"title":"Preserve history"}', '{"id":"alice","type":"user"}', 'existing-client', 8, 1793275200000
      );
      INSERT INTO sync_log (seq, model, row_id, op, txn_id, event_seq, ts)
      VALUES (91, 'issue', 'existing-issue', 'upsert', 'existing-transaction', 51, '2026-10-29T12:00:00.000Z');
      INSERT INTO sync_client (client_id, user_id, last_mutation_id, last_seen_at, visible_teams)
      VALUES ('existing-client', 'alice', 8, '2026-10-29T12:00:00.000Z', 'existing-team');
    `);
    const history = database.prepare("SELECT * FROM event_log").all();

    // Production applies each migration transactionally. PRAGMA changes inside the SQL must not
    // discard existing event sequences or turn off foreign-key checks for later operations.
    database.exec("BEGIN");
    database.exec(sql("0002_tearful_surge"));
    database.exec("COMMIT");

    expect(database.prepare("SELECT * FROM event_log").all()).toEqual(history);
    expect(database.prepare("SELECT seq, branch_id, event_seq FROM sync_log").all()).toEqual([
      { seq: 91, branch_id: "main", event_seq: 51 },
    ]);
    expect(
      database.prepare("SELECT client_id, branch_id, last_mutation_id, visible_teams FROM sync_client").all(),
    ).toEqual([
      { client_id: "existing-client", branch_id: "main", last_mutation_id: 8, visible_teams: "existing-team" },
    ]);
    expect(database.prepare("SELECT COUNT(*) AS count FROM workspace_branch").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM branch_row").get()).toEqual({ count: 0 });
    expect(database.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });

    database.exec(`
      INSERT INTO event_log (
        branch_id, txn_id, event_index, type, entity_type, entity_id, team_id, scope_user_id,
        payload, actor, ts
      ) VALUES (
        'branch-1', 'branch-transaction', 0, 'BranchCreated', 'workspaceBranch', 'branch-1', NULL, 'alice',
        '{"name":"Draft","baseSeq":51,"ownerId":"alice","ownerType":"user","ownerUserId":"alice","scope":{"teamIds":[],"projectIds":[]}}',
        '{"id":"alice","type":"user"}', 1793275200001
      );
    `);
    expect(database.prepare("SELECT seq, team_id FROM event_log WHERE branch_id = 'branch-1'").get()).toEqual({
      seq: 52,
      team_id: null,
    });
  } finally {
    database.close();
  }
});

it("keeps each branch overlay separate and rejects ambiguous live-row tombstones", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(sql("0000_marvelous_dark_beast"));
    database.exec(sql("0001_legal_amphibian"));
    database.exec(sql("0002_tearful_surge"));
    const insert = database.prepare(`
      INSERT INTO branch_row (branch_id, entity_type, entity_id, row, tombstone)
      VALUES (?, 'issue', 'issue-1', ?, ?)
    `);
    insert.run("branch-a", '{"id":"issue-1","title":"A"}', 0);
    insert.run("branch-b", null, 1);
    expect(database.prepare("SELECT branch_id, row, tombstone FROM branch_row ORDER BY branch_id").all()).toEqual([
      { branch_id: "branch-a", row: '{"id":"issue-1","title":"A"}', tombstone: 0 },
      { branch_id: "branch-b", row: null, tombstone: 1 },
    ]);
    expect(() => insert.run("branch-a", '{"id":"issue-1","title":"Duplicate"}', 0)).toThrow(/UNIQUE/);
    expect(() => insert.run("branch-c", null, 0)).toThrow(/CHECK/);
    expect(() => insert.run("branch-c", '{"id":"issue-1"}', 1)).toThrow(/CHECK/);
  } finally {
    database.close();
  }
});
