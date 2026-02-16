import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../db/schema.js";
import { createApp } from "../index.js";

describe("POST /api/drafts/generate", () => {
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

    // Set a default send account
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

    await app.request(`/api/projects/${project.id}/account`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_id: account.id }),
    });

    // Add contacts and assign to project
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

    await app.request(`/api/contacts/${contact.id}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: project.id,
        stage: "Lead",
      }),
    });

    // Create a template
    const tmplRes = await app.request("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: project.id,
        name: "Intro",
        subject: "Hi {{first_name}}",
        body: "Hello {{first_name}} at {{company}}!",
        variables: ["first_name", "company"],
      }),
    });
    const template = await tmplRes.json();

    return { project, contact, account, template };
  }

  it("generates template-based drafts", async () => {
    const deps = await seedDeps();
    const res = await app.request("/api/drafts/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: deps.project.id,
        mode: "template",
        template_id: deps.template.id,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);

    // Verify the draft was created with rendered template
    const draftsRes = await app.request(`/api/drafts?project_id=${deps.project.id}`);
    const drafts = await draftsRes.json();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].subject).toBe("Hi Alice");
    expect(drafts[0].draft_type).toBe("template");
  });

  it("skips contacts with pending drafts", async () => {
    const deps = await seedDeps();
    // Generate once
    await app.request("/api/drafts/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: deps.project.id,
        mode: "template",
        template_id: deps.template.id,
      }),
    });

    // Generate again — should skip since draft is pending_review
    const res = await app.request("/api/drafts/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: deps.project.id,
        mode: "template",
        template_id: deps.template.id,
      }),
    });
    const body = await res.json();
    expect(body.count).toBe(0);
  });

  it("returns 400 for template mode without template_id", async () => {
    const deps = await seedDeps();
    const res = await app.request("/api/drafts/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: deps.project.id,
        mode: "template",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid mode", async () => {
    const deps = await seedDeps();
    const res = await app.request("/api/drafts/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: deps.project.id,
        mode: "invalid",
      }),
    });
    expect(res.status).toBe(400);
  });
});
