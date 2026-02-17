import { describe, it, expect } from "vitest";
import { buildChatSystemPrompt } from "../chat-prompt.js";

describe("buildChatSystemPrompt", () => {
  it("generates base prompt with no context", () => {
    const prompt = buildChatSystemPrompt({});
    expect(prompt).toContain("You are a CRM assistant for Kanbun");
    expect(prompt).toContain("No project is currently selected");
    expect(prompt).not.toContain("Selected contact");
  });

  it("includes project context when provided", () => {
    const prompt = buildChatSystemPrompt({
      project: {
        name: "Series A",
        description: "Fundraising outreach",
        stages: [
          { name: "Contacted", count: 5 },
          { name: "Replied", count: 2 },
        ],
      },
    });
    expect(prompt).toContain("Current project: Series A");
    expect(prompt).toContain("Project description: Fundraising outreach");
    expect(prompt).toContain("Contacted: 5 contacts");
    expect(prompt).toContain("Replied: 2 contacts");
    expect(prompt).not.toContain("No project is currently selected");
  });

  it("includes contact context when provided", () => {
    const prompt = buildChatSystemPrompt({
      contact: {
        name: "Alice Smith",
        email: "alice@example.com",
        company: "Acme Inc",
        title: "CTO",
        notes: "Met at conference",
      },
    });
    expect(prompt).toContain("Selected contact: Alice Smith");
    expect(prompt).toContain("Email: alice@example.com");
    expect(prompt).toContain("Company: Acme Inc");
    expect(prompt).toContain("Title: CTO");
    expect(prompt).toContain("Notes: Met at conference");
  });

  it("handles singular contact count", () => {
    const prompt = buildChatSystemPrompt({
      project: {
        name: "Test",
        description: null,
        stages: [{ name: "New", count: 1 }],
      },
    });
    expect(prompt).toContain("New: 1 contact");
    expect(prompt).not.toContain("1 contacts");
  });

  it("omits null contact fields", () => {
    const prompt = buildChatSystemPrompt({
      contact: {
        name: "Bob",
        email: "bob@test.com",
        company: null,
        title: null,
        notes: null,
      },
    });
    expect(prompt).toContain("Selected contact: Bob");
    expect(prompt).toContain("Email: bob@test.com");
    expect(prompt).not.toContain("Company:");
    expect(prompt).not.toContain("Title:");
    expect(prompt).not.toContain("Notes:");
  });

  it("omits project description when null", () => {
    const prompt = buildChatSystemPrompt({
      project: {
        name: "Test",
        description: null,
        stages: [],
      },
    });
    expect(prompt).toContain("Current project: Test");
    expect(prompt).not.toContain("Project description:");
  });

  it("includes both project and contact when provided", () => {
    const prompt = buildChatSystemPrompt({
      project: {
        name: "Outreach",
        description: "Q1 campaign",
        stages: [{ name: "Sent", count: 3 }],
      },
      contact: {
        name: "Jane Doe",
        email: "jane@co.com",
        company: "StartupCo",
        title: "CEO",
        notes: null,
      },
    });
    expect(prompt).toContain("Current project: Outreach");
    expect(prompt).toContain("Selected contact: Jane Doe");
  });
});
