import { Hono } from "hono";
import type Database from "better-sqlite3";
import { MeetingService } from "../../services/meeting.js";

export function meetingRoutes(db: Database.Database) {
  const router = new Hono();
  const svc = new MeetingService(db);

  router.get("/", (c) => {
    const projectId = c.req.query("project_id");
    if (!projectId) return c.json({ error: "project_id required" }, 400);
    return c.json(svc.listByProject(Number(projectId)));
  });

  router.post("/", async (c) => {
    const input = await c.req.json();
    const meeting = svc.create(input);
    return c.json(meeting, 201);
  });

  router.get("/:id", (c) => {
    const meeting = svc.getById(Number(c.req.param("id")));
    if (!meeting) return c.json({ error: "Not found" }, 404);
    return c.json(meeting);
  });

  return router;
}
