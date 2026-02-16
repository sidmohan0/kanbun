import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../db/schema.js";
import { DraftService } from "../draft.js";

describe("DraftService thread_id", () => {
  let db: Database.Database;
  let svc: DraftService;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    svc = new DraftService(db);

    // Seed deps
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO projects (name, created_at, updated_at) VALUES (?, ?, ?)"
    ).run("Test", now, now);
    db.prepare(
      "INSERT INTO contacts (first_name, last_name, email, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("Alice", "Smith", "alice@test.com", "manual", now, now);
    db.prepare(
      "INSERT INTO email_accounts (provider, email_address, display_name, credentials) VALUES (?, ?, ?, ?)"
    ).run("gmail", "me@gmail.com", "Me", "{}");
  });

  afterEach(() => db.close());

  it("draft starts with null thread_id", () => {
    const draft = svc.create({
      project_id: 1,
      contact_id: 1,
      send_account_id: 1,
      subject: "Hello",
      body: "Hi",
      draft_type: "template",
    });
    expect(draft.thread_id).toBeNull();
  });

  it("setThreadId persists the thread_id", () => {
    const draft = svc.create({
      project_id: 1,
      contact_id: 1,
      send_account_id: 1,
      subject: "Hello",
      body: "Hi",
      draft_type: "template",
    });
    svc.setThreadId(draft.id, "thread_abc123");
    const updated = svc.getById(draft.id);
    expect(updated?.thread_id).toBe("thread_abc123");
  });
});
