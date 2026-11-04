import { uuidv7 } from "@kanbun/model";
import {
  githubPullRequest,
  githubResponses,
  githubSignature,
  GITHUB_INSTALLATION_ID,
  GITHUB_REPOSITORY_ID,
} from "@kanbun/worker/testing";
import type { BootstrapResponse } from "@kanbun/sync";
import { test, expect, loginEmail, nativeBrowser } from "./app-github.fixture";

test("links real GitHub PR context and converges after signed webhook updates in two native-authenticated browsers", async ({
  browser,
  emailApp: app,
}, testInfo) => {
  const firstContext = await browser.newContext({ reducedMotion: "reduce" }),
    secondContext = await browser.newContext({ reducedMotion: "reduce" });
  await nativeBrowser(firstContext);
  await nativeBrowser(secondContext);
  const first = await firstContext.newPage(),
    second = await secondContext.newPage();
  try {
    // Substitute only GitHub's external consent page. The product callback still exchanges the
    // code, verifies native-session-bound state and reads the provider's installation catalog.
    await firstContext.route("https://github.com/login/oauth/authorize?**", (route) => {
      const state = new URL(route.request().url()).searchParams.get("state")!;
      return route.fulfill({
        status: 302,
        headers: {
          location: `${app.origin}/api/integrations/github/callback?code=fixture-code&iss=${encodeURIComponent("https://github.com/login/oauth")}&state=${encodeURIComponent(state)}`,
        },
      });
    });
    await loginEmail(first, app, app.runtime.ownerEmail, "#settings/integrations");
    await expect(first.getByRole("region", { name: "GitHub connection", exact: true })).toBeVisible();
    await first.goto(`${app.origin}/#issues`);
    await first.getByRole("button", { name: "New issue" }).click();
    await first.getByRole("textbox", { name: "Issue title", exact: true }).fill("Integration navigation");
    await first.getByRole("button", { name: "Create issue", exact: true }).click();
    await first
      .getByRole("link", { name: /^Open KAN-/ })
      .first()
      .click();
    await first.getByRole("link", { name: "Connect one in Settings" }).click();
    await expect(first).toHaveURL(/#settings\/integrations$/);
    await expect(first.getByRole("region", { name: "GitHub connection", exact: true })).toBeVisible();
    const connection = first.getByRole("region", { name: "GitHub connection", exact: true });
    await connection.getByRole("button", { name: "Connect GitHub", exact: true }).click();
    await expect(connection.getByRole("combobox", { name: "GitHub repository", exact: true })).toContainText(
      "example/pilot",
    );
    await connection
      .getByRole("combobox", { name: "GitHub repository", exact: true })
      .selectOption({ label: "example/pilot (private repository)" });
    const bootstrap = await first.request.get(`${app.origin}/sync/bootstrap?clientId=github-browser-reader`);
    expect(bootstrap.ok()).toBe(true);
    const before = (await bootstrap.json()) as BootstrapResponse;
    const teamId = String(before.rows.team![0]!.id),
      issueId = uuidv7();
    await connection.getByRole("combobox", { name: "Kanbun team", exact: true }).selectOption(teamId);
    await connection.getByRole("button", { name: "Connect repository to team", exact: true }).click();
    await expect(connection).toContainText("example/pilot");
    const created = await first.request.post(`${app.origin}/sync/push`, {
      headers: { Origin: app.origin },
      data: {
        clientId: "github-browser-writer",
        mutations: [
          {
            id: 1,
            name: "issueCreate",
            ts: new Date().toISOString(),
            args: { id: issueId, teamId, title: "Track the pilot implementation", subscriptionId: uuidv7() },
          },
        ],
      },
    });
    expect(await created.json()).toMatchObject({ ok: true, rejected: [] });
    await first.goto(`${app.origin}/#issues/${issueId}`);
    await loginEmail(second, app, app.runtime.ownerEmail, `#issues/${issueId}`);
    const development = (page: typeof first) => page.getByRole("region", { name: "Development", exact: true });
    const previewActivity = new Date().toISOString();
    await app.runtime.setGithubResponses(
      githubResponses(
        githubPullRequest({
          body: "[Staging Preview](https://kanbun-staging.vercel.app)",
          updated_at: previewActivity,
        }),
      ).map((response) =>
        response.path.includes("/reviews?")
          ? {
              ...response,
              body: [
                { id: 1, state: "APPROVED", commit_id: "a".repeat(40), user: { id: 301, login: "reviewer-one" } },
                {
                  id: 2,
                  state: "CHANGES_REQUESTED",
                  commit_id: "a".repeat(40),
                  user: { id: 302, login: "reviewer-two" },
                },
              ],
            }
          : response.path.includes("/issues/42/comments?")
            ? {
                ...response,
                body: [
                  {
                    body: "[Author Preview](https://kanbun-author.netlify.app)",
                    created_at: previewActivity,
                    updated_at: previewActivity,
                    user: { login: "contributor", type: "User" },
                  },
                  {
                    body: "[Bot Preview](https://kanbun-bot.pages.dev)",
                    created_at: previewActivity,
                    updated_at: previewActivity,
                    user: { login: "deploy-preview[bot]", type: "Bot" },
                  },
                ],
              }
            : response,
      ),
    );
    await development(first)
      .getByRole("textbox", { name: "Pull request URL", exact: true })
      .fill("https://github.com/example/pilot/pull/42");
    await development(first).getByRole("button", { name: "Link pull request", exact: true }).click();
    const card = development(second).getByRole("listitem", { name: "example/pilot PR #42", exact: true });
    await expect(card.getByRole("link", { name: "Ship the pilot", exact: true })).toHaveAttribute(
      "href",
      "https://github.com/example/pilot/pull/42",
    );
    await expect(card).toContainText("feature/pilot");
    await expect(card).toContainText(/reviewer-one\s*Approved/);
    await expect(card).toContainText(/reviewer-two\s*Changes requested/);
    const previews = card.getByText("Preview links (3)", { exact: true });
    await expect(previews).toBeVisible();
    await previews.click();
    await expect(card.getByRole("link", { name: "Staging Preview", exact: true })).toHaveAttribute(
      "href",
      "https://kanbun-staging.vercel.app/",
    );
    await expect(card.getByRole("link", { name: "Author Preview", exact: true })).toBeVisible();
    await expect(card.getByRole("link", { name: "Bot Preview", exact: true })).toBeVisible();
    await app.runtime.setGithubResponses(
      githubResponses(
        githubPullRequest({
          state: "closed",
          merged: true,
          merged_at: "2026-10-30T11:00:00Z",
          updated_at: "2026-10-30T11:00:00Z",
        }),
      ),
    );
    const payload = JSON.stringify({
      action: "closed",
      installation: { id: GITHUB_INSTALLATION_ID },
      repository: { id: GITHUB_REPOSITORY_ID },
      number: 42,
      pull_request: { number: 42 },
    });
    const delivered = await app.runtime.fetch(
      "/api/integrations/github/webhook",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GitHub-Event": "pull_request",
          "X-GitHub-Delivery": uuidv7(),
          "X-Hub-Signature-256": githubSignature(payload),
        },
        body: payload,
      },
      null,
    );
    expect(delivered.ok).toBe(true);
    await expect(card).toContainText(/merged/i, { timeout: 15000 });
    await expect(card).not.toContainText(/reviewer-one\s*Approved/);
    await expect(development(first)).toContainText(/merged/i);
    await second.goto(`${app.origin}/#issues`);
    await expect(
      second.getByRole("link", { name: "example/pilot pull request #42: Ship the pilot", exact: true }),
    ).toHaveCount(1);
    await second.goto(`${app.origin}/#issues/${issueId}`);
    await testInfo.attach("github-development-context", {
      body: await second.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await first.goto(`${app.origin}/#settings`);
    await first.getByRole("button", { name: /^Disconnect example\/pilot from / }).click();
    await expect(development(second).getByRole("listitem", { name: "example/pilot PR #42", exact: true })).toHaveCount(
      0,
    );
    await second.goto(`${app.origin}/#issues`);
    await expect(
      second.getByRole("link", { name: "example/pilot pull request #42: Ship the pilot", exact: true }),
    ).toHaveCount(0);
  } finally {
    await Promise.allSettled([firstContext.close(), secondContext.close()]);
  }
});
