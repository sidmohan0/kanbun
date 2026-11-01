import { expect, it } from "vitest";
import { uuidv7 } from "@kanbun/model";
import type { BootstrapResponse } from "@kanbun/sync";
import { startEmailRuntime, nativeAgent, emailLink, linkToken } from "./email-runtime";

async function runtime() {
  return startEmailRuntime({
    sheetsConfig: {
      GOOGLE_SHEETS_CLIENT_ID: "fixture-google-client",
      GOOGLE_SHEETS_CLIENT_SECRET: "fixture-google-secret",
      GOOGLE_SHEETS_TOKEN_KEY: Buffer.alloc(32, 7).toString("base64"),
    },
  });
}
type Runtime = Awaited<ReturnType<typeof runtime>>;
type Agent = ReturnType<typeof nativeAgent>;
async function login(r: Runtime, a: Agent) {
  await a.requestLink(r.ownerEmail);
  await a.consume(linkToken(emailLink((await r.capturedEmails()).at(-1)!)));
  expect((await a.fetch("/api/context")).status).toBe(200);
}
async function connect(a: Agent) {
  const result = await a.json("/api/integrations/google-sheets/connect", {});
  expect(result.status).toBe(200);
  const { url } = (await result.json()) as { url: string };
  const parsed = new URL(url);
  expect(parsed.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive.file");
  expect(parsed.searchParams.get("access_type")).toBe("offline");
  expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
  return parsed.searchParams.get("state")!;
}
const callback = (a: Agent, state: string) =>
  a.fetch(`/api/integrations/google-sheets/callback?code=fixture-code&state=${state}`, { redirect: "manual" });

it("binds Google authorization to the native owner session, consumes state once, and keeps tokens private", async () => {
  const r = await runtime();
  try {
    const a = nativeAgent(r),
      other = nativeAgent(r),
      anon = nativeAgent(r);
    expect((await anon.fetch("/api/integrations/google-sheets")).status).toBe(401);
    await login(r, a);
    await login(r, other);
    const state = await connect(a);
    other.cookies.set("__Host-kanbun-google-sheets", a.cookies.get("__Host-kanbun-google-sheets")!);
    expect((await callback(other, state)).status).toBe(403);
    expect(await r.googleRequests()).toHaveLength(0);
    expect((await callback(a, state)).status).toBe(303);
    expect((await callback(a, state)).status).toBe(403);
    const status = await (await a.fetch("/api/integrations/google-sheets")).text();
    expect(status).toContain("fixture-spreadsheet");
    expect(status).not.toContain("fixture-google-refresh");
    expect(status).not.toContain("fixture-google-access");
    expect(JSON.stringify(await r.googleStoredConnection())).not.toContain("fixture-google-refresh");
    const bootstrap = await (await a.fetch("/sync/bootstrap?clientId=sheets-secrecy")).text();
    expect(bootstrap).not.toContain("fixture-google");
    const invitation = (await (await a.json("/api/invitations", { email: "sheets-member@datafog.ai" })).json()) as {
      token: string;
    };
    const member = nativeAgent(r);
    await member.requestLink("sheets-member@datafog.ai");
    await member.consume(linkToken(emailLink((await r.capturedEmails()).at(-1)!)));
    expect((await member.json("/api/invitations/accept", { token: invitation.token })).status).toBe(200);
    expect((await member.fetch("/api/integrations/google-sheets")).status).toBe(403);
    expect((await member.json("/api/integrations/google-sheets/connect", {})).status).toBe(403);
    expect((await member.json("/api/integrations/google-sheets/sync", {})).status).toBe(403);
    const lost = await connect(a);
    await a.logout();
    expect((await callback(a, lost)).status).toBe(401);
  } finally {
    await r.close();
  }
}, 30000);

it("refreshes public data manually and hourly, clears private rows, uses literal strings, and preserves the file on reconnect", async () => {
  const r = await runtime();
  try {
    const a = nativeAgent(r);
    await login(r, a);
    const bootstrap = async () =>
      (await (await a.fetch("/sync/bootstrap?clientId=sheets-export")).json()) as BootstrapResponse;
    const teamId = String((await bootstrap()).rows.team![0]!.id);
    const issueId = uuidv7();
    let id = 0;
    async function push(name: string, args: unknown) {
      expect(
        await (
          await a.json("/sync/push", {
            clientId: "sheets-writer",
            mutations: [{ id: ++id, name, args, ts: new Date().toISOString() }],
          })
        ).json(),
      ).toMatchObject({ rejected: [] });
    }
    await push("issueCreate", { id: issueId, teamId, title: "=IMPORTXML(private)", subscriptionId: uuidv7() });
    expect((await callback(a, await connect(a))).status).toBe(303);
    const writes = async () => (await r.googleRequests()).filter((q) => q.url.endsWith(":batchUpdate"));
    let requests = await writes();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.at(-1)!.body).toContain('"stringValue":"=IMPORTXML(private)"');
    expect(requests.at(-1)!.body).not.toContain("formulaValue");
    const before = requests.length;
    await r.googleAlarm();
    expect((await writes()).length).toBe(before);
    await push("issueUpdate", { id: issueId, patch: { title: "Public changed title" } });
    await r.googleAlarm();
    expect((await writes()).at(-1)!.body).toContain("Public changed title");
    const privateId = uuidv7();
    await push("teamCreate", {
      id: privateId,
      name: "Private team",
      key: "PRIV",
      visibility: "private",
      membershipId: uuidv7(),
      stateIds: { backlog: uuidv7(), todo: uuidv7(), inProgress: uuidv7(), done: uuidv7(), canceled: uuidv7() },
    });
    await push("issueUpdate", { id: issueId, patch: { teamId: privateId, title: "Secret issue title" } });
    expect((await a.json("/api/integrations/google-sheets/sync", {})).status).toBe(200);
    requests = await writes();
    expect(requests.at(-1)!.body).not.toContain("Secret issue title");
    expect(requests.at(-1)!.body).not.toContain("Public changed title");
    const batch = JSON.parse(requests.at(-1)!.body) as {
      requests: { updateCells?: { range: unknown; fields: string } }[];
    };
    expect(batch.requests.find((q) => q.updateCells)?.updateCells).toMatchObject({
      range: { sheetId: 0 },
      fields: "userEnteredValue",
    });
    expect((await callback(a, await connect(a))).status).toBe(303);
    expect((await r.googleRequests()).filter((q) => q.url.endsWith("/v4/spreadsheets"))).toHaveLength(1);
    await r.googleFixture(true);
    const failed = await a.json("/api/integrations/google-sheets/sync", {});
    expect(await failed.text()).not.toContain("fixture-private-provider-detail");
    expect(await (await a.fetch("/api/integrations/google-sheets")).json()).toMatchObject({
      error: expect.any(String),
    });
    await r.googleFixture();
    expect((await a.json("/api/integrations/google-sheets/sync", {})).status).toBe(200);
    expect(await (await a.fetch("/api/integrations/google-sheets")).json()).toMatchObject({ error: null });
    await a.json("/api/integrations/google-sheets/disconnect", {});
    expect(await r.googleStoredConnection()).toBeNull();
    const count = (await r.googleRequests()).length;
    await r.googleAlarm();
    expect((await r.googleRequests()).length).toBe(count);
    expect((await r.googleRequests()).every((q) => !q.url.includes("revoke"))).toBe(true);
  } finally {
    await r.close();
  }
}, 45000);

it("serializes a delayed refresh before disconnect so authorization cannot revive", async () => {
  const r = await runtime();
  try {
    const a = nativeAgent(r);
    await login(r, a);
    expect((await callback(a, await connect(a))).status).toBe(303);
    await r.googleFixture(false, true);
    const count = (await r.googleRequests()).length;
    const syncing = a.json("/api/integrations/google-sheets/sync", {});
    let disconnecting: Promise<Response> | undefined;
    try {
      await expect.poll(async () => (await r.googleRequests()).length).toBeGreaterThan(count + 1);
      disconnecting = a.json("/api/integrations/google-sheets/disconnect", {});
    } finally {
      await r.releaseGoogle();
    }
    expect((await syncing).status).toBe(200);
    expect((await disconnecting!).status).toBe(200);
    expect(await r.googleStoredConnection()).toBeNull();
  } finally {
    await r.close();
  }
}, 30000);
