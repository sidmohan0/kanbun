import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../db/schema.js";
import { DraftService } from "../draft.js";

function seedDb(db: Database.Database) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO projects (name, pipeline_stages, follow_up_cadence, created_at, updated_at)
     VALUES (?, '[]', '[]', ?, ?)`
  ).run("P1", now, now);
  db.prepare(
    `INSERT INTO contacts (first_name, last_name, email, source, created_at, updated_at)
     VALUES (?, ?, ?, 'manual', ?, ?)`
  ).run("Jane", "Doe", "jane@acme.com", now, now);
  db.prepare(
    `INSERT INTO email_accounts (provider, email_address, display_name, credentials)
     VALUES (?, ?, ?, ?)`
  ).run("gmail", "me@gmail.com", "Me", "{}");
}

describe("DraftService", () => {
  let db: Database.Database;
  let svc: DraftService;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    seedDb(db);
    svc = new DraftService(db);
  });

  afterEach(() => db.close());

  it("creates a draft", () => {
    const d = svc.create({
      project_id: 1,
      contact_id: 1,
      send_account_id: 1,
      subject: "Hello",
      body: "Hi Jane",
      draft_type: "template",
    });
    expect(d.id).toBe(1);
    expect(d.status).toBe("pending_review");
    expect(d.sequence_step).toBe(1);
  });

  it("lists drafts by status", () => {
    svc.create({ project_id: 1, contact_id: 1, send_account_id: 1, subject: "S", body: "B", draft_type: "template" });
    svc.create({ project_id: 1, contact_id: 1, send_account_id: 1, subject: "S2", body: "B2", draft_type: "agent" });
    expect(svc.listByStatus("pending_review")).toHaveLength(2);
  });

  it("updates draft status", () => {
    const d = svc.create({ project_id: 1, contact_id: 1, send_account_id: 1, subject: "S", body: "B", draft_type: "template" });
    svc.updateStatus(d.id, "sent");
    const updated = svc.getById(d.id);
    expect(updated?.status).toBe("sent");
    expect(updated?.sent_at).not.toBeNull();
  });

  it("updates draft content", () => {
    const d = svc.create({ project_id: 1, contact_id: 1, send_account_id: 1, subject: "S", body: "B", draft_type: "template" });
    svc.updateContent(d.id, "New Subject", "New Body");
    const updated = svc.getById(d.id);
    expect(updated?.subject).toBe("New Subject");
    expect(updated?.body).toBe("New Body");
  });
});
