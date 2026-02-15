import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../db/schema.js";
import { FollowUpScheduler } from "../scheduler.js";
import { DraftService } from "../../services/draft.js";

describe("FollowUpScheduler", () => {
  let db: Database.Database;
  let scheduler: FollowUpScheduler;
  let draftService: DraftService;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    scheduler = new FollowUpScheduler(db);
    draftService = new DraftService(db);

    const now = new Date().toISOString();
    // Create email account
    db.prepare(
      "INSERT INTO email_accounts (provider, email_address, display_name, credentials) VALUES (?, ?, ?, ?)"
    ).run("gmail", "me@gmail.com", "Me", "{}");

    // Create project with cadence and send account
    db.prepare(
      `INSERT INTO projects (name, pipeline_stages, follow_up_cadence, default_send_account_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("Test", '["Researched","Sent"]', "[3, 7]", 1, now, now);

    // Create contact
    db.prepare(
      "INSERT INTO contacts (first_name, last_name, email, source, created_at, updated_at) VALUES (?, ?, ?, 'manual', ?, ?)"
    ).run("Jane", "Doe", "jane@acme.com", now, now);

    // Assign to project
    db.prepare(
      "INSERT INTO project_contacts (project_id, contact_id, current_stage, assigned_at, stage_updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run(1, 1, "Sent", now, now);
  });

  afterEach(() => db.close());

  it("generates follow-up when cadence is due", async () => {
    // Insert a sent draft from 4 days ago
    const fourDaysAgo = new Date(Date.now() - 4 * 86400000).toISOString();
    db.prepare(
      `INSERT INTO drafts (project_id, contact_id, send_account_id, subject, body, draft_type, status, sequence_step, created_at, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, 'sent', 1, ?, ?)`
    ).run(1, 1, 1, "Hi", "Hello", "agent", fourDaysAgo, fourDaysAgo);

    const count = await scheduler.check();
    expect(count).toBe(1);

    const drafts = draftService.listByStatus("pending_review");
    expect(drafts).toHaveLength(1);
    expect(drafts[0].sequence_step).toBe(2);
    expect(drafts[0].parent_draft_id).toBe(1);
  });

  it("does not generate follow-up when cadence is not yet due", async () => {
    // Insert a sent draft from 1 day ago (cadence is 3 days)
    const oneDayAgo = new Date(Date.now() - 1 * 86400000).toISOString();
    db.prepare(
      `INSERT INTO drafts (project_id, contact_id, send_account_id, subject, body, draft_type, status, sequence_step, created_at, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, 'sent', 1, ?, ?)`
    ).run(1, 1, 1, "Hi", "Hello", "agent", oneDayAgo, oneDayAgo);

    const count = await scheduler.check();
    expect(count).toBe(0);
  });

  it("does not generate follow-up when already pending", async () => {
    const fourDaysAgo = new Date(Date.now() - 4 * 86400000).toISOString();
    db.prepare(
      `INSERT INTO drafts (project_id, contact_id, send_account_id, subject, body, draft_type, status, sequence_step, created_at, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, 'sent', 1, ?, ?)`
    ).run(1, 1, 1, "Hi", "Hello", "agent", fourDaysAgo, fourDaysAgo);

    // Already has a pending draft
    db.prepare(
      `INSERT INTO drafts (project_id, contact_id, send_account_id, subject, body, draft_type, status, sequence_step, parent_draft_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending_review', 2, 1, ?)`
    ).run(1, 1, 1, "Re:", "Follow-up", "agent", new Date().toISOString());

    const count = await scheduler.check();
    expect(count).toBe(0);
  });
});
