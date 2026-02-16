import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../db/schema.js";
import { MeetingService } from "../meeting.js";

describe("MeetingService", () => {
  let db: Database.Database;
  let svc: MeetingService;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    svc = new MeetingService(db);

    // Seed project and contact
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO projects (name, created_at, updated_at) VALUES (?, ?, ?)"
    ).run("Test", now, now);
    db.prepare(
      "INSERT INTO contacts (first_name, last_name, email, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("Alice", "Smith", "alice@test.com", "manual", now, now);
  });

  afterEach(() => db.close());

  it("creates a meeting", () => {
    const meeting = svc.create({
      project_id: 1,
      contact_id: 1,
      meeting_type: "demo",
      notes: "Product demo",
    });
    expect(meeting.id).toBe(1);
    expect(meeting.meeting_type).toBe("demo");
    expect(meeting.notes).toBe("Product demo");
  });

  it("lists meetings by project", () => {
    svc.create({ project_id: 1, contact_id: 1 });
    svc.create({ project_id: 1, contact_id: 1, meeting_type: "demo" });
    const meetings = svc.listByProject(1);
    expect(meetings).toHaveLength(2);
  });

  it("counts meetings in a date range", () => {
    svc.create({ project_id: 1, contact_id: 1 });
    const now = new Date();
    const start = new Date(now.getTime() - 86400000).toISOString();
    const end = new Date(now.getTime() + 86400000).toISOString();
    expect(svc.countByProjectInRange(1, start, end)).toBe(1);
  });
});
