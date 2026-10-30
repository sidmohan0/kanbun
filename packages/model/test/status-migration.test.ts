import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

it("preserves existing effective status as a baseline without fabricating a human assertion", () => {
  const database = new DatabaseSync(":memory:");
  const directory = new URL("../migrations/workspace/", import.meta.url);
  const sql = (name: string) => readFileSync(new URL(`${name}.sql`, directory), "utf8");
  try {
    const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", directory), "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    for (const entry of journal.entries.filter((entry) => entry.idx < 5)) database.exec(sql(entry.tag));
    database.exec(`INSERT INTO issue (
      id, team_id, number, title, priority_sort_order, sort_order, board_order, state_id, created_at, updated_at, created_seq, updated_seq
    ) VALUES ('issue', 'team', 17, 'Existing issue', 'a0', 'a0', 'a0', 'existing-state', '2026-10-29T12:00:00.000Z', '2026-10-29T12:00:00.000Z', 2, 9)`);
    database.exec(`INSERT INTO event_log (branch_id, txn_id, event_index, type, entity_type, entity_id, team_id, payload, actor, ts)
      VALUES ('main', 'existing-txn', 0, 'IssueTitled', 'issue', 'issue', 'team', '{"title":"Existing issue"}', '{"id":"alice","type":"user"}', 1793275200000)`);
    const history = database.prepare("SELECT * FROM event_log").all();
    database.exec("BEGIN");
    database.exec(sql("0005_careless_young_avengers"));
    database.exec("COMMIT");
    expect(
      database
        .prepare("SELECT state_id, asserted_state_id, derived_state_id, number, created_seq, updated_seq FROM issue")
        .get(),
    ).toEqual({
      state_id: "existing-state",
      asserted_state_id: null,
      derived_state_id: "existing-state",
      number: 17,
      created_seq: 2,
      updated_seq: 9,
    });
    expect(database.prepare("SELECT * FROM event_log").all()).toEqual(history);
  } finally {
    database.close();
  }
});
