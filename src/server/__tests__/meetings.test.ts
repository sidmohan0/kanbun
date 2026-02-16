import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../db/schema.js";
import { createApp } from "../index.js";

describe("meeting routes", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    app = createApp(db);
  });

  afterEach(() => db.close());

  async function seedDeps() {
    const projRes = await app.request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Outreach" }),
    });
    const project = await projRes.json();

    const contactRes = await app.request("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name: "Alice",
        last_name: "Smith",
        email: "alice@example.com",
        source: "manual",
      }),
    });
    const contact = await contactRes.json();

    return { project, contact };
  }

  it("POST /api/meetings creates a meeting", async () => {
    const deps = await seedDeps();
    const res = await app.request("/api/meetings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: deps.project.id,
        contact_id: deps.contact.id,
        meeting_type: "demo",
        notes: "Product walkthrough",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.meeting_type).toBe("demo");
    expect(body.notes).toBe("Product walkthrough");
    expect(body.id).toBeDefined();
  });

  it("GET /api/meetings?project_id= lists meetings", async () => {
    const deps = await seedDeps();
    await app.request("/api/meetings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: deps.project.id,
        contact_id: deps.contact.id,
      }),
    });

    const res = await app.request(`/api/meetings?project_id=${deps.project.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
  });

  it("GET /api/meetings/:id returns a meeting", async () => {
    const deps = await seedDeps();
    const createRes = await app.request("/api/meetings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: deps.project.id,
        contact_id: deps.contact.id,
        meeting_type: "meeting",
      }),
    });
    const created = await createRes.json();

    const res = await app.request(`/api/meetings/${created.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meeting_type).toBe("meeting");
  });

  it("GET /api/meetings/:id returns 404 for missing", async () => {
    const res = await app.request("/api/meetings/999");
    expect(res.status).toBe(404);
  });
});
