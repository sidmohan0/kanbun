import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

const envSchema = z.object({
  DATABASE_URL: z.url(),
  APP_URL: z.url().default("http://localhost:3000"),
  NEXT_PUBLIC_APP_NAME: z.string().default("Kanbun"),
  OWNER_MODE_ENABLED: z.boolean().default(true),
  IMPORT_WORKER_POLL_INTERVAL_MS: z.number().int().positive().default(2000),
  IMPORT_WORKER_STALE_ROW_MS: z.number().int().positive().default(300000),
  APP_ENCRYPTION_KEY: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  MICROSOFT_CLIENT_ID: z.string().min(1).optional(),
  MICROSOFT_CLIENT_SECRET: z.string().min(1).optional(),
  MICROSOFT_TENANT_ID: z.string().min(1).default("common"),
  TODOIST_CLIENT_ID: z.string().min(1).optional(),
  TODOIST_CLIENT_SECRET: z.string().min(1).optional(),
});

const parsed = envSchema.safeParse({
  DATABASE_URL: process.env.DATABASE_URL,
  APP_URL: process.env.APP_URL ?? "http://localhost:3000",
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME ?? "Kanbun",
  OWNER_MODE_ENABLED:
    process.env.OWNER_MODE_ENABLED === undefined
      ? true
      : process.env.OWNER_MODE_ENABLED === "true",
  IMPORT_WORKER_POLL_INTERVAL_MS: Number(
    process.env.IMPORT_WORKER_POLL_INTERVAL_MS ?? "2000",
  ),
  IMPORT_WORKER_STALE_ROW_MS: Number(
    process.env.IMPORT_WORKER_STALE_ROW_MS ?? "300000",
  ),
  APP_ENCRYPTION_KEY:
    process.env.APP_ENCRYPTION_KEY ??
    "kanbun-local-development-encryption-key-change-me",
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || undefined,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || undefined,
  MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID || undefined,
  MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET || undefined,
  MICROSOFT_TENANT_ID: process.env.MICROSOFT_TENANT_ID || "common",
  TODOIST_CLIENT_ID: process.env.TODOIST_CLIENT_ID || undefined,
  TODOIST_CLIENT_SECRET: process.env.TODOIST_CLIENT_SECRET || undefined,
});

if (!parsed.success) {
  console.error(
    "Invalid environment configuration",
    parsed.error.flatten().fieldErrors,
  );
  throw new Error("Invalid environment configuration");
}

export const env = parsed.data;
