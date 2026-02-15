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
