import { Hono } from "hono";
import type Database from "better-sqlite3";
import { DraftService } from "../../services/draft.js";
import { Orchestrator } from "../../agent/orchestrator.js";
import { TemplateService } from "../../services/template.js";
import { ContactService } from "../../services/contact.js";
import { ProjectService } from "../../services/project.js";

export function draftRoutes(db: Database.Database) {
  const router = new Hono();
  const svc = new DraftService(db);

  router.post("/generate", async (c) => {
    const { project_id, mode, context, model, template_id } = await c.req.json();

    if (mode === "agent") {
      const orchestrator = new Orchestrator(db);
      try {
        const count = await orchestrator.generateDrafts({
          projectId: project_id,
          context,
          model,
        });
        return c.json({ count });
      } catch (e: any) {
        return c.json({ error: e.message }, 500);
      }
    }

    if (mode === "template") {
      if (!template_id) return c.json({ error: "template_id required" }, 400);
      const templateSvc = new TemplateService(db);
      const contactSvc = new ContactService(db);
      const projectSvc = new ProjectService(db);

      const template = templateSvc.getById(template_id);
      if (!template) return c.json({ error: "Template not found" }, 404);

      const project = projectSvc.getById(project_id);
      if (!project) return c.json({ error: "Project not found" }, 404);
      if (!project.default_send_account_id)
        return c.json({ error: "Project has no default send account" }, 400);

      const contacts = contactSvc.listByProject(project_id);
      let count = 0;
      for (const contact of contacts) {
        if (svc.pendingForContact(contact.id, project_id)) continue;
        const rendered = templateSvc.render(template_id, {
          first_name: contact.first_name,
          last_name: contact.last_name,
          email: contact.email,
          company: contact.company ?? "",
          title: contact.title ?? "",
        });
        svc.create({
          project_id,
          contact_id: contact.id,
          send_account_id: project.default_send_account_id,
          subject: rendered.subject,
          body: rendered.body,
          draft_type: "template",
        });
        count++;
      }
      return c.json({ count });
    }

    return c.json({ error: "mode must be 'agent' or 'template'" }, 400);
  });

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
      const result = await emailService.send(draft.send_account_id, contact.email, draft.subject, draft.body);
      svc.updateStatus(id, "sent");
      if (result.threadId) {
        svc.setThreadId(id, result.threadId);
      }
      return c.json({ success: true, threadId: result.threadId });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  return router;
}
