import type Database from "better-sqlite3";
import type { EmailAccount } from "../shared/types.js";

export class EmailAccountService {
  constructor(private db: Database.Database) {}

  add(
    provider: "gmail" | "outlook",
    emailAddress: string,
    displayName: string,
    credentials: Record<string, unknown>
  ): EmailAccount {
    const result = this.db
      .prepare(
        `INSERT INTO email_accounts (provider, email_address, display_name, credentials) VALUES (?, ?, ?, ?)`
      )
      .run(provider, emailAddress, displayName, JSON.stringify(credentials));
    return this.getById(result.lastInsertRowid as number)!;
  }

  getById(id: number): EmailAccount | undefined {
    return this.db
      .prepare("SELECT * FROM email_accounts WHERE id = ?")
      .get(id) as EmailAccount | undefined;
  }

  list(): EmailAccount[] {
    return this.db
      .prepare("SELECT id, provider, email_address, display_name FROM email_accounts ORDER BY id")
      .all() as EmailAccount[];
  }

  remove(id: number): void {
    this.db.prepare("DELETE FROM email_accounts WHERE id = ?").run(id);
  }

  getCredentials(id: number): Record<string, unknown> {
    const row = this.db
      .prepare("SELECT credentials FROM email_accounts WHERE id = ?")
      .get(id) as any;
    return row ? JSON.parse(row.credentials) : {};
  }

  updateCredentials(id: number, credentials: Record<string, unknown>): void {
    this.db
      .prepare("UPDATE email_accounts SET credentials = ? WHERE id = ?")
      .run(JSON.stringify(credentials), id);
  }
}
