import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../db/schema.js";
import { createApp } from "../index.js";

describe("project routes", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    app = createApp(db);
  });

  afterEach(() => db.close());

  it("POST /api/projects creates a project", async () => {
    const res = await app.request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Series A" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("Series A");
  });

  it("GET /api/projects lists projects", async () => {
    await app.request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "P1" }),
    });
    const res = await app.request("/api/projects");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
  });

  it("PATCH /api/projects/:id/stages sets stages", async () => {
    await app.request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "P1" }),
    });
    const res = await app.request("/api/projects/1/stages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stages: ["Researched", "Sent"] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pipeline_stages).toEqual(["Researched", "Sent"]);
  });
});
