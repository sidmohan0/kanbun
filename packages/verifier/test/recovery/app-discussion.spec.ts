import { issueIncarnation, type PushResponse } from "@kanbun/sync";
import { uuidv7 } from "@kanbun/model";
import { test, expect, readWorkspaceState, syncApi, type AppHarness } from "./app.fixture";
import type { Page } from "@playwright/test";

async function open(page: Page, app: AppHarness) {
  await page.goto(`${app.origin}/#issues/${app.issueId}`);
  await expect(page.getByRole("textbox", { name: "Add a comment", exact: true })).toBeEditable();
}
const comments = (page: Page) => page.getByRole("region", { name: "Comments", exact: true });
const activity = (page: Page) => page.getByRole("region", { name: "Activity", exact: true });

test("known inactive authors remain attributed and another person's comment has no edit control", async ({
  page,
  app,
}) => {
  const response = await app.runtime.fetch("/sync/push", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Kanbun-Local-Actor": "bob" },
    body: JSON.stringify({
      clientId: "former-author",
      mutations: [
        {
          id: 1,
          name: "commentCreate",
          ts: "2026-10-30T00:00:00.000Z",
          args: { id: uuidv7(), issueId: app.issueId, body: "A historical decision" },
        },
      ],
    }),
  });
  expect(response.status).toBe(200);
  expect((await response.json()) as PushResponse).toMatchObject({ ok: true, rejected: [] });
  await app.runtime.setMemberActive("bob", false);
  await open(page, app);
  await expect(comments(page)).toContainText("A historical decision");
  await expect(comments(page)).toContainText(/Bob.*\(inactive\)/);
  await expect(activity(page)).toContainText(/Bob.*\(inactive\)/);
  await expect(comments(page).getByRole("button", { name: "Edit comment", exact: true })).toHaveCount(0);
});

test("discussion edits, replies, resolve and reopen converge automatically and show attributed issue activity", async ({
  browser,
  app,
}, testInfo) => {
  const firstContext = await browser.newContext(),
    secondContext = await browser.newContext();
  const first = await firstContext.newPage(),
    second = await secondContext.newPage();
  try {
    await Promise.all([open(first, app), open(second, app)]);
    await first.getByRole("textbox", { name: "Add a comment", exact: true }).fill("Please review the launch decision.");
    await first.getByRole("button", { name: "Post comment", exact: true }).click();
    await expect(comments(second)).toContainText("Please review the launch decision.");
    await first.getByRole("button", { name: "Reply", exact: true }).click();
    await first.getByRole("textbox", { name: /^Reply to/ }).fill("The decision is approved.");
    await first.getByRole("button", { name: "Post reply", exact: true }).click();
    await expect(comments(second)).toContainText("The decision is approved.");
    await first.getByRole("button", { name: "Edit comment", exact: true }).first().click();
    await first.getByRole("textbox", { name: "Edit comment", exact: true }).fill("Launch decision reviewed.");
    await first.getByRole("button", { name: "Save comment", exact: true }).click();
    await expect(comments(second)).toContainText("Launch decision reviewed.");
    await first.getByRole("button", { name: "Resolve thread", exact: true }).click();
    await expect(second.getByRole("button", { name: "Reopen thread", exact: true })).toBeVisible();
    await second.getByRole("button", { name: "Reopen thread", exact: true }).click();
    await expect(first.getByRole("button", { name: "Resolve thread", exact: true })).toBeVisible();
    await expect(activity(second)).toContainText("edited a comment");
    await expect(activity(first)).toContainText("reopened the thread");
    await expect(activity(first)).toContainText("Alice");
    await second.reload();
    await expect(comments(second)).toContainText("Launch decision reviewed.");
    await expect(comments(second)).toContainText("The decision is approved.");
    await expect(second.getByRole("button", { name: "Resolve thread", exact: true })).toBeVisible();
    await testInfo.attach("issue-discussion-desktop", {
      body: await first.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await first.setViewportSize({ width: 390, height: 844 });
    expect(await first.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await testInfo.attach("issue-discussion-narrow", {
      body: await first.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    const events = (await app.runtime.inspect()).events;
    expect(events.filter((event) => event.type === "CommentPosted")).toHaveLength(2);
    expect(events.filter((event) => event.type === "CommentEdited")).toHaveLength(1);
    expect(events.filter((event) => event.type === "CommentResolved")).toHaveLength(2);
  } finally {
    await Promise.allSettled([firstContext.close(), secondContext.close()]);
  }
});

test("a submitted offline comment survives reload, then publishes once after reconnect", async ({ page, app }) => {
  await open(page, app);
  // Keep the product assets available so the real persisted outbox can rehydrate while sync is offline.
  await page.route(syncApi, (route) => route.abort("internetdisconnected"));
  await page.getByRole("textbox", { name: "Add a comment", exact: true }).fill("Durable offline discussion");
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await expect(comments(page)).toContainText("Durable offline discussion");
  const key = "local:user-alice:main";
  await expect
    .poll(async () => (await readWorkspaceState(page, key))?.pending.filter((m) => m.name === "commentCreate").length)
    .toBe(1);
  expect((await readWorkspaceState(page, key))?.pending[0]?.args).toMatchObject({
    issueId: app.issueId,
    issueIncarnation: expect.stringMatching(/^seq:\d+$/),
  });
  await page.reload();
  await expect(comments(page)).toContainText("Durable offline discussion");
  await expect(comments(page)).toContainText("Pending");
  await page.unroute(syncApi);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect
    .poll(async () => (await app.runtime.inspect()).events.filter((event) => event.type === "CommentPosted").length)
    .toBe(1);
  await expect(comments(page).getByText("Pending", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(comments(page)).toContainText("Durable offline discussion");
  expect((await app.runtime.inspect()).events.filter((event) => event.type === "CommentPosted")).toHaveLength(1);
});

test("activity pages older facts for one issue without downloading workspace history", async ({ page, app }) => {
  const initialIssue = (await app.runtime.inspect()).issues.find((issue) => issue.id === app.issueId)!;
  const initialized = await app.runtime.fetch(
    `/sync/document?issueId=${app.issueId}&incarnation=${encodeURIComponent(issueIncarnation(initialIssue))}`,
  );
  expect(initialized.status).toBe(200);
  const mutations = Array.from({ length: 500 }, (_, index) => ({
    id: index + 1,
    name: "issueUpdate",
    ts: "2026-10-30T00:00:00.000Z",
    args: { id: app.issueId, patch: { title: `Recorded title ${index}` } },
  }));
  const response = await app.runtime.fetch("/sync/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientId: "history-page-seed", mutations }),
  });
  expect(response.status).toBe(200);
  expect((await response.json()) as PushResponse).toMatchObject({ ok: true, rejected: [] });
  const historyRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/sync/events") historyRequests.push(request.url());
  });
  await open(page, app);
  await expect(activity(page).locator("li")).toHaveCount(500);
  await page.getByRole("button", { name: "Load older activity", exact: true }).click();
  await expect(activity(page)).toContainText("created the issue");
  await expect(activity(page).locator("li")).toHaveCount(502);
  await expect(page.getByRole("button", { name: "Load older activity", exact: true })).toHaveCount(0);
  expect(historyRequests.every((url) => new URL(url).searchParams.get("issueId") === app.issueId)).toBe(true);
  expect(historyRequests.some((url) => new URL(url).searchParams.has("before"))).toBe(true);
  const historyUrl = (url: URL) => url.pathname === "/sync/events";
  await page.route(historyUrl, (route) => route.abort("internetdisconnected"));
  for (const [batch, length] of [
    [0, 500],
    [1, 1],
  ] as const) {
    const newer = await app.runtime.fetch("/sync/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId: `newer-history-${batch}`,
        mutations: Array.from({ length }, (_, index) => ({
          id: index + 1,
          name: "issueUpdate",
          ts: "2026-10-30T01:00:00.000Z",
          args: { id: app.issueId, patch: { title: `New activity ${batch * 500 + index}` } },
        })),
      }),
    });
    expect((await newer.json()) as PushResponse).toMatchObject({ ok: true, rejected: [] });
  }
  await expect(page.getByRole("heading", { name: "New activity 500", exact: true })).toBeVisible();
  await page.unroute(historyUrl);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(activity(page).locator("li")).toHaveCount(1003);
  await expect(activity(page)).toContainText("New activity 0");
  await expect(activity(page)).toContainText("New activity 500");
  expect(
    historyRequests.some((url) => {
      const query = new URL(url).searchParams;
      return Number(query.get("since")) > 0 && query.has("before");
    }),
  ).toBe(true);
});
