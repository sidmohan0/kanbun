import type Database from "better-sqlite3";

function hasColumn(cols: { name: string }[], name: string): boolean {
  return cols.some((c) => c.name === name);
}

export function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      pipeline_stages TEXT NOT NULL DEFAULT '[]',
      follow_up_cadence TEXT NOT NULL DEFAULT '[]',
      default_send_account_id INTEGER,
      gtm_config TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (default_send_account_id) REFERENCES email_accounts(id)
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL,
      company TEXT,
      title TEXT,
      linkedin_url TEXT,
      phone TEXT,
      notes TEXT,
      apollo_id TEXT UNIQUE,
      source TEXT NOT NULL DEFAULT 'manual',
      social_links TEXT,
      website TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_contacts (
      project_id INTEGER NOT NULL,
      contact_id INTEGER NOT NULL,
      current_stage TEXT NOT NULL,
      assigned_at TEXT NOT NULL,
      stage_updated_at TEXT NOT NULL,
      PRIMARY KEY (project_id, contact_id),
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (contact_id) REFERENCES contacts(id)
    );

    CREATE TABLE IF NOT EXISTS email_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      email_address TEXT NOT NULL,
      display_name TEXT NOT NULL,
      credentials TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      contact_id INTEGER NOT NULL,
      send_account_id INTEGER NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      draft_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_review',
      scheduled_send_at TEXT,
      parent_draft_id INTEGER,
      sequence_step INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      sent_at TEXT,
      thread_id TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (contact_id) REFERENCES contacts(id),
      FOREIGN KEY (send_account_id) REFERENCES email_accounts(id),
      FOREIGN KEY (parent_draft_id) REFERENCES drafts(id)
    );

    CREATE TABLE IF NOT EXISTS meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      contact_id INTEGER NOT NULL,
      meeting_type TEXT NOT NULL DEFAULT 'meeting',
      scheduled_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (contact_id) REFERENCES contacts(id)
    );

    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      variables TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contact_groups (
      contact_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      assigned_at TEXT NOT NULL,
      PRIMARY KEY (contact_id, group_id),
      FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS contact_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (contact_id, name),
      FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS contact_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS contact_social_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (contact_id, provider, value),
      FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_contact_groups_contact ON contact_groups(contact_id);
    CREATE INDEX IF NOT EXISTS idx_contact_groups_group ON contact_groups(group_id);
    CREATE INDEX IF NOT EXISTS idx_contact_tags_contact ON contact_tags(contact_id);
    CREATE INDEX IF NOT EXISTS idx_contact_tags_name ON contact_tags(name);
    CREATE INDEX IF NOT EXISTS idx_groups_name ON groups(name);
    CREATE INDEX IF NOT EXISTS idx_contact_notes_contact ON contact_notes(contact_id);
    CREATE INDEX IF NOT EXISTS idx_contact_social_links_contact ON contact_social_links(contact_id);
  `);

  // Migrations for existing databases
  const projectCols = db.pragma("table_info(projects)") as { name: string }[];
  if (!hasColumn(projectCols, "gtm_config")) {
    db.exec("ALTER TABLE projects ADD COLUMN gtm_config TEXT");
  }

  const draftCols = db.pragma("table_info(drafts)") as { name: string }[];
  if (!hasColumn(draftCols, "thread_id")) {
    db.exec("ALTER TABLE drafts ADD COLUMN thread_id TEXT");
  }

  const contactCols = db.pragma("table_info(contacts)") as { name: string }[];
  if (!hasColumn(contactCols, "social_links")) {
    db.exec("ALTER TABLE contacts ADD COLUMN social_links TEXT");
  }
  if (!hasColumn(contactCols, "website")) {
    db.exec("ALTER TABLE contacts ADD COLUMN website TEXT");
  }
}
