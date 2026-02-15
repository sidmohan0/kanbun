import { Hono } from "hono";
import type Database from "better-sqlite3";
import { DraftService } from "../../services/draft.js";

export function draftRoutes(db: Database.Database) {
  const router = new Hono();
  const svc = new DraftService(db);

  router.get("/", (c) => {
    const status = c.req.query("status");
    const projectId = c.req.query("project_id");
    if (status) {
      return c.json(svc.listByStatus(status));
    }
    if (projectId) {
      return c.json(svc.listByProject(Number(projectId)));
    }
    // Default: return all drafts
    const rows = db.prepare("SELECT * FROM drafts ORDER BY id").all();
    return c.json(rows);
  });

  router.get("/:id", (c) => {
    const id = Number(c.req.param("id"));
    // Join with contacts to include contact info
    const row = db
      .prepare(
        `SELECT d.*, c.first_name, c.last_name, c.email, c.company, c.title
         FROM drafts d
         JOIN contacts c ON d.contact_id = c.id
         WHERE d.id = ?`
      )
      .get(id);
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json(row);
  });

  router.post("/", async (c) => {
    const input = await c.req.json();
    const draft = svc.create(input);
    return c.json(draft, 201);
  });

  router.patch("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const { subject, body } = await c.req.json();
    svc.updateContent(id, subject, body);
    return c.json(svc.getById(id));
  });

  router.patch("/:id/status", async (c) => {
    const id = Number(c.req.param("id"));
    const { status } = await c.req.json();
    svc.updateStatus(id, status);
    return c.json(svc.getById(id));
  });

  router.post("/:id/send", async (c) => {
    const id = Number(c.req.param("id"));
    const draft = svc.getById(id);
    if (!draft) return c.json({ error: "Draft not found" }, 404);

    // Get contact email
    const contact = db.prepare("SELECT email FROM contacts WHERE id = ?").get(draft.contact_id) as any;
    if (!contact) return c.json({ error: "Contact not found" }, 404);

    // Send via email service
    const { EmailService } = await import("../../services/email.js");
    const emailService = new EmailService(db);
    try {
      await emailService.send(draft.send_account_id, contact.email, draft.subject, draft.body);
      svc.updateStatus(id, "sent");
      return c.json({ success: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  return router;
}
