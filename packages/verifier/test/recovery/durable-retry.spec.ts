import { test, expect, syncApi } from "./fixture";

test.use({ seedIssue: false });

test("replays an unacknowledged durable mutation once after page reload and SQLite reopen", async ({
  browser,
  harness,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(harness.origin);
    await page.waitForFunction(() => Boolean(window.recovery));
    const initial = await page.evaluate(() => window.recovery.start("alice"));
    expect(initial.pending).toBe(0);
    expect(harness.inspect().issues).toHaveLength(0);

    harness.dropNextPushResponse("alice");
    const issueId = await page.evaluate((teamId) => {
      const id = window.recovery.newId();
      window.recovery.mutate("issueCreate", {
        id,
        teamId,
        title: "Created before the acknowledgement disappeared",
        subscriptionId: window.recovery.newId(),
      });
      return id;
    }, harness.teamId);

    await expect
      .poll(() => harness.pushes.filter((push) => push.request.clientId === initial.clientId && push.responseDropped))
      .toHaveLength(1);
    const originalPush = harness.pushes.find(
      (push) => push.request.clientId === initial.clientId && push.responseDropped,
    )!;
    expect(originalPush.request.mutations).toHaveLength(1);
    const originalMutation = originalPush.request.mutations[0]!;
    expect(originalMutation.name).toBe("issueCreate");
    expect(originalPush.result).toMatchObject({ ok: true, lastMutationId: originalMutation.id, rejected: [] });
    expect(originalPush.seqAfter).toBeGreaterThan(originalPush.seqBefore);

    await expect
      .poll(async () => page.evaluate(() => window.recovery.snapshot()))
      .toMatchObject({ clientId: initial.clientId, status: "offline", pending: 1 });
    await expect
      .poll(async () => page.evaluate(() => window.recovery.persisted()))
      .toMatchObject({ clientId: initial.clientId, pending: [originalMutation] });

    const committed = harness.inspect();
    expect(committed.issues).toHaveLength(1);
    expect(committed.issues[0]).toMatchObject({ id: issueId, number: 1 });
    const originalLog = committed.log.filter(
      (entry) => entry["client_id"] === initial.clientId && entry["mutation_id"] === originalMutation.id,
    );
    expect(originalLog.length).toBeGreaterThan(0);
    expect(
      originalLog.filter(
        (entry) => entry["model"] === "issue" && entry["row_id"] === issueId && entry["prev"] === null,
      ),
    ).toHaveLength(1);

    // Keep startup's pull from acknowledging the committed mutation before its retry.
    await context.route(syncApi, (route) => route.abort("internetdisconnected"));
    await page.reload();
    await page.waitForFunction(() => Boolean(window.recovery));
    const restored = await page.evaluate(() => window.recovery.start("alice"));
    expect(restored).toMatchObject({ clientId: initial.clientId, status: "offline", pending: 1 });
    expect(restored.startError).toBeTruthy();
    expect(restored.pendingMutations).toEqual([originalMutation]);
    expect(harness.pushes.filter((push) => push.request.clientId === initial.clientId)).toHaveLength(1);

    await harness.restart();
    const reopened = harness.inspect();
    expect(reopened.issues).toEqual(committed.issues);
    expect(reopened.log).toEqual(committed.log);
    expect(reopened.clients.find((client) => client["client_id"] === initial.clientId)).toMatchObject({
      last_mutation_id: originalMutation.id,
    });

    await context.unroute(syncApi);
    const recovered = await page.evaluate(() => window.recovery.push());
    expect(recovered).toMatchObject({ clientId: initial.clientId, status: "idle", pending: 0 });
    await expect
      .poll(() => harness.pushes.filter((push) => push.request.clientId === initial.clientId))
      .toHaveLength(2);
    const replay = harness.pushes.filter((push) => push.request.clientId === initial.clientId)[1]!;
    expect(replay.responseDropped).toBe(false);
    expect(replay.request).toEqual(originalPush.request);
    expect(replay.result).toMatchObject({ ok: true, lastMutationId: originalMutation.id, rejected: [] });

    const afterReplay = harness.inspect();
    expect(afterReplay.issues).toHaveLength(1);
    expect(afterReplay.issues[0]).toMatchObject({ id: issueId, number: 1 });
    expect(afterReplay.log).toEqual(committed.log);
    expect(
      afterReplay.log.filter(
        (entry) => entry["client_id"] === initial.clientId && entry["mutation_id"] === originalMutation.id,
      ),
    ).toEqual(originalLog);
    expect(recovered.issues.find((issue) => issue.id === issueId)).toMatchObject({ number: 1 });
    await expect
      .poll(async () => page.evaluate(() => window.recovery.persisted()))
      .toMatchObject({ clientId: initial.clientId, lastMutationId: originalMutation.id, pending: [] });

    const nextIssueId = await page.evaluate((teamId) => {
      const id = window.recovery.newId();
      window.recovery.mutate("issueCreate", {
        id,
        teamId,
        title: "The retry consumed no extra issue number",
        subscriptionId: window.recovery.newId(),
      });
      return id;
    }, harness.teamId);
    await page.evaluate(() => window.recovery.push());
    expect(harness.inspect().issues).toHaveLength(2);
    expect(harness.inspect().issues.find((issue) => issue.id === nextIssueId)).toMatchObject({ number: 2 });
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});
