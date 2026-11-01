import { test, expect, syncApi, readWorkspaceState } from "./app.fixture";

test.describe("local workspace context before initialization", () => {
  test.use({ seedWorkspace: false });

  test("server context identifies the local user before seeding and initialization is an explicit action", async ({
    browser,
    app,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const seeds: string[] = [];
    const syntheticHeaders: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/__local/seed") seeds.push(request.method());
      if (request.headers()["x-kanbun-local-actor"]) syntheticHeaders.push(url.pathname);
    });
    try {
      const metadata = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/context");
      const uninitialized = page.waitForResponse((response) => new URL(response.url()).pathname === "/sync/bootstrap");
      await page.goto(app.origin);
      expect(await (await metadata).json()).toMatchObject({
        mode: "local",
        workspaceId: "local",
        name: "Alice",
        actor: { id: "user-alice", type: "user" },
      });
      expect((await uninitialized).status()).toBe(403);
      await expect(page.locator(".local-person")).toContainText("Alice");
      await expect(page.getByRole("button", { name: "Initialize local workspace", exact: true })).toBeVisible();
      expect(seeds).toEqual([]);
      await page.getByRole("button", { name: "Initialize local workspace", exact: true }).click();
      await expect(page.getByRole("row", { name: "REC-1", exact: true })).toContainText("Shared issue");
      await expect(page.getByRole("status")).toContainText("Saved");
      expect(seeds).toEqual(["POST"]);
      expect(syntheticHeaders).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

test("rejected or invalid context never reveals a cached workspace or discards its offline outbox", async ({
  browser,
  app,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(app.origin);
    await expect(page.getByRole("status")).toContainText("Saved");
    await context.route(syncApi, (route) => route.abort("internetdisconnected"));
    await page.getByRole("button", { name: "Edit title for REC-1", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Title for REC-1", exact: true })
      .fill("Pending work survives context denial");
    await page.getByRole("button", { name: "Save title", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Offline");
    await expect.poll(async () => (await readWorkspaceState(page, "local:user-alice:main"))?.pending.length).toBe(1);
    const saved = await readWorkspaceState(page, "local:user-alice:main");
    const syncRequests: string[] = [];
    const sockets: string[] = [];
    let contextRejected = false;
    page.on("response", (response) => {
      if (new URL(response.url()).pathname === "/api/context") contextRejected = true;
    });
    page.on("request", (request) => {
      if (contextRejected && new URL(request.url()).pathname.startsWith("/sync/")) syncRequests.push(request.url());
    });
    page.on("websocket", (socket) => {
      if (new URL(socket.url()).pathname === "/sync/connect") sockets.push(socket.url());
    });
    const failures: { status: number; body: string; headers: Record<string, string> }[] = [
      {
        status: 403,
        body: JSON.stringify({ error: "Access denied" }),
        headers: { "content-type": "application/json" },
      },
      {
        status: 200,
        body: JSON.stringify({ mode: "hosted", actor: { id: "unverified" } }),
        headers: { "content-type": "application/json" },
      },
      { status: 302, body: "", headers: { location: "/login" } },
    ];
    for (const failure of failures) {
      await page.unroute("**/api/context");
      await page.route("**/api/context", (route) => route.fulfill(failure));
      await page.reload();
      await expect(page.getByRole("alert")).toContainText(/Sign.in|context/i);
      await expect(page.getByRole("row", { name: "REC-1", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Initialize local workspace", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "New issue" }).and(page.locator(":enabled"))).toHaveCount(0);
      expect((await readWorkspaceState(page, "local:user-alice:main"))?.pending).toEqual(saved?.pending);
    }
    // An explicit denial also invalidates the older local descriptor for a later network failure.
    await page.unroute("**/api/context");
    await page.route("**/api/context", (route) => route.abort("internetdisconnected"));
    await page.reload();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("row", { name: "REC-1", exact: true })).toHaveCount(0);
    expect((await readWorkspaceState(page, "local:user-alice:main"))?.pending).toEqual(saved?.pending);
    expect(syncRequests).toEqual([]);
    expect(sockets).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
