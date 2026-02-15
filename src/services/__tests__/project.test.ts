import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../db/schema.js";
import { ProjectService } from "../project.js";

describe("ProjectService", () => {
  let db: Database.Database;
  let svc: ProjectService;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    svc = new ProjectService(db);
  });

  afterEach(() => db.close());

  it("creates and retrieves a project", () => {
    const p = svc.create("Series A Raise");
    expect(p.name).toBe("Series A Raise");
    expect(p.id).toBe(1);

    const found = svc.getById(1);
    expect(found?.name).toBe("Series A Raise");
  });

  it("lists all projects", () => {
    svc.create("Project 1");
    svc.create("Project 2");
    expect(svc.list()).toHaveLength(2);
  });

  it("sets pipeline stages", () => {
    svc.create("Test");
    svc.setStages(1, ["Researched", "Drafted", "Sent"]);
    const p = svc.getById(1);
    expect(p?.pipeline_stages).toEqual(["Researched", "Drafted", "Sent"]);
  });

  it("sets follow-up cadence", () => {
    svc.create("Test");
    svc.setCadence(1, [3, 7, 14]);
    const p = svc.getById(1);
    expect(p?.follow_up_cadence).toEqual([3, 7, 14]);
  });

  it("sets default send account", () => {
    svc.create("Test");
    db.prepare(
      "INSERT INTO email_accounts (provider, email_address, display_name, credentials) VALUES (?, ?, ?, ?)"
    ).run("gmail", "me@gmail.com", "Me", "{}");
    svc.setAccount(1, 1);
    const p = svc.getById(1);
    expect(p?.default_send_account_id).toBe(1);
  });
});
