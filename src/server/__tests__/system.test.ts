import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../db/schema.js";
import { createApp } from "../index.js";

describe("system routes", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    app = createApp(db);
  });

  afterEach(() => {
    db.close();
    process.env = { ...originalEnv };
  });

  it("returns system info with defaults when env vars are missing", async () => {
    delete process.env.KANBUN_PORT;
    delete process.env.KANBUN_DB_PATH;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;
    delete process.env.OUTLOOK_CLIENT_ID;
    delete process.env.OUTLOOK_TENANT_ID;
    delete process.env.OUTLOOK_REDIRECT_URI;

    const res = await app.request("/api/system");
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(typeof body.version === "string" || body.version === null).toBe(true);
    expect(body.port).toBe(7890);
    expect(typeof body.db_path).toBe("string");

    expect(body.oauth.gmail.configured).toBe(false);
    expect(body.oauth.gmail.missing).toEqual([
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_REDIRECT_URI",
    ]);

    expect(body.oauth.outlook.configured).toBe(false);
    expect(body.oauth.outlook.missing).toEqual([
      "OUTLOOK_CLIENT_ID",
      "OUTLOOK_TENANT_ID",
      "OUTLOOK_REDIRECT_URI",
    ]);
  });

  it("reflects configured OAuth env vars and custom port/db path", async () => {
    process.env.KANBUN_PORT = "9999";
    process.env.KANBUN_DB_PATH = "/tmp/kanbun-test.db";
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.GOOGLE_REDIRECT_URI = "http://localhost/callback";
    process.env.OUTLOOK_CLIENT_ID = "oid";
    process.env.OUTLOOK_TENANT_ID = "tenant";
    process.env.OUTLOOK_REDIRECT_URI = "http://localhost/outlook-callback";

    const res = await app.request("/api/system");
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.port).toBe(9999);
    expect(body.db_path).toBe("/tmp/kanbun-test.db");

    expect(body.oauth.gmail.configured).toBe(true);
    expect(body.oauth.gmail.missing).toEqual([]);

    expect(body.oauth.outlook.configured).toBe(true);
    expect(body.oauth.outlook.missing).toEqual([]);
  });
});
