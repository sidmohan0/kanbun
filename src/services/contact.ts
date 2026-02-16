import type Database from "better-sqlite3";
import type {
  Contact,
  ContactNote,
  ContactProfile,
  ContactTag,
  Group,
  SocialLink,
} from "../shared/types.js";

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
  website?: string;
  social_links?: SocialLink[];
}

interface ContactSearchFilters {
  q?: string;
  tag?: string;
  group_id?: number;
  project_id?: number;
  stage?: string;
}

interface CsvImportSummary {
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export interface CsvImportResult {
  contacts: Contact[];
  summary: CsvImportSummary;
}

export class ContactService {
  constructor(private db: Database.Database) {}

  private normalizeSocialLinks(value: unknown): SocialLink[] {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value
        .filter((row) => row && typeof row === "object")
        .map((row: any) => ({
          provider: String(row.provider ?? "").trim(),
          value: String(row.value ?? "").trim(),
        }))
        .filter((row) => row.provider && row.value);
    }

    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return this.normalizeSocialLinks(parsed);
      } catch {
        return [];
      }
    }

    return [];
  }

  private mapContact(row: any): Contact {
    const social_links = this.normalizeSocialLinks(row.social_links);
    return {
      ...row,
      social_links,
      source: row.source,
    } as Contact;
  }

  private existsByEmail(email: string): Contact | undefined {
    const row = this.db
      .prepare("SELECT * FROM contacts WHERE LOWER(email) = LOWER(?)")
      .get(email);
    return row ? (this.mapContact(row) as Contact) : undefined;
  }

  add(input: AddContactInput): Contact {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO contacts (
          first_name,
          last_name,
          email,
          company,
          title,
          linkedin_url,
          phone,
          notes,
          apollo_id,
          source,
          website,
          social_links,
          created_at,
          updated_at
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        input.website ?? null,
        JSON.stringify(input.social_links ?? []),
        now,
        now
      );
    return this.getById(result.lastInsertRowid as number)!;
  }

  getById(id: number): Contact | undefined {
    const row = this.db
      .prepare("SELECT * FROM contacts WHERE id = ?")
      .get(id);
    return row ? this.mapContact(row) : undefined;
  }

  listAll(): Contact[] {
    const rows = this.db.prepare("SELECT * FROM contacts ORDER BY id").all();
    return (rows as any[]).map((row) => this.mapContact(row));
  }

  getProfile(contactId: number): ContactProfile {
    const contact = this.getById(contactId);
    if (!contact) {
      throw new Error(`Contact ${contactId} not found`);
    }

    const tags = this.db
      .prepare("SELECT * FROM contact_tags WHERE contact_id = ? ORDER BY name")
      .all(contactId) as ContactTag[];

    const groups = this.db
      .prepare(
        `SELECT g.* FROM groups g
         JOIN contact_groups cg ON g.id = cg.group_id
         WHERE cg.contact_id = ?
         ORDER BY g.name`
      )
      .all(contactId) as Group[];

    const notes = this.db
      .prepare(
        "SELECT * FROM contact_notes WHERE contact_id = ? ORDER BY created_at DESC"
      )
      .all(contactId) as ContactNote[];

    const socialRows = this.db
      .prepare(
        "SELECT provider, value FROM contact_social_links WHERE contact_id = ? ORDER BY id"
      )
      .all(contactId) as Array<{ provider: string; value: string }>;

    return {
      contact,
      tags: tags.map((tag) => tag.name),
      groups,
      notes,
      social_links: [...contact.social_links, ...socialRows.map((s) => ({ provider: s.provider, value: s.value }))],
    };
  }

  importCsv(rows: Array<Record<string, string>>, dedupeMode: "skip" | "update" = "skip"): CsvImportResult {
    const insert = this.db.prepare(
      `INSERT INTO contacts (first_name, last_name, email, company, title, linkedin_url, phone, notes, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'csv', ?, ?)`
    );

    const updateStmt = this.db.prepare(
      `UPDATE contacts
         SET first_name = ?,
             last_name = ?,
             company = ?,
             title = ?,
             linkedin_url = ?,
             phone = ?,
             notes = ?,
             updated_at = ?
       WHERE LOWER(email) = LOWER(?)`
    );

    const now = new Date().toISOString();
    const contacts: Contact[] = [];
    const summary: CsvImportSummary = {
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };

    const tx = this.db.transaction(() => {
      for (const row of rows) {
        const firstName = String(row.first_name ?? "").trim();
        const lastName = String(row.last_name ?? "").trim();
        const email = String(row.email ?? "").trim().toLowerCase();
        if (!email) {
          summary.skipped += 1;
          summary.errors.push("Missing email in row");
          continue;
        }

        const existing = this.existsByEmail(email);
        if (existing) {
          if (dedupeMode === "skip") {
            summary.skipped += 1;
            continue;
          }
          updateStmt.run(
            firstName || existing.first_name,
            lastName || existing.last_name,
            row.company ?? existing.company ?? null,
            row.title ?? existing.title ?? null,
            row.linkedin_url ?? existing.linkedin_url ?? null,
            row.phone ?? existing.phone ?? null,
            row.notes ?? existing.notes ?? null,
            now,
            email
          );
          const updated = this.getById(existing.id);
          if (updated) {
            contacts.push(updated);
          }
          summary.updated += 1;
          continue;
        }

        const result = insert.run(
          firstName,
          lastName,
          email,
          row.company ?? null,
          row.title ?? null,
          row.linkedin_url ?? null,
          row.phone ?? null,
          row.notes ?? null,
          now,
          now
        );
        const inserted = this.getById(result.lastInsertRowid as number);
        if (inserted) {
          contacts.push(inserted);
          summary.inserted += 1;
        }
      }
    });
    tx();

    return { contacts, summary };
  }

  assignToProject(contactId: number, projectId: number, stage: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO project_contacts (project_id, contact_id, current_stage, assigned_at, stage_updated_at)
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

  setTags(contactId: number, tags: string[]): void {
    const now = new Date().toISOString();
    const normalized = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM contact_tags WHERE contact_id = ?").run(contactId);
      const insert = this.db.prepare(
        "INSERT OR IGNORE INTO contact_tags (contact_id, name, created_at) VALUES (?, ?, ?)"
      );
      for (const tag of normalized) {
        insert.run(contactId, tag, now);
      }
    })();
  }

  appendNote(contactId: number, body: string, createdBy = "user"): ContactNote {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        "INSERT INTO contact_notes (contact_id, body, created_by, created_at) VALUES (?, ?, ?, ?)"
      )
      .run(contactId, body, createdBy, now);
    return this.db
      .prepare("SELECT * FROM contact_notes WHERE id = ?")
      .get(result.lastInsertRowid as number) as ContactNote;
  }

  update(id: number, input: Partial<AddContactInput>): Contact | undefined {
    const current = this.getById(id);
    if (!current) return undefined;

    const now = new Date().toISOString();
    const updatedFirst = input.first_name ?? current.first_name;
    const updatedLast = input.last_name ?? current.last_name;
    const updatedEmail = input.email ?? current.email;
    const updatedCompany = input.company ?? current.company;
    const updatedTitle = input.title ?? current.title;
    const updatedLinkedin = input.linkedin_url ?? current.linkedin_url;
    const updatedPhone = input.phone ?? current.phone;
    const updatedNotes = input.notes ?? current.notes;
    const updatedWebsite = input.website ?? current.website;
    const updatedSocialLinks =
      input.social_links !== undefined
        ? JSON.stringify(input.social_links)
        : current.social_links
            ? JSON.stringify(current.social_links)
            : null;

    this.db
      .prepare(
        `UPDATE contacts
         SET first_name = ?,
             last_name = ?,
             email = ?,
             company = ?,
             title = ?,
             linkedin_url = ?,
             phone = ?,
             notes = ?,
             website = ?,
             social_links = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        updatedFirst,
        updatedLast,
        updatedEmail,
        updatedCompany,
        updatedTitle,
        updatedLinkedin,
        updatedPhone,
        updatedNotes,
        updatedWebsite,
        updatedSocialLinks,
        now,
        id
      );

    return this.getById(id);
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
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((row) => this.mapContact(row) as Contact & { current_stage: string });
  }

  searchContacts(filters: ContactSearchFilters = {}): Array<Contact & { current_stage?: string }> {
    const params: any[] = [];
    const where: string[] = [];

    let from = "FROM contacts c";
    if (filters.project_id) {
      from += " JOIN project_contacts pc ON c.id = pc.contact_id";
    }

    if (filters.tag) {
      from += " JOIN contact_tags ct ON c.id = ct.contact_id";
      where.push("ct.name = ?");
      params.push(filters.tag);
    }

    if (filters.group_id) {
      from += " JOIN contact_groups cg ON c.id = cg.contact_id";
      where.push("cg.group_id = ?");
      params.push(filters.group_id);
    }

    if (filters.q) {
      where.push("(LOWER(c.first_name) LIKE ? OR LOWER(c.last_name) LIKE ? OR LOWER(c.email) LIKE ? OR LOWER(COALESCE(c.company,'')) LIKE ?) ");
      const q = `%${filters.q.toLowerCase()}%`;
      params.push(q, q, q, q);
    }

    if (filters.project_id) {
      where.push("pc.project_id = ?");
      params.push(filters.project_id);

      if (filters.stage) {
        where.push("pc.current_stage = ?");
        params.push(filters.stage);
      }
    }

    let sql = `SELECT c.*${filters.project_id ? ", pc.current_stage" : ""} ${from}`;
    if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
    sql += " ORDER BY c.id DESC";

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((row) => this.mapContact(row));
  }
}
