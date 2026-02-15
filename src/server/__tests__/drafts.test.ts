import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../db/schema.js";
import { createApp } from "../index.js";

describe("draft routes", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    app = createApp(db);
  });

  afterEach(() => db.close());

  /** Helper: seed a project, contact, and email account so drafts have valid FKs */
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

    const accountRes = await app.request("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "gmail",
        email_address: "me@gmail.com",
        display_name: "Me",
        credentials: { token: "abc" },
      }),
    });
    const account = await accountRes.json();

    return { project, contact, account };
  }

  async function createDraft(deps: Awaited<ReturnType<typeof seedDeps>>, overrides: Record<string, unknown> = {}) {
    const res = await app.request("/api/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: deps.project.id,
        contact_id: deps.contact.id,
        send_account_id: deps.account.id,
        subject: "Hello",
        body: "Hi there",
        draft_type: "template",
        ...overrides,
      }),
    });
    return { res, body: await res.json() };
  }

  it("POST /api/drafts creates a draft", async () => {
    const deps = await seedDeps();
    const { res, body } = await createDraft(deps);
    expect(res.status).toBe(201);
    expect(body.subject).toBe("Hello");
    expect(body.status).toBe("pending_review");
    expect(body.id).toBeDefined();
  });

  it("GET /api/drafts/:id returns draft with contact info", async () => {
    const deps = await seedDeps();
    const { body: draft } = await createDraft(deps);

    const res = await app.request(`/api/drafts/${draft.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subject).toBe("Hello");
    expect(body.first_name).toBe("Alice");
    expect(body.email).toBe("alice@example.com");
  });

  it("GET /api/drafts/:id returns 404 for missing", async () => {
    const res = await app.request("/api/drafts/999");
    expect(res.status).toBe(404);
  });

  it("GET /api/drafts?status= lists drafts by status", async () => {
    const deps = await seedDeps();
    await createDraft(deps);
    await createDraft(deps, { subject: "Follow-up" });

    const res = await app.request("/api/drafts?status=pending_review");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
  });

  it("GET /api/drafts?project_id= lists drafts by project", async () => {
    const deps = await seedDeps();
    await createDraft(deps);

    const res = await app.request(
      `/api/drafts?project_id=${deps.project.id}`
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
  });

  it("PATCH /api/drafts/:id updates content", async () => {
    const deps = await seedDeps();
    const { body: draft } = await createDraft(deps);

    const res = await app.request(`/api/drafts/${draft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: "Updated", body: "New body" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subject).toBe("Updated");
    expect(body.body).toBe("New body");
  });

  it("PATCH /api/drafts/:id/status updates status", async () => {
    const deps = await seedDeps();
    const { body: draft } = await createDraft(deps);

    const res = await app.request(`/api/drafts/${draft.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("approved");
  });
});
