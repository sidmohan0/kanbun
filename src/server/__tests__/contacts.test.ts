import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../db/schema.js";
import { createApp } from "../index.js";

describe("contact routes", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    app = createApp(db);
  });

  afterEach(() => db.close());

  async function createProject(name = "Outreach") {
    const res = await app.request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return res.json();
  }

  async function createContact(overrides: Record<string, unknown> = {}) {
    const res = await app.request("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name: "Alice",
        last_name: "Smith",
        email: "alice@example.com",
        source: "manual",
        ...overrides,
      }),
    });
    return { res, body: await res.json() };
  }

  it("POST /api/contacts creates a contact", async () => {
    const { res, body } = await createContact();
    expect(res.status).toBe(201);
    expect(body.first_name).toBe("Alice");
    expect(body.last_name).toBe("Smith");
    expect(body.email).toBe("alice@example.com");
    expect(body.source).toBe("manual");
    expect(body.id).toBeDefined();
  });

  it("GET /api/contacts/:id returns a contact", async () => {
    const { body: created } = await createContact();
    const res = await app.request(`/api/contacts/${created.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe("alice@example.com");
  });

  it("GET /api/contacts/:id returns 404 for missing", async () => {
    const res = await app.request("/api/contacts/999");
    expect(res.status).toBe(404);
  });

  it("GET /api/contacts?project_id= lists contacts by project", async () => {
    const project = await createProject();
    const { body: contact } = await createContact();

    // Assign to project
    await app.request(`/api/contacts/${contact.id}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: project.id, stage: "Researched" }),
    });

    const res = await app.request(
      `/api/contacts?project_id=${project.id}`
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].first_name).toBe("Alice");
    expect(body[0].current_stage).toBe("Researched");
  });

  it("GET /api/contacts?project_id=&stage= filters by stage", async () => {
    const project = await createProject();
    const { body: c1 } = await createContact();
    const { body: c2 } = await createContact({
      first_name: "Bob",
      email: "bob@example.com",
    });

    await app.request(`/api/contacts/${c1.id}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: project.id, stage: "Researched" }),
    });
    await app.request(`/api/contacts/${c2.id}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: project.id, stage: "Sent" }),
    });

    const res = await app.request(
      `/api/contacts?project_id=${project.id}&stage=Sent`
    );
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].first_name).toBe("Bob");
  });

  it("POST /api/contacts/import imports CSV rows", async () => {
    const res = await app.request("/api/contacts/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: [
          { first_name: "Eve", last_name: "Jones", email: "eve@example.com" },
          { first_name: "Dan", last_name: "Lee", email: "dan@example.com" },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].source).toBe("csv");
  });

  it("POST /api/contacts/import with project_id assigns to project", async () => {
    const project = await createProject();
    const res = await app.request("/api/contacts/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: [
          { first_name: "Eve", last_name: "Jones", email: "eve@example.com" },
        ],
        project_id: project.id,
        stage: "Researched",
      }),
    });
    expect(res.status).toBe(201);
    const imported = await res.json();

    // Verify they are assigned
    const listRes = await app.request(
      `/api/contacts?project_id=${project.id}`
    );
    const list = await listRes.json();
    expect(list).toHaveLength(1);
    expect(list[0].current_stage).toBe("Researched");
  });

  it("POST /api/contacts/:id/assign assigns contact to project", async () => {
    const project = await createProject();
    const { body: contact } = await createContact();

    const res = await app.request(`/api/contacts/${contact.id}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: project.id, stage: "Researched" }),
    });
    expect(res.status).toBe(200);
  });

  it("PATCH /api/contacts/:id/stage moves stage", async () => {
    const project = await createProject();
    const { body: contact } = await createContact();

    await app.request(`/api/contacts/${contact.id}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: project.id, stage: "Researched" }),
    });

    const res = await app.request(`/api/contacts/${contact.id}/stage`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: project.id, stage: "Sent" }),
    });
    expect(res.status).toBe(200);

    // Verify stage moved
    const listRes = await app.request(
      `/api/contacts?project_id=${project.id}`
    );
    const list = await listRes.json();
    expect(list[0].current_stage).toBe("Sent");
  });
});
