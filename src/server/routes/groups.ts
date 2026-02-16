import { Hono } from "hono";
import type Database from "better-sqlite3";
import { GroupService } from "../../services/group.js";

export function groupRoutes(db: Database.Database) {
  const router = new Hono();
  const svc = new GroupService(db);

  router.get("/", (c) => {
    return c.json(svc.list());
  });

  router.post("/", async (c) => {
    const { name, color } = await c.req.json();
    if (!name || !String(name).trim()) {
      return c.json({ error: "name is required" }, 400);
    }
    const group = svc.create({ name: String(name).trim(), color: color ?? null });
    return c.json(group, 201);
  });

  router.patch("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const group = svc.getById(id);
    if (!group) {
      return c.json({ error: "Not found" }, 404);
    }

    const { name } = await c.req.json();
    if (!name || !String(name).trim()) {
      return c.json({ error: "name is required" }, 400);
    }
    svc.rename(id, String(name).trim());
    return c.json(svc.getById(id));
  });

  router.delete("/:id", (c) => {
    const id = Number(c.req.param("id"));
    const group = svc.getById(id);
    if (!group) {
      return c.json({ error: "Not found" }, 404);
    }
    svc.remove(id);
    return c.json({ ok: true });
  });

  router.get("/:id/contacts", (c) => {
    const id = Number(c.req.param("id"));
    const group = svc.getById(id);
    if (!group) {
      return c.json({ error: "Not found" }, 404);
    }
    return c.json(svc.listMembers(id));
  });

  router.post("/:id/contacts", async (c) => {
    const id = Number(c.req.param("id"));
    const { contact_id } = await c.req.json();
    const group = svc.getById(id);
    if (!group) {
      return c.json({ error: "Not found" }, 404);
    }
    if (!contact_id) {
      return c.json({ error: "contact_id is required" }, 400);
    }
    const contactId = Number(contact_id);
    if (!svc.existsContact(contactId)) {
      return c.json({ error: "contact_id not found" }, 404);
    }
    svc.assign(id, contactId);
    return c.json({ ok: true });
  });

  router.delete("/:id/contacts/:contact_id", (c) => {
    const id = Number(c.req.param("id"));
    const contactId = Number(c.req.param("contact_id"));
    const group = svc.getById(id);
    if (!group) {
      return c.json({ error: "Not found" }, 404);
    }
    svc.unassign(id, contactId);
    return c.json({ ok: true });
  });

  return router;
}
