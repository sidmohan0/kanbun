import { Hono } from "hono";
import type Database from "better-sqlite3";
import { ContactService } from "../../services/contact.js";

export function contactRoutes(db: Database.Database) {
  const router = new Hono();
  const svc = new ContactService(db);

  router.get("/", (c) => {
    const projectId = c.req.query("project_id");
    const stage = c.req.query("stage");
    const q = c.req.query("q");
    const tag = c.req.query("tag");
    const groupId = c.req.query("group_id");

    const filters = {
      q: q ?? undefined,
      tag: tag ?? undefined,
      group_id: groupId ? Number(groupId) : undefined,
      project_id: projectId ? Number(projectId) : undefined,
      stage: stage ?? undefined,
    };

    const hasAnyFilter =
      filters.q ||
      filters.tag ||
      filters.group_id ||
      filters.stage;

    if (projectId && !hasAnyFilter) {
      return c.json(svc.listByProject(Number(projectId)));
    }

    if (!hasAnyFilter) {
      return c.json(svc.listAll());
    }

    return c.json(svc.searchContacts(filters));
  });

  router.get("/:id/profile", (c) => {
    try {
      const profile = svc.getProfile(Number(c.req.param("id")));
      return c.json(profile);
    } catch {
      return c.json({ error: "Not found" }, 404);
    }
  });

  router.get("/:id", (c) => {
    const contact = svc.getById(Number(c.req.param("id")));
    if (!contact) return c.json({ error: "Not found" }, 404);
    return c.json(contact);
  });

  router.post("/", async (c) => {
    const body = await c.req.json();
    const {
      first_name,
      last_name,
      email,
      company,
      title,
      source,
      linkedin_url,
      phone,
      notes,
      apollo_id,
      website,
      social_links,
    } = body;
    const contact = svc.add({
      first_name,
      last_name,
      email,
      company,
      title,
      source,
      linkedin_url,
      phone,
      notes,
      apollo_id,
      website,
      social_links,
    });
    return c.json(contact, 201);
  });

  router.post("/import", async (c) => {
    const { rows, project_id, stage, dedupe_mode, legacy_response } =
      await c.req.json();
    const result = svc.importCsv(rows, dedupe_mode === "update" ? "update" : "skip");

    if (project_id) {
      for (const contact of result.contacts) {
        svc.assignToProject(contact.id, Number(project_id), stage ?? "Researched");
      }
    }

    if (legacy_response) {
      return c.json(result.contacts, 201);
    }

    return c.json(result, 201);
  });

  router.patch("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const updates = await c.req.json();
    const updated = svc.update(id, updates);
    if (!updated) return c.json({ error: "Not found" }, 404);
    return c.json(updated);
  });

  router.post("/:id/notes", async (c) => {
    const id = Number(c.req.param("id"));
    const existing = svc.getById(id);
    if (!existing) return c.json({ error: "Not found" }, 404);
    const { body, created_by } = await c.req.json();
    const note = svc.appendNote(id, String(body ?? ""), created_by);
    return c.json(note);
  });

  router.post("/:id/tags", async (c) => {
    const id = Number(c.req.param("id"));
    const existing = svc.getById(id);
    if (!existing) return c.json({ error: "Not found" }, 404);
    const { tags } = await c.req.json();
    if (!Array.isArray(tags)) {
      return c.json({ error: "tags must be an array" }, 400);
    }
    svc.setTags(id, tags.map(String));
    return c.json({ ok: true });
  });

  router.post("/:id/assign", async (c) => {
    const id = Number(c.req.param("id"));
    const existing = svc.getById(id);
    if (!existing) return c.json({ error: "Not found" }, 404);
    const { project_id, stage } = await c.req.json();
    svc.assignToProject(id, Number(project_id), stage);
    return c.json({ ok: true });
  });

  router.patch("/:id/stage", async (c) => {
    const id = Number(c.req.param("id"));
    const existing = svc.getById(id);
    if (!existing) return c.json({ error: "Not found" }, 404);
    const { project_id, stage } = await c.req.json();
    svc.moveStage(id, Number(project_id), stage);
    return c.json({ ok: true });
  });

  return router;
}
