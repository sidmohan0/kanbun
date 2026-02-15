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
