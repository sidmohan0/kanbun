import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../db/schema.js";
import { createApp } from "../index.js";

describe("chat routes", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  let originalKey: string | undefined;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    app = createApp(db);
    originalKey = process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    db.close();
    if (originalKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("returns 500 when ANTHROPIC_API_KEY is not set", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain("ANTHROPIC_API_KEY");
  });

  it("returns 400 when messages array is empty", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";

    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("messages");
  });

  it("returns 400 when messages is missing", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";

    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("messages");
  });
});
