import { uuidv7 } from "@kanbun/model";
import type { BootstrapResponse, PushResponse } from "@kanbun/sync";
import type { Page } from "@playwright/test";
import { test, expect, type AppHarness } from "./app.fixture";

const filter = (page: Page, name: string) => page.getByRole("combobox", { name, exact: true });
async function seedViews(app: AppHarness) {
  const initial = (await (
    await app.runtime.fetch("/sync/bootstrap?clientId=views-state-reader")
  ).json()) as BootstrapResponse;
  const started = initial.rows.workflowState!.find((state) => state.type === "started")!.id as string;
  const completed = initial.rows.workflowState!.find((state) => state.type === "completed")!.id as string;
  const labelId = uuidv7();
  const mutations = [
    { name: "issueLabelCreate", args: { id: labelId, teamId: app.teamId, name: "Bug", color: "#C2321F" } },
    {
      name: "issueUpdate",
      args: {
        id: app.issueId,
        patch: { title: "Zebra bootstrap", stateId: started, priority: 2, assigneeId: "user-alice" },
      },
    },
    { name: "issueLabelsSet", args: { issueId: app.issueId, add: [{ labelId, linkId: uuidv7() }], remove: [] } },
    {
      name: "issueCreate",
      args: {
        id: uuidv7(),
        teamId: app.teamId,
        title: "Alpha API",
        description: "日本語 recovery details",
        stateId: completed,
        priority: 1,
        assigneeId: "user-bob",
        subscriptionId: uuidv7(),
      },
    },
    {
      name: "issueCreate",
      args: { id: uuidv7(), teamId: app.teamId, title: "Middle backlog", priority: 0, subscriptionId: uuidv7() },
    },
  ];
  const response = await app.runtime.fetch("/sync/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientId: "view-fixture",
      mutations: mutations.map((mutation, index) => ({ ...mutation, id: index + 1, ts: new Date().toISOString() })),
    }),
  });
  expect((await response.json()) as PushResponse).toMatchObject({ ok: true, rejected: [] });
  return { started, completed, labelId };
}
const names = (page: Page) =>
  page.locator("tbody tr").evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label")));

test("combined filters and My Issues retain their state across details, and creation assigns work to the current person", async ({
  browser,
  app,
}) => {
  const seeded = await seedViews(app);
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(app.origin);
    await expect(page.getByRole("row", { name: "REC-3", exact: true })).toBeVisible();
    await page.getByRole("searchbox", { name: "Search issues", exact: true }).fill("REC-1 bootstrap");
    await filter(page, "Filter by status").selectOption(seeded.started);
    await filter(page, "Filter by assignee").selectOption("user-alice");
    await filter(page, "Filter by priority").selectOption("2");
    await filter(page, "Filter by label").selectOption(seeded.labelId);
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.getByRole("row", { name: "REC-1", exact: true })).toContainText("High");
    await expect(page.getByRole("row", { name: "REC-1", exact: true })).toContainText("Alice");
    await page.getByRole("link", { name: "Open REC-1", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Description", exact: true })).toBeEditable();
    await page.locator(".back-to-issues").click();
    await expect(page.getByRole("searchbox", { name: "Search issues", exact: true })).toHaveValue("REC-1 bootstrap");
    await expect(filter(page, "Filter by label")).toHaveValue(seeded.labelId);
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.getByRole("link", { name: /^My Issues(?: \d+)?$/ }).click();
    await expect(page.getByRole("heading", { name: "My Issues", exact: true })).toBeVisible();
    await expect(filter(page, "Filter by assignee")).toBeDisabled();
    await expect(page.getByRole("searchbox", { name: "Search issues", exact: true })).toHaveValue("");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.getByRole("searchbox", { name: "Search issues", exact: true }).fill("Zebra");
    await page.getByRole("link", { name: "Open REC-1", exact: true }).click();
    await page.locator(".back-to-issues").click();
    await expect(page.getByRole("heading", { name: "My Issues", exact: true })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Search issues", exact: true })).toHaveValue("Zebra");
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await page.getByRole("textbox", { name: "Issue title", exact: true }).fill("Owned from My Issues");
    await page.getByRole("button", { name: "Create issue", exact: true }).click();
    await expect(page.getByRole("row", { name: "REC-4", exact: true })).toContainText("Owned from My Issues");
    await expect(page.locator(".sync-indicator")).toContainText("Saved");
    expect((await app.runtime.inspect()).issues.find((issue) => issue.number === 4)?.assigneeId).toBe("user-alice");
    await page.getByRole("link", { name: /^All issues(?: \d+)?$/ }).click();
    await expect(page.getByRole("searchbox", { name: "Search issues", exact: true })).toHaveValue("REC-1 bootstrap");
    await expect(filter(page, "Filter by label")).toHaveValue(seeded.labelId);
    // Remote changes must update membership in an active filtered view without a manual refresh.
    const changed = await app.runtime.fetch("/sync/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId: "view-remote-editor",
        mutations: [
          {
            id: 1,
            name: "issueUpdate",
            ts: new Date().toISOString(),
            args: { id: app.issueId, patch: { priority: 4 } },
          },
        ],
      }),
    });
    expect((await changed.json()) as PushResponse).toMatchObject({ ok: true, rejected: [] });
    await expect(page.getByRole("heading", { name: "No matching issues", exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("list sorting, unassigned/status/description filtering and clear feedback work on desktop and narrow layouts", async ({
  browser,
  app,
}, testInfo) => {
  const seeded = await seedViews(app);
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(app.origin);
    await expect(page.locator("tbody tr")).toHaveCount(3);
    await filter(page, "Sort issues").selectOption("priority");
    expect(await names(page)).toEqual(["REC-2", "REC-1", "REC-3"]);
    await filter(page, "Sort issues").selectOption("title");
    expect(await names(page)).toEqual(["REC-2", "REC-3", "REC-1"]);
    await filter(page, "Filter by assignee").selectOption("unassigned");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    expect(await names(page)).toEqual(["REC-3"]);
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await filter(page, "Filter by status").selectOption(seeded.completed);
    await expect(page.locator("tbody tr")).toHaveCount(1);
    expect(await names(page)).toEqual(["REC-2"]);
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search issues", exact: true }).fill("日本語 recovery");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    expect(await names(page)).toEqual(["REC-2"]);
    await page.getByRole("searchbox", { name: "Search issues", exact: true }).fill("no matching content");
    await expect(page.getByRole("heading", { name: "No matching issues", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(3);
    await testInfo.attach("issue-views-desktop", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await testInfo.attach("issue-views-narrow", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  } finally {
    await context.close();
  }
});
