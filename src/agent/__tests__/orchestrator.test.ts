import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../db/schema.js";
import { buildDraftPrompt } from "../prompts.js";
import { Orchestrator } from "../orchestrator.js";
import { DraftService } from "../../services/draft.js";

describe("buildDraftPrompt", () => {
  it("builds a prompt for initial outreach", () => {
    const prompt = buildDraftPrompt({
      projectName: "Series A",
      projectDescription: "Raising $10M Series A",
      contactName: "Jane Doe",
      contactTitle: "Partner",
      contactCompany: "VC Fund",
      contactNotes: "Met at conference",
      priorThread: null,
      context: "warm intro via Mike",
      sequenceStep: 1,
    });
    expect(prompt).toContain("Series A");
    expect(prompt).toContain("Jane Doe");
    expect(prompt).toContain("Partner");
    expect(prompt).toContain("VC Fund");
    expect(prompt).toContain("warm intro via Mike");
    expect(prompt).toContain("initial outreach");
    expect(prompt).toContain("Return JSON");
  });

  it("builds a follow-up prompt", () => {
    const prompt = buildDraftPrompt({
      projectName: "Series A",
      projectDescription: "",
      contactName: "Jane Doe",
      contactTitle: null,
      contactCompany: null,
      contactNotes: null,
      priorThread: "Previous: Hi Jane...",
      context: null,
      sequenceStep: 3,
    });
    expect(prompt).toContain("follow-up #2");
    expect(prompt).toContain("Previous: Hi Jane...");
    expect(prompt).not.toContain("initial outreach");
  });

  it("excludes empty optional fields", () => {
    const prompt = buildDraftPrompt({
      projectName: "Test",
      projectDescription: "",
      contactName: "Bob Smith",
      contactTitle: null,
      contactCompany: null,
      contactNotes: null,
      priorThread: null,
      context: null,
      sequenceStep: 1,
    });
    expect(prompt).not.toContain("Title:");
    expect(prompt).not.toContain("Company:");
    expect(prompt).not.toContain("Notes:");
    expect(prompt).not.toContain("Additional context:");
    expect(prompt).not.toContain("Previous email thread:");
  });
});

describe("Orchestrator", () => {
  let db: Database.Database;

  function seedDb() {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO email_accounts (provider, email_address, display_name, credentials)
       VALUES (?, ?, ?, ?)`
    ).run("gmail", "me@gmail.com", "Me", "{}");
    db.prepare(
      `INSERT INTO projects (name, description, default_send_account_id, pipeline_stages, follow_up_cadence, created_at, updated_at)
       VALUES (?, ?, ?, '[]', '[]', ?, ?)`
    ).run("Series A", "Raising $10M", 1, now, now);
    db.prepare(
      `INSERT INTO contacts (first_name, last_name, email, company, title, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'manual', ?, ?)`
    ).run("Jane", "Doe", "jane@vc.com", "VC Fund", "Partner", now, now);
    db.prepare(
      `INSERT INTO project_contacts (project_id, contact_id, current_stage, assigned_at, stage_updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(1, 1, "outreach", now, now);
  }

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    seedDb();
  });

  afterEach(() => db.close());

  it("generates drafts for project contacts", async () => {
    const orchestrator = new Orchestrator(db, "test-key");

    // Mock the Anthropic SDK messages.create method
    const mockCreate = vi.fn().mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            subject: "Quick intro - Series A",
            body: "Hi Jane,\n\nI hope this finds you well.\n\nBest,\nMe",
          }),
        },
      ],
    });
    (orchestrator as any).anthropic = { messages: { create: mockCreate } };

    const count = await orchestrator.generateDrafts({ projectId: 1 });
    expect(count).toBe(1);

    // Verify the draft was created in the DB
    const draftService = new DraftService(db);
    const drafts = draftService.listByProject(1);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].subject).toBe("Quick intro - Series A");
    expect(drafts[0].body).toContain("Hi Jane");
    expect(drafts[0].draft_type).toBe("agent");
    expect(drafts[0].status).toBe("pending_review");

    // Verify the prompt was built correctly
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain("Series A");
    expect(callArgs.messages[0].content).toContain("Jane Doe");
  });

  it("skips contacts with pending drafts", async () => {
    // Create an existing pending draft for the contact
    const draftService = new DraftService(db);
    draftService.create({
      project_id: 1,
      contact_id: 1,
      send_account_id: 1,
      subject: "Existing",
      body: "Already pending",
      draft_type: "agent",
    });

    const orchestrator = new Orchestrator(db, "test-key");
    const mockCreate = vi.fn();
    (orchestrator as any).anthropic = { messages: { create: mockCreate } };

    const count = await orchestrator.generateDrafts({ projectId: 1 });
    expect(count).toBe(0);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("throws if project not found", async () => {
    const orchestrator = new Orchestrator(db, "test-key");
    await expect(
      orchestrator.generateDrafts({ projectId: 999 })
    ).rejects.toThrow("Project 999 not found");
  });

  it("throws if project has no send account", async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO projects (name, pipeline_stages, follow_up_cadence, created_at, updated_at)
       VALUES (?, '[]', '[]', ?, ?)`
    ).run("No Account", now, now);

    const orchestrator = new Orchestrator(db, "test-key");
    await expect(
      orchestrator.generateDrafts({ projectId: 2 })
    ).rejects.toThrow("Project has no default send account");
  });

  it("filters by contactIds when provided", async () => {
    const now = new Date().toISOString();
    // Add a second contact
    db.prepare(
      `INSERT INTO contacts (first_name, last_name, email, source, created_at, updated_at)
       VALUES (?, ?, ?, 'manual', ?, ?)`
    ).run("Bob", "Smith", "bob@co.com", now, now);
    db.prepare(
      `INSERT INTO project_contacts (project_id, contact_id, current_stage, assigned_at, stage_updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(1, 2, "outreach", now, now);

    const orchestrator = new Orchestrator(db, "test-key");
    const mockCreate = vi.fn().mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({ subject: "Hi", body: "Hello" }),
        },
      ],
    });
    (orchestrator as any).anthropic = { messages: { create: mockCreate } };

    // Only generate for contact 2
    const count = await orchestrator.generateDrafts({
      projectId: 1,
      contactIds: [2],
    });
    expect(count).toBe(1);
    expect(mockCreate).toHaveBeenCalledTimes(1);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain("Bob Smith");
  });
});
