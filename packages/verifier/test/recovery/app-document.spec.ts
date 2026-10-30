import type { Page } from "@playwright/test";
import { uuidv7 } from "@kanbun/model";
import { issueIncarnation, type PushResponse } from "@kanbun/sync";
import { test, expect, syncApi } from "./app.fixture";
import { readDescriptionRecord } from "./document-storage";

const description = (page: Page) => page.getByRole("textbox", { name: "Description", exact: true });
const descriptionStatus = (page: Page) => page.getByRole("status", { name: "Description status", exact: true });

async function openDescription(page: Page, origin: string, issueId: string) {
  await page.goto(`${origin}/#issues/${issueId}`);
  await expect(description(page)).toBeVisible();
  await expect(description(page)).toBeEditable();
  await expect(descriptionStatus(page)).toContainText("Saved");
}

test("an issue description has a shareable detail URL and survives reload with its authoritative mirror", async ({
  browser,
  app,
}, testInfo) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(app.origin);
    const issueLink = page.getByRole("row", { name: "REC-1", exact: true }).getByRole("link");
    await expect(issueLink).toHaveAttribute("href", `#issues/${app.issueId}`);
    await issueLink.click();
    await expect(page).toHaveURL(`${app.origin}/#issues/${app.issueId}`);
    await expect(descriptionStatus(page)).toContainText("Saved");
    const text = "A clear problem statement.\n\nKeep collaborative edits after a reload. 日本語も保存。";
    await description(page).fill(text);
    await expect(descriptionStatus(page)).toContainText("Saved");
    await expect
      .poll(async () => (await app.runtime.inspect()).issues.find((issue) => issue.id === app.issueId)?.description)
      .toBe(text);
    const beforeReload = await app.runtime.inspect();
    const incarnation = issueIncarnation(beforeReload.issues.find((issue) => issue.id === app.issueId)!);
    const snapshot = await app.runtime.fetch(
      `/sync/document?issueId=${app.issueId}&incarnation=${encodeURIComponent(incarnation)}`,
    );
    expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toMatchObject({
      mirror: text,
      contentState: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(
      beforeReload.events.some((event) => event.type === "IssueDescribed" && event.entity_id === app.issueId),
    ).toBe(true);
    await page.reload();
    await expect(description(page)).toHaveValue(text);
    await expect(descriptionStatus(page)).toContainText("Saved");
    const afterReload = await app.runtime.inspect();
    expect(afterReload.events).toEqual(beforeReload.events);
    expect(errors).toEqual([]);
    const screenshot = testInfo.outputPath("issue-description.png");
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach("issue-description", { path: screenshot, contentType: "image/png" });
  } finally {
    await context.close();
  }
});

test("concurrent description updates converge in two browsers without refresh or focus", async ({ browser, app }) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  const errors: string[] = [];
  alice.on("pageerror", (error) => errors.push(error.message));
  bob.on("pageerror", (error) => errors.push(error.message));
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let alicePosted!: () => void;
  let bobPosted!: () => void;
  const alicePost = new Promise<void>((resolve) => {
    alicePosted = resolve;
  });
  const bobPost = new Promise<void>((resolve) => {
    bobPosted = resolve;
  });
  try {
    await Promise.all([openDescription(alice, app.origin, app.issueId), openDescription(bob, app.origin, app.issueId)]);
    await alice.route("**/sync/document", async (route) => {
      if (route.request().method() === "POST") {
        alicePosted();
        await held;
      }
      await route.continue();
    });
    await bob.route("**/sync/document", async (route) => {
      if (route.request().method() === "POST") {
        bobPosted();
        await held;
      }
      await route.continue();
    });
    await Promise.all([
      description(alice).fill("Alice records the expected behavior. "),
      description(bob).fill("Bob records the recovery requirement. "),
    ]);
    await Promise.all([alicePost, bobPost]);
    await expect(descriptionStatus(alice)).not.toHaveText("Saved");
    await expect(descriptionStatus(bob)).not.toHaveText("Saved");
    release();
    for (const page of [alice, bob]) {
      await expect(description(page)).toHaveValue(/Alice records the expected behavior\./);
      await expect(description(page)).toHaveValue(/Bob records the recovery requirement\./);
      await expect(descriptionStatus(page)).toContainText("Saved");
    }
    const combined = await description(alice).inputValue();
    await expect(description(bob)).toHaveValue(combined);
    const authority = await app.runtime.inspect();
    expect(authority.issues.find((issue) => issue.id === app.issueId)?.description).toBe(combined);
    expect(errors).toEqual([]);
  } finally {
    release();
    await Promise.allSettled([
      alice.unrouteAll({ behavior: "ignoreErrors" }),
      bob.unrouteAll({ behavior: "ignoreErrors" }),
    ]);
    await Promise.allSettled([aliceContext.close(), bobContext.close()]);
  }
});

test("both browsers retain offline description edits and converge after one reloads before reconnecting", async ({
  browser,
  app,
}) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  const errors: string[] = [];
  alice.on("pageerror", (error) => errors.push(error.message));
  bob.on("pageerror", (error) => errors.push(error.message));
  try {
    await openDescription(alice, app.origin, app.issueId);
    await description(alice).fill("Shared context. ");
    await expect(descriptionStatus(alice)).toContainText("Saved");
    await openDescription(bob, app.origin, app.issueId);
    await expect(description(bob)).toHaveValue("Shared context. ");
    await Promise.all([
      aliceContext.route(syncApi, (route) => route.abort("internetdisconnected")),
      bobContext.route(syncApi, (route) => route.abort("internetdisconnected")),
    ]);
    await Promise.all([
      description(alice).fill("Shared context. Alice worked offline. "),
      description(bob).fill("Shared context. Bob worked offline. "),
    ]);
    await expect(descriptionStatus(alice)).toContainText(/waiting for connection/i);
    await expect(descriptionStatus(bob)).toContainText(/waiting for connection/i);
    const original = (await app.runtime.inspect()).issues.find((issue) => issue.id === app.issueId)!;
    const key = JSON.stringify([
      "v2",
      "local",
      "local",
      "user",
      "user-alice",
      "main",
      app.issueId,
      issueIncarnation(original),
    ]);
    await expect.poll(async () => (await readDescriptionRecord(alice, key))?.pending).toBe(true);
    await expect.poll(async () => (await readDescriptionRecord(bob, key))?.pending).toBe(true);
    expect((await app.runtime.inspect()).issues.find((issue) => issue.id === app.issueId)?.description).toBe(
      "Shared context. ",
    );
    await aliceContext.route("**/api/context", (route) => route.abort("internetdisconnected"));
    await alice.reload();
    await expect(description(alice)).toHaveValue("Shared context. Alice worked offline. ");
    await expect(descriptionStatus(alice)).toContainText(/waiting for connection/i);
    await Promise.all([
      aliceContext.unroute(syncApi),
      aliceContext.unroute("**/api/context"),
      bobContext.unroute(syncApi),
    ]);
    // The explicit refresh is the offline recovery action; convergence after it is automatic.
    await Promise.all([
      alice.getByRole("button", { name: "Refresh", exact: true }).click(),
      bob.getByRole("button", { name: "Refresh", exact: true }).click(),
    ]);
    for (const page of [alice, bob]) {
      await expect(description(page)).toHaveValue(/Shared context\./);
      await expect(description(page)).toHaveValue(/Alice worked offline\./);
      await expect(description(page)).toHaveValue(/Bob worked offline\./);
      await expect(descriptionStatus(page)).toContainText("Saved");
    }
    const combined = await description(alice).inputValue();
    await expect(description(bob)).toHaveValue(combined);
    const authority = await app.runtime.inspect();
    expect(authority.issues.find((issue) => issue.id === app.issueId)?.description).toBe(combined);
    await alice.reload();
    await expect(description(alice)).toHaveValue(combined);
    await expect(descriptionStatus(alice)).toContainText("Saved");
    expect((await app.runtime.inspect()).events).toEqual(authority.events);
    expect(errors).toEqual([]);
  } finally {
    await Promise.allSettled([aliceContext.close(), bobContext.close()]);
  }
});

test("description storage failure blocks network synchronization until the saved state can be read", async ({
  browser,
  app,
}) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const fault = window as unknown as { blockDescriptionStorage: boolean };
    fault.blockDescriptionStorage = true;
    const open = indexedDB.open.bind(indexedDB);
    Object.defineProperty(indexedDB, "open", {
      value(name: string, version?: number) {
        if (name === "kanbun-documents" && fault.blockDescriptionStorage)
          throw new DOMException("Description storage is unavailable", "SecurityError");
        return version === undefined ? open(name) : open(name, version);
      },
    });
  });
  const page = await context.newPage();
  const documentRequests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/sync/document") documentRequests.push(request.method());
  });
  try {
    await page.goto(`${app.origin}/#issues/${app.issueId}`);
    await expect(page.getByRole("alert")).toContainText("Description storage is unavailable");
    await expect(description(page)).toBeDisabled();
    await expect(descriptionStatus(page)).not.toHaveText("Saved");
    expect(documentRequests).toEqual([]);
    expect((await app.runtime.inspect()).events.some((event) => event.type === "IssueDescribed")).toBe(false);
    await page.evaluate(() => {
      (window as unknown as { blockDescriptionStorage: boolean }).blockDescriptionStorage = false;
    });
    await page.getByRole("button", { name: "Retry description sync", exact: true }).click();
    await expect(description(page)).toBeEditable();
    await expect(descriptionStatus(page)).toContainText("Saved");
    expect(documentRequests).toContain("GET");
    await description(page).fill("Editing starts only after local storage is readable.");
    await expect(descriptionStatus(page)).toContainText("Saved");
    await expect
      .poll(async () => (await app.runtime.inspect()).issues.find((issue) => issue.id === app.issueId)?.description)
      .toBe("Editing starts only after local storage is readable.");
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("recreating an issue UUID never reopens or submits the previous issue's cached description draft", async ({
  browser,
  app,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let release!: () => void;
  const holdRequest = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captured!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    captured = resolve;
  });
  let staleStatus: number | null = null;
  try {
    await openDescription(page, app.origin, app.issueId);
    await description(page).fill("The deleted issue's description must stay separate.");
    await expect(descriptionStatus(page)).toContainText("Saved");
    const original = (await app.runtime.inspect()).issues.find((issue) => issue.id === app.issueId)!;
    const oldIncarnation = issueIncarnation(original);
    const oldKey = JSON.stringify(["v2", "local", "local", "user", "user-alice", "main", app.issueId, oldIncarnation]);
    await page.route("**/sync/document", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      captured();
      await holdRequest;
      const response = await route.fetch();
      staleStatus = response.status();
      await route.fulfill({ response });
    });
    await description(page).fill("An unsent draft still belongs to the deleted issue.");
    await requestStarted;
    await expect.poll(async () => (await readDescriptionRecord(page, oldKey))?.pending).toBe(true);
    const oldDraft = await readDescriptionRecord(page, oldKey);
    const replacement = await app.runtime.fetch("/sync/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId: "description-recreated-issue",
        mutations: [
          { id: 1, name: "issueTrash", args: { id: app.issueId, trashed: true }, ts: new Date().toISOString() },
          { id: 2, name: "issueDelete", args: { id: app.issueId }, ts: new Date().toISOString() },
          {
            id: 3,
            name: "issueCreate",
            args: {
              id: app.issueId,
              teamId: app.teamId,
              title: "Replacement issue with the same UUID",
              subscriptionId: uuidv7(),
            },
            ts: new Date().toISOString(),
          },
        ],
      }),
    });
    expect(replacement.status).toBe(200);
    expect((await replacement.json()) as PushResponse).toMatchObject({ ok: true, rejected: [] });
    await expect(
      page.getByRole("heading", { name: "Replacement issue with the same UUID", exact: true }),
    ).toBeVisible();
    await expect(description(page)).toHaveValue("");
    await expect(descriptionStatus(page)).toContainText("Saved");
    expect(await readDescriptionRecord(page, oldKey)).toEqual(oldDraft);
    release();
    await expect.poll(() => staleStatus).toBe(409);
    await expect(description(page)).toHaveValue("");
    const fresh = (await app.runtime.inspect()).issues.find((issue) => issue.id === app.issueId)!;
    expect(issueIncarnation(fresh)).not.toBe(oldIncarnation);
    expect(fresh.description).toBe("");
    await page.reload();
    await expect(description(page)).toHaveValue("");
    await expect(descriptionStatus(page)).toContainText("Saved");
    expect(await readDescriptionRecord(page, oldKey)).toEqual(oldDraft);
    expect(errors).toEqual([]);
  } finally {
    release();
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await context.close();
  }
});
