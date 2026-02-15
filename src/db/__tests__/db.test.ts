import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../schema.js";

describe("database schema", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("creates all tables", () => {
    applySchema(db);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("projects");
    expect(names).toContain("contacts");
    expect(names).toContain("project_contacts");
    expect(names).toContain("email_accounts");
    expect(names).toContain("drafts");
    expect(names).toContain("templates");
  });

  it("inserts and retrieves a project", () => {
    applySchema(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO projects (name, description, pipeline_stages, follow_up_cadence, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      "Test Project",
      "A test",
      JSON.stringify(["Stage1", "Stage2"]),
      JSON.stringify([3, 7]),
      now,
      now
    );
    const row = db.prepare("SELECT * FROM projects WHERE id = 1").get() as any;
    expect(row.name).toBe("Test Project");
    expect(JSON.parse(row.pipeline_stages)).toEqual(["Stage1", "Stage2"]);
  });
});
