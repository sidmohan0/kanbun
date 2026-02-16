import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../db/schema.js";
import { ContactService } from "../contact.js";

describe("ContactService", () => {
  let db: Database.Database;
  let svc: ContactService;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    svc = new ContactService(db);
  });

  afterEach(() => db.close());

  it("adds a contact", () => {
    const c = svc.add({
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@acme.com",
      company: "Acme",
      source: "manual",
    });
    expect(c.id).toBe(1);
    expect(c.first_name).toBe("Jane");
  });

  it("imports from CSV rows", () => {
    const rows = [
      { first_name: "A", last_name: "B", email: "a@b.com" },
      { first_name: "C", last_name: "D", email: "c@d.com" },
    ];
    const result = svc.importCsv(rows);
    expect(result.contacts).toHaveLength(2);
    expect(result.summary.inserted).toBe(2);
    expect(result.contacts[0].source).toBe("csv");
  });

  it("skips duplicate email import rows", () => {
    const rows = [
      { first_name: "A", last_name: "B", email: "a@b.com" },
      { first_name: "A-2", last_name: "B-2", email: "a@b.com" },
    ];
    const result = svc.importCsv(rows, "skip");
    expect(result.summary.inserted).toBe(1);
    expect(result.summary.skipped).toBe(1);
    expect(result.contacts).toHaveLength(1);
  });

  it("assigns contact to project and lists by project", () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO projects (name, pipeline_stages, follow_up_cadence, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run("P1", '["Researched","Sent"]', "[]", now, now);

    const c = svc.add({
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@acme.com",
      source: "manual",
    });
    svc.assignToProject(c.id, 1, "Researched");
    const list = svc.listByProject(1);
    expect(list).toHaveLength(1);
    expect(list[0].current_stage).toBe("Researched");
  });

  it("moves contact to a new stage", () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO projects (name, pipeline_stages, follow_up_cadence, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run("P1", '["Researched","Sent"]', "[]", now, now);

    const c = svc.add({
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@acme.com",
      source: "manual",
    });
    svc.assignToProject(c.id, 1, "Researched");
    svc.moveStage(c.id, 1, "Sent");
    const list = svc.listByProject(1);
    expect(list[0].current_stage).toBe("Sent");
  });
});
