import { uuidv7 } from "@kanbun/model";
import type { PushResponse } from "@kanbun/sync";
import { test, expect, readWorkspaceState } from "./app.fixture";

const region = (page: import("@playwright/test").Page) =>
  page.getByRole("region", { name: "Issue relationships", exact: true });

test("sub-issues and inverse dependencies converge in another browser and reject cycles", async ({
  browser,
  app,
}, testInfo) => {
  const firstContext = await browser.newContext(),
    secondContext = await browser.newContext();
  const first = await firstContext.newPage(),
    second = await secondContext.newPage();
  try {
    for (const page of [first, second]) {
      await page.goto(`${app.origin}/#issues/${app.issueId}`);
      await expect(page.locator(".sync-indicator")).toContainText("Saved");
    }
    await region(first).getByRole("textbox", { name: "New sub-issue title", exact: true }).fill("Release checklist");
    await region(first).getByRole("button", { name: "Create sub-issue", exact: true }).click();
    const childLink = region(first).getByRole("link", { name: /Release checklist/ });
    await expect(childLink).toHaveCount(1);
    await expect(region(second).getByRole("link", { name: /Release checklist/ })).toHaveCount(1);
    const child = (await app.runtime.inspect()).issues.find((row) => row.title === "Release checklist")!;
    await region(first).getByRole("combobox", { name: "Link issue", exact: true }).selectOption(child.id);
    await region(first).getByRole("button", { name: "Add relationship", exact: true }).click();
    await expect(region(second)).toContainText("Blocks");
    await first.goto(`${app.origin}/#issues/${child.id}`);
    await expect(region(first).getByRole("combobox", { name: "Parent issue", exact: true })).toHaveValue(app.issueId);
    await expect(region(first)).toContainText("Blocked by");
    await region(first).getByRole("combobox", { name: "Link issue", exact: true }).selectOption(app.issueId);
    await region(first).getByRole("button", { name: "Add relationship", exact: true }).click();
    await expect(region(first).getByRole("alert")).toContainText("cycle");
    await region(first)
      .getByRole("button", { name: /^Remove blocked by/ })
      .click();
    await expect(region(second)).toContainText("No linked issues yet.");
    await region(first).getByRole("combobox", { name: "Parent issue", exact: true }).selectOption("");
    await expect(region(second)).toContainText("No sub-issues yet.");
    await first.reload();
    await expect(region(first).getByRole("combobox", { name: "Parent issue", exact: true })).toHaveValue("");
    await expect(region(first)).toContainText("No linked issues yet.");
    await testInfo.attach("issue-relationships", {
      body: await second.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await second.setViewportSize({ width: 390, height: 844 });
    expect(await second.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await Promise.allSettled([firstContext.close(), secondContext.close()]);
  }
});

test("parent and related-issue edits survive offline reload and publish once after reconnect", async ({
  page,
  app,
}) => {
  const target = uuidv7();
  const result = await app.runtime.fetch("/sync/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientId: "relationships-browser-seed",
      mutations: [
        {
          id: 1,
          name: "issueCreate",
          args: { id: target, teamId: app.teamId, title: "Parent planning task", subscriptionId: uuidv7() },
          ts: new Date().toISOString(),
        },
      ],
    }),
  });
  expect((await result.json()) as PushResponse).toMatchObject({ ok: true, rejected: [] });
  await page.goto(`${app.origin}/#issues/${app.issueId}`);
  await expect(page.locator(".sync-indicator")).toContainText("Saved");
  await page.route("**/sync/push", (route) => route.abort("internetdisconnected"));
  await region(page).getByRole("combobox", { name: "Parent issue", exact: true }).selectOption(target);
  await region(page).getByRole("combobox", { name: "Relationship", exact: true }).selectOption("related");
  await region(page).getByRole("combobox", { name: "Link issue", exact: true }).selectOption(target);
  await region(page).getByRole("button", { name: "Add relationship", exact: true }).click();
  const key = "local:user-alice:main";
  await expect.poll(async () => (await readWorkspaceState(page, key))?.pending.length).toBe(2);
  await page.reload();
  await expect(region(page).getByRole("combobox", { name: "Parent issue", exact: true })).toHaveValue(target);
  await expect(region(page)).toContainText("Related to");
  await page.unroute("**/sync/push");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(async () => (await readWorkspaceState(page, key))?.pending.length).toBe(0);
  await page.reload();
  await expect(region(page).getByRole("combobox", { name: "Parent issue", exact: true })).toHaveValue(target);
  await expect(region(page)).toContainText("Related to");
  const final = await app.runtime.inspect();
  expect(final.events.filter((event) => event.type === "IssueParentChanged")).toHaveLength(1);
  expect(final.events.filter((event) => event.type === "IssueRelationAdded")).toHaveLength(1);
});
