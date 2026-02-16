import type Database from "better-sqlite3";
import type { Contact, Group, SocialLink } from "../shared/types.js";

interface GroupInput {
  name: string;
  color?: string | null;
}

export class GroupService {
  constructor(private db: Database.Database) {}

  private normalizeSocialLinks(value: unknown): SocialLink[] {
    if (!value) return [];
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return parsed
            .filter((row) => row && typeof row === "object")
            .map((row: any) => ({
              provider: String(row.provider ?? "").trim(),
              value: String(row.value ?? "").trim(),
            }))
            .filter((row) => row.provider && row.value);
        }
      } catch {
        return [];
      }
    }

    return [];
  }

  private mapContact(row: any): Contact {
    return {
      ...row,
      social_links: this.normalizeSocialLinks(row.social_links),
    } as Contact;
  }

  list(): Group[] {
    return this.db
      .prepare("SELECT * FROM groups ORDER BY id")
      .all() as Group[];
  }

  create(input: GroupInput): Group {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        "INSERT INTO groups (name, color, created_at, updated_at) VALUES (?, ?, ?, ?)"
      )
      .run(input.name, input.color ?? null, now, now);
    return this.getById(result.lastInsertRowid as number)!;
  }

  getById(id: number): Group | undefined {
    return this.db.prepare("SELECT * FROM groups WHERE id = ?").get(id) as Group | undefined;
  }

  existsContact(contactId: number): boolean {
    return Boolean(
      this.db
        .prepare("SELECT 1 FROM contacts WHERE id = ? LIMIT 1")
        .get(contactId)
    );
  }

  rename(id: number, name: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE groups SET name = ?, updated_at = ? WHERE id = ?")
      .run(name, now, id);
  }

  remove(id: number): void {
    this.db.prepare("DELETE FROM groups WHERE id = ?").run(id);
  }

  listMembers(groupId: number): Contact[] {
    const rows = this.db
      .prepare(
        `SELECT c.*
         FROM contacts c
         JOIN contact_groups cg ON c.id = cg.contact_id
         WHERE cg.group_id = ?
         ORDER BY c.id`
      )
      .all(groupId);

    return (rows as any[]).map((row) => this.mapContact(row));
  }

  assign(groupId: number, contactId: number): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT OR REPLACE INTO contact_groups (contact_id, group_id, assigned_at) VALUES (?, ?, ?)"
      )
      .run(contactId, groupId, now);
  }

  unassign(groupId: number, contactId: number): void {
    this.db
      .prepare("DELETE FROM contact_groups WHERE contact_id = ? AND group_id = ?")
      .run(contactId, groupId);
  }
}
