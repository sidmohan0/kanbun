import { Hono } from "hono";
import type Database from "better-sqlite3";
import { ContactService } from "../../services/contact.js";

export function contactRoutes(db: Database.Database) {
  const router = new Hono();
  const svc = new ContactService(db);

  router.get("/", (c) => {
    const projectId = c.req.query("project_id");
    const stage = c.req.query("stage");
    if (projectId) {
      return c.json(svc.listByProject(Number(projectId), stage));
    }
    // No project filter — return all contacts
    const rows = db
      .prepare("SELECT * FROM contacts ORDER BY id")
      .all();
    return c.json(rows);
  });

  router.get("/:id", (c) => {
    const contact = svc.getById(Number(c.req.param("id")));
    if (!contact) return c.json({ error: "Not found" }, 404);
    return c.json(contact);
  });

  router.post("/", async (c) => {
    const { first_name, last_name, email, company, title, source } =
      await c.req.json();
    const contact = svc.add({
      first_name,
      last_name,
      email,
      company,
      title,
      source: source ?? "manual",
    });
    return c.json(contact, 201);
  });

  router.post("/import", async (c) => {
    const { rows, project_id, stage } = await c.req.json();
    const contacts = svc.importCsv(rows);
    if (project_id) {
      for (const contact of contacts) {
        svc.assignToProject(contact.id, project_id, stage ?? "Imported");
      }
    }
    return c.json(contacts, 201);
  });

  router.post("/:id/assign", async (c) => {
    const id = Number(c.req.param("id"));
    const { project_id, stage } = await c.req.json();
    svc.assignToProject(id, project_id, stage);
    return c.json({ ok: true });
  });

  router.patch("/:id/stage", async (c) => {
    const id = Number(c.req.param("id"));
    const { project_id, stage } = await c.req.json();
    svc.moveStage(id, project_id, stage);
    return c.json({ ok: true });
  });

  return router;
}
