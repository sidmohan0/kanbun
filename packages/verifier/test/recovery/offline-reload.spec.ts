import { test, expect, syncApi } from "./fixture";

test("an offline edit survives a page reload in IndexedDB and converges over HTTP", async ({
  browser,
  harness,
}, testInfo) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  try {
    const alice = await aliceContext.newPage();
    const bob = await bobContext.newPage();
    const pageErrors: string[] = [];
    alice.on("pageerror", (error) => pageErrors.push(error.message));
    bob.on("pageerror", (error) => pageErrors.push(error.message));
    await Promise.all([alice.goto(harness.origin), bob.goto(harness.origin)]);
    await Promise.all([
      alice.waitForFunction(() => Boolean(window.recovery)),
      bob.waitForFunction(() => Boolean(window.recovery)),
    ]);
    const [bootstrap, initial] = await Promise.all([
      alice.waitForResponse((response) => response.url().includes("/sync/bootstrap")),
      alice.evaluate(() => window.recovery.start("alice")),
    ]);
    const bobInitial = await bob.evaluate(() => window.recovery.start("bob"));
    expect(bobInitial.clientId).not.toBe(initial.clientId);
    expect(bootstrap.headers()["content-type"]).toContain("application/json");
    expect((await bootstrap.json()).rows.issue).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: harness.issueId, title: "Shared issue" })]),
    );
    expect((await aliceContext.cookies()).find((cookie) => cookie.name === "kanbun_fixture_actor")).toMatchObject({
      value: "alice",
      httpOnly: true,
    });
    expect(initial.pending).toBe(0);

    // Only the sync API is unavailable. Harness assets remain loadable without a service worker.
    await aliceContext.route(syncApi, (route) => route.abort("internetdisconnected"));
    await alice.evaluate(
      (id) => window.recovery.mutate("issueUpdate", { id, patch: { title: "Recovered offline edit" } }),
      harness.issueId,
    );
    await alice.evaluate(() => window.recovery.push());
    await expect.poll(() => alice.evaluate(async () => (await window.recovery.persisted())?.pending.length)).toBe(1);
    const saved = await alice.evaluate(() => window.recovery.persisted());
    expect(saved?.clientId).toBe(initial.clientId);
    expect(saved?.pending).toEqual([
      expect.objectContaining({
        id: 1,
        name: "issueUpdate",
        args: { id: harness.issueId, patch: { title: "Recovered offline edit" } },
      }),
    ]);
    expect(await alice.evaluate(async () => (await indexedDB.databases()).map((database) => database.name))).toContain(
      "kanbun-browser-recovery",
    );
    expect(harness.pushes).toHaveLength(0);

    await alice.reload();
    await alice.waitForFunction(() => Boolean(window.recovery));
    const restored = await alice.evaluate(() => window.recovery.start("alice"));
    expect(restored.clientId).toBe(initial.clientId);
    expect(restored.status).toBe("offline");
    expect(restored.startError).not.toBeNull();
    expect(restored.pendingMutations).toEqual(saved?.pending);
    expect(restored.issues.find((issue) => issue.id === harness.issueId)?.title).toBe("Recovered offline edit");

    await aliceContext.unroute(syncApi);
    const [pushResponse] = await Promise.all([
      alice.waitForResponse((response) => response.url().endsWith("/sync/push")),
      alice.evaluate(() => window.recovery.push()),
    ]);
    expect(pushResponse.headers()["content-type"]).toContain("application/json");
    expect(await pushResponse.json()).toMatchObject({ ok: true, lastMutationId: 1, rejected: [] });
    await bob.evaluate(() => window.recovery.pull());
    const [aliceState, bobState] = await Promise.all([
      alice.evaluate(() => window.recovery.snapshot()),
      bob.evaluate(() => window.recovery.snapshot()),
    ]);
    expect(aliceState.pending).toBe(0);
    expect(bobState.pending).toBe(0);
    expect(aliceState.issues).toEqual(bobState.issues);
    expect(bobState.issues.find((issue) => issue.id === harness.issueId)?.title).toBe("Recovered offline edit");
    await expect.poll(() => alice.evaluate(async () => (await window.recovery.persisted())?.pending.length)).toBe(0);
    expect(harness.pushes).toHaveLength(1);
    expect(harness.pushes[0]).toMatchObject({
      actor: harness.actors.alice,
      requestContentType: "application/json",
      request: { clientId: initial.clientId, mutations: saved?.pending },
      responseDropped: false,
    });
    expect(harness.pushes[0]?.cookie).toContain("kanbun_fixture_actor=alice");
    expect(pageErrors).toEqual([]);
    await testInfo.attach("offline-reload-evidence", {
      body: JSON.stringify({ initial, saved, restored, aliceState, bobState, pushes: harness.pushes }, null, 2),
      contentType: "application/json",
    });
  } finally {
    await Promise.allSettled([aliceContext.close(), bobContext.close()]);
  }
});
