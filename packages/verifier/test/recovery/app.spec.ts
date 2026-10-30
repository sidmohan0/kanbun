import { uuidv7 } from "@kanbun/model";
import type { Mutation, PushRequest, PushResponse } from "@kanbun/sync";
import type { Page } from "@playwright/test";
import { test, expect, syncApi } from "./app.fixture";

async function openApp(page: Page, origin: string) {
  await page.goto(origin);
  await expect(page.getByRole("heading", { name: "Issues", exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: "REC-1", exact: true })).toContainText("Shared issue");
  await expect(page.getByRole("status")).toContainText("Saved");
}

async function rename(page: Page, identifier: string, title: string) {
  await page.getByRole("button", { name: `Edit title for ${identifier}`, exact: true }).click();
  await page.getByRole("textbox", { name: `Title for ${identifier}`, exact: true }).fill(title);
  await page.getByRole("button", { name: "Save title", exact: true }).click();
}

async function storedOutbox(page: Page): Promise<Mutation[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("kanbun");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Mutation[]>((resolve, reject) => {
        const request = db.transaction("state", "readonly").objectStore("state").get("local:user-alice:main");
        request.onsuccess = () => {
          const state = request.result as { pending?: Mutation[] } | undefined;
          resolve(state?.pending ?? []);
        };
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
}

async function expectStoredTitle(page: Page, title: string) {
  await expect
    .poll(async () =>
      (await storedOutbox(page)).some((mutation) => {
        const args = mutation.args as { patch?: { title?: string } };
        return args.patch?.title === title;
      }),
    )
    .toBe(true);
}

test("the issue UI creates and renames an issue, then a separate browser session refreshes to the same state", async ({
  browser,
  app,
}, testInfo) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const errors: string[] = [];
  try {
    const first = await firstContext.newPage();
    const second = await secondContext.newPage();
    first.on("pageerror", (error) => errors.push(error.message));
    second.on("pageerror", (error) => errors.push(error.message));
    await Promise.all([openApp(first, app.origin), openApp(second, app.origin)]);

    await first.getByRole("textbox", { name: "Issue title", exact: true }).fill("Created through the issue form");
    await first.getByRole("button", { name: "Create issue", exact: true }).click();
    await expect(first.getByRole("row", { name: "REC-2", exact: true })).toContainText(
      "Created through the issue form",
    );
    await expect(first.getByRole("status")).toContainText("Saved");
    await rename(first, "REC-2", "Renamed through the issue row");
    await expect(first.getByRole("row", { name: "REC-2", exact: true })).toContainText("Renamed through the issue row");
    await expect(first.getByRole("status")).toContainText("Saved");

    await second.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(second.getByRole("row", { name: "REC-2", exact: true })).toContainText(
      "Renamed through the issue row",
    );
    await expect(second.getByRole("status")).toContainText("Saved");
    const prioritized = await app.runtime.fetch("/sync/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId: "product-ui-top-insertion",
        mutations: [
          {
            id: 1,
            name: "issueCreate",
            args: {
              id: uuidv7(),
              teamId: app.teamId,
              title: "Prioritized above the existing work",
              subscriptionId: uuidv7(),
              position: "top",
            },
            ts: new Date().toISOString(),
          },
        ],
      }),
    });
    expect(prioritized.status).toBe(200);
    expect((await prioritized.json()) as PushResponse).toMatchObject({ ok: true, rejected: [] });
    await first.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(first.locator("tbody tr").first()).toHaveAccessibleName("REC-3");
    await expect(first.locator("tbody tr").first()).toContainText("Prioritized above the existing work");
    const authority = await app.runtime.inspect();
    const created = authority.issues.find((issue) => issue.title === "Renamed through the issue row");
    expect(created).toMatchObject({ teamId: app.teamId, number: 2 });
    expect(
      authority.events.filter((event) => event.type === "IssueCreated" && event.entity_id === created?.id),
    ).toHaveLength(1);
    expect(
      authority.events.filter((event) => event.type === "IssueTitled" && event.entity_id === created?.id),
    ).toHaveLength(1);
    expect(errors).toEqual([]);

    for (const [name, colorScheme, width, height] of [
      ["light", "light", 1440, 1000],
      ["dark", "dark", 1440, 1000],
      ["mobile", "light", 390, 844],
    ] as const) {
      await first.emulateMedia({ colorScheme });
      await first.setViewportSize({ width, height });
      const screenshot = `/tmp/kanbun-app-${name}.png`;
      await first.screenshot({ path: screenshot, fullPage: true });
      await testInfo.attach(`product-ui-${name}`, { path: screenshot, contentType: "image/png" });
    }
  } finally {
    await Promise.allSettled([firstContext.close(), secondContext.close()]);
  }
});

test("an offline title entered in the issue UI survives reload and is committed once after reconnecting", async ({
  browser,
  app,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await openApp(page, app.origin);
    await context.route(syncApi, (route) => route.abort("internetdisconnected"));
    await rename(page, "REC-1", "A title saved while offline");
    await expect(page.getByRole("status")).toContainText("Offline");
    await expect(page.getByRole("row", { name: "REC-1", exact: true })).toContainText("A title saved while offline");
    expect((await app.runtime.inspect()).issues.find((issue) => issue.id === app.issueId)?.title).toBe("Shared issue");
    await expectStoredTitle(page, "A title saved while offline");

    await page.reload();
    await expect(page.getByRole("row", { name: "REC-1", exact: true })).toContainText("A title saved while offline");
    await expect(page.getByRole("status")).toContainText("Offline");
    await context.unroute(syncApi);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Saved");
    const committed = await app.runtime.inspect();
    expect(committed.issues.find((issue) => issue.id === app.issueId)?.title).toBe("A title saved while offline");
    expect(
      committed.events.filter((event) => event.type === "IssueTitled" && event.entity_id === app.issueId),
    ).toHaveLength(1);

    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.reload();
    await expect(page.getByRole("row", { name: "REC-1", exact: true })).toContainText("A title saved while offline");
    await expect(page.getByRole("status")).toContainText("Saved");
    const recovered = await app.runtime.inspect();
    expect(recovered.events).toEqual(committed.events);
    expect(recovered.log).toEqual(committed.log);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("the issue UI displays an actual authority rejection and replaces the optimistic creation with the canonical issue", async ({
  browser,
  app,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let releasePull!: () => void;
  const pausedPull = new Promise<void>((resolve) => {
    releasePull = resolve;
  });
  let pullStarted!: () => void;
  const capturedPull = new Promise<void>((resolve) => {
    pullStarted = resolve;
  });
  let releasePushNetwork!: () => void;
  const pausedPushNetwork = new Promise<void>((resolve) => {
    releasePushNetwork = resolve;
  });
  let releasePushResponse!: () => void;
  const pausedPushResponse = new Promise<void>((resolve) => {
    releasePushResponse = resolve;
  });
  let pushProcessed!: (result: PushResponse) => void;
  const processedPush = new Promise<PushResponse>((resolve) => {
    pushProcessed = resolve;
  });
  let capture!: (request: PushRequest) => void;
  const captured = new Promise<PushRequest>((resolve) => {
    capture = resolve;
  });
  try {
    await openApp(page, app.origin);
    let firstPull = true;
    await page.route("**/sync/pull?*", async (route) => {
      if (firstPull) {
        firstPull = false;
        pullStarted();
        await pausedPull;
      }
      await route.continue();
    });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await capturedPull;
    await page.route("**/sync/push", async (route) => {
      capture(route.request().postDataJSON() as PushRequest);
      await pausedPushNetwork;
      const response = await route.fetch();
      pushProcessed((await response.json()) as PushResponse);
      await pausedPushResponse;
      await route.fulfill({ response });
    });
    await page
      .getByRole("textbox", { name: "Issue title", exact: true })
      .fill("An optimistic creation that loses the race");
    await page.getByRole("button", { name: "Create issue", exact: true }).click();
    const request = await captured;
    const creation = request.mutations.find((mutation) => mutation.name === "issueCreate");
    expect(creation).toBeDefined();
    const args = creation!.args as Record<string, unknown>;
    await expect(page.getByText("An optimistic creation that loses the race", { exact: true })).toBeVisible();

    const response = await app.runtime.fetch("/sync/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId: "product-ui-authority-race",
        mutations: [
          {
            id: 1,
            name: "issueCreate",
            args: { ...args, title: "The canonical issue from the authority", subscriptionId: uuidv7() },
            ts: new Date().toISOString(),
          },
        ],
      }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()) as PushResponse).toMatchObject({ ok: true, rejected: [] });
    releasePushNetwork();
    expect(await processedPush).toMatchObject({
      ok: true,
      rejected: [{ id: creation!.id, error: expect.stringMatching(/already exists/i) }],
    });
    // The earlier refresh receives the committed ACK before the rejected push response.
    releasePull();
    await expect(page.getByRole("row", { name: "REC-2", exact: true })).toContainText(
      "The canonical issue from the authority",
    );
    await expect.poll(async () => (await storedOutbox(page)).length).toBe(0);
    releasePushResponse();
    await expect(page.getByRole("alert")).toContainText(/already exists/i);
    await expect(page.getByText("An optimistic creation that loses the race", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("row", { name: "REC-2", exact: true })).toContainText(
      "The canonical issue from the authority",
    );
    await expect(page.getByRole("status")).toContainText("Saved");
    const authority = await app.runtime.inspect();
    expect(authority.issues).toHaveLength(2);
    expect(
      authority.events.filter((event) => event.type === "IssueCreated" && event.entity_id === args["id"]),
    ).toHaveLength(1);
    expect(authority.log.some((entry) => entry.client_id === request.clientId && entry.model === "issue")).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    releasePushNetwork();
    releasePull();
    releasePushResponse();
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await context.close();
  }
});

test("a second tab waits for the workspace writer and recovers its offline queue when the first tab closes", async ({
  browser,
  app,
}) => {
  const context = await browser.newContext();
  const first = await context.newPage();
  const second = await context.newPage();
  const errors: string[] = [];
  first.on("pageerror", (error) => errors.push(error.message));
  second.on("pageerror", (error) => errors.push(error.message));
  try {
    await openApp(first, app.origin);
    await context.route(syncApi, (route) => route.abort("internetdisconnected"));
    await rename(first, "REC-1", "The next tab recovers this offline draft");
    await expect(first.getByRole("status")).toContainText("Offline");
    await expectStoredTitle(first, "The next tab recovers this offline draft");
    await second.goto(app.origin);
    await expect(second.getByText("Workspace open in another tab", { exact: true })).toBeVisible();
    await expect(
      second.getByRole("button", { name: "Create issue", exact: true }).and(second.locator(":enabled")),
    ).toHaveCount(0);
    await first.close();
    await expect(second.getByRole("row", { name: "REC-1", exact: true })).toContainText(
      "The next tab recovers this offline draft",
    );
    await expect(second.getByRole("status")).toContainText("Offline");
    await context.unroute(syncApi);
    await second.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(second.getByRole("status")).toContainText("Saved");
    const authority = await app.runtime.inspect();
    expect(authority.issues.find((issue) => issue.id === app.issueId)?.title).toBe(
      "The next tab recovers this offline draft",
    );
    expect(
      authority.events.filter((event) => event.type === "IssueTitled" && event.entity_id === app.issueId),
    ).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("unavailable browser storage shows a startup error and keeps issue editing disabled", async ({ browser, app }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(indexedDB, "open", {
      value() {
        throw new DOMException("IndexedDB unavailable", "SecurityError");
      },
    });
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(app.origin);
    await expect(page.getByRole("alert")).toContainText(/IndexedDB|storage/i);
    await expect(
      page.getByRole("textbox", { name: "Issue title", exact: true }).and(page.locator(":enabled")),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Create issue", exact: true }).and(page.locator(":enabled")),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Edit title for / }).and(page.locator(":enabled"))).toHaveCount(0);
    expect((await app.runtime.inspect()).issues).toMatchObject([{ id: app.issueId, title: "Shared issue" }]);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
