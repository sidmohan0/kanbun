import { uuidv7 } from "@kanbun/model";
import type { BootstrapResponse, PushResponse } from "@kanbun/sync";
import type { Page } from "@playwright/test";
import { test, expect, readWorkspaceState, syncApi, type AppHarness } from "./app.fixture";

async function push(app: AppHarness, mutations: { name: string; args: unknown }[]) {
  const response = await app.runtime.fetch("/sync/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientId: `board-fixture-${uuidv7()}`,
      mutations: mutations.map((mutation, index) => ({ ...mutation, id: index + 1, ts: new Date().toISOString() })),
    }),
  });
  expect((await response.json()) as PushResponse).toMatchObject({ ok: true, rejected: [] });
}
async function states(app: AppHarness) {
  const initial = (await (
    await app.runtime.fetch("/sync/bootstrap?clientId=board-state-reader")
  ).json()) as BootstrapResponse;
  return {
    backlog: initial.rows.workflowState!.find((state) => state.type === "backlog")!.id as string,
    started: initial.rows.workflowState!.find((state) => state.type === "started")!.id as string,
    completed: initial.rows.workflowState!.find((state) => state.type === "completed")!.id as string,
  };
}
async function openBoard(page: Page, app: AppHarness) {
  await page.goto(app.origin);
  await expect(page.getByRole("link", { name: "Open REC-1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await expect(page.getByRole("region", { name: "Issue board", exact: true })).toBeVisible();
}
const card = (page: Page, name = "REC-1") => page.getByRole("listitem", { name, exact: true });
const column = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

test("board and list share filters and sorting while each personal view retains its own layout", async ({
  page,
  app,
}, testInfo) => {
  const seeded = await states(app);
  await push(app, [
    { name: "issueUpdate", args: { id: app.issueId, patch: { title: "Zebra task", assigneeId: "user-alice" } } },
    {
      name: "issueCreate",
      args: {
        id: uuidv7(),
        teamId: app.teamId,
        title: "Alpha task",
        stateId: seeded.backlog,
        assigneeId: "user-alice",
        subscriptionId: uuidv7(),
      },
    },
    {
      name: "issueCreate",
      args: {
        id: uuidv7(),
        teamId: app.teamId,
        title: "Bob task",
        stateId: seeded.completed,
        assigneeId: "user-bob",
        subscriptionId: uuidv7(),
      },
    },
  ]);
  await openBoard(page, app);
  await expect(page.locator(".board-card")).toHaveCount(3);
  await page.getByRole("combobox", { name: "Sort issues", exact: true }).selectOption("title");
  expect(await column(page, "REC: Backlog").locator(".board-card").allTextContents()).toEqual([
    expect.stringContaining("Alpha task"),
    expect.stringContaining("Zebra task"),
  ]);
  await page.getByRole("combobox", { name: "Filter by assignee", exact: true }).selectOption("user-alice");
  await expect(page.locator(".board-card")).toHaveCount(2);
  await page.getByRole("searchbox", { name: "Search issues", exact: true }).fill("Zebra");
  await expect(page.locator(".board-card")).toHaveCount(1);
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page.getByRole("link", { name: "Open REC-1", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Description", exact: true })).toBeEditable();
  await page.locator(".back-to-issues").click();
  await expect(page.getByRole("button", { name: "Board", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("searchbox", { name: "Search issues", exact: true })).toHaveValue("Zebra");
  await page.getByRole("link", { name: /^My Issues(?: \d+)?$/ }).click();
  await expect(page.getByRole("button", { name: "List", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await expect(page.locator(".board-card")).toHaveCount(2);
  await expect(card(page, "REC-3")).toHaveCount(0);
  await page.getByRole("link", { name: /^All issues(?: \d+)?$/ }).click();
  await expect(page.locator(".board-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await testInfo.attach("issue-board-desktop", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await testInfo.attach("issue-board-narrow", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

test("dragging and keyboard status changes converge between browsers and survive reload", async ({ browser, app }) => {
  const seeded = await states(app);
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  try {
    await Promise.all([openBoard(first, app), openBoard(second, app)]);
    await card(first).dragTo(column(first, "REC: In Progress"));
    await expect(
      column(second, "REC: In Progress").getByRole("listitem", { name: "REC-1", exact: true }),
    ).toBeVisible();
    const status = second.getByRole("combobox", { name: "Status for REC-1", exact: true });
    await status.focus();
    await status.press("ArrowDown");
    await expect(status).toBeFocused();
    await expect(column(first, "REC: Done").getByRole("listitem", { name: "REC-1", exact: true })).toBeVisible();
    await expect(first.locator(".sync-indicator")).toContainText("Saved");
    expect((await app.runtime.inspect()).issues.find((issue) => issue.id === app.issueId)?.stateId).toBe(
      seeded.completed,
    );
    await first.reload();
    await first.getByRole("button", { name: "Board", exact: true }).click();
    await expect(column(first, "REC: Done").getByRole("listitem", { name: "REC-1", exact: true })).toBeVisible();
  } finally {
    await Promise.allSettled([firstContext.close(), secondContext.close()]);
  }
});

test("a board status change survives an offline reload and commits once after reconnect", async ({ page, app }) => {
  const seeded = await states(app);
  await openBoard(page, app);
  await expect(page.locator(".sync-indicator")).toContainText("Saved");
  await page.route(syncApi, (route) => route.abort("internetdisconnected"));
  try {
    await page.getByRole("combobox", { name: "Status for REC-1", exact: true }).selectOption(seeded.started);
    await expect(column(page, "REC: In Progress").getByRole("listitem", { name: "REC-1", exact: true })).toContainText(
      "Pending",
    );
    const key = "local:user-alice:main";
    await expect.poll(async () => (await readWorkspaceState(page, key))?.pending.length).toBe(1);
    await page.reload();
    await page.getByRole("button", { name: "Board", exact: true }).click();
    await expect(column(page, "REC: In Progress").getByRole("listitem", { name: "REC-1", exact: true })).toContainText(
      "Pending",
    );
    await page.unroute(syncApi);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(async () => (await readWorkspaceState(page, key))?.pending.length).toBe(0);
    await expect(card(page)).not.toContainText("Pending");
    const authority = await app.runtime.inspect();
    expect(authority.issues.find((issue) => issue.id === app.issueId)?.stateId).toBe(seeded.started);
    expect(
      authority.events.filter((event) => event.type === "HumanAssertedStatus" && event.entity_id === app.issueId),
    ).toHaveLength(1);
  } finally {
    await page.unroute(syncApi);
  }
});

test("boards keep similarly named workflow states isolated between teams", async ({ page, app }) => {
  const otherTeam = uuidv7();
  await push(app, [
    {
      name: "teamCreate",
      args: {
        id: otherTeam,
        name: "Operations",
        key: "OPS",
        stateIds: { backlog: uuidv7(), todo: uuidv7(), inProgress: uuidv7(), done: uuidv7(), canceled: uuidv7() },
        membershipId: uuidv7(),
      },
    },
    {
      name: "issueCreate",
      args: { id: uuidv7(), teamId: otherTeam, title: "An operations task", subscriptionId: uuidv7() },
    },
  ]);
  await openBoard(page, app);
  await expect(column(page, "OPS: Backlog").getByRole("listitem", { name: "OPS-1", exact: true })).toBeVisible();
  await card(page).dragTo(column(page, "OPS: Done"));
  await expect(column(page, "REC: Backlog").getByRole("listitem", { name: "REC-1", exact: true })).toBeVisible();
  expect((await app.runtime.inspect()).issues.find((issue) => issue.id === app.issueId)?.teamId).toBe(app.teamId);
});
