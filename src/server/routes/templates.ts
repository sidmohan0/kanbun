import { Hono } from "hono";
import type Database from "better-sqlite3";
import { TemplateService } from "../../services/template.js";

export function templateRoutes(db: Database.Database) {
  const router = new Hono();
  const svc = new TemplateService(db);

  router.get("/", (c) => {
    const projectId = c.req.query("project_id");
    if (projectId) {
      return c.json(svc.listByProject(Number(projectId)));
    }
    // No filter — return all templates
    const rows = db.prepare("SELECT * FROM templates ORDER BY id").all();
    // Parse variables JSON for each row
    return c.json(
      rows.map((r: any) => ({ ...r, variables: JSON.parse(r.variables) }))
    );
  });

  router.get("/:id", (c) => {
    const template = svc.getById(Number(c.req.param("id")));
    if (!template) return c.json({ error: "Not found" }, 404);
    return c.json(template);
  });

  router.post("/", async (c) => {
    const { project_id, name, subject, body, variables } = await c.req.json();
    const template = svc.create(project_id, name, subject, body, variables ?? []);
    return c.json(template, 201);
  });

  router.post("/:id/render", async (c) => {
    const id = Number(c.req.param("id"));
    const { vars } = await c.req.json();
    try {
      const rendered = svc.render(id, vars);
      return c.json(rendered);
    } catch (e: any) {
      return c.json({ error: e.message }, 404);
    }
  });

  return router;
}
