import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../db/schema.js";
import { EmailAccountService } from "../email-account.js";

describe("EmailAccountService", () => {
  let db: Database.Database;
  let svc: EmailAccountService;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    svc = new EmailAccountService(db);
  });

  afterEach(() => db.close());

  it("adds an account", () => {
    const a = svc.add("gmail", "me@gmail.com", "Me", { token: "abc" });
    expect(a.id).toBe(1);
    expect(a.provider).toBe("gmail");
  });

  it("lists accounts", () => {
    svc.add("gmail", "me@gmail.com", "Me", {});
    svc.add("outlook", "me@outlook.com", "Me", {});
    expect(svc.list()).toHaveLength(2);
  });

  it("retrieves credentials", () => {
    svc.add("gmail", "me@gmail.com", "Me", { token: "secret" });
    const creds = svc.getCredentials(1);
    expect(creds).toEqual({ token: "secret" });
  });
});
