import { uuidv7 } from "@kanbun/model";
import { issueIncarnation, type BootstrapResponse, type PushResponse } from "@kanbun/sync";
import type { Page } from "@playwright/test";
import { test, expect, type AppHarness } from "./app.fixture";
import { readDescriptionRecord } from "./document-storage";

const control = (page: Page, name: string) => page.getByRole("combobox", { name, exact: true });
const description = (page: Page) => page.getByRole("textbox", { name: "Description", exact: true });
const descriptionStatus = (page: Page) => page.getByRole("status", { name: "Description status", exact: true });
async function openIssue(page: Page, app: AppHarness) {
  await page.goto(`${app.origin}/#issues/${app.issueId}`);
  await expect(control(page, "Status")).toBeVisible();
  await expect(description(page)).toBeEditable();
  await expect(descriptionStatus(page)).toHaveText("Saved");
}
async function push(app: AppHarness, mutations: { name: string; args: unknown }[]) {
  const response = await app.runtime.fetch("/sync/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientId: `control-fixture-${uuidv7()}`,
      mutations: mutations.map((mutation, index) => ({
        ...mutation,
        id: index + 1,
        ts: new Date().toISOString(),
      })),
    }),
  });
  expect(response.status).toBe(200);
  expect((await response.json()) as PushResponse).toMatchObject({ ok: true, rejected: [] });
}

test("issue properties and new labels persist and converge automatically in a second browser", async ({
  browser,
  app,
}, testInfo) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  try {
    await Promise.all([openIssue(first, app), openIssue(second, app)]);
    const initial = (await (
      await app.runtime.fetch("/sync/bootstrap?clientId=controls-state-reader")
    ).json()) as BootstrapResponse;
    const started = initial.rows.workflowState!.find((state) => state.type === "started")!.id as string;
    const baseline = initial.rows.issue!.find((issue) => issue.id === app.issueId)!.stateId as string;
    await control(first, "Status").selectOption(started);
    await control(first, "Priority").selectOption("2");
    await control(first, "Assignee").selectOption("user-bob");
    await first.getByRole("button", { name: "Create label", exact: true }).click();
    await first.getByRole("textbox", { name: "New label name", exact: true }).fill(" Bug ");
    await first.getByRole("button", { name: "Create and apply label", exact: true }).click();
    await expect(first.getByRole("button", { name: "Remove label Bug", exact: true })).toBeVisible();
    for (const page of [first, second]) {
      await expect(control(page, "Status")).toHaveValue(started);
      await expect(control(page, "Priority")).toHaveValue("2");
      await expect(control(page, "Assignee")).toHaveValue("user-bob");
      await expect(page.getByRole("button", { name: "Remove label Bug", exact: true })).toBeVisible();
      await expect(page.locator(".sync-indicator")).toContainText("Saved");
    }
    const viewport = first.viewportSize()!;
    await testInfo.attach("issue-properties-desktop", {
      body: await first.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await first.setViewportSize({ width: 390, height: 844 });
    expect(await first.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await testInfo.attach("issue-properties-narrow", {
      body: await first.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await first.setViewportSize(viewport);
    await second.reload();
    await expect(control(second, "Priority")).toHaveValue("2");
    await expect(control(second, "Assignee")).toHaveValue("user-bob");
    await expect(second.getByRole("button", { name: "Remove label Bug", exact: true })).toBeVisible();
    const authority = await app.runtime.inspect();
    for (const type of ["HumanAssertedStatus", "IssuePrioritized", "IssueAssigned", "LabelAdded"])
      expect(authority.events.some((event) => event.type === type && event.entity_id === app.issueId)).toBe(true);
    await first.getByRole("button", { name: "Create label", exact: true }).click();
    await first.getByRole("textbox", { name: "New label name", exact: true }).fill("bug");
    await first.getByRole("button", { name: "Create and apply label", exact: true }).click();
    await expect(first.getByRole("alert").filter({ hasText: /already exists/i })).toBeVisible();
    await first.getByRole("button", { name: "Cancel label creation", exact: true }).click();
    await first.getByRole("button", { name: "Clear status override", exact: true }).click();
    await expect(control(second, "Status")).toHaveValue(baseline);
    await control(first, "Assignee").selectOption("");
    await first.getByRole("button", { name: "Remove label Bug", exact: true }).click();
    await expect(control(second, "Assignee")).toHaveValue("");
    await expect(second.getByRole("button", { name: "Remove label Bug", exact: true })).toHaveCount(0);
  } finally {
    await Promise.allSettled([firstContext.close(), secondContext.close()]);
  }
});

test("archive Undo reopens the same description and preserves its pending local edit", async ({ browser, app }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captured!: () => void;
  const requestCaptured = new Promise<void>((resolve) => {
    captured = resolve;
  });
  try {
    await openIssue(page, app);
    await description(page).fill("Saved description before archive.");
    await expect(descriptionStatus(page)).toHaveText("Saved");
    const issue = (await app.runtime.inspect()).issues.find((candidate) => candidate.id === app.issueId)!;
    const key = JSON.stringify([
      "v2",
      "local",
      "local",
      "user",
      "user-alice",
      "main",
      issue.id,
      issueIncarnation(issue),
    ]);
    await page.route(
      (url) => url.pathname === "/sync/document",
      async (route) => {
        if (route.request().method() === "POST") {
          captured();
          await held;
        }
        await route.continue();
      },
    );
    const pending = "Saved description before archive. Pending local detail survives Undo.";
    await description(page).fill(pending);
    await requestCaptured;
    await expect.poll(async () => (await readDescriptionRecord(page, key))?.pending).toBe(true);
    await page.getByRole("button", { name: "Archive issue", exact: true }).click();
    await expect(page.getByRole("row", { name: "REC-1", exact: true })).toHaveCount(0);
    await expect(page.getByRole("status", { name: "Archive status", exact: true })).toContainText("REC-1 archived");
    await expect
      .poll(async () => (await app.runtime.inspect()).issues.find((candidate) => candidate.id === issue.id)?.archivedAt)
      .toBeTruthy();
    await page.getByRole("button", { name: "Undo archive", exact: true }).click();
    await expect(description(page)).toBeEditable();
    await expect(description(page)).toHaveValue(pending);
    release();
    await expect(descriptionStatus(page)).toHaveText("Saved");
    await expect
      .poll(
        async () => (await app.runtime.inspect()).issues.find((candidate) => candidate.id === issue.id)?.description,
      )
      .toBe(pending);
    await page.reload();
    await expect(description(page)).toHaveValue(pending);
    await expect(descriptionStatus(page)).toHaveText("Saved");
  } finally {
    release();
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await context.close();
  }
});

test("an assignee rejected by the authority rolls back and exposes the actual rejection", async ({ browser, app }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await openIssue(page, app);
    await expect(control(page, "Assignee").getByRole("option", { name: "Bob", exact: true })).toHaveCount(1);
    await app.runtime.setMemberActive("bob", false);
    await control(page, "Assignee").selectOption("user-bob");
    await expect(
      page.getByRole("alert").filter({ hasText: /assignee.*active|active.*assignee|inactive/i }),
    ).toBeVisible();
    await expect(control(page, "Assignee")).toHaveValue("");
    expect((await app.runtime.inspect()).issues.find((issue) => issue.id === app.issueId)?.assigneeId).toBeNull();
  } finally {
    await context.close();
  }
});

test("properties offer only eligible assignees and active labels from the issue's scope", async ({ browser, app }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const otherTeam = uuidv7();
    const retired = uuidv7();
    await push(app, [
      {
        name: "teamCreate",
        args: {
          id: otherTeam,
          name: "Other",
          key: "OTH",
          membershipId: uuidv7(),
          stateIds: { backlog: uuidv7(), todo: uuidv7(), inProgress: uuidv7(), done: uuidv7(), canceled: uuidv7() },
        },
      },
      { name: "issueLabelCreate", args: { id: uuidv7(), name: "Workspace label", color: "#C2321F" } },
      { name: "issueLabelCreate", args: { id: uuidv7(), teamId: app.teamId, name: "Team label", color: "#C2321F" } },
      { name: "issueLabelCreate", args: { id: retired, teamId: app.teamId, name: "Retired label", color: "#C2321F" } },
      { name: "issueLabelUpdate", args: { id: retired, patch: { retiredAt: new Date().toISOString() } } },
      {
        name: "issueLabelCreate",
        args: {
          id: uuidv7(),
          teamId: app.teamId,
          name: "Group label",
          color: "#C2321F",
          isGroup: true,
          groupType: "multi",
        },
      },
      {
        name: "issueLabelCreate",
        args: { id: uuidv7(), teamId: otherTeam, name: "Other team label", color: "#C2321F" },
      },
    ]);
    await app.runtime.setTeamPrivate(app.teamId);
    await openIssue(page, app);
    await expect(control(page, "Assignee").getByRole("option", { name: "Bob", exact: true })).toHaveCount(0);
    await expect(control(page, "Assignee").getByRole("option", { name: "Alice", exact: true })).toHaveCount(1);
    const labelPicker = page.getByRole("button", { name: "+ Add label", exact: true });
    await labelPicker.click();
    for (const name of ["Workspace label", "Team label"])
      await expect(control(page, "Add label").getByRole("option", { name, exact: true })).toHaveCount(1);
    await page.getByRole("searchbox", { name: "Search labels" }).fill("Workspace");
    await expect(control(page, "Add label").getByRole("option", { name: "Team label", exact: true })).toHaveCount(0);
    await page.getByRole("searchbox", { name: "Search labels" }).clear();
    for (const name of ["Retired label", "Group label", "Other team label"])
      await expect(control(page, "Add label").getByRole("option", { name, exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("searchbox", { name: "Search labels" })).toHaveCount(0);
    await expect(labelPicker).toBeFocused();
    await expect(control(page, "Status").getByRole("option")).toHaveCount(5);
  } finally {
    await context.close();
  }
});
