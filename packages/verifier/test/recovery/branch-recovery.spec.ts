import { test, expect, syncApi } from "./fixture";

test("a workspace branch survives offline reloads, Durable Object reactivation, and an unacknowledged retry without changing main", async ({
  browser,
  harness,
}, testInfo) => {
  const branchId = await harness.createBranch();
  // Two tabs share one origin and IndexedDB, so branch-specific keys are exercised.
  const context = await browser.newContext();
  const main = await context.newPage();
  const branch = await context.newPage();
  const pageErrors: string[] = [];
  main.on("pageerror", (error) => pageErrors.push(error.message));
  branch.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await Promise.all([main.goto(harness.origin), branch.goto(harness.origin)]);
    await Promise.all([
      main.waitForFunction(() => Boolean(window.recovery)),
      branch.waitForFunction(() => Boolean(window.recovery)),
    ]);
    const initialMain = await main.evaluate(() => window.recovery.start("alice"));
    const [bootstrap, initialBranch] = await Promise.all([
      branch.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === "/sync/bootstrap" && url.searchParams.get("branchId") === branchId;
      }),
      branch.evaluate((id) => window.recovery.start("alice", id), branchId),
    ]);
    expect(bootstrap.status()).toBe(200);
    expect(initialBranch.branchId).toBe(branchId);
    expect(initialBranch.clientId).not.toBe(initialMain.clientId);
    expect(initialBranch.issues).toEqual(initialMain.issues);
    const mainBefore = await harness.inspect();

    await branch.route(syncApi, (route) => route.abort("internetdisconnected"));
    await branch.evaluate(
      (id) => window.recovery.mutate("issueUpdate", { id, patch: { title: "Private branch draft" } }),
      harness.issueId,
    );
    await branch.evaluate(() => window.recovery.push());
    await expect.poll(() => branch.evaluate(async () => (await window.recovery.persisted())?.pending.length)).toBe(1);
    const saved = await branch.evaluate(() => window.recovery.persisted());
    expect(saved).toMatchObject({ branchId, clientId: initialBranch.clientId });
    expect(await main.evaluate(() => window.recovery.persisted())).toMatchObject({
      branchId: "main",
      clientId: initialMain.clientId,
      pending: [],
    });
    expect(harness.pushes).toHaveLength(0);

    await harness.restart();
    await branch.reload();
    await branch.waitForFunction(() => Boolean(window.recovery));
    const restored = await branch.evaluate((id) => window.recovery.start("alice", id), branchId);
    expect(restored).toMatchObject({ branchId, clientId: initialBranch.clientId, pending: 1, status: "offline" });
    expect(restored.pendingMutations).toEqual(saved?.pending);
    expect(restored.issues.find((issue) => issue.id === harness.issueId)?.title).toBe("Private branch draft");
    expect((await harness.inspect()).issues).toEqual(mainBefore.issues);

    // The branch commits, but its acknowledgement is deliberately truncated over the real HTTP connection.
    harness.dropNextPushResponse("alice");
    await branch.unroute(syncApi);
    await branch.evaluate(() => window.recovery.push());
    await expect
      .poll(() => harness.pushes.filter((push) => push.request.clientId === initialBranch.clientId))
      .toHaveLength(1);
    const original = harness.pushes.find((push) => push.request.clientId === initialBranch.clientId)!;
    expect(original.request).toMatchObject({ branchId, clientId: initialBranch.clientId, mutations: saved?.pending });
    expect(original.responseDropped).toBe(true);
    expect(original.result).toMatchObject({ ok: true, lastMutationId: 1, rejected: [] });
    await expect.poll(() => branch.evaluate(async () => (await window.recovery.persisted())?.pending.length)).toBe(1);
    const committed = await harness.inspect();
    expect(committed.issues).toEqual(mainBefore.issues);
    expect(committed.seq).toBe(mainBefore.seq);
    expect(committed.clients.find((client) => client["client_id"] === initialBranch.clientId)).toMatchObject({
      branch_id: branchId,
      last_mutation_id: 1,
    });
    const branchLog = committed.log.filter((entry) => entry["branch_id"] === branchId);
    expect(branchLog.length).toBeGreaterThan(0);

    // Keep startup's pull from acknowledging the command before its byte-identical retry.
    await branch.route(syncApi, (route) => route.abort("internetdisconnected"));
    await harness.restart();
    await branch.reload();
    await branch.waitForFunction(() => Boolean(window.recovery));
    const reopened = await branch.evaluate((id) => window.recovery.start("alice", id), branchId);
    expect(reopened).toMatchObject({ branchId, clientId: initialBranch.clientId, pending: 1 });
    expect(reopened.pendingMutations).toEqual(saved?.pending);
    expect((await harness.inspect()).log).toEqual(committed.log);
    await branch.unroute(syncApi);
    const confirmed = await branch.evaluate(() => window.recovery.push());
    expect(confirmed).toMatchObject({ branchId, pending: 0, status: "idle" });
    const attempts = harness.pushes.filter((push) => push.request.clientId === initialBranch.clientId);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]?.rawBody).toBe(original.rawBody);
    expect((await harness.inspect()).log).toEqual(committed.log);
    expect(confirmed.issues.find((issue) => issue.id === harness.issueId)?.title).toBe("Private branch draft");
    await main.evaluate(() => window.recovery.pull());
    expect((await main.evaluate(() => window.recovery.snapshot())).issues).toEqual(initialMain.issues);

    const branchIssue = await branch.evaluate((teamId) => {
      const id = window.recovery.newId();
      window.recovery.mutate("issueCreate", {
        id,
        teamId,
        title: "Branch-only issue",
        subscriptionId: window.recovery.newId(),
      });
      return id;
    }, harness.teamId);
    const branchCreated = await branch.evaluate(() => window.recovery.push());
    expect(branchCreated.issues.find((issue) => issue.id === branchIssue)?.number).toBe(0);
    expect((await harness.inspect()).issues).toEqual(mainBefore.issues);
    const nextMainIssue = await main.evaluate((teamId) => {
      const id = window.recovery.newId();
      window.recovery.mutate("issueCreate", {
        id,
        teamId,
        title: "Main still owns its counter",
        subscriptionId: window.recovery.newId(),
      });
      return id;
    }, harness.teamId);
    const mainCreated = await main.evaluate(() => window.recovery.push());
    expect(mainCreated.issues.find((issue) => issue.id === nextMainIssue)?.number).toBe(2);
    expect(mainCreated.issues.some((issue) => issue.id === branchIssue)).toBe(false);
    const liveBranch = await branch.evaluate(() => window.recovery.pull());
    expect(liveBranch.issues.find((issue) => issue.id === nextMainIssue)?.number).toBe(2);
    expect(liveBranch.issues.find((issue) => issue.id === harness.issueId)?.title).toBe("Private branch draft");
    expect(liveBranch.issues.find((issue) => issue.id === branchIssue)?.number).toBe(0);
    await expect.poll(() => branch.evaluate(async () => (await window.recovery.persisted())?.pending.length)).toBe(0);
    expect(pageErrors).toEqual([]);
    await testInfo.attach("branch-recovery-evidence", {
      body: JSON.stringify(
        {
          branchId,
          initialMain,
          initialBranch,
          saved,
          restored,
          committed,
          reopened,
          confirmed,
          mainCreated,
          liveBranch,
          pushes: harness.pushes,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  } finally {
    await context.close();
  }
});
