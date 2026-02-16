import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../db/schema.js";
import { ContactService } from "../contact.js";
import { GroupService } from "../group.js";

describe("GroupService", () => {
  let db: Database.Database;
  let contactSvc: ContactService;
  let groupSvc: GroupService;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    contactSvc = new ContactService(db);
    groupSvc = new GroupService(db);
  });

  afterEach(() => db.close());

  it("creates groups", () => {
    const g = groupSvc.create({ name: "Customers", color: "#ff0000" });
    const list = groupSvc.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(g.id);
    expect(list[0].name).toBe("Customers");
  });

  it("assigns contact to group", () => {
    const contact = contactSvc.add({
      first_name: "Alex",
      last_name: "Ng",
      email: "alex@example.com",
      source: "manual",
    });
    const group = groupSvc.create({ name: "ICP", color: "#00ff00" });

    groupSvc.assign(group.id, contact.id);
    const members = groupSvc.listMembers(group.id);
    expect(members).toHaveLength(1);
    expect(members[0].id).toBe(contact.id);
  });
});
