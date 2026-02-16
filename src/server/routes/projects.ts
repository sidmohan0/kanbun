import { Hono } from "hono";
import type Database from "better-sqlite3";
import { ProjectService } from "../../services/project.js";
import { GtmService, defaultGtmConfig } from "../../services/gtm.js";
import type { GtmScenario } from "../../shared/types.js";

export function projectRoutes(db: Database.Database) {
  const router = new Hono();
  const svc = new ProjectService(db);
  const gtmSvc = new GtmService(db);

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

  // GTM routes

  router.get("/:id/gtm/config", (c) => {
    const id = Number(c.req.param("id"));
    const config = svc.getGtmConfig(id);
    return c.json(config ?? defaultGtmConfig());
  });

  router.put("/:id/gtm/config", async (c) => {
    const id = Number(c.req.param("id"));
    const project = svc.getById(id);
    if (!project) return c.json({ error: "Not found" }, 404);
    const config = await c.req.json();
    svc.setGtmConfig(id, config);
    return c.json(config);
  });

  router.get("/:id/gtm/projections", (c) => {
    const id = Number(c.req.param("id"));
    const scenario = (c.req.query("scenario") ?? "base") as GtmScenario;
    const config = svc.getGtmConfig(id) ?? defaultGtmConfig();
    const projections = gtmSvc.generateProjections(config, scenario);
    return c.json(projections);
  });

  router.get("/:id/gtm/actuals", (c) => {
    const id = Number(c.req.param("id"));
    const actuals = gtmSvc.getActuals(id);
    return c.json(actuals);
  });

  return router;
}
