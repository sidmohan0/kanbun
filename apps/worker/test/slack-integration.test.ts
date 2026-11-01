import { createHmac } from "node:crypto";
import { expect, it } from "vitest";
import { startEmailRuntime, emailLink, linkToken, nativeAgent } from "./email-runtime";

const secret = "fixture-slack-signing-secret";
const config = {
  SLACK_CLIENT_ID: "123.456",
  SLACK_CLIENT_SECRET: "fixture-client-secret",
  SLACK_APP_ID: "A123",
  SLACK_SIGNING_SECRET: secret,
  SLACK_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
};
const grant = {
  ok: true,
  access_token: "xoxb-fixture-private-token",
  token_type: "bot",
  app_id: "A123",
  scope: "chat:write",
  team: { id: "T123", name: "Example team" },
  bot_user_id: "U123",
  is_enterprise_install: false,
};
async function signed(
  runtime: Awaited<ReturnType<typeof startEmailRuntime>>,
  payload: unknown,
  timestamp = Math.floor(Date.now() / 1000),
) {
  const raw = JSON.stringify(payload);
  return fetch(runtime.origin + "/api/integrations/slack/events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": String(timestamp),
      "x-slack-signature": "v0=" + createHmac("sha256", secret).update(`v0:${timestamp}:${raw}`).digest("hex"),
    },
    body: raw,
  });
}
it("connects Slack only through a browser/session-bound owner grant and keeps tokens private", async () => {
  const runtime = await startEmailRuntime({ slackConfig: config });
  try {
    await runtime.setGithubResponses([
      { host: "slack.com", method: "POST", path: "/api/oauth.v2.access", body: grant },
      { host: "slack.com", method: "POST", path: "/api/auth.revoke", body: { ok: false, error: "token_revoked" } },
      { host: "slack.com", method: "POST", path: "/api/auth.test", body: { ok: true }, once: true },
      { host: "slack.com", method: "POST", path: "/api/auth.test", body: { ok: true }, once: true },
      { host: "slack.com", method: "POST", path: "/api/auth.test", body: { ok: false, error: "token_revoked" } },
    ]);
    const owner = nativeAgent(runtime),
      other = nativeAgent(runtime),
      anonymous = nativeAgent(runtime);
    expect((await anonymous.fetch("/api/integrations/slack")).status).toBe(401);
    for (const agent of [owner, other]) {
      await agent.requestLink(runtime.ownerEmail);
      await agent.consume(linkToken(emailLink((await runtime.capturedEmails()).at(-1)!)));
      expect((await agent.fetch("/api/context")).status).toBe(200);
    }
    expect((await owner.json("/api/integrations/slack/connect", {}, {}, false)).status).toBe(403);
    const begin = await owner.json("/api/integrations/slack/connect", {});
    expect(begin.status).toBe(200);
    const url = new URL(((await begin.json()) as { url: string }).url);
    expect(url.origin).toBe("https://slack.com");
    expect(url.searchParams.get("scope")).toBe("chat:write");
    expect(begin.headers.getSetCookie().join(";")).toContain("HttpOnly");
    other.cookies.set("__Host-kanbun-slack", owner.cookies.get("__Host-kanbun-slack")!);
    const callback = "/api/integrations/slack/callback?code=fixture-code&state=" + url.searchParams.get("state");
    expect((await other.fetch(callback, { redirect: "manual" })).status).toBe(403);
    expect(await runtime.githubRequests()).toHaveLength(0);
    expect((await owner.fetch(callback, { redirect: "manual" })).status).toBe(303);
    expect((await owner.fetch(callback, { redirect: "manual" })).status).toBe(403);
    const status = await (await owner.fetch("/api/integrations/slack")).text();
    expect(status).toContain("Example team");
    expect(status).not.toContain(grant.access_token);
    expect(status).not.toContain("token_ciphertext");
    const stored = await runtime.slackCredentials();
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain(grant.access_token);
    expect(String(stored[0]!["token_ciphertext"])).toMatch(/^[A-Za-z0-9+/]+=*\.[A-Za-z0-9+/]+=*$/);
    expect((await signed(runtime, { type: "url_verification", challenge: "verify-me" })).status).toBe(200);
    expect(
      (await signed(runtime, { type: "url_verification", challenge: "old" }, Math.floor(Date.now() / 1000) - 301))
        .status,
    ).toBe(403);
    // Delayed uninstall from before this connection cannot delete the new installation.
    await signed(runtime, {
      type: "event_callback",
      api_app_id: "A123",
      team_id: "T123",
      event_time: Math.floor(Date.now() / 1000) - 60,
      event: { type: "app_uninstalled" },
    });
    expect(await (await owner.fetch("/api/integrations/slack")).json()).toMatchObject({
      connection: { teamId: "T123" },
    });
    await signed(runtime, {
      type: "event_callback",
      api_app_id: "A123",
      team_id: "T123",
      event_time: Math.floor(Date.now() / 1000),
      event: { type: "app_uninstalled" },
    });
    expect(await (await owner.fetch("/api/integrations/slack")).json()).toMatchObject({
      connection: { teamId: "T123" },
    });
    expect((await owner.json("/api/integrations/slack/disconnect", {})).status).toBe(200);
    expect(await (await owner.fetch("/api/integrations/slack")).json()).toMatchObject({ connection: null });
    const next = new URL(
      ((await (await owner.json("/api/integrations/slack/connect", {})).json()) as { url: string }).url,
    );
    await owner.fetch("/api/integrations/slack/callback?code=fixture-code&state=" + next.searchParams.get("state"), {
      redirect: "manual",
    });
    await signed(runtime, {
      type: "event_callback",
      api_app_id: "A123",
      team_id: "T123",
      event_time: Math.floor(Date.now() / 1000),
      event: { type: "app_uninstalled" },
    });
    expect(await (await owner.fetch("/api/integrations/slack")).json()).toMatchObject({ connection: null });
    await runtime.setGithubResponses([
      { host: "slack.com", method: "POST", path: "/api/oauth.v2.access", body: grant, gate: "oauth-session-revoked" },
    ]);
    const pending = new URL(
      ((await (await owner.json("/api/integrations/slack/connect", {})).json()) as { url: string }).url,
    );
    const completing = owner.fetch(
      "/api/integrations/slack/callback?code=fixture-code&state=" + pending.searchParams.get("state"),
      { redirect: "manual" },
    );
    await expect
      .poll(async () => (await runtime.githubRequests()).filter((r) => r.url.endsWith("/api/oauth.v2.access")).length)
      .toBe(3);
    await owner.logout();
    await runtime.releaseGithubResponse("oauth-session-revoked");
    expect((await completing).status).toBe(401);
    expect(await runtime.slackCredentials()).toHaveLength(0);
  } finally {
    await runtime.close();
  }
});

it("never pairs one Slack team's identity with a concurrent grant for another team", async () => {
  const runtime = await startEmailRuntime({ slackConfig: config });
  try {
    const a = nativeAgent(runtime),
      b = nativeAgent(runtime);
    for (const agent of [a, b]) {
      await agent.requestLink(runtime.ownerEmail);
      await agent.consume(linkToken(emailLink((await runtime.capturedEmails()).at(-1)!)));
      await agent.fetch("/api/context");
    }
    await runtime.setGithubResponses([
      { host: "slack.com", method: "POST", path: "/api/oauth.v2.access", body: grant, once: true, gate: "first-team" },
      {
        host: "slack.com",
        method: "POST",
        path: "/api/oauth.v2.access",
        body: { ...grant, team: { id: "T456", name: "Other team" } },
        once: true,
        gate: "second-team",
      },
    ]);
    const state = async (agent: ReturnType<typeof nativeAgent>) =>
      new URL(
        ((await (await agent.json("/api/integrations/slack/connect", {})).json()) as { url: string }).url,
      ).searchParams.get("state");
    const firstState = await state(a),
      secondState = await state(b);
    const first = a.fetch("/api/integrations/slack/callback?code=first&state=" + firstState, { redirect: "manual" });
    await expect.poll(async () => (await runtime.githubRequests()).length).toBe(1);
    const second = b.fetch("/api/integrations/slack/callback?code=second&state=" + secondState, { redirect: "manual" });
    await expect.poll(async () => (await runtime.githubRequests()).length).toBe(2);
    await Promise.all([runtime.releaseGithubResponse("first-team"), runtime.releaseGithubResponse("second-team")]);
    expect([(await first).status, (await second).status].sort()).toEqual([303, 409]);
    const stored = await runtime.slackCredentials();
    expect(stored).toHaveLength(1);
    expect(["T123:Example team", "T456:Other team"]).toContain(`${stored[0]!["team_id"]}:${stored[0]!["team_name"]}`);
  } finally {
    await runtime.close();
  }
});

it("removes deleted Slack credentials while retaining connections during provider outages", async () => {
  const runtime = await startEmailRuntime({ slackConfig: config });
  try {
    const owner = nativeAgent(runtime);
    await owner.requestLink(runtime.ownerEmail);
    await owner.consume(linkToken(emailLink((await runtime.capturedEmails()).at(-1)!)));
    await owner.fetch("/api/context");

    for (const method of ["auth.revoke", "auth.test"]) {
      await runtime.setGithubResponses([
        { host: "slack.com", method: "POST", path: "/api/oauth.v2.access", body: grant },
        { host: "slack.com", method: "POST", path: "/api/" + method, body: { ok: false, error: "internal_error" } },
      ]);
      const begin = await owner.json("/api/integrations/slack/connect", {});
      const state = new URL(((await begin.json()) as { url: string }).url).searchParams.get("state");
      expect(
        (await owner.fetch("/api/integrations/slack/callback?code=fixture-code&state=" + state, { redirect: "manual" }))
          .status,
      ).toBe(303);
      const remove = () =>
        method === "auth.revoke"
          ? owner.json("/api/integrations/slack/disconnect", {})
          : signed(runtime, {
              type: "event_callback",
              api_app_id: "A123",
              team_id: "T123",
              // A valid signed retry or skewed provider clock can predate our local write.
              event_time: Math.floor(Date.now() / 1000) - 60,
              event: { type: "app_uninstalled" },
            });

      expect((await remove()).status).toBe(503);
      expect(await runtime.slackCredentials()).toHaveLength(1);
      await runtime.setGithubResponses([
        { host: "slack.com", method: "POST", path: "/api/" + method, body: { ok: false, error: "account_inactive" } },
      ]);
      expect((await remove()).status).toBe(200);
      expect(await runtime.slackCredentials()).toHaveLength(0);
    }
  } finally {
    await runtime.close();
  }
});
