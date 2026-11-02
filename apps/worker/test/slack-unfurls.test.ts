import { createHmac } from "node:crypto";
import { expect, it } from "vitest";
import { uuidv7 } from "@kanbun/model";
import type { BootstrapResponse } from "@kanbun/sync";
import { startEmailRuntime, nativeAgent, emailLink, linkToken } from "./email-runtime";
import { slackLiteral } from "../src/slack-unfurls";

const config = {
  SLACK_CLIENT_ID: "123.456",
  SLACK_CLIENT_SECRET: "fixture-client-secret",
  SLACK_APP_ID: "A123",
  SLACK_SIGNING_SECRET: "fixture-slack-signing-secret",
  SLACK_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
};
const grant = {
  ok: true,
  access_token: "xoxb-fixture-private-token",
  token_type: "bot",
  app_id: "A123",
  scope: "chat:write,links:read,links:write",
  team: { id: "T123", name: "Example workspace" },
  bot_user_id: "U123",
  is_enterprise_install: false,
};
async function setup() {
  const runtime = await startEmailRuntime({ slackConfig: config });
  const owner = nativeAgent(runtime);
  await owner.requestLink(runtime.ownerEmail);
  await owner.consume(linkToken(emailLink((await runtime.capturedEmails()).at(-1)!)));
  await owner.fetch("/api/context");
  const bootstrap = (await (await owner.fetch("/sync/bootstrap?clientId=slack-reader")).json()) as BootstrapResponse;
  const teamId = String(bootstrap.rows.team![0]!.id);
  const ownerId = String(bootstrap.rows.user![0]!.id);
  let mutation = 0;
  async function push(name: string, args: unknown) {
    expect(
      await (
        await owner.json("/sync/push", {
          clientId: "slack-writer",
          mutations: [{ id: ++mutation, name, args, ts: new Date().toISOString() }],
        })
      ).json(),
    ).toMatchObject({ rejected: [] });
  }
  async function issue(title: string, team = teamId, id = uuidv7()) {
    await push("issueCreate", {
      id,
      teamId: team,
      title,
      assigneeId: ownerId,
      description: "Literal <!here> & <@U123> description",
      subscriptionId: uuidv7(),
    });
    return id;
  }
  const url = (id: string) => `${runtime.appOrigin}/#issues/${id}`;
  async function fixture(body: unknown = { ok: true }, gate?: string, tokenStatus: unknown = { ok: true }) {
    await runtime.setGithubResponses([
      { host: "slack.com", method: "POST", path: "/api/oauth.v2.access", body: grant },
      { host: "slack.com", method: "POST", path: "/api/auth.revoke", body: { ok: true } },
      { host: "slack.com", method: "POST", path: "/api/auth.test", body: tokenStatus },
      { host: "slack.com", method: "POST", path: "/api/chat.unfurl", body, ...(gate ? { gate } : {}) },
    ]);
  }
  async function connect() {
    const start = await owner.json("/api/integrations/slack/connect", {});
    const location = new URL(((await start.json()) as { url: string }).url);
    expect(location.searchParams.get("scope")).toBe("chat:write,links:read,links:write");
    expect(
      (
        await owner.fetch("/api/integrations/slack/callback?code=fixture&state=" + location.searchParams.get("state"), {
          redirect: "manual",
        })
      ).status,
    ).toBe(303);
  }
  async function event(
    id: string,
    urls: string[],
    extra: Record<string, unknown> = {},
    wrapper: Record<string, unknown> = {},
  ) {
    const raw = JSON.stringify({
      type: "event_callback",
      api_app_id: "A123",
      team_id: "T123",
      event_id: id,
      event: {
        type: "link_shared",
        channel: "C123",
        message_ts: "123456789.9875",
        links: urls.map((url) => ({ url })),
        ...extra,
      },
      ...wrapper,
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    return fetch(runtime.origin + "/api/integrations/slack/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature":
          "v0=" + createHmac("sha256", config.SLACK_SIGNING_SECRET).update(`v0:${timestamp}:${raw}`).digest("hex"),
      },
      body: raw,
    });
  }
  const calls = async () => (await runtime.githubRequests()).filter((r) => r.url.endsWith("/api/chat.unfurl"));
  const snapshot = async () =>
    runtime.slackControl("snapshot") as Promise<{
      jobs: { payload: string }[];
      deliveries: { completed_at: string | null }[];
      commands: number;
      uninstalls: number;
    }>;
  return { runtime, owner, teamId, push, issue, url, fixture, connect, event, calls, snapshot };
}

it("acknowledges durable public-only candidates, escapes previews and deduplicates Slack retries", async () => {
  const r = await setup();
  try {
    await r.fixture();
    await r.connect();
    const id = await r.issue("Public <!channel> & <@U123> issue");
    const legacy = await r.issue("Legacy uppercase UUID issue", r.teamId, "6F79BB73-1CC7-4EBD-881F-C8A7DBF86D92");
    const privateTeam = uuidv7();
    await r.push("teamCreate", {
      id: privateTeam,
      name: "Private",
      key: "PRIV",
      visibility: "private",
      membershipId: uuidv7(),
      stateIds: { backlog: uuidv7(), todo: uuidv7(), inProgress: uuidv7(), done: uuidv7(), canceled: uuidv7() },
    });
    const secret = await r.issue("Private secret", privateTeam);
    const urls = [
      r.url(id),
      r.url(legacy),
      r.url(id),
      r.url(secret),
      `https://foreign.example/#issues/${id}`,
      `${r.runtime.appOrigin}/?extra=1#issues/${id}`,
      `${r.runtime.appOrigin}/#issues/not-an-id`,
    ];
    expect((await r.event("EvPUBLIC", urls)).status).toBe(200);
    const admitted = await r.snapshot();
    expect(admitted.jobs).toHaveLength(1);
    expect(JSON.parse(admitted.jobs[0]!.payload).targets).toHaveLength(2);
    const credentials = await r.runtime.slackCredentials();
    expect(admitted.jobs[0]!.payload).not.toContain(String(credentials[0]!["token_ciphertext"]));
    expect(admitted.jobs[0]!.payload).not.toContain(grant.access_token);
    expect(admitted.jobs[0]!.payload).not.toContain("Public");
    expect(await r.calls()).toHaveLength(0);
    expect((await r.event("EvPUBLIC", urls)).status).toBe(200);
    expect((await r.snapshot()).jobs).toHaveLength(1);
    await r.runtime.slackControl("alarm");
    const calls = await r.calls();
    expect(calls).toHaveLength(1);
    const sent = new URLSearchParams(calls[0]!.body);
    expect(sent.get("channel")).toBe("C123");
    expect(sent.get("ts")).toBe("123456789.9875");
    const unfurls = JSON.parse(sent.get("unfurls")!) as Record<
      string,
      { blocks: { text: { type: string; text: string; emoji: boolean } }[] }
    >;
    expect(Object.keys(unfurls)).toEqual([r.url(id), r.url(legacy)]);
    const texts = unfurls[r.url(id)]!.blocks.map((b) => b.text);
    expect(texts.every((t) => t.type === "plain_text" && t.emoji === false)).toBe(true);
    expect(JSON.stringify(texts)).toContain("&lt;!channel&gt; &amp; &lt;@U123&gt;");
    expect(JSON.stringify(texts)).toContain("Status:");
    expect(JSON.stringify(texts)).toContain("Assignee:");
    expect(JSON.stringify(texts)).toContain("Created:");
    expect((await r.snapshot()).jobs).toHaveLength(0);
    expect((await r.snapshot()).deliveries[0]!.completed_at).not.toBeNull();
    await r.event("EvPUBLIC", urls);
    await r.runtime.slackControl("alarm");
    expect(await r.calls()).toHaveLength(1);
    await r.event("EvFOREIGNTEAM", [r.url(id)], {}, { team_id: "T999" });
    expect((await r.snapshot()).jobs).toHaveLength(0);
    expect((await r.event("EvWRONGAPP", [r.url(id)], {}, { api_app_id: "A999" })).status).toBe(403);
    const invitation = (await (
      await r.owner.json("/api/invitations", { email: "slack-member@datafog.ai" })
    ).json()) as { token: string };
    const member = nativeAgent(r.runtime);
    await member.requestLink("slack-member@datafog.ai");
    await member.consume(linkToken(emailLink((await r.runtime.capturedEmails()).at(-1)!)));
    expect((await member.json("/api/invitations/accept", { token: invitation.token })).status).toBe(200);
    expect((await member.json("/api/integrations/slack/unfurls", { enabled: false })).status).toBe(403);
  } finally {
    await r.runtime.close();
  }
});

it("checks the current valid grant when a stale uninstall waits behind reauthorization", async () => {
  const r = await setup();
  try {
    await r.fixture({ ok: true }, "posting");
    await r.connect();
    const previous = (await r.runtime.slackCredentials())[0]!["token_ciphertext"];
    const id = await r.issue("Public issue");
    await r.event("EvSTALEGRANT", [r.url(id)]);
    const delivering = r.runtime.slackControl("alarm");
    await expect.poll(async () => (await r.calls()).length).toBe(1);
    const before = await r.snapshot();
    const reconnecting = r.connect();
    await expect.poll(async () => (await r.snapshot()).commands).toBe(before.commands + 1);
    const uninstalling = r.event("EvOLDUNINSTALL", [], { type: "app_uninstalled" });
    await expect.poll(async () => (await r.snapshot()).uninstalls).toBe(before.uninstalls + 1);
    await r.runtime.releaseGithubResponse("posting");
    await delivering;
    await reconnecting;
    expect((await uninstalling).status).toBe(200);
    const current = await r.runtime.slackCredentials();
    expect(current).toHaveLength(1);
    expect(current[0]!["token_ciphertext"]).not.toBe(previous);
    expect((await r.runtime.githubRequests()).filter((request) => request.url.endsWith("/api/auth.test"))).toHaveLength(
      1,
    );
  } finally {
    await r.runtime.close();
  }
});

it("finishes an admitted post before acknowledging disable and still processes token revocation across preference changes", async () => {
  const r = await setup();
  try {
    await r.fixture({ ok: true }, "posting", { ok: false, error: "account_inactive" });
    await r.connect();
    const id = await r.issue("Visible before disable");
    await r.event("EvINFLIGHT", [r.url(id)]);
    const delivering = r.runtime.slackControl("alarm");
    await expect.poll(async () => (await r.calls()).length).toBe(1);
    const before = await r.snapshot();
    let acknowledged = false;
    const disabling = r.owner.json("/api/integrations/slack/unfurls", { enabled: false }).then((response) => {
      acknowledged = true;
      return response;
    });
    await expect.poll(async () => (await r.snapshot()).commands).toBe(before.commands + 1);
    expect(acknowledged).toBe(false);
    // The uninstall is admitted while the preference update is queued. Preference generations
    // invalidate previews but must not invalidate a lifecycle verdict for the same credential.
    const uninstalling = r.event("EvUNINSTALL", [], { type: "app_uninstalled" });
    await expect.poll(async () => (await r.snapshot()).uninstalls).toBe(before.uninstalls + 1);
    await r.runtime.releaseGithubResponse("posting");
    await delivering;
    expect((await disabling).status).toBe(200);
    expect((await uninstalling).status).toBe(200);
    expect(await r.runtime.slackCredentials()).toHaveLength(0);
    expect(await r.calls()).toHaveLength(1);
  } finally {
    await r.runtime.close();
  }
});

it("honors Slack's section limit without cutting escaped entities or Unicode characters", () => {
  expect(slackLiteral("x".repeat(3000))).toHaveLength(3000);
  const text = slackLiteral("😀&<>".repeat(1000));
  expect(text.length).toBeLessThanOrEqual(3000);
  expect(text.endsWith("…")).toBe(true);
  expect(text).not.toMatch(/&(?!amp;|lt;|gt;)/);
  expect(() => encodeURIComponent(text)).not.toThrow();
});

it("keeps failed work durable, supports composer delivery, and retires old grants and disabled generations", async () => {
  const r = await setup();
  try {
    await r.fixture({ ok: false, error: "internal_error" });
    await r.connect();
    const id = await r.issue("Retry public issue");
    await r.event("EvRETRY", [r.url(id)], { unfurl_id: "fixture-unfurl", source: "composer" });
    await expect(r.runtime.slackControl("alarm")).rejects.toThrow();
    expect((await r.snapshot()).jobs).toHaveLength(1);
    expect((await r.snapshot()).deliveries[0]!.completed_at).toBeNull();
    await r.fixture();
    await r.runtime.slackControl("alarm");
    expect(await r.calls()).toHaveLength(2);
    const composer = new URLSearchParams((await r.calls()).at(-1)!.body);
    expect(composer.get("unfurl_id")).toBe("fixture-unfurl");
    expect(composer.get("source")).toBe("composer");
    expect(composer.has("channel")).toBe(false);
    await r.event("EvDISABLE", [r.url(id)]);
    expect((await r.owner.json("/api/integrations/slack/unfurls", { enabled: false })).status).toBe(200);
    expect((await r.owner.json("/api/integrations/slack/unfurls", { enabled: true })).status).toBe(200);
    await r.runtime.slackControl("alarm");
    expect(await r.calls()).toHaveLength(2);
    await r.event("EvRECONNECT", [r.url(id)]);
    await r.owner.json("/api/integrations/slack/disconnect", {});
    await r.connect();
    await r.runtime.slackControl("alarm");
    expect(await r.calls()).toHaveLength(2);
    await r.runtime.slackLegacyScopes();
    expect(await (await r.owner.fetch("/api/integrations/slack")).json()).toMatchObject({
      connection: { reauthorizationRequired: true },
    });
    await r.event("EvOLDSCOPES", [r.url(id)]);
    expect((await r.snapshot()).jobs).toHaveLength(0);
    await r.connect();
    await r.event("EvREVOKED", [r.url(id)]);
    await r.fixture({ ok: false, error: "token_revoked" });
    await r.runtime.slackControl("alarm");
    expect(await r.runtime.slackCredentials()).toHaveLength(0);
    expect((await r.snapshot()).jobs).toHaveLength(0);
  } finally {
    await r.runtime.close();
  }
});

it("rechecks public scope after credential I/O and refuses a replacement incarnation", async () => {
  const r = await setup();
  try {
    await r.fixture();
    await r.connect();
    const id = await r.issue("Initially public");
    await r.event("EvPRIVACY", [r.url(id)]);
    await r.runtime.slackControl("gate");
    const delivering = r.runtime.slackControl("alarm");
    await expect.poll(() => r.runtime.slackControl("pending")).toBe(true);
    const privateTeam = uuidv7();
    await r.push("teamCreate", {
      id: privateTeam,
      name: "Private",
      key: "PRIV",
      visibility: "private",
      membershipId: uuidv7(),
      stateIds: { backlog: uuidv7(), todo: uuidv7(), inProgress: uuidv7(), done: uuidv7(), canceled: uuidv7() },
    });
    await r.push("issueUpdate", { id, patch: { teamId: privateTeam, title: "Never disclose this" } });
    await r.runtime.slackControl("release");
    await delivering;
    expect(await r.calls()).toHaveLength(0);
    const replaced = await r.issue("Original incarnation");
    await r.event("EvINCARNATION", [r.url(replaced)]);
    await r.push("issueTrash", { id: replaced, trashed: true });
    await r.push("issueDelete", { id: replaced });
    await r.issue("Replacement must not inherit a preview", r.teamId, replaced);
    await r.runtime.slackControl("alarm");
    expect(await r.calls()).toHaveLength(0);
  } finally {
    await r.runtime.close();
  }
});
