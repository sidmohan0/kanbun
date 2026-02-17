import { Hono } from "hono";
import type Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

interface SystemInfo {
  version: string | null;
  port: number;
  db_path: string | null;
  oauth: {
    gmail: { configured: boolean; missing: string[] };
    outlook: { configured: boolean; missing: string[] };
  };
}

let cachedVersion: string | null | undefined;

function getVersion(): string | null {
  if (cachedVersion !== undefined) return cachedVersion;
  try {
    const packageJsonPath = path.join(process.cwd(), "package.json");
    const raw = fs.readFileSync(packageJsonPath, "utf-8");
    const pkg = JSON.parse(raw) as { version?: string };
    cachedVersion = pkg.version ?? null;
  } catch {
    cachedVersion = null;
  }
  return cachedVersion;
}

function getDbPath(): string | null {
  if (process.env.KANBUN_DB_PATH) return process.env.KANBUN_DB_PATH;
  // Mirror getDb default: cwd/data/kanbun.db
  return path.join(process.cwd(), "data", "kanbun.db");
}

function computeOauthStatus(env: NodeJS.ProcessEnv) {
  const gmailKeys = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI",
  ];
  const outlookKeys = [
    "OUTLOOK_CLIENT_ID",
    "OUTLOOK_TENANT_ID",
    "OUTLOOK_REDIRECT_URI",
  ];

  const gmailMissing = gmailKeys.filter((k) => !env[k]);
  const outlookMissing = outlookKeys.filter((k) => !env[k]);

  return {
    gmail: {
      configured: gmailMissing.length === 0,
      missing: gmailMissing,
    },
    outlook: {
      configured: outlookMissing.length === 0,
      missing: outlookMissing,
    },
  };
}

export function systemRoutes(_db: Database.Database) {
  const router = new Hono();

  router.get("/", (c) => {
    const info: SystemInfo = {
      version: getVersion(),
      port: Number(process.env.KANBUN_PORT ?? 7890),
      db_path: getDbPath(),
      oauth: computeOauthStatus(process.env),
    };

    return c.json(info);
  });

  return router;
}
