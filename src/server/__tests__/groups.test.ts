import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../db/schema.js";
import { createApp } from "../index.js";

describe("group routes", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    app = createApp(db);
  });

  afterEach(() => db.close());

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
    return res.json();
  }

  it("creates and lists groups", async () => {
    const createRes = await app.request("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Research" }),
    });
    expect(createRes.status).toBe(201);

    const listRes = await app.request("/api/groups");
    expect(listRes.status).toBe(200);
    const body = await listRes.json();
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("Research");
  });

  it("assigns and unassigns contacts from a group", async () => {
    const contact: any = await createContact();

    const createRes = await app.request("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "ICP" }),
    });
    const group = await createRes.json();

    const assignRes = await app.request(`/api/groups/${group.id}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact_id: contact.id }),
    });
    expect(assignRes.status).toBe(200);

    const contactsRes = await app.request(`/api/groups/${group.id}/contacts`);
    expect((await contactsRes.json())).toHaveLength(1);

    const removeRes = await app.request(
      `/api/groups/${group.id}/contacts/${contact.id}`,
      { method: "DELETE" }
    );
    expect(removeRes.status).toBe(200);

    const contactsAfter = await app.request(`/api/groups/${group.id}/contacts`);
    expect((await contactsAfter.json())).toHaveLength(0);
  });
});
