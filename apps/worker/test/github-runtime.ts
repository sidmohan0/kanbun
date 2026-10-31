import { exportPKCS8, generateKeyPair } from "jose";
import { createHmac } from "node:crypto";
import { startEmailRuntime } from "./email-runtime";
import type { GithubFixtureResponse } from "./github-provider-worker";

export const GITHUB_WEBHOOK_SECRET = "fixture-github-webhook-secret";
export const GITHUB_USER_TOKEN = "fixture-user-oauth-token";
export const GITHUB_INSTALLATION_TOKEN = "fixture-installation-token";
export const GITHUB_INSTALLATION_ID = 201;
export const GITHUB_REPOSITORY_ID = 101;
export const githubRepository = {
  id: GITHUB_REPOSITORY_ID,
  name: "pilot",
  full_name: "example/pilot",
  owner: { login: "example" },
  html_url: "https://github.com/example/pilot",
  private: true,
};

export function githubPullRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 1042,
    number: 42,
    title: "Ship the pilot",
    html_url: "https://github.com/example/pilot/pull/42",
    state: "open",
    draft: false,
    merged: false,
    merged_at: null,
    updated_at: "2026-10-30T10:00:00Z",
    user: { login: "contributor", avatar_url: "https://avatars.githubusercontent.com/u/301" },
    head: { ref: "feature/pilot", sha: "a".repeat(40) },
    base: { ref: "main", repo: githubRepository },
    ...overrides,
  };
}

export function githubResponses(pr = githubPullRequest()): GithubFixtureResponse[] {
  const sha = (pr.head as { sha: string }).sha;
  const user = `Bearer ${GITHUB_USER_TOKEN}`;
  const app = `Bearer ${GITHUB_INSTALLATION_TOKEN}`;
  return [
    {
      host: "github.com",
      method: "POST",
      path: "/login/oauth/access_token",
      body: { access_token: GITHUB_USER_TOKEN, token_type: "bearer" },
    },
    { method: "GET", path: "/user", authorization: user, body: { id: 301, login: "pilot-owner" } },
    {
      method: "GET",
      path: "/user/installations?per_page=100&page=1",
      authorization: user,
      body: {
        total_count: 2,
        installations: [
          { id: GITHUB_INSTALLATION_ID, app_id: 1234, account: { login: "example" } },
          { id: 999, app_id: 9999, account: { login: "another-app" } },
        ],
      },
    },
    {
      method: "GET",
      path: `/user/installations/${GITHUB_INSTALLATION_ID}/repositories?per_page=100&page=1`,
      authorization: user,
      body: { total_count: 1, repositories: [githubRepository] },
    },
    {
      method: "POST",
      path: `/app/installations/${GITHUB_INSTALLATION_ID}/access_tokens`,
      body: { token: GITHUB_INSTALLATION_TOKEN, expires_at: "2030-01-01T00:00:00Z" },
    },
    { method: "GET", path: "/repos/example/pilot/pulls/42", authorization: app, body: pr },
    { method: "GET", path: "/repos/example/pilot/pulls/42/reviews?per_page=100&page=1", authorization: app, body: [] },
    {
      method: "GET",
      path: `/repos/example/pilot/commits/${sha}/check-runs?per_page=100&page=1`,
      authorization: app,
      body: { total_count: 0, check_runs: [] },
    },
    {
      method: "GET",
      path: `/repos/example/pilot/commits/${sha}/status?per_page=100&page=1`,
      authorization: app,
      body: {
        state: "success",
        total_count: 1,
        statuses: [{ state: "success", target_url: "https://github.com/example/pilot/actions/runs/1" }],
      },
    },
  ];
}

export function githubSignature(body: string, secret = GITHUB_WEBHOOK_SECRET) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export async function startGithubRuntime() {
  const pair = await generateKeyPair("RS256", { extractable: true });
  const runtime = await startEmailRuntime({
    githubConfig: {
      GITHUB_APP_ID: "1234",
      GITHUB_APP_CLIENT_ID: "fixture-app-client-id",
      GITHUB_APP_SLUG: "kanbun-fixture",
      GITHUB_APP_CLIENT_SECRET: "fixture-app-client-secret",
      GITHUB_APP_PRIVATE_KEY: await exportPKCS8(pair.privateKey),
      GITHUB_WEBHOOK_SECRET,
    },
  });
  await runtime.setGithubResponses(githubResponses());
  return runtime;
}
