import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../db/schema.js";
import { createApp } from "../index.js";

describe("account routes", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    app = createApp(db);
  });

  afterEach(() => db.close());

  async function createAccount() {
    const res = await app.request("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "gmail",
        email_address: "me@example.com",
        display_name: "Me",
        credentials: { token: "abc" },
      }),
    });
    return { res, body: await res.json() };
  }

  it("DELETE /api/accounts/:id removes an account", async () => {
    const { body: account } = await createAccount();

    // ensure it exists
    let listRes = await app.request("/api/accounts");
    let list = await listRes.json();
    expect(list).toHaveLength(1);

    const delRes = await app.request(`/api/accounts/${account.id}`, {
      method: "DELETE",
    });
    expect(delRes.status).toBe(200);
    const delBody = await delRes.json();
    expect(delBody).toEqual({ ok: true });

    listRes = await app.request("/api/accounts");
    list = await listRes.json();
    expect(list).toHaveLength(0);
  });

  it("DELETE /api/accounts/:id returns 404 when missing", async () => {
    const res = await app.request("/api/accounts/999", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});
