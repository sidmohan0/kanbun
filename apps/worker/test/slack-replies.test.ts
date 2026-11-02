import { createHmac } from "node:crypto";
import { expect, it } from "vitest";
import { uuidv7 } from "@kanbun/model";
import type { BootstrapResponse } from "@kanbun/sync";
import { startEmailRuntime, nativeAgent, emailLink, linkToken } from "./email-runtime";
import { slackIssueIdentifiers } from "../src/slack-replies";

const base = "chat:write,links:read,links:write";
const config = {
  SLACK_CLIENT_ID: "123.456",
  SLACK_CLIENT_SECRET: "fixture-client-secret",
  SLACK_APP_ID: "A123",
  SLACK_SIGNING_SECRET: "fixture-slack-signing-secret",
  SLACK_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
};
async function setup() {
  const runtime = await startEmailRuntime({ slackConfig: config });
  const owner = nativeAgent(runtime);
  await owner.requestLink(runtime.ownerEmail);
  await owner.consume(linkToken(emailLink((await runtime.capturedEmails()).at(-1)!)));
  await owner.fetch("/api/context");
  const bootstrap = (await (await owner.fetch("/sync/bootstrap?clientId=reply-reader")).json()) as BootstrapResponse;
  const teamId = String(bootstrap.rows.team![0]!.id),
    key = String(bootstrap.rows.team![0]!.key);
  let mutation = 0;
  async function push(name: string, args: unknown) {
    expect(
      await (
        await owner.json("/sync/push", {
          clientId: "reply-writer",
          mutations: [{ id: ++mutation, name, args, ts: new Date().toISOString() }],
        })
      ).json(),
    ).toMatchObject({ rejected: [] });
  }
  async function issue(team = teamId, id = uuidv7()) {
    await push("issueCreate", {
      id,
      teamId: team,
      title: "Private body must not enter Slack reply payloads",
      subscriptionId: uuidv7(),
    });
    const rows = (await (
      await owner.fetch(`/sync/bootstrap?clientId=reply-read-${uuidv7()}`)
    ).json()) as BootstrapResponse;
    const value = rows.rows.issue!.find((row) => row.id === id)!;
    const teamKey = String(rows.rows.team!.find((row) => row.id === team)!.key);
    return { id, identifier: `${teamKey}-${value.number}` };
  }
  async function fixture(post: unknown = { ok: true }, scopes = base + ",channels:history", gate?: string) {
    await runtime.setGithubResponses([
      {
        host: "slack.com",
        method: "POST",
        path: "/api/oauth.v2.access",
        body: {
          ok: true,
          access_token: "xoxb-fixture-secret",
          token_type: "bot",
          app_id: "A123",
          scope: scopes,
          team: { id: "T123", name: "Example workspace" },
          bot_user_id: "U123",
          is_enterprise_install: false,
        },
      },
      { host: "slack.com", method: "POST", path: "/api/auth.revoke", body: { ok: true } },
      { host: "slack.com", method: "POST", path: "/api/chat.postMessage", body: post, ...(gate ? { gate } : {}) },
    ]);
  }
  const preference = async (enabled: boolean) => owner.json("/api/integrations/slack/issue-replies", { enabled });
  async function connect(enabled = false) {
    const destination = new URL(
      ((await (await owner.json("/api/integrations/slack/connect", {})).json()) as { url: string }).url,
    );
    expect(destination.searchParams.get("scope")).toBe(base + (enabled ? ",channels:history" : ""));
    expect(
      (
        await owner.fetch(
          `/api/integrations/slack/callback?code=fixture&state=${destination.searchParams.get("state")}`,
          { redirect: "manual" },
        )
      ).status,
    ).toBe(303);
  }
  async function event(
    id: string,
    text: string,
    extra: Record<string, unknown> = {},
    wrapper: Record<string, unknown> = {},
    signed = true,
  ) {
    const raw = JSON.stringify({
      type: "event_callback",
      api_app_id: "A123",
      team_id: "T123",
      event_id: id,
      event: {
        type: "message",
        channel_type: "channel",
        channel: "C123",
        user: "U456",
        ts: "1234567890.123456",
        text,
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
          "v0=" +
          (signed
            ? createHmac("sha256", config.SLACK_SIGNING_SECRET).update(`v0:${timestamp}:${raw}`).digest("hex")
            : "0".repeat(64)),
      },
      body: raw,
    });
  }
  const snapshot = async () =>
    (await runtime.slackControl("snapshot")) as {
      jobs: { payload: string }[];
      replies: { pending_job_id: string | null; last_sent_at: string | null }[];
      commands: number;
      deliveries: { id: string }[];
    };
  const calls = async () =>
    (await runtime.githubRequests()).filter((request) => request.url.endsWith("/api/chat.postMessage"));
  return { runtime, owner, teamId, key, push, issue, fixture, preference, connect, event, snapshot, calls };
}

it("recognizes only canonical bounded issue identifiers", () => {
  expect(slackIssueIdentifiers("eng-12 (ENG-12), ABC1234-9")).toEqual(["ENG-12", "ABC1234-9"]);
  expect(slackIssueIdentifiers("ENG-01 _ENG-1 X-2suffix ABCDEFGH-1 ENG-9007199254740992 ENG-0 prefix-ENG-1")).toEqual(
    [],
  );
  const twenty = Array.from({ length: 20 }, (_, index) => `ENG-${index + 1}`);
  expect(slackIssueIdentifiers(`ENG-1 eng-1 ${twenty.join(" ")} ENG-21 ENG-22`)).toEqual(twenty);
});

it("requires opt-in/reauthorization and durably replies only to public issue IDs with 60-minute thread deduplication", async () => {
  const r = await setup();
  try {
    await r.fixture({ ok: true }, base);
    await r.connect();
    const first = await r.issue(),
      second = await r.issue();
    const beforeChat = (await r.snapshot()).deliveries.length;
    await r.event("EvCHAT", "ordinary public message without identifiers");
    expect((await r.snapshot()).deliveries).toHaveLength(beforeChat);
    expect(await (await r.owner.fetch("/api/integrations/slack")).json()).toMatchObject({
      connection: { issueRepliesEnabled: false },
    });
    await r.event("EvOFF", first.identifier);
    expect((await r.snapshot()).jobs).toHaveLength(0);
    expect((await r.preference(true)).status).toBe(200);
    expect(await (await r.owner.fetch("/api/integrations/slack")).json()).toMatchObject({
      connection: { issueRepliesReauthorizationRequired: true },
    });
    await r.event("EvOLDGRANT", first.identifier);
    expect((await r.snapshot()).jobs).toHaveLength(0);
    await r.fixture();
    await r.connect(true);
    const privateTeam = uuidv7();
    await r.push("teamCreate", {
      id: privateTeam,
      name: "Secret",
      key: "PRIV",
      visibility: "private",
      membershipId: uuidv7(),
      stateIds: { backlog: uuidv7(), todo: uuidv7(), inProgress: uuidv7(), done: uuidv7(), canceled: uuidv7() },
    });
    const secret = await r.issue(privateTeam);
    expect((await r.event("EvBADSIGN", first.identifier, {}, {}, false)).status).toBe(403);
    expect((await r.event("EvBADAPP", first.identifier, {}, { api_app_id: "A999" })).status).toBe(403);
    for (const extra of [
      { user: "U123" },
      { bot_id: "B123" },
      { bot_profile: {} },
      { user: "USLACKBOT" },
      { app_id: "A999" },
      { subtype: "bot_message" },
      { subtype: "message_changed" },
      { edited: {} },
      { channel_type: "group" },
      { channel_type: "im", channel: "D123" },
    ])
      await r.event(uuidv7(), first.identifier, extra);
    expect((await r.snapshot()).jobs).toHaveLength(0);
    const text = `${first.identifier} ${first.identifier.toLowerCase()} ${second.identifier} ${secret.identifier} rawmessage-private-note`;
    await r.event("EvPUBLIC", text, { thread_ts: "1234500000.000001" });
    const admitted = await r.snapshot();
    expect(admitted.jobs).toHaveLength(2);
    expect(await r.calls()).toHaveLength(0);
    for (const job of admitted.jobs) {
      expect(job.payload).not.toContain("rawmessage");
      expect(job.payload).not.toContain("Private body");
      expect(job.payload).not.toContain("xoxb");
    }
    await r.event("EvPUBLIC", text, { thread_ts: "1234500000.000001" });
    await r.event("EvPENDING", text, { thread_ts: "1234500000.000001" });
    expect((await r.snapshot()).jobs).toHaveLength(2);
    expect((await r.owner.json("/api/integrations/slack/unfurls", { enabled: false })).status).toBe(200);
    await r.runtime.slackControl("alarm");
    expect(await r.calls()).toHaveLength(2);
    const sent = (await r.calls()).map((call) => new URLSearchParams(call.body));
    expect(
      sent.every(
        (form) =>
          form.get("thread_ts") === "1234500000.000001" &&
          form.get("unfurl_links") === "false" &&
          form.get("reply_broadcast") === "false",
      ),
    ).toBe(true);
    expect(sent.map((form) => form.get("text"))).toContain(
      `${first.identifier} ${r.runtime.appOrigin}/#issues/${first.id}`,
    );
    await r.runtime.slackAgeReplies(59);
    await r.event("Ev59", text, { thread_ts: "1234500000.000001" });
    expect((await r.snapshot()).jobs).toHaveLength(0);
    await r.runtime.slackAgeReplies(61);
    await r.event("Ev61", first.identifier, { thread_ts: "1234500000.000001" });
    expect((await r.snapshot()).jobs).toHaveLength(1);
    await r.event("EvOTHERTHREAD", second.identifier, { thread_ts: "1234500000.000002" });
    expect((await r.snapshot()).jobs).toHaveLength(2);
    const invitation = (await (
      await r.owner.json("/api/invitations", { email: "reply-member@datafog.ai" })
    ).json()) as { token: string };
    const member = nativeAgent(r.runtime);
    await member.requestLink("reply-member@datafog.ai");
    await member.consume(linkToken(emailLink((await r.runtime.capturedEmails()).at(-1)!)));
    expect((await member.json("/api/invitations/accept", { token: invitation.token })).status).toBe(200);
    expect((await member.json("/api/integrations/slack/issue-replies", { enabled: false })).status).toBe(403);
  } finally {
    await r.runtime.close();
  }
});

it("keeps provider failures pending, retires disabled/reconnected generations and revoked or inaccessible destinations", async () => {
  const r = await setup();
  try {
    await r.fixture();
    await r.connect();
    await r.preference(true);
    const issue = await r.issue();
    await r.fixture({ ok: false, error: "ratelimited" });
    await r.event("EvOUTAGE", issue.identifier);
    await expect(r.runtime.slackControl("alarm")).rejects.toThrow();
    expect((await r.snapshot()).jobs).toHaveLength(1);
    await r.event("EvRETRY", issue.identifier);
    expect((await r.snapshot()).jobs).toHaveLength(1);
    await r.fixture();
    await r.runtime.slackControl("alarm");
    expect((await r.snapshot()).jobs).toHaveLength(0);
    await r.event("EvDISABLED", issue.identifier, { ts: "1234500000.000002" });
    await r.preference(false);
    await r.preference(true);
    await r.runtime.slackControl("alarm");
    expect((await r.snapshot()).jobs).toHaveLength(0);
    await r.event("EvRECONNECT", issue.identifier, { ts: "1234500000.000003" });
    await r.connect(true);
    const before = (await r.calls()).length;
    await r.runtime.slackControl("alarm");
    expect(await r.calls()).toHaveLength(before);
    await r.fixture({ ok: false, error: "not_in_channel" });
    await r.event("EvLEFT", issue.identifier, { ts: "1234500000.000004" });
    await r.runtime.slackControl("alarm");
    expect((await r.snapshot()).jobs).toHaveLength(0);
    expect(await r.runtime.slackCredentials()).toHaveLength(1);
    await r.fixture({ ok: false, error: "account_inactive" });
    await r.event("EvREVOKED", issue.identifier, { ts: "1234500000.000005" });
    await r.runtime.slackControl("alarm");
    expect(await r.runtime.slackCredentials()).toHaveLength(0);
  } finally {
    await r.runtime.close();
  }
});

it("rechecks privacy after credential reads and refuses a deleted/recreated issue", async () => {
  const r = await setup();
  try {
    await r.fixture();
    await r.connect();
    await r.preference(true);
    const issue = await r.issue();
    await r.event("EvVISIBILITY", issue.identifier);
    await r.runtime.slackControl("gate");
    const delivering = r.runtime.slackControl("alarm");
    await expect.poll(async () => r.runtime.slackControl("pending")).toBe(true);
    await r.push("teamUpdate", { id: r.teamId, patch: { visibility: "private" } });
    await r.runtime.slackControl("release");
    await delivering;
    expect(await r.calls()).toHaveLength(0);
    await r.push("teamUpdate", { id: r.teamId, patch: { visibility: "public" } });
    await r.event("EvREPLACED", issue.identifier, { ts: "1234500000.000002" });
    await r.push("issueTrash", { id: issue.id, trashed: true });
    await r.push("issueDelete", { id: issue.id });
    const replacement = await r.issue(r.teamId, issue.id);
    await r.runtime.slackControl("alarm");
    expect(await r.calls()).toHaveLength(0);
    await r.event("EvRENAMED", replacement.identifier, { ts: "1234500000.000003" });
    await r.push("teamUpdate", { id: r.teamId, patch: { key: "NEW" } });
    await r.runtime.slackControl("alarm");
    expect(await r.calls()).toHaveLength(0);
  } finally {
    await r.runtime.close();
  }
});

it("finishes an admitted post before acknowledging owner disable", async () => {
  const r = await setup();
  try {
    await r.fixture({ ok: true }, base + ",channels:history", "reply-posting");
    await r.connect();
    await r.preference(true);
    const issue = await r.issue();
    await r.event("EvINFLIGHT", issue.identifier);
    const delivering = r.runtime.slackControl("alarm");
    await expect.poll(async () => (await r.calls()).length).toBe(1);
    const before = await r.snapshot();
    let acknowledged = false;
    const disabling = r.preference(false).then((response) => {
      acknowledged = true;
      return response;
    });
    await expect.poll(async () => (await r.snapshot()).commands).toBe(before.commands + 1);
    expect(acknowledged).toBe(false);
    await r.runtime.releaseGithubResponse("reply-posting");
    await delivering;
    expect((await disabling).status).toBe(200);
    await r.event("EvAFTEROFF", issue.identifier, { ts: "1234500000.000002" });
    expect((await r.snapshot()).jobs).toHaveLength(0);
    expect(await r.calls()).toHaveLength(1);
  } finally {
    await r.runtime.close();
  }
});
