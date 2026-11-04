import { expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { emailLink, linkToken, nativeAgent, startEmailRuntime } from "./email-runtime";

const key = Buffer.alloc(32, 29).toString("base64");
const values = {
  github: {
    appId: "12345",
    appSlug: "kanbun-self-hosted",
    clientId: "Iv1.fixture-client-id",
    clientSecret: "github-fixture-client-secret",
    privateKey: `-----BEGIN PRIVATE KEY-----\n${"A".repeat(140)}\n-----END PRIVATE KEY-----`,
    webhookSecret: "github-fixture-webhook-secret",
  },
  slack: {
    appId: "A123",
    clientId: "123.456",
    clientSecret: "slack-fixture-client-secret",
    signingSecret: "slack-fixture-signing-secret",
  },
  "google-sheets": {
    clientId: "fixture.apps.googleusercontent.com",
    clientSecret: "google-fixture-client-secret",
  },
};

async function signIn(runtime: Awaited<ReturnType<typeof startEmailRuntime>>, email: string) {
  const agent = nativeAgent(runtime);
  expect((await agent.requestLink(email)).status).toBe(202);
  expect((await agent.consume(linkToken(emailLink((await runtime.capturedEmails()).at(-1)!)))).status).toBe(200);
  return agent;
}

it("stores self-hosted provider apps encrypted, owner-only, blank-on-read and rotatable", async () => {
  const runtime = await startEmailRuntime({
    integrationCredentialsMode: "workspace",
    integrationCredentialsKey: key,
  });
  try {
    const owner = await signIn(runtime, runtime.ownerEmail);
    const inviteResponse = await owner.json("/api/invitations", { email: "member@datafog.ai" });
    expect(inviteResponse.status).toBe(200);
    const token = ((await inviteResponse.json()) as { token: string }).token;
    const member = await signIn(runtime, "member@datafog.ai");
    expect((await member.json("/api/invitations/accept", { token })).status).toBe(200);
    expect((await member.fetch("/api/integration-apps")).status).toBe(403);
    expect(
      (await member.fetch("/api/integration-apps/github", { method: "PUT", body: JSON.stringify(values.github) }))
        .status,
    ).toBe(403);

    const initial = await owner.fetch("/api/integration-apps");
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({
      enabled: true,
      providers: [
        { provider: "github", configured: false, callbackUrl: `${runtime.appOrigin}/api/integrations/github/callback` },
        {
          provider: "slack",
          configured: false,
          eventsUrl: `${runtime.appOrigin}/api/integrations/slack/events/${runtime.workspaceId}`,
        },
        { provider: "google-sheets", configured: false, scopes: ["https://www.googleapis.com/auth/drive.file"] },
      ],
    });

    for (const [provider, config] of Object.entries(values)) {
      const saved = await owner.fetch(`/api/integration-apps/${provider}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config),
      });
      expect(saved.status).toBe(200);
      const body = await saved.text();
      for (const secret of Object.values(config)) expect(body).not.toContain(secret);
    }
    const configuredStatus = await (await owner.fetch("/api/integration-apps")).json();
    expect(configuredStatus).toMatchObject({
      providers: [
        { provider: "github", configured: true, verifiedAt: null },
        { provider: "slack", configured: true, verifiedAt: null },
        { provider: "google-sheets", configured: true, verifiedAt: null },
      ],
    });
    const records = await runtime.integrationAppCredentials();
    expect(records).toHaveLength(3);
    expect(JSON.stringify(records)).not.toContain("fixture-client-secret");
    expect(JSON.stringify(records)).not.toContain("fixture-signing-secret");
    expect(JSON.stringify(records)).not.toContain("BEGIN PRIVATE KEY");

    const before = records.find((row) => row.provider === "github") as Record<string, unknown>;
    const rotated = await owner.fetch("/api/integration-apps/github", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientSecret: "github-rotated-client-secret" }),
    });
    expect(rotated.status).toBe(200);
    const after = (await runtime.integrationAppCredentials()).find((row) => row.provider === "github") as Record<
      string,
      unknown
    >;
    expect(after.revision).not.toBe(before.revision);
    expect(after.credentials_ciphertext).not.toBe(before.credentials_ciphertext);
    expect(await rotated.text()).not.toContain("github-rotated-client-secret");

    const deleted = await owner.fetch("/api/integration-apps/slack", { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect((await runtime.integrationAppCredentials()).map((row) => row.provider)).not.toContain("slack");
  } finally {
    await runtime.close();
  }
});

it("uses workspace Slack credentials for OAuth exchange and signed workspace webhooks", async () => {
  const runtime = await startEmailRuntime({
    integrationCredentialsMode: "workspace",
    integrationCredentialsKey: key,
    slackConfig: { SLACK_TOKEN_ENCRYPTION_KEY: key },
  });
  try {
    const owner = await signIn(runtime, runtime.ownerEmail);
    await owner.fetch("/api/integration-apps/slack", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values.slack),
    });
    await runtime.setGithubResponses([
      {
        host: "slack.com",
        method: "POST",
        path: "/api/oauth.v2.access",
        body: {
          ok: true,
          access_token: "xoxb-fixture-private-token",
          token_type: "bot",
          app_id: values.slack.appId,
          scope: "chat:write,links:read,links:write",
          team: { id: "T123", name: "Self-hosted team" },
          bot_user_id: "U123",
          is_enterprise_install: false,
        },
      },
    ]);
    const begin = await owner.json("/api/integrations/slack/connect", {});
    expect(begin.status).toBe(200);
    const authorize = new URL(((await begin.json()) as { url: string }).url);
    expect(authorize.searchParams.get("client_id")).toBe(values.slack.clientId);
    const callback = await owner.fetch(
      `/api/integrations/slack/callback?code=fixture-code&state=${encodeURIComponent(authorize.searchParams.get("state")!)}`,
      { redirect: "manual" },
    );
    expect(callback.status).toBe(303);
    const exchange = (await runtime.githubRequests()).find((request) => request.url.includes("oauth.v2.access"));
    expect(exchange?.body).toContain(values.slack.clientSecret);
    expect(exchange?.body).toContain(values.slack.clientId);

    const payload = { type: "url_verification", challenge: "workspace-challenge", api_app_id: values.slack.appId };
    const raw = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", values.slack.signingSecret).update(`v0:${timestamp}:${raw}`).digest("hex");
    const verified = await runtime.fetch(`/api/integrations/slack/events/${runtime.workspaceId}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": `v0=${signature}`,
      },
      body: raw,
    });
    expect(verified.status).toBe(200);
    expect(await verified.json()).toEqual({ challenge: "workspace-challenge" });
    expect(
      (
        (await (await owner.fetch("/api/integration-apps")).json()) as {
          providers: { provider: string; verifiedAt: string | null }[];
        }
      ).providers.find((provider) => provider.provider === "slack")?.verifiedAt,
    ).toBeTruthy();
  } finally {
    await runtime.close();
  }
});

it("does not report Slack as configured when only the token encryption key exists", async () => {
  const runtime = await startEmailRuntime({
    integrationCredentialsMode: "workspace",
    integrationCredentialsKey: key,
    slackConfig: { SLACK_TOKEN_ENCRYPTION_KEY: key },
  });
  try {
    const owner = await signIn(runtime, runtime.ownerEmail);
    const status = await owner.fetch("/api/integrations/slack");
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ configured: false, connection: null });
  } finally {
    await runtime.close();
  }
});

it("uses the saved Google OAuth client for workspace authorization exchange", async () => {
  const runtime = await startEmailRuntime({
    integrationCredentialsMode: "workspace",
    integrationCredentialsKey: key,
    sheetsConfig: { GOOGLE_SHEETS_TOKEN_KEY: key },
  });
  try {
    const owner = await signIn(runtime, runtime.ownerEmail);
    const saved = await owner.fetch("/api/integration-apps/google-sheets", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values["google-sheets"]),
    });
    expect(saved.status).toBe(200);
    const begin = await owner.json("/api/integrations/google-sheets/connect", {});
    expect(begin.status).toBe(200);
    const authorize = new URL(((await begin.json()) as { url: string }).url);
    expect(authorize.searchParams.get("client_id")).toBe(values["google-sheets"].clientId);
    const callback = await owner.fetch(
      `/api/integrations/google-sheets/callback?code=fixture-code&state=${encodeURIComponent(authorize.searchParams.get("state")!)}`,
      { redirect: "manual" },
    );
    expect(callback.status).toBe(303);
    const exchange = (await runtime.googleRequests()).find((request) =>
      request.url.includes("oauth2.googleapis.com/token"),
    );
    expect(exchange?.body).toContain(values["google-sheets"].clientSecret);
    expect(exchange?.body).toContain(values["google-sheets"].clientId);
    expect(
      (
        (await (await owner.fetch("/api/integration-apps")).json()) as {
          providers: { provider: string; verifiedAt: string | null }[];
        }
      ).providers.find((provider) => provider.provider === "google-sheets")?.verifiedAt,
    ).toBeTruthy();
  } finally {
    await runtime.close();
  }
});

it("uses the saved GitHub App for workspace OAuth and installation filtering", async () => {
  const runtime = await startEmailRuntime({
    integrationCredentialsMode: "workspace",
    integrationCredentialsKey: key,
    githubConfig: {
      GITHUB_APP_ID: "99999",
      GITHUB_APP_CLIENT_ID: "platform-client-id",
      GITHUB_APP_CLIENT_SECRET: "platform-client-secret",
      GITHUB_APP_SLUG: "platform-app",
      GITHUB_APP_PRIVATE_KEY: "platform-private-key",
      GITHUB_WEBHOOK_SECRET: "platform-webhook-secret",
    },
  });
  try {
    const owner = await signIn(runtime, runtime.ownerEmail);
    await owner.fetch("/api/integration-apps/github", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values.github),
    });
    await runtime.setGithubResponses([
      {
        host: "github.com",
        method: "POST",
        path: "/login/oauth/access_token",
        body: { access_token: "github-user-token" },
      },
      {
        method: "GET",
        path: "/user",
        authorization: "Bearer github-user-token",
        body: { id: 1, login: "fixture-owner" },
      },
      {
        method: "GET",
        path: "/user/installations?per_page=100&page=1",
        authorization: "Bearer github-user-token",
        body: { total_count: 1, installations: [{ id: 71, app_id: 12345, suspended_at: null }] },
      },
      {
        method: "GET",
        path: "/user/installations/71/repositories?per_page=100&page=1",
        authorization: "Bearer github-user-token",
        body: { total_count: 0, repositories: [] },
      },
    ]);
    const begin = await owner.json("/api/integrations/github/connect", {});
    expect(begin.status).toBe(200);
    const authorize = new URL(((await begin.json()) as { url: string }).url);
    expect(authorize.searchParams.get("client_id")).toBe(values.github.clientId);
    const callback = await owner.fetch(
      `/api/integrations/github/callback?code=fixture-code&state=${encodeURIComponent(authorize.searchParams.get("state")!)}&iss=https%3A%2F%2Fgithub.com%2Flogin%2Foauth`,
      { redirect: "manual" },
    );
    expect(callback.status).toBe(303);
    const exchange = (await runtime.githubRequests()).find((request) =>
      request.url.includes("/login/oauth/access_token"),
    );
    expect(exchange?.body).toContain(values.github.clientSecret);
    expect(exchange?.body).toContain(values.github.clientId);
    expect(exchange?.body).not.toContain("platform-client-secret");
    expect(
      (
        (await (await owner.fetch("/api/integration-apps")).json()) as {
          providers: { provider: string; verifiedAt: string | null }[];
        }
      ).providers.find((provider) => provider.provider === "github")?.verifiedAt,
    ).toBeTruthy();

    const raw = "{}";
    const signature = (secret: string) => "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
    const endpoint = `/api/integrations/github/webhook/${runtime.workspaceId}`;
    const headers = { "content-type": "application/json", "x-github-event": "ping", "x-github-delivery": "fixture" };
    expect(
      (
        await runtime.fetch(endpoint, {
          method: "POST",
          headers: { ...headers, "x-hub-signature-256": signature("platform-webhook-secret") },
          body: raw,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await runtime.fetch(endpoint, {
          method: "POST",
          headers: { ...headers, "x-hub-signature-256": signature(values.github.webhookSecret) },
          body: raw,
        })
      ).status,
    ).toBe(202);
  } finally {
    await runtime.close();
  }
});
