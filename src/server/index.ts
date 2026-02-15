import { Hono } from "hono";
import type Database from "better-sqlite3";
import { projectRoutes } from "./routes/projects.js";

export function createApp(db: Database.Database) {
  const app = new Hono();

  app.route("/api/projects", projectRoutes(db));

  return app;
}
