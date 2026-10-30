import { expect, it } from "vitest";
import { mutators } from "@kanbun/mutators";
import { SyncServer } from "@kanbun/sync/server";
import { openWorkspaceDb } from "@kanbun/sync/server/node";
import { preparePreview, projectMembershipRemoval } from "../src/preview";

const id = (n: number) => `019a0000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;

it("does not project an old removal over a new admission or resurrect an inactive same-admission member", () => {
  const { db, driver } = openWorkspaceDb();
  const server = new SyncServer({ driver, mutators });
  try {
    server.system("workspaceInit", {
      organization: { id: id(1), name: "Kanbun", urlKey: "kanbun" },
      owner: { id: "owner", name: "Owner", email: "owner@example.com" },
    });
    server.system("memberSync", {
      id: "member",
      name: "Member",
      email: "member@example.com",
      directoryAdmissionId: id(2),
    });
    const owner = { id: "owner", type: "user" as const };
    expect(
      server.push(owner, {
        clientId: "old-private-grant",
        mutations: [
          {
            id: 1,
            name: "teamCreate",
            ts: new Date().toISOString(),
            args: {
              id: id(10),
              name: "Private",
              key: "PRIV",
              visibility: "private",
              membershipId: id(16),
              stateIds: { backlog: id(11), todo: id(12), inProgress: id(13), done: id(14), canceled: id(15) },
            },
          },
          {
            id: 2,
            name: "teamMembershipCreate",
            ts: new Date().toISOString(),
            args: { id: id(17), teamId: id(10), userId: "member" },
          },
        ],
      }),
    ).toMatchObject({ ok: true, rejected: [] });
    server.system("memberSync", {
      id: "member",
      name: "Member",
      email: "member@example.com",
      active: true,
      directoryAdmissionId: id(3),
    });
    expect(server.store.get("teamMembership", id(17))).toBeUndefined();
    expect(
      server.push(owner, {
        clientId: "fresh-private-grant",
        mutations: [
          {
            id: 1,
            name: "teamMembershipCreate",
            ts: new Date().toISOString(),
            args: { id: id(18), teamId: id(10), userId: "member" },
          },
        ],
      }),
    ).toMatchObject({ ok: true, rejected: [] });
    projectMembershipRemoval(server, { userId: "member", admissionId: id(2), removed: true });
    expect(server.store.get("user", "member")).toMatchObject({ active: true, directoryAdmissionId: id(3) });
    expect(server.store.get("teamMembership", id(18))).toMatchObject({ userId: "member", archivedAt: null });
    projectMembershipRemoval(server, { userId: "member", admissionId: id(3), removed: true });
    const context = {
      mode: "hosted" as const,
      role: "member" as const,
      admissionId: id(3),
      workspaceId: id(1),
      workspaceName: "Kanbun",
      actor: { id: "member", type: "user" as const },
      name: "Member",
      email: "member@example.com",
    };
    expect(() => preparePreview(server, driver, context, id(3))).toThrow(/Active workspace membership/);
    expect(server.store.get("user", "member")?.active).toBe(false);
    preparePreview(server, driver, { ...context, admissionId: id(4) }, id(4));
    expect(server.store.get("user", "member")).toMatchObject({ active: true, directoryAdmissionId: id(4) });
  } finally {
    db.close();
  }
});
