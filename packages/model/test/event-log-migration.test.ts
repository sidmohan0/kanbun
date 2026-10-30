import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

it("upgrades an existing workspace without inventing event provenance for its older rows", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(
      readFileSync(new URL("../migrations/workspace/0000_marvelous_dark_beast.sql", import.meta.url), "utf8"),
    );
    database.exec(`
      INSERT INTO team (id, name, key, display_name, issue_counter, created_at, updated_at)
      VALUES (
        'existing-team', 'Existing team', 'EX', 'Existing team', 17,
        '2026-10-29T12:00:00.000Z', '2026-10-29T12:00:00.000Z'
      );
      INSERT INTO issue (
        id, team_id, number, title, priority_sort_order, sort_order, board_order,
        state_id, created_at, updated_at
      ) VALUES (
        'existing-issue', 'existing-team', 17, 'Keep this issue', 'a0', 'a0', 'a0',
        'existing-state', '2026-10-29T12:00:00.000Z', '2026-10-29T12:00:00.000Z'
      );
      INSERT INTO sync_log (model, row_id, op, txn_id, ts)
      VALUES ('issue', 'existing-issue', 'upsert', 'legacy-transaction', '2026-10-29T12:00:00.000Z');
    `);

    database.exec(readFileSync(new URL("../migrations/workspace/0001_legal_amphibian.sql", import.meta.url), "utf8"));

    expect(database.prepare("SELECT id, number, title, created_seq, updated_seq FROM issue").all()).toEqual([
      { id: "existing-issue", number: 17, title: "Keep this issue", created_seq: 0, updated_seq: 0 },
    ]);
    expect(database.prepare("SELECT seq, row_id, event_seq FROM sync_log").all()).toEqual([
      { seq: 1, row_id: "existing-issue", event_seq: null },
    ]);
    expect(database.prepare("SELECT issue_counter FROM team WHERE id = 'existing-team'").get()).toEqual({
      issue_counter: 17,
    });
    expect(database.prepare("SELECT COUNT(*) AS count FROM event_log").get()).toEqual({ count: 0 });
  } finally {
    database.close();
  }
});

it("enforces event identity without conflating separate events from the same mutation", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(
      readFileSync(new URL("../migrations/workspace/0000_marvelous_dark_beast.sql", import.meta.url), "utf8"),
    );
    database.exec(readFileSync(new URL("../migrations/workspace/0001_legal_amphibian.sql", import.meta.url), "utf8"));
    const insert = database.prepare(`
      INSERT INTO event_log (
        branch_id, txn_id, event_index, type, entity_type, entity_id, team_id,
        payload, actor, client_id, mutation_id, ts
      ) VALUES (
        'main', 'transaction-1', ?, 'IssueTitled', 'issue', 'issue-1', 'team-1',
        '{"title":"Renamed"}', '{"id":"alice","type":"user"}', 'client-1', 1, 1793275200000
      )
    `);

    insert.run(0);
    expect(() => insert.run(0)).toThrow(/UNIQUE constraint failed/);
    insert.run(1);
    expect(database.prepare("SELECT seq, mutation_id, event_index FROM event_log ORDER BY seq").all()).toEqual([
      { seq: 1, mutation_id: 1, event_index: 0 },
      { seq: 2, mutation_id: 1, event_index: 1 },
    ]);
  } finally {
    database.close();
  }
});
