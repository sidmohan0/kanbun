import { uuidv7 } from "@kanbun/model";
import type { WorkspaceContext } from "@kanbun/sync";
import type { PersistedState } from "@kanbun/sync/client";
import type { WebSocket } from "@playwright/test";
import { readWorkspaceState, syncApi } from "./app.fixture";
import { test, expect } from "./app-preview.fixture";

test("verified owner context isolates the local queue and preserves hosted work through foreign and expired-session denial", async ({
  browser,
  preview,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  const sockets: WebSocket[] = [];
  const syntheticHeaders: string[] = [];
  const requestsAfterDenial: string[] = [];
  let deniedSession = false;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname === "/sync/connect") sockets.push(socket);
  });
  page.on("request", (request) => {
    if (request.headers()["x-kanbun-local-actor"]) syntheticHeaders.push(request.url());
    if (deniedSession && new URL(request.url()).pathname.startsWith("/sync/")) requestsAfterDenial.push(request.url());
  });
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/sync/") && [401, 403].includes(response.status()))
      deniedSession = true;
  });
  const legacy: PersistedState = {
    clientId: "prior-local-client",
    userId: "user-alice",
    branchId: "main",
    seq: 0,
    lastMutationId: 0,
    rows: {},
    pending: [
      {
        id: 1,
        name: "issueCreate",
        ts: new Date().toISOString(),
        args: {
          id: uuidv7(),
          teamId: uuidv7(),
          subscriptionId: uuidv7(),
          title: "A prior local queue must stay intact",
        },
      },
    ],
  };
  const localKey = "local:user-alice:main";
  try {
    // Prepare an existing local record using browser storage before the actual app starts.
    await page.goto(`${preview.origin}/favicon.svg`);
    await page.evaluate(
      async ({ key, state }) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("kanbun", 1);
          request.onupgradeneeded = () => request.result.createObjectStore("state");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction("state", "readwrite");
            transaction.objectStore("state").put(state, key);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
          });
        } finally {
          db.close();
        }
      },
      { key: localKey, state: legacy },
    );

    const response = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/context");
    await page.goto(preview.origin);
    const verified = (await (await response).json()) as WorkspaceContext;
    expect(verified.mode).toBe("hosted");
    expect(verified.actor.id).not.toBe("user-alice");
    await expect(page.getByText(verified.name, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Saved");
    await expect(page.getByText("Local fixture identity", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Initialize local workspace", exact: true })).toHaveCount(0);
    expect(await readWorkspaceState(page, localKey)).toEqual(legacy);
    await expect.poll(() => sockets.length).toBe(1);

    await page.route(syncApi, (route) => route.abort("internetdisconnected"));
    if (!(await page.getByRole("textbox", { name: "Issue title", exact: true }).isVisible()))
      await page.getByRole("button", { name: "New issue" }).click();
    await page.getByRole("textbox", { name: "Issue title", exact: true }).fill("Hosted draft remains private");
    await page.getByRole("button", { name: "Create issue", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Offline");
    const keys = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("kanbun");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<string[]>((resolve, reject) => {
          const request = db.transaction("state", "readonly").objectStore("state").getAllKeys();
          request.onsuccess = () => resolve(request.result.map(String));
          request.onerror = () => reject(request.error);
        });
      } finally {
        db.close();
      }
    });
    expect(keys).toHaveLength(2);
    const hostedKey = keys.find((key) => key !== localKey)!;
    await expect.poll(async () => (await readWorkspaceState(page, hostedKey))?.pending.length).toBe(1);
    const saved = await readWorkspaceState(page, hostedKey);
    expect(saved?.userId).toBe(verified.actor.id);
    expect(await readWorkspaceState(page, localKey)).toEqual(legacy);

    preview.setToken(await preview.runtime.token({ sub: "foreign-principal", email: "foreign@example.test" }));
    await page.unroute(syncApi);
    const closed = sockets[0]!.waitForEvent("close");
    const denied = page.waitForResponse(
      (response) => new URL(response.url()).pathname.startsWith("/sync/") && [401, 403].includes(response.status()),
    );
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await denied;
    await closed;
    await expect(page.getByRole("heading", { name: "Workspace access required", exact: true })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("Sign-in does not automatically grant workspace access");
    await expect(page.getByText("Hosted draft remains private", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New issue" }).and(page.locator(":enabled"))).toHaveCount(0);
    expect((await readWorkspaceState(page, hostedKey))?.pending).toEqual(saved?.pending);

    preview.setToken(await preview.runtime.token({ exp: 1 }));
    const expired = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/context");
    await page.reload();
    expect([401, 403]).toContain((await expired).status());
    await expect(page.getByRole("alert")).toContainText("Sign in again");
    await expect(page.getByText("Hosted draft remains private", { exact: true })).toHaveCount(0);
    expect((await readWorkspaceState(page, hostedKey))?.pending).toEqual(saved?.pending);
    expect(sockets).toHaveLength(1);
    expect(requestsAfterDenial).toEqual([]);

    await page.route("**/api/context", (route) => route.abort("internetdisconnected"));
    await page.reload();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByText("Hosted draft remains private", { exact: true })).toHaveCount(0);
    expect((await readWorkspaceState(page, hostedKey))?.pending).toEqual(saved?.pending);
    await page.unroute("**/api/context");

    deniedSession = false;
    preview.setToken(preview.ownerToken);
    await page.reload();
    await expect(page.getByText("Hosted draft remains private", { exact: true })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Saved");
    await expect.poll(async () => (await readWorkspaceState(page, hostedKey))?.pending.length).toBe(0);
    const authority = await preview.runtime.inspect();
    const issueId = (saved!.pending[0]!.args as { id: string }).id;
    expect(authority.rows.issue?.find((issue) => issue["id"] === issueId)?.["title"]).toBe(
      "Hosted draft remains private",
    );
    expect(
      authority.events.filter((event) => event.type === "IssueCreated" && event.entity_id === issueId),
    ).toHaveLength(1);
    expect(await readWorkspaceState(page, localKey)).toEqual(legacy);
    expect(syntheticHeaders).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
