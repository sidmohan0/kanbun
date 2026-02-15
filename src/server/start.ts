import { serve } from "@hono/node-server";
import type Database from "better-sqlite3";
import type { Hono } from "hono";
import { getDb } from "../db/index.js";
import { createApp } from "./index.js";

const PORT = Number(process.env.KANBUN_PORT ?? 7890);

export function startServer(): { db: Database.Database; app: Hono } {
  const db = getDb();
  const app = createApp(db);

  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`Kanbun server running on http://localhost:${info.port}`);
  });

  return { db, app };
}

// Direct execution
const isMain = process.argv[1]?.endsWith("start.ts") ||
               process.argv[1]?.endsWith("start.js");
if (isMain) {
  startServer();
}
