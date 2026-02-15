# Kanbun Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a personal CRM CLI + Electron app for founder outreach with Apollo, Gmail, Outlook, and Calendar integrations.

**Architecture:** TypeScript monorepo. Hono HTTP server with SQLite (better-sqlite3) as the data layer. Commander.js CLI talks to the server over localhost HTTP. Electron wraps a Preact web UI. Anthropic SDK for LLM-powered draft generation.

**Tech Stack:** TypeScript, Hono, Commander.js, better-sqlite3, Electron, Preact, Anthropic SDK, Google APIs, Microsoft Graph API

**Phases:**
1. Foundation (scaffolding, DB, types)
2. Core Services (project, contact, template, draft, email account)
3. HTTP Server (Hono routes)
4. CLI (Commander.js commands wired to server)
5. Integrations (Gmail, Outlook, Apollo, Calendar)
6. Agent Layer (LLM drafts, follow-up scheduler)
7. Electron + Web UI (Dashboard, Draft Review)

---

## Phase 1: Foundation

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

**Step 1: Initialize project**

Run: `npm init -y`

**Step 2: Install core dependencies**

Run:
```bash
npm install hono @hono/node-server commander better-sqlite3 @anthropic-ai/sdk
npm install -D typescript @types/node @types/better-sqlite3 vitest tsx
```

**Step 3: Configure tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": ".",
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Configure .gitignore**

```
node_modules/
dist/
data/
*.db
.env
```

**Step 5: Add scripts to package.json**

```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx src/server/index.ts",
    "cli": "tsx src/cli/index.ts",
    "test": "vitest",
    "build": "tsc"
  }
}
```

**Step 6: Create directory structure**

Run:
```bash
mkdir -p src/{server/routes,cli/commands,services,agent,db/migrations,shared} ui/{pages,components} data electron
```

**Step 7: Commit**

```bash
git add -A && git commit -m "feat: project scaffolding with core dependencies"
```

---

### Task 2: Shared Types

**Files:**
- Create: `src/shared/types.ts`

**Step 1: Write types**

```typescript
// src/shared/types.ts

export interface Project {
  id: number;
  name: string;
  description: string | null;
  pipeline_stages: string[];
  follow_up_cadence: number[];
  default_send_account_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  company: string | null;
  title: string | null;
  linkedin_url: string | null;
  phone: string | null;
  notes: string | null;
  apollo_id: string | null;
  source: "manual" | "csv" | "apollo";
  created_at: string;
  updated_at: string;
}

export interface ProjectContact {
  project_id: number;
  contact_id: number;
  current_stage: string;
  assigned_at: string;
  stage_updated_at: string;
}

export interface EmailAccount {
  id: number;
  provider: "gmail" | "outlook";
  email_address: string;
  display_name: string;
  credentials: string;
}

export interface Draft {
  id: number;
  project_id: number;
  contact_id: number;
  send_account_id: number;
  subject: string;
  body: string;
  draft_type: "template" | "agent";
  status: "pending_review" | "approved" | "sent" | "skipped";
  scheduled_send_at: string | null;
  parent_draft_id: number | null;
  sequence_step: number;
  created_at: string;
  sent_at: string | null;
}

export interface Template {
  id: number;
  project_id: number;
  name: string;
  subject: string;
  body: string;
  variables: string[];
}
```

**Step 2: Commit**

```bash
git add src/shared/types.ts && git commit -m "feat: add shared TypeScript types"
```

---

### Task 3: Database Setup

**Files:**
- Create: `src/db/index.ts`
- Create: `src/db/schema.ts`
- Create: `src/db/__tests__/db.test.ts`

**Step 1: Write the failing test**

```typescript
// src/db/__tests__/db.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../schema.js";

describe("database schema", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("creates all tables", () => {
    applySchema(db);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("projects");
    expect(names).toContain("contacts");
    expect(names).toContain("project_contacts");
    expect(names).toContain("email_accounts");
    expect(names).toContain("drafts");
    expect(names).toContain("templates");
  });

  it("inserts and retrieves a project", () => {
    applySchema(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO projects (name, description, pipeline_stages, follow_up_cadence, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      "Test Project",
      "A test",
      JSON.stringify(["Stage1", "Stage2"]),
      JSON.stringify([3, 7]),
      now,
      now
    );
    const row = db.prepare("SELECT * FROM projects WHERE id = 1").get() as any;
    expect(row.name).toBe("Test Project");
    expect(JSON.parse(row.pipeline_stages)).toEqual(["Stage1", "Stage2"]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/__tests__/db.test.ts`
Expected: FAIL — `applySchema` doesn't exist

**Step 3: Write schema.ts**

```typescript
// src/db/schema.ts
import type Database from "better-sqlite3";

export function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      pipeline_stages TEXT NOT NULL DEFAULT '[]',
      follow_up_cadence TEXT NOT NULL DEFAULT '[]',
      default_send_account_id INTEGER,
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
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (contact_id) REFERENCES contacts(id),
      FOREIGN KEY (send_account_id) REFERENCES email_accounts(id),
      FOREIGN KEY (parent_draft_id) REFERENCES drafts(id)
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
  `);
}
```

**Step 4: Write db/index.ts**

```typescript
// src/db/index.ts
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { applySchema } from "./schema.js";

export function getDb(dbPath?: string): Database.Database {
  const resolvedPath =
    dbPath ?? path.join(process.cwd(), "data", "kanbun.db");
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(resolvedPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applySchema(db);
  return db;
}
```

**Step 5: Run tests to verify they pass**

Run: `npx vitest run src/db/__tests__/db.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/db/ && git commit -m "feat: database schema and connection setup"
```

---

## Phase 2: Core Services

### Task 4: Project Service

**Files:**
- Create: `src/services/project.ts`
- Create: `src/services/__tests__/project.test.ts`

**Step 1: Write failing tests**

```typescript
// src/services/__tests__/project.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../db/schema.js";
import { ProjectService } from "../project.js";

describe("ProjectService", () => {
  let db: Database.Database;
  let svc: ProjectService;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    svc = new ProjectService(db);
  });

  afterEach(() => db.close());

  it("creates and retrieves a project", () => {
    const p = svc.create("Series A Raise");
    expect(p.name).toBe("Series A Raise");
    expect(p.id).toBe(1);

    const found = svc.getById(1);
    expect(found?.name).toBe("Series A Raise");
  });

  it("lists all projects", () => {
    svc.create("Project 1");
    svc.create("Project 2");
    expect(svc.list()).toHaveLength(2);
  });

  it("sets pipeline stages", () => {
    svc.create("Test");
    svc.setStages(1, ["Researched", "Drafted", "Sent"]);
    const p = svc.getById(1);
    expect(p?.pipeline_stages).toEqual(["Researched", "Drafted", "Sent"]);
  });

  it("sets follow-up cadence", () => {
    svc.create("Test");
    svc.setCadence(1, [3, 7, 14]);
    const p = svc.getById(1);
    expect(p?.follow_up_cadence).toEqual([3, 7, 14]);
  });

  it("sets default send account", () => {
    svc.create("Test");
    db.prepare(
      "INSERT INTO email_accounts (provider, email_address, display_name, credentials) VALUES (?, ?, ?, ?)"
    ).run("gmail", "me@gmail.com", "Me", "{}");
    svc.setAccount(1, 1);
    const p = svc.getById(1);
    expect(p?.default_send_account_id).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/project.test.ts`
Expected: FAIL

**Step 3: Implement ProjectService**

```typescript
// src/services/project.ts
import type Database from "better-sqlite3";
import type { Project } from "../shared/types.js";

function parseProject(row: any): Project {
  return {
    ...row,
    pipeline_stages: JSON.parse(row.pipeline_stages),
    follow_up_cadence: JSON.parse(row.follow_up_cadence),
  };
}

export class ProjectService {
  constructor(private db: Database.Database) {}

  create(name: string, description?: string): Project {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO projects (name, description, pipeline_stages, follow_up_cadence, created_at, updated_at)
         VALUES (?, ?, '[]', '[]', ?, ?)`
      )
      .run(name, description ?? null, now, now);
    return this.getById(result.lastInsertRowid as number)!;
  }

  getById(id: number): Project | undefined {
    const row = this.db
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(id) as any;
    return row ? parseProject(row) : undefined;
  }

  list(): Project[] {
    const rows = this.db.prepare("SELECT * FROM projects ORDER BY id").all();
    return rows.map(parseProject);
  }

  setStages(id: number, stages: string[]): void {
    this.db
      .prepare("UPDATE projects SET pipeline_stages = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(stages), new Date().toISOString(), id);
  }

  setCadence(id: number, cadence: number[]): void {
    this.db
      .prepare("UPDATE projects SET follow_up_cadence = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(cadence), new Date().toISOString(), id);
  }

  setAccount(id: number, accountId: number): void {
    this.db
      .prepare("UPDATE projects SET default_send_account_id = ?, updated_at = ? WHERE id = ?")
      .run(accountId, new Date().toISOString(), id);
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/__tests__/project.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/services/project.ts src/services/__tests__/project.test.ts
git commit -m "feat: project service with CRUD and config"
```

---

### Task 5: Contact Service

**Files:**
- Create: `src/services/contact.ts`
- Create: `src/services/__tests__/contact.test.ts`

**Step 1: Write failing tests**

```typescript
// src/services/__tests__/contact.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../db/schema.js";
import { ContactService } from "../contact.js";

describe("ContactService", () => {
  let db: Database.Database;
  let svc: ContactService;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    svc = new ContactService(db);
  });

  afterEach(() => db.close());

  it("adds a contact", () => {
    const c = svc.add({
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@acme.com",
      company: "Acme",
      source: "manual",
    });
    expect(c.id).toBe(1);
    expect(c.first_name).toBe("Jane");
  });

  it("imports from CSV rows", () => {
    const rows = [
      { first_name: "A", last_name: "B", email: "a@b.com" },
      { first_name: "C", last_name: "D", email: "c@d.com" },
    ];
    const contacts = svc.importCsv(rows);
    expect(contacts).toHaveLength(2);
    expect(contacts[0].source).toBe("csv");
  });

  it("assigns contact to project and lists by project", () => {
    // Create project first
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO projects (name, pipeline_stages, follow_up_cadence, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run("P1", '["Researched","Sent"]', "[]", now, now);

    const c = svc.add({
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@acme.com",
      source: "manual",
    });
    svc.assignToProject(c.id, 1, "Researched");
    const list = svc.listByProject(1);
    expect(list).toHaveLength(1);
    expect(list[0].current_stage).toBe("Researched");
  });

  it("moves contact to a new stage", () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO projects (name, pipeline_stages, follow_up_cadence, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run("P1", '["Researched","Sent"]', "[]", now, now);

    const c = svc.add({
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@acme.com",
      source: "manual",
    });
    svc.assignToProject(c.id, 1, "Researched");
    svc.moveStage(c.id, 1, "Sent");
    const list = svc.listByProject(1);
    expect(list[0].current_stage).toBe("Sent");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/contact.test.ts`
Expected: FAIL

**Step 3: Implement ContactService**

```typescript
// src/services/contact.ts
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
```

**Step 4: Run tests**

Run: `npx vitest run src/services/__tests__/contact.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/services/contact.ts src/services/__tests__/contact.test.ts
git commit -m "feat: contact service with CRUD, CSV import, project assignment"
```

---

### Task 6: Template Service

**Files:**
- Create: `src/services/template.ts`
- Create: `src/services/__tests__/template.test.ts`

**Step 1: Write failing tests**

```typescript
// src/services/__tests__/template.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../db/schema.js";
import { TemplateService } from "../template.js";

describe("TemplateService", () => {
  let db: Database.Database;
  let svc: TemplateService;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO projects (name, pipeline_stages, follow_up_cadence, created_at, updated_at)
       VALUES (?, '[]', '[]', ?, ?)`
    ).run("P1", now, now);
    svc = new TemplateService(db);
  });

  afterEach(() => db.close());

  it("creates a template", () => {
    const t = svc.create(1, "Cold Intro", "Hi {{firstName}}", "Intro from {{company}}", ["firstName", "company"]);
    expect(t.id).toBe(1);
    expect(t.name).toBe("Cold Intro");
  });

  it("renders a template with variables", () => {
    svc.create(1, "Cold Intro", "Hi {{firstName}}", "Reaching out from {{company}}", ["firstName", "company"]);
    const rendered = svc.render(1, { firstName: "Jane", company: "Acme" });
    expect(rendered.subject).toBe("Hi Jane");
    expect(rendered.body).toBe("Reaching out from Acme");
  });

  it("lists templates by project", () => {
    svc.create(1, "T1", "S1", "B1", []);
    svc.create(1, "T2", "S2", "B2", []);
    expect(svc.listByProject(1)).toHaveLength(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/template.test.ts`
Expected: FAIL

**Step 3: Implement TemplateService**

```typescript
// src/services/template.ts
import type Database from "better-sqlite3";
import type { Template } from "../shared/types.js";

function parseTemplate(row: any): Template {
  return { ...row, variables: JSON.parse(row.variables) };
}

export class TemplateService {
  constructor(private db: Database.Database) {}

  create(
    projectId: number,
    name: string,
    subject: string,
    body: string,
    variables: string[]
  ): Template {
    const result = this.db
      .prepare(
        `INSERT INTO templates (project_id, name, subject, body, variables) VALUES (?, ?, ?, ?, ?)`
      )
      .run(projectId, name, subject, body, JSON.stringify(variables));
    return this.getById(result.lastInsertRowid as number)!;
  }

  getById(id: number): Template | undefined {
    const row = this.db
      .prepare("SELECT * FROM templates WHERE id = ?")
      .get(id) as any;
    return row ? parseTemplate(row) : undefined;
  }

  listByProject(projectId: number): Template[] {
    return this.db
      .prepare("SELECT * FROM templates WHERE project_id = ? ORDER BY id")
      .all(projectId)
      .map(parseTemplate);
  }

  render(
    templateId: number,
    vars: Record<string, string>
  ): { subject: string; body: string } {
    const t = this.getById(templateId);
    if (!t) throw new Error(`Template ${templateId} not found`);
    let subject = t.subject;
    let body = t.body;
    for (const [key, value] of Object.entries(vars)) {
      const re = new RegExp(`\\{\\{${key}\\}\\}`, "g");
      subject = subject.replace(re, value);
      body = body.replace(re, value);
    }
    return { subject, body };
  }
}
```

**Step 4: Run tests**

Run: `npx vitest run src/services/__tests__/template.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/services/template.ts src/services/__tests__/template.test.ts
git commit -m "feat: template service with rendering"
```

---

### Task 7: Draft Service

**Files:**
- Create: `src/services/draft.ts`
- Create: `src/services/__tests__/draft.test.ts`

**Step 1: Write failing tests**

```typescript
// src/services/__tests__/draft.test.ts
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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/draft.test.ts`
Expected: FAIL

**Step 3: Implement DraftService**

```typescript
// src/services/draft.ts
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

  pendingForContact(contactId: number, projectId: number): Draft | undefined {
    return this.db
      .prepare(
        "SELECT * FROM drafts WHERE contact_id = ? AND project_id = ? AND status = 'pending_review' LIMIT 1"
      )
      .get(contactId, projectId) as Draft | undefined;
  }
}
```

**Step 4: Run tests**

Run: `npx vitest run src/services/__tests__/draft.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/services/draft.ts src/services/__tests__/draft.test.ts
git commit -m "feat: draft service with CRUD and status management"
```

---

### Task 8: Email Account Service

**Files:**
- Create: `src/services/email-account.ts`
- Create: `src/services/__tests__/email-account.test.ts`

**Step 1: Write failing tests**

```typescript
// src/services/__tests__/email-account.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../db/schema.js";
import { EmailAccountService } from "../email-account.js";

describe("EmailAccountService", () => {
  let db: Database.Database;
  let svc: EmailAccountService;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    svc = new EmailAccountService(db);
  });

  afterEach(() => db.close());

  it("adds an account", () => {
    const a = svc.add("gmail", "me@gmail.com", "Me", { token: "abc" });
    expect(a.id).toBe(1);
    expect(a.provider).toBe("gmail");
  });

  it("lists accounts", () => {
    svc.add("gmail", "me@gmail.com", "Me", {});
    svc.add("outlook", "me@outlook.com", "Me", {});
    expect(svc.list()).toHaveLength(2);
  });

  it("retrieves credentials", () => {
    svc.add("gmail", "me@gmail.com", "Me", { token: "secret" });
    const creds = svc.getCredentials(1);
    expect(creds).toEqual({ token: "secret" });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/email-account.test.ts`
Expected: FAIL

**Step 3: Implement EmailAccountService**

```typescript
// src/services/email-account.ts
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
```

**Step 4: Run tests**

Run: `npx vitest run src/services/__tests__/email-account.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/services/email-account.ts src/services/__tests__/email-account.test.ts
git commit -m "feat: email account service"
```

---

## Phase 3: HTTP Server

### Task 9: Hono Server Setup + Project Routes

**Files:**
- Create: `src/server/index.ts`
- Create: `src/server/routes/projects.ts`
- Create: `src/server/__tests__/projects.test.ts`

**Step 1: Write failing tests**

```typescript
// src/server/__tests__/projects.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../db/schema.js";
import { createApp } from "../index.js";

describe("project routes", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    app = createApp(db);
  });

  afterEach(() => db.close());

  it("POST /api/projects creates a project", async () => {
    const res = await app.request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Series A" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("Series A");
  });

  it("GET /api/projects lists projects", async () => {
    await app.request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "P1" }),
    });
    const res = await app.request("/api/projects");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
  });

  it("PATCH /api/projects/:id/stages sets stages", async () => {
    await app.request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "P1" }),
    });
    const res = await app.request("/api/projects/1/stages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stages: ["Researched", "Sent"] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pipeline_stages).toEqual(["Researched", "Sent"]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/__tests__/projects.test.ts`
Expected: FAIL

**Step 3: Implement server and project routes**

```typescript
// src/server/index.ts
import { Hono } from "hono";
import type Database from "better-sqlite3";
import { projectRoutes } from "./routes/projects.js";

export function createApp(db: Database.Database) {
  const app = new Hono();

  app.route("/api/projects", projectRoutes(db));

  return app;
}
```

```typescript
// src/server/routes/projects.ts
import { Hono } from "hono";
import type Database from "better-sqlite3";
import { ProjectService } from "../../services/project.js";

export function projectRoutes(db: Database.Database) {
  const router = new Hono();
  const svc = new ProjectService(db);

  router.get("/", (c) => {
    return c.json(svc.list());
  });

  router.post("/", async (c) => {
    const { name, description } = await c.req.json();
    const project = svc.create(name, description);
    return c.json(project, 201);
  });

  router.get("/:id", (c) => {
    const project = svc.getById(Number(c.req.param("id")));
    if (!project) return c.json({ error: "Not found" }, 404);
    return c.json(project);
  });

  router.patch("/:id/stages", async (c) => {
    const id = Number(c.req.param("id"));
    const { stages } = await c.req.json();
    svc.setStages(id, stages);
    return c.json(svc.getById(id));
  });

  router.patch("/:id/cadence", async (c) => {
    const id = Number(c.req.param("id"));
    const { cadence } = await c.req.json();
    svc.setCadence(id, cadence);
    return c.json(svc.getById(id));
  });

  router.patch("/:id/account", async (c) => {
    const id = Number(c.req.param("id"));
    const { account_id } = await c.req.json();
    svc.setAccount(id, account_id);
    return c.json(svc.getById(id));
  });

  return router;
}
```

**Step 4: Run tests**

Run: `npx vitest run src/server/__tests__/projects.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/server/ && git commit -m "feat: hono server with project routes"
```

---

### Task 10: Contact, Draft, Template, Account Routes

**Files:**
- Create: `src/server/routes/contacts.ts`
- Create: `src/server/routes/drafts.ts`
- Create: `src/server/routes/templates.ts`
- Create: `src/server/routes/accounts.ts`
- Modify: `src/server/index.ts` — register new routes
- Create: `src/server/__tests__/contacts.test.ts`
- Create: `src/server/__tests__/drafts.test.ts`

Follow the same pattern as Task 9. Each route file:
- Instantiates its service with the `db` parameter
- Exposes REST endpoints matching the CLI commands
- Returns JSON responses

**Contact routes:**
- `GET /api/contacts?project_id=&stage=` — list contacts, optional filters
- `POST /api/contacts` — add a contact
- `POST /api/contacts/import` — CSV import (accepts JSON array)
- `POST /api/contacts/:id/assign` — assign to project `{ project_id, stage }`
- `PATCH /api/contacts/:id/stage` — move stage `{ project_id, stage }`

**Draft routes:**
- `GET /api/drafts?status=&project_id=` — list drafts
- `GET /api/drafts/:id` — get single draft
- `POST /api/drafts` — create a draft
- `PATCH /api/drafts/:id` — update content `{ subject, body }`
- `PATCH /api/drafts/:id/status` — update status `{ status }`

**Template routes:**
- `GET /api/templates?project_id=` — list templates
- `POST /api/templates` — create template
- `POST /api/templates/:id/render` — render with variables `{ vars: {} }`

**Account routes:**
- `GET /api/accounts` — list accounts
- `POST /api/accounts` — add account

**Modify `src/server/index.ts`** to register all routes:

```typescript
app.route("/api/projects", projectRoutes(db));
app.route("/api/contacts", contactRoutes(db));
app.route("/api/drafts", draftRoutes(db));
app.route("/api/templates", templateRoutes(db));
app.route("/api/accounts", accountRoutes(db));
```

Write tests for contacts and drafts routes (most critical paths). Templates and accounts follow the same pattern and are covered by service-level tests.

**Commit:**

```bash
git add src/server/ && git commit -m "feat: contact, draft, template, and account routes"
```

---

### Task 11: Server Startup

**Files:**
- Create: `src/server/start.ts`

**Step 1: Create the server entry point**

```typescript
// src/server/start.ts
import { serve } from "@hono/node-server";
import { getDb } from "../db/index.js";
import { createApp } from "./index.js";

const PORT = Number(process.env.KANBUN_PORT ?? 7890);

export function startServer() {
  const db = getDb();
  const app = createApp(db);

  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`Kanbun server running on http://localhost:${info.port}`);
  });

  return { db, app };
}

// Direct execution
const isMain = process.argv[1]?.endsWith("start.ts") ||
               process.argv[1]?.endsWith("start.js");
if (isMain) {
  startServer();
}
```

**Step 2: Commit**

```bash
git add src/server/start.ts && git commit -m "feat: server startup entry point"
```

---

## Phase 4: CLI

### Task 12: CLI Entry Point + Project Commands

**Files:**
- Create: `src/cli/index.ts`
- Create: `src/cli/commands/project.ts`
- Create: `src/cli/client.ts` — HTTP client helper

**Step 1: Create HTTP client helper**

```typescript
// src/cli/client.ts
const BASE = process.env.KANBUN_URL ?? "http://localhost:7890";

export async function api<T = any>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}
```

**Step 2: Create project commands**

```typescript
// src/cli/commands/project.ts
import { Command } from "commander";
import { api } from "../client.js";

export const projectCmd = new Command("project").description("Manage projects");

projectCmd
  .command("create <name>")
  .description("Create a new project")
  .action(async (name: string) => {
    const project = await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    console.log(`Created project #${project.id}: ${project.name}`);
  });

projectCmd
  .command("list")
  .description("List all projects")
  .action(async () => {
    const projects = await api("/api/projects");
    if (projects.length === 0) {
      console.log("No projects yet.");
      return;
    }
    for (const p of projects) {
      console.log(`#${p.id} ${p.name} [${p.pipeline_stages.join(" → ")}]`);
    }
  });

projectCmd
  .command("set-stages <id> <stages>")
  .description('Set pipeline stages (comma-separated, e.g. "Researched,Drafted,Sent")')
  .action(async (id: string, stages: string) => {
    const project = await api(`/api/projects/${id}/stages`, {
      method: "PATCH",
      body: JSON.stringify({ stages: stages.split(",").map((s) => s.trim()) }),
    });
    console.log(`Stages set: ${project.pipeline_stages.join(" → ")}`);
  });

projectCmd
  .command("set-cadence <id> <days>")
  .description('Set follow-up cadence (comma-separated days, e.g. "3,7,14")')
  .action(async (id: string, days: string) => {
    const cadence = days.split(",").map((d) => Number(d.trim()));
    const project = await api(`/api/projects/${id}/cadence`, {
      method: "PATCH",
      body: JSON.stringify({ cadence }),
    });
    console.log(`Cadence set: follow up at days ${project.follow_up_cadence.join(", ")}`);
  });

projectCmd
  .command("set-account <id> <account-id>")
  .description("Set default email account for a project")
  .action(async (id: string, accountId: string) => {
    await api(`/api/projects/${id}/account`, {
      method: "PATCH",
      body: JSON.stringify({ account_id: Number(accountId) }),
    });
    console.log("Default send account updated.");
  });
```

**Step 3: Create CLI entry point**

```typescript
// src/cli/index.ts
import { Command } from "commander";
import { projectCmd } from "./commands/project.js";

const program = new Command()
  .name("kanbun")
  .description("Personal CRM for founder outreach")
  .version("0.1.0");

program.addCommand(projectCmd);

program.parse();
```

**Step 4: Test manually**

Run: `npx tsx src/server/start.ts` (in one terminal)
Run: `npx tsx src/cli/index.ts project create "Test Project"` (in another)
Expected: `Created project #1: Test Project`

**Step 5: Commit**

```bash
git add src/cli/ && git commit -m "feat: CLI entry point with project commands"
```

---

### Task 13: Contact, Draft, Template, Account CLI Commands

**Files:**
- Create: `src/cli/commands/contact.ts`
- Create: `src/cli/commands/draft.ts`
- Create: `src/cli/commands/template.ts`
- Create: `src/cli/commands/account.ts`
- Modify: `src/cli/index.ts` — register all commands

Follow the same pattern as Task 12. Each command file creates a `Command` with subcommands that call the API via the `api()` helper.

**Contact commands:**
- `contact add --name <name> --email <email> [--company <co>] [--title <t>]` — splits name into first/last
- `contact import --csv <path> --project <id>` — reads CSV file, parses rows, POSTs to `/api/contacts/import`
- `contact list --project <id> [--stage <stage>]`
- `contact move <contact-id> --project <id> --stage <stage>`

For CSV parsing, use a simple line-by-line parser or add `csv-parse` as a dependency:
```bash
npm install csv-parse
```

**Draft commands:**
- `draft generate --project <id> --template <template-id>` — calls API to generate template drafts
- `draft generate --project <id> --agent [--context <ctx>]` — calls API to generate agent drafts
- `draft list [--status <status>]`
- `draft preview <id>` — prints subject/body to terminal

**Template commands:**
- `template create --project <id> --name <name>` — opens $EDITOR or prompts for subject/body
- `template list --project <id>`

**Account commands:**
- `account add <provider>` — triggers OAuth flow (stubbed for now, implemented in Phase 5)
- `account list`

**Modify `src/cli/index.ts`:**

```typescript
import { contactCmd } from "./commands/contact.js";
import { draftCmd } from "./commands/draft.js";
import { templateCmd } from "./commands/template.js";
import { accountCmd } from "./commands/account.js";

program.addCommand(projectCmd);
program.addCommand(contactCmd);
program.addCommand(draftCmd);
program.addCommand(templateCmd);
program.addCommand(accountCmd);
```

**Commit:**

```bash
git add src/cli/ && git commit -m "feat: contact, draft, template, and account CLI commands"
```

---

## Phase 5: Integrations

### Task 14: Gmail Integration

**Files:**
- Create: `src/services/gmail.ts`
- Create: `src/services/__tests__/gmail.test.ts`

**Step 1: Install dependencies**

Run: `npm install googleapis`

**Step 2: Implement GmailService**

```typescript
// src/services/gmail.ts
import { google, type gmail_v1 } from "googleapis";
import type { EmailAccount } from "../shared/types.js";

export class GmailService {
  private gmail: gmail_v1.Gmail;
  private auth;

  constructor(credentials: {
    client_id: string;
    client_secret: string;
    access_token: string;
    refresh_token: string;
  }) {
    this.auth = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret
    );
    this.auth.setCredentials({
      access_token: credentials.access_token,
      refresh_token: credentials.refresh_token,
    });
    this.gmail = google.gmail({ version: "v1", auth: this.auth });
  }

  async send(to: string, subject: string, body: string, from: string): Promise<string> {
    const raw = Buffer.from(
      `From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${body}`
    ).toString("base64url");

    const res = await this.gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });
    return res.data.id ?? "";
  }

  async checkReplies(threadId: string): Promise<boolean> {
    const thread = await this.gmail.users.threads.get({
      userId: "me",
      id: threadId,
    });
    return (thread.data.messages?.length ?? 0) > 1;
  }

  static getAuthUrl(clientId: string, clientSecret: string, redirectUri: string): string {
    const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    return auth.generateAuthUrl({
      access_type: "offline",
      scope: [
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/calendar",
      ],
    });
  }

  static async exchangeCode(
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    code: string
  ): Promise<{ access_token: string; refresh_token: string }> {
    const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const { tokens } = await auth.getToken(code);
    return {
      access_token: tokens.access_token!,
      refresh_token: tokens.refresh_token!,
    };
  }
}
```

**Step 3: Write tests** (unit tests with mocked API — test the raw email encoding and auth URL generation)

**Step 4: Commit**

```bash
git add src/services/gmail.ts src/services/__tests__/gmail.test.ts
git commit -m "feat: Gmail integration service"
```

---

### Task 15: Outlook Integration

**Files:**
- Create: `src/services/outlook.ts`
- Create: `src/services/__tests__/outlook.test.ts`

**Step 1: Install dependencies**

Run: `npm install @microsoft/microsoft-graph-client @azure/msal-node`

**Step 2: Implement OutlookService**

Same interface pattern as GmailService:
- `send(to, subject, body, from)` — uses Graph API `sendMail`
- `checkReplies(messageId)` — queries conversation thread
- Static `getAuthUrl()` and `exchangeCode()` for OAuth2 via MSAL

```typescript
// src/services/outlook.ts
import { Client } from "@microsoft/microsoft-graph-client";
import { ConfidentialClientApplication } from "@azure/msal-node";

export class OutlookService {
  private client: Client;

  constructor(accessToken: string) {
    this.client = Client.init({
      authProvider: (done) => done(null, accessToken),
    });
  }

  async send(to: string, subject: string, body: string): Promise<string> {
    const message = {
      subject,
      body: { contentType: "HTML", content: body },
      toRecipients: [{ emailAddress: { address: to } }],
    };
    const res = await this.client.api("/me/sendMail").post({ message });
    return res?.id ?? "";
  }

  async checkReplies(conversationId: string): Promise<boolean> {
    const messages = await this.client
      .api(`/me/messages?$filter=conversationId eq '${conversationId}'`)
      .get();
    return (messages.value?.length ?? 0) > 1;
  }
}
```

**Step 3: Commit**

```bash
git add src/services/outlook.ts src/services/__tests__/outlook.test.ts
git commit -m "feat: Outlook integration service"
```

---

### Task 16: Email Service (common interface)

**Files:**
- Create: `src/services/email.ts`

**Step 1: Implement the unified EmailService**

```typescript
// src/services/email.ts
import type Database from "better-sqlite3";
import { GmailService } from "./gmail.js";
import { OutlookService } from "./outlook.js";
import { EmailAccountService } from "./email-account.js";

export class EmailService {
  private accountService: EmailAccountService;

  constructor(private db: Database.Database) {
    this.accountService = new EmailAccountService(db);
  }

  async send(
    accountId: number,
    to: string,
    subject: string,
    body: string
  ): Promise<string> {
    const account = this.accountService.getById(accountId);
    if (!account) throw new Error(`Account ${accountId} not found`);
    const creds = this.accountService.getCredentials(accountId);

    if (account.provider === "gmail") {
      const gmail = new GmailService(creds as any);
      return gmail.send(to, subject, body, account.email_address);
    } else {
      const outlook = new OutlookService(creds.access_token as string);
      return outlook.send(to, subject, body);
    }
  }
}
```

**Step 2: Commit**

```bash
git add src/services/email.ts && git commit -m "feat: unified email service delegating to gmail/outlook"
```

---

### Task 17: Apollo MCP Integration

**Files:**
- Create: `src/services/apollo.ts`
- Create: `src/services/__tests__/apollo.test.ts`

**Step 1: Install MCP client**

Run: `npm install @anthropic-ai/mcp`

**Step 2: Implement ApolloService**

```typescript
// src/services/apollo.ts
import type { Contact } from "../shared/types.js";

// Apollo MCP client — connects to the Apollo MCP server
// The exact tool names depend on the Apollo MCP server spec.
// This wraps the MCP calls and normalizes results to Contact shape.

export class ApolloService {
  private mcpClient: any; // MCP client instance

  constructor(private serverUrl: string) {}

  async connect(): Promise<void> {
    // Initialize MCP client connection to Apollo server
    // Implementation depends on the MCP SDK's client API
  }

  async search(
    query: string,
    limit: number = 25
  ): Promise<Array<Partial<Contact> & { apollo_id: string }>> {
    // Call Apollo MCP search tool
    // Normalize response to Contact-like objects
    // Return with apollo_id set for dedup on import
    return [];
  }

  async importList(
    listName: string
  ): Promise<Array<Partial<Contact> & { apollo_id: string }>> {
    // Call Apollo MCP list tool
    // Normalize response
    return [];
  }

  async enrich(apolloId: string): Promise<Partial<Contact>> {
    // Call Apollo MCP enrich tool
    // Return enriched contact fields
    return {};
  }
}
```

Note: The exact MCP tool names and payloads depend on the Apollo MCP server specification. The service provides the wrapper — actual tool call signatures will be filled in when integrating with the real server.

**Step 3: Commit**

```bash
git add src/services/apollo.ts src/services/__tests__/apollo.test.ts
git commit -m "feat: Apollo MCP service scaffold"
```

---

### Task 18: Google Calendar Integration

**Files:**
- Create: `src/services/calendar.ts`

**Step 1: Implement CalendarService**

```typescript
// src/services/calendar.ts
import { google } from "googleapis";

export class CalendarService {
  private calendar;

  constructor(credentials: {
    client_id: string;
    client_secret: string;
    access_token: string;
    refresh_token: string;
  }) {
    const auth = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret
    );
    auth.setCredentials({
      access_token: credentials.access_token,
      refresh_token: credentials.refresh_token,
    });
    this.calendar = google.calendar({ version: "v3", auth });
  }

  async createEvent(params: {
    summary: string;
    description?: string;
    startTime: string;
    endTime: string;
    attendeeEmail?: string;
  }): Promise<string> {
    const event = await this.calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary: params.summary,
        description: params.description,
        start: { dateTime: params.startTime },
        end: { dateTime: params.endTime },
        attendees: params.attendeeEmail
          ? [{ email: params.attendeeEmail }]
          : undefined,
      },
    });
    return event.data.id ?? "";
  }

  async listUpcoming(maxResults: number = 10) {
    const res = await this.calendar.events.list({
      calendarId: "primary",
      timeMin: new Date().toISOString(),
      maxResults,
      singleEvents: true,
      orderBy: "startTime",
    });
    return res.data.items ?? [];
  }
}
```

**Step 2: Commit**

```bash
git add src/services/calendar.ts && git commit -m "feat: Google Calendar integration service"
```

---

### Task 19: Sync Service (Reply Polling)

**Files:**
- Create: `src/services/sync.ts`

**Step 1: Implement SyncService**

```typescript
// src/services/sync.ts
import type Database from "better-sqlite3";
import { DraftService } from "./draft.js";
import { ContactService } from "./contact.js";
import { EmailService } from "./email.js";

export class SyncService {
  private draftService: DraftService;
  private contactService: ContactService;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(private db: Database.Database) {
    this.draftService = new DraftService(db);
    this.contactService = new ContactService(db);
  }

  start(intervalMs: number = 5 * 60 * 1000): void {
    this.intervalId = setInterval(() => this.pollReplies(), intervalMs);
    console.log(`Sync service started (polling every ${intervalMs / 1000}s)`);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async pollReplies(): Promise<void> {
    // Find all sent drafts that haven't been replied to
    const sentDrafts = this.db
      .prepare(
        `SELECT d.*, c.email, ea.provider, ea.id as account_id
         FROM drafts d
         JOIN contacts c ON d.contact_id = c.id
         JOIN email_accounts ea ON d.send_account_id = ea.id
         WHERE d.status = 'sent'
         AND NOT EXISTS (
           SELECT 1 FROM project_contacts pc
           WHERE pc.contact_id = d.contact_id
           AND pc.project_id = d.project_id
           AND pc.current_stage = 'Replied'
         )`
      )
      .all() as any[];

    for (const draft of sentDrafts) {
      // Check for replies via the appropriate email provider
      // If reply found, move contact to "Replied" stage
      // This is provider-specific and will use GmailService/OutlookService
    }
  }
}
```

**Step 2: Commit**

```bash
git add src/services/sync.ts && git commit -m "feat: sync service for reply polling"
```

---

## Phase 6: Agent Layer

### Task 20: LLM Draft Generation

**Files:**
- Create: `src/agent/prompts.ts`
- Create: `src/agent/orchestrator.ts`
- Create: `src/agent/__tests__/orchestrator.test.ts`

**Step 1: Create prompt templates**

```typescript
// src/agent/prompts.ts

export function buildDraftPrompt(params: {
  projectName: string;
  projectDescription: string;
  contactName: string;
  contactTitle: string | null;
  contactCompany: string | null;
  contactNotes: string | null;
  priorThread: string | null;
  context: string | null;
  sequenceStep: number;
}): string {
  const lines = [
    `You are writing an outreach email for the project "${params.projectName}".`,
    params.projectDescription ? `Project context: ${params.projectDescription}` : "",
    "",
    `Recipient: ${params.contactName}`,
    params.contactTitle ? `Title: ${params.contactTitle}` : "",
    params.contactCompany ? `Company: ${params.contactCompany}` : "",
    params.contactNotes ? `Notes: ${params.contactNotes}` : "",
    "",
    params.priorThread ? `Previous email thread:\n${params.priorThread}\n` : "",
    params.context ? `Additional context: ${params.context}` : "",
    "",
    params.sequenceStep > 1
      ? `This is follow-up #${params.sequenceStep - 1}. Be brief and reference the previous email.`
      : "This is the initial outreach email.",
    "",
    "Write a concise, personalized email. Return JSON with { subject, body } fields.",
    "The body should be plain text with paragraph breaks. Do not use HTML.",
    "Be natural and human. Avoid salesy language.",
  ];
  return lines.filter(Boolean).join("\n");
}
```

**Step 2: Create orchestrator**

```typescript
// src/agent/orchestrator.ts
import Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import { ProjectService } from "../services/project.js";
import { ContactService } from "../services/contact.js";
import { DraftService } from "../services/draft.js";
import { buildDraftPrompt } from "./prompts.js";

export class Orchestrator {
  private anthropic: Anthropic;
  private projectService: ProjectService;
  private contactService: ContactService;
  private draftService: DraftService;

  constructor(private db: Database.Database, apiKey?: string) {
    this.anthropic = new Anthropic({ apiKey });
    this.projectService = new ProjectService(db);
    this.contactService = new ContactService(db);
    this.draftService = new DraftService(db);
  }

  async generateDrafts(params: {
    projectId: number;
    context?: string;
    model?: string;
    contactIds?: number[];
  }): Promise<number> {
    const project = this.projectService.getById(params.projectId);
    if (!project) throw new Error(`Project ${params.projectId} not found`);
    if (!project.default_send_account_id)
      throw new Error("Project has no default send account");

    // Get contacts that don't already have a pending draft
    let contacts = this.contactService.listByProject(params.projectId);
    if (params.contactIds) {
      contacts = contacts.filter((c) => params.contactIds!.includes(c.id));
    }
    contacts = contacts.filter(
      (c) => !this.draftService.pendingForContact(c.id, params.projectId)
    );

    let count = 0;
    for (const contact of contacts) {
      const prompt = buildDraftPrompt({
        projectName: project.name,
        projectDescription: project.description ?? "",
        contactName: `${contact.first_name} ${contact.last_name}`,
        contactTitle: contact.title,
        contactCompany: contact.company,
        contactNotes: contact.notes,
        priorThread: null,
        context: params.context ?? null,
        sequenceStep: 1,
      });

      const response = await this.anthropic.messages.create({
        model: params.model ?? "claude-sonnet-4-5-20250929",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });

      const text =
        response.content[0].type === "text" ? response.content[0].text : "";
      const parsed = JSON.parse(text);

      this.draftService.create({
        project_id: params.projectId,
        contact_id: contact.id,
        send_account_id: project.default_send_account_id,
        subject: parsed.subject,
        body: parsed.body,
        draft_type: "agent",
      });
      count++;
    }
    return count;
  }
}
```

**Step 3: Write tests** (mock Anthropic SDK, verify prompt construction and draft creation)

**Step 4: Commit**

```bash
git add src/agent/ && git commit -m "feat: agent orchestrator for LLM draft generation"
```

---

### Task 21: Follow-up Scheduler

**Files:**
- Create: `src/agent/scheduler.ts`
- Create: `src/agent/__tests__/scheduler.test.ts`

**Step 1: Implement scheduler**

```typescript
// src/agent/scheduler.ts
import type Database from "better-sqlite3";
import { ProjectService } from "../services/project.js";
import { DraftService } from "../services/draft.js";
import { Orchestrator } from "./orchestrator.js";

export class FollowUpScheduler {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private projectService: ProjectService;
  private draftService: DraftService;

  constructor(private db: Database.Database) {
    this.projectService = new ProjectService(db);
    this.draftService = new DraftService(db);
  }

  start(intervalMs: number = 60 * 60 * 1000): void {
    this.intervalId = setInterval(() => this.check(), intervalMs);
    console.log("Follow-up scheduler started (checking hourly)");
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async check(): Promise<number> {
    let generated = 0;
    const projects = this.projectService.list();

    for (const project of projects) {
      if (project.follow_up_cadence.length === 0) continue;

      // Find contacts with sent drafts that need follow-ups
      const candidates = this.db
        .prepare(
          `SELECT d.contact_id, d.id as last_draft_id, d.sequence_step, d.sent_at
           FROM drafts d
           WHERE d.project_id = ?
           AND d.status = 'sent'
           AND d.sequence_step <= ?
           AND NOT EXISTS (
             SELECT 1 FROM drafts d2
             WHERE d2.contact_id = d.contact_id
             AND d2.project_id = d.project_id
             AND d2.status = 'pending_review'
           )
           AND NOT EXISTS (
             SELECT 1 FROM project_contacts pc
             WHERE pc.contact_id = d.contact_id
             AND pc.project_id = d.project_id
             AND pc.current_stage = 'Replied'
           )
           ORDER BY d.sequence_step DESC`
        )
        .all(project.id, project.follow_up_cadence.length) as any[];

      for (const candidate of candidates) {
        const nextStep = candidate.sequence_step + 1;
        const cadenceIndex = nextStep - 2; // step 2 = cadence[0], step 3 = cadence[1]
        if (cadenceIndex >= project.follow_up_cadence.length) continue;

        const daysToWait = project.follow_up_cadence[cadenceIndex];
        const sentDate = new Date(candidate.sent_at);
        const dueDate = new Date(sentDate.getTime() + daysToWait * 86400000);

        if (new Date() >= dueDate) {
          // Generate follow-up draft
          // Uses template or agent based on project config
          // For now, creates a placeholder that the orchestrator can fill
          this.draftService.create({
            project_id: project.id,
            contact_id: candidate.contact_id,
            send_account_id: project.default_send_account_id!,
            subject: "Re: (follow-up)",
            body: `[Follow-up #${nextStep - 1} — to be personalized]`,
            draft_type: "agent",
            parent_draft_id: candidate.last_draft_id,
            sequence_step: nextStep,
          });
          generated++;
        }
      }
    }
    return generated;
  }
}
```

**Step 2: Write tests** (use in-memory DB, insert sent drafts with old dates, verify follow-ups are generated)

**Step 3: Commit**

```bash
git add src/agent/scheduler.ts src/agent/__tests__/scheduler.test.ts
git commit -m "feat: follow-up scheduler with cadence-based draft generation"
```

---

## Phase 7: Electron + Web UI

### Task 22: Electron Shell

**Files:**
- Create: `electron/main.ts`
- Create: `electron/preload.ts`
- Modify: `package.json` — add Electron scripts and config

**Step 1: Install Electron dependencies**

Run: `npm install -D electron electron-builder`

**Step 2: Create Electron main process**

```typescript
// electron/main.ts
import { app, BrowserWindow } from "electron";
import path from "node:path";
import { startServer } from "../src/server/start.js";

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  const PORT = Number(process.env.KANBUN_PORT ?? 7890);
  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  startServer();
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});
```

```typescript
// electron/preload.ts
// Minimal preload — no node access in renderer
```

**Step 3: Add Electron scripts to package.json**

```json
{
  "main": "dist/electron/main.js",
  "scripts": {
    "electron": "npm run build && electron .",
    "dev": "tsx src/server/start.ts",
    "cli": "tsx src/cli/index.ts",
    "test": "vitest",
    "build": "tsc"
  }
}
```

**Step 4: Commit**

```bash
git add electron/ package.json && git commit -m "feat: Electron shell"
```

---

### Task 23: Web UI — Preact Setup + Dashboard

**Files:**
- Create: `ui/index.html`
- Create: `ui/app.tsx`
- Create: `ui/pages/Dashboard.tsx`
- Create: `ui/components/ProjectSidebar.tsx`
- Create: `ui/components/PipelineBar.tsx`
- Modify: `src/server/index.ts` — serve static UI files

**Step 1: Install UI dependencies**

Run: `npm install preact && npm install -D @preact/preset-vite vite`

**Step 2: Create vite.config.ts**

```typescript
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  root: "ui",
  build: { outDir: "../dist/ui" },
});
```

**Step 3: Create index.html**

```html
<!-- ui/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Kanbun</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="./app.tsx"></script>
</body>
</html>
```

**Step 4: Create app.tsx**

```tsx
// ui/app.tsx
import { render } from "preact";
import { useState } from "preact/hooks";
import { Dashboard } from "./pages/Dashboard.js";
import { DraftReview } from "./pages/DraftReview.js";

function App() {
  const [view, setView] = useState<"dashboard" | "drafts">("dashboard");
  const [selectedProject, setSelectedProject] = useState<number | null>(null);

  if (view === "drafts") {
    return <DraftReview projectId={selectedProject} onBack={() => setView("dashboard")} />;
  }
  return (
    <Dashboard
      onSelectProject={setSelectedProject}
      onOpenDrafts={() => setView("drafts")}
    />
  );
}

render(<App />, document.getElementById("app")!);
```

**Step 5: Create Dashboard page**

Dashboard fetches `/api/projects`, displays sidebar and pipeline bar. Calls `/api/drafts?status=pending_review` for pending count. Calls `/api/contacts?project_id=X` grouped by stage for the pipeline visualization.

Key components:
- `ProjectSidebar` — lists projects, shows pending draft badge
- `PipelineBar` — horizontal bar with stage counts for selected project

**Step 6: Add static file serving to Hono**

Modify `src/server/index.ts` to serve the built UI files from `dist/ui/` for non-API routes.

**Step 7: Commit**

```bash
git add ui/ vite.config.ts src/server/index.ts
git commit -m "feat: Preact dashboard UI"
```

---

### Task 24: Web UI — Draft Review Page

**Files:**
- Create: `ui/pages/DraftReview.tsx`
- Create: `ui/components/DraftEditor.tsx`
- Create: `ui/components/ContactCard.tsx`

**Step 1: Create DraftReview page**

Fetches `/api/drafts?status=pending_review`. Displays one draft at a time with:
- Editable subject (text input)
- Editable body (textarea or simple rich text)
- Contact context card (fetched via `/api/contacts/:id`)
- Navigation: previous/next, "Draft N of M"
- Actions: Skip, Save & Next, Send

```tsx
// ui/pages/DraftReview.tsx
import { useState, useEffect } from "preact/hooks";

const API = "";

interface DraftReviewProps {
  projectId: number | null;
  onBack: () => void;
}

export function DraftReview({ projectId, onBack }: DraftReviewProps) {
  const [drafts, setDrafts] = useState<any[]>([]);
  const [index, setIndex] = useState(0);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [contact, setContact] = useState<any>(null);

  useEffect(() => {
    fetch(`${API}/api/drafts?status=pending_review`)
      .then((r) => r.json())
      .then((d) => {
        setDrafts(d);
        if (d.length > 0) {
          setSubject(d[0].subject);
          setBody(d[0].body);
        }
      });
  }, []);

  useEffect(() => {
    if (drafts[index]) {
      setSubject(drafts[index].subject);
      setBody(drafts[index].body);
      fetch(`${API}/api/contacts/${drafts[index].contact_id}`)
        .then((r) => r.json())
        .then(setContact);
    }
  }, [index, drafts]);

  const current = drafts[index];
  if (!current) return <div><button onClick={onBack}>Back</button><p>No drafts to review.</p></div>;

  async function handleAction(action: "skip" | "save" | "send") {
    if (action === "skip") {
      await fetch(`${API}/api/drafts/${current.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "skipped" }),
      });
    } else if (action === "save") {
      await fetch(`${API}/api/drafts/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body }),
      });
    } else if (action === "send") {
      await fetch(`${API}/api/drafts/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body }),
      });
      await fetch(`${API}/api/drafts/${current.id}/send`, { method: "POST" });
    }
    // Move to next draft
    const next = drafts.filter((_, i) => i !== index);
    setDrafts(next);
    setIndex(Math.min(index, next.length - 1));
  }

  return (
    <div>
      <header>
        <button onClick={onBack}>← Back</button>
        <span>Draft {index + 1} of {drafts.length}</span>
      </header>
      {contact && (
        <div class="contact-card">
          {contact.first_name} {contact.last_name}
          {contact.title && `, ${contact.title}`}
          {contact.company && ` @ ${contact.company}`}
        </div>
      )}
      <input value={subject} onInput={(e) => setSubject((e.target as any).value)} />
      <textarea value={body} onInput={(e) => setBody((e.target as any).value)} rows={12} />
      <footer>
        <button onClick={() => handleAction("skip")}>Skip</button>
        <button onClick={() => handleAction("save")}>Save & Next</button>
        <button onClick={() => handleAction("send")}>Send</button>
      </footer>
    </div>
  );
}
```

**Step 2: Add send route to server**

Add `POST /api/drafts/:id/send` route that:
1. Loads the draft
2. Loads the contact email
3. Calls `EmailService.send()`
4. Updates draft status to "sent"
5. Moves contact to "Sent" stage

**Step 3: Commit**

```bash
git add ui/ src/server/routes/drafts.ts
git commit -m "feat: draft review UI with send flow"
```

---

## Phase Summary

| Phase | Tasks | What you get |
|-------|-------|-------------|
| 1. Foundation | 1-3 | Scaffolding, types, database |
| 2. Core Services | 4-8 | Project, contact, template, draft, account CRUD |
| 3. HTTP Server | 9-11 | Full REST API |
| 4. CLI | 12-13 | All CLI commands working against the server |
| 5. Integrations | 14-19 | Gmail, Outlook, Apollo, Calendar, reply sync |
| 6. Agent Layer | 20-21 | LLM drafts, follow-up scheduling |
| 7. Electron + UI | 22-24 | Desktop app with dashboard and draft review |

After Phase 4, you have a fully functional CLI CRM. Each subsequent phase adds a layer of capability. You can start using it at Phase 4 and iterate.
