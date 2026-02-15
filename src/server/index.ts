import { Hono } from "hono";
import type Database from "better-sqlite3";
import { projectRoutes } from "./routes/projects.js";
import { contactRoutes } from "./routes/contacts.js";
import { draftRoutes } from "./routes/drafts.js";
import { templateRoutes } from "./routes/templates.js";
import { accountRoutes } from "./routes/accounts.js";

export function createApp(db: Database.Database) {
  const app = new Hono();

  app.route("/api/projects", projectRoutes(db));
  app.route("/api/contacts", contactRoutes(db));
  app.route("/api/drafts", draftRoutes(db));
  app.route("/api/templates", templateRoutes(db));
  app.route("/api/accounts", accountRoutes(db));

  return app;
}
