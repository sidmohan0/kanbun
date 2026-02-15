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
