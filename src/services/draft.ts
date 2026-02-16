import type Database from "better-sqlite3";
import type { Draft } from "../shared/types.js";

interface CreateDraftInput {
  project_id: number;
  contact_id: number;
  send_account_id: number;
  subject: string;
  body: string;
  draft_type: "template" | "agent";
  parent_draft_id?: number;
  sequence_step?: number;
}

export class DraftService {
  constructor(private db: Database.Database) {}

  create(input: CreateDraftInput): Draft {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO drafts (project_id, contact_id, send_account_id, subject, body, draft_type, status, parent_draft_id, sequence_step, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending_review', ?, ?, ?)`
      )
      .run(
        input.project_id,
        input.contact_id,
        input.send_account_id,
        input.subject,
        input.body,
        input.draft_type,
        input.parent_draft_id ?? null,
        input.sequence_step ?? 1,
        now
      );
    return this.getById(result.lastInsertRowid as number)!;
  }

  getById(id: number): Draft | undefined {
    return this.db
      .prepare("SELECT * FROM drafts WHERE id = ?")
      .get(id) as Draft | undefined;
  }

  listByStatus(status: string): Draft[] {
    return this.db
      .prepare("SELECT * FROM drafts WHERE status = ? ORDER BY id")
      .all(status) as Draft[];
  }

  listByProject(projectId: number): Draft[] {
    return this.db
      .prepare("SELECT * FROM drafts WHERE project_id = ? ORDER BY id")
      .all(projectId) as Draft[];
  }

  updateStatus(id: number, status: Draft["status"]): void {
    const sentAt = status === "sent" ? new Date().toISOString() : null;
    this.db
      .prepare("UPDATE drafts SET status = ?, sent_at = COALESCE(?, sent_at) WHERE id = ?")
      .run(status, sentAt, id);
  }

  updateContent(id: number, subject: string, body: string): void {
    this.db
      .prepare("UPDATE drafts SET subject = ?, body = ? WHERE id = ?")
      .run(subject, body, id);
  }

  setThreadId(id: number, threadId: string): void {
    this.db
      .prepare("UPDATE drafts SET thread_id = ? WHERE id = ?")
      .run(threadId, id);
  }

  pendingForContact(contactId: number, projectId: number): Draft | undefined {
    return this.db
      .prepare(
        "SELECT * FROM drafts WHERE contact_id = ? AND project_id = ? AND status = 'pending_review' LIMIT 1"
      )
      .get(contactId, projectId) as Draft | undefined;
  }
}
