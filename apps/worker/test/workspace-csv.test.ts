import { expect, it } from "vitest";
import { MemoryStore, type BootstrapResponse } from "@kanbun/sync";
import { uuidv7 } from "@kanbun/model";
import { csvText, workspaceCsv } from "../src/workspace-csv";
import { startEmailRuntime, nativeAgent, emailLink, linkToken } from "./email-runtime";
import { startWorkspaceRuntime } from "./runtime";

it("writes UTF-8 RFC 4180 records with literal quotes, delimiters, newlines and numeric cells", () => {
  expect(
    csvText([
      ["Title", "Estimate"],
      ['報告, "quoted"\r\nsecond line', -2.5],
      ["", 0],
    ]),
  ).toBe('\uFEFF"Title","Estimate"\r\n"報告, ""quoted""\r\nsecond line",-2.5\r\n"",0\r\n');
});

it("prefixes formula-like strings without changing numeric values", () => {
  for (const value of [
    "=1+2",
    "+SUM(A1)",
    "-1+2",
    "@SUM(A1)",
    "\t=1",
    "\r=1",
    "\n=1",
    "  =1",
    "\uFEFF@SUM(A1)",
    "＝1",
    "＋1",
    "－1",
    "＠SUM(A1)",
  ])
    expect(csvText([[value]])).toBe('\uFEFF"\t' + value + '"\r\n');
  expect(csvText([[-1, 1, "plain text", "O'Reilly"]])).toBe('\uFEFF-1,1,"plain text","O\'Reilly"\r\n');
  expect(() => csvText([[NaN]])).toThrow("must be finite");
});

it("uses the shared public-project filter and omits private relationship names", async () => {
  const store = new MemoryStore();
  store.table("team").set("public", { id: "public", name: "Public team", visibility: "public" });
  store.table("team").set("private", { id: "private", name: "Private team", visibility: "private" });
  const project = { createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", priority: 1 };
  store.table("project").set("public", { ...project, id: "public", name: "Shared project" });
  store.table("project").set("private", { ...project, id: "private", name: "Private project" });
  store.table("projectTeam").set("shared-public", { projectId: "public", teamId: "public" });
  store.table("projectTeam").set("shared-private", { projectId: "public", teamId: "private" });
  store.table("projectTeam").set("private", { projectId: "private", teamId: "private" });
  const text = await workspaceCsv(store, "projects").text();
  expect(text).toContain("Shared project");
  expect(text).toContain("Public team");
  expect(text).not.toContain("Private");
});

it("exports only public data for the current owner without Google credentials or provider access", async () => {
  const runtime = await startEmailRuntime({ sheetsConfig: {} });
  try {
    const owner = nativeAgent(runtime),
      anonymous = nativeAgent(runtime),
      member = nativeAgent(runtime);
    expect((await anonymous.fetch("/api/exports.csv?type=issues")).status).toBe(401);
    await owner.requestLink(runtime.ownerEmail);
    await owner.consume(linkToken(emailLink((await runtime.capturedEmails()).at(-1)!)));
    const bootstrap = (await (await owner.fetch("/sync/bootstrap?clientId=csv-owner")).json()) as BootstrapResponse;
    const publicTeamId = bootstrap.rows.team![0]!.id;
    const privateTeamId = uuidv7();
    const mutations = [
      {
        id: 1,
        name: "teamCreate",
        args: {
          id: privateTeamId,
          name: "Private export team",
          key: "PRIVATE",
          visibility: "private",
          membershipId: uuidv7(),
          stateIds: { backlog: uuidv7(), todo: uuidv7(), inProgress: uuidv7(), done: uuidv7(), canceled: uuidv7() },
        },
      },
      {
        id: 2,
        name: "issueCreate",
        args: { id: uuidv7(), teamId: publicTeamId, title: "=Public CSV value", subscriptionId: uuidv7() },
      },
      {
        id: 3,
        name: "issueCreate",
        args: { id: uuidv7(), teamId: privateTeamId, title: "Private CSV value", subscriptionId: uuidv7() },
      },
    ].map((mutation) => ({ ...mutation, ts: new Date().toISOString() }));
    expect(await (await owner.json("/sync/push", { clientId: "csv-writer", mutations })).json()).toMatchObject({
      rejected: [],
    });
    const response = await owner.fetch("/api/exports.csv?type=issues");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toContain('filename="kanbun-issues.csv"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(text).toContain('"\t=Public CSV value"');
    expect(text).not.toContain("Private CSV value");
    expect(text).not.toContain("Private export team");
    const projects = await owner.fetch("/api/exports.csv?type=projects");
    expect(projects.headers.get("content-disposition")).toContain('filename="kanbun-projects.csv"');
    expect(await projects.text()).toContain('"ID","Name","Description"');
    expect((await owner.fetch("/api/exports.csv?type=other")).status).toBe(400);
    expect((await owner.fetch("/api/exports.csv?type=issues&teamId=private")).status).toBe(400);
    const invitation = (await (await owner.json("/api/invitations", { email: "csv-member@datafog.ai" })).json()) as {
      token: string;
    };
    await member.requestLink("csv-member@datafog.ai");
    await member.consume(linkToken(emailLink((await runtime.capturedEmails()).at(-1)!)));
    expect((await member.json("/api/invitations/accept", { token: invitation.token })).status).toBe(200);
    expect((await member.fetch("/api/exports.csv?type=issues")).status).toBe(403);
    expect((await member.fetch("/api/exports.csv?type=projects")).status).toBe(403);
    expect(await runtime.googleRequests()).toEqual([]);
    expect(await runtime.googleStoredConnection()).toBeNull();
    await owner.logout();
    expect((await owner.fetch("/api/exports.csv?type=issues")).status).toBe(401);
  } finally {
    await runtime.close();
  }
}, 30000);

it("supports the local owner while refusing the local member", async () => {
  const runtime = await startWorkspaceRuntime();
  try {
    await runtime.seed();
    const response = await runtime.fetch("/api/exports.csv?type=issues");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"ID","Team","Title"');
    expect(
      (await runtime.fetch("/api/exports.csv?type=issues", { headers: { "X-Kanbun-Local-Actor": "bob" } })).status,
    ).toBe(403);
    expect((await runtime.fetch("/api/exports.csv?type=issues", { method: "POST" })).status).toBe(405);
  } finally {
    await runtime.close();
  }
});
