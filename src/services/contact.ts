import type Database from "better-sqlite3";
import type { Contact } from "../shared/types.js";

interface AddContactInput {
  first_name: string;
  last_name: string;
  email: string;
  company?: string;
  title?: string;
  linkedin_url?: string;
  phone?: string;
  notes?: string;
  apollo_id?: string;
  source: "manual" | "csv" | "apollo";
}

export class ContactService {
  constructor(private db: Database.Database) {}

  add(input: AddContactInput): Contact {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO contacts (first_name, last_name, email, company, title, linkedin_url, phone, notes, apollo_id, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.first_name,
        input.last_name,
        input.email,
        input.company ?? null,
        input.title ?? null,
        input.linkedin_url ?? null,
        input.phone ?? null,
        input.notes ?? null,
        input.apollo_id ?? null,
        input.source,
        now,
        now
      );
    return this.getById(result.lastInsertRowid as number)!;
  }

  getById(id: number): Contact | undefined {
    return this.db
      .prepare("SELECT * FROM contacts WHERE id = ?")
      .get(id) as Contact | undefined;
  }

  importCsv(rows: Array<Record<string, string>>): Contact[] {
    const insert = this.db.prepare(
      `INSERT INTO contacts (first_name, last_name, email, company, title, linkedin_url, phone, notes, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'csv', ?, ?)`
    );
    const now = new Date().toISOString();
    const contacts: Contact[] = [];
    const tx = this.db.transaction(() => {
      for (const row of rows) {
        const result = insert.run(
          row.first_name ?? "",
          row.last_name ?? "",
          row.email ?? "",
          row.company ?? null,
          row.title ?? null,
          row.linkedin_url ?? null,
          row.phone ?? null,
          row.notes ?? null,
          now,
          now
        );
        contacts.push(this.getById(result.lastInsertRowid as number)!);
      }
    });
    tx();
    return contacts;
  }

  assignToProject(contactId: number, projectId: number, stage: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO project_contacts (project_id, contact_id, current_stage, assigned_at, stage_updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(projectId, contactId, stage, now, now);
  }

  moveStage(contactId: number, projectId: number, newStage: string): void {
    this.db
      .prepare(
        `UPDATE project_contacts SET current_stage = ?, stage_updated_at = ? WHERE contact_id = ? AND project_id = ?`
      )
      .run(newStage, new Date().toISOString(), contactId, projectId);
  }

  listByProject(
    projectId: number,
    stage?: string
  ): Array<Contact & { current_stage: string }> {
    let sql = `SELECT c.*, pc.current_stage FROM contacts c
               JOIN project_contacts pc ON c.id = pc.contact_id
               WHERE pc.project_id = ?`;
    const params: any[] = [projectId];
    if (stage) {
      sql += " AND pc.current_stage = ?";
      params.push(stage);
    }
    return this.db.prepare(sql).all(...params) as any[];
  }
}
