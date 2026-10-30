import type { SyncServer } from "@kanbun/sync/server";
import { test, expect } from "./fixture";

type Preview = ReturnType<SyncServer["previewBranch"]>;
type MergeRequest = Parameters<SyncServer["mergeBranch"]>[1];
type MergeResult = ReturnType<SyncServer["mergeBranch"]>;

test("a reviewed branch merge survives a lost HTTP acknowledgement and SQLite restart exactly once", async ({
  browser,
  harness,
}, testInfo) => {
  const branchId = harness.createBranch();
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
    await main.evaluate(() => window.recovery.start("alice"));
    await branch.evaluate((id) => window.recovery.start("alice", id), branchId);
    const newIssueId = await branch.evaluate(
      ({ teamId, existingId }) => {
        window.recovery.mutate("issueUpdate", { id: existingId, patch: { title: "Proposed branch title" } });
        const id = window.recovery.newId();
        window.recovery.mutate("issueCreate", {
          id,
          teamId,
          title: "Created on the reviewed branch",
          subscriptionId: window.recovery.newId(),
        });
        return id;
      },
      { teamId: harness.teamId, existingId: harness.issueId },
    );
    const branchState = await branch.evaluate(() => window.recovery.push());
    expect(branchState.pending).toBe(0);
    expect(branchState.issues.find((issue) => issue.id === newIssueId)?.number).toBe(0);
    expect(harness.inspect().issues).toHaveLength(1);

    await main.evaluate(
      (id) => window.recovery.mutate("issueUpdate", { id, patch: { title: "Changed on main during review" } }),
      harness.issueId,
    );
    await main.evaluate(() => window.recovery.push());
    const preview = await branch.evaluate(async (id) => {
      const response = await fetch(`/sync/branch/preview?branchId=${encodeURIComponent(id)}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error(`Preview failed: ${response.status}`);
      return (await response.json()) as Preview;
    }, branchId);
    expect(preview.changes).toEqual(
      expect.arrayContaining([
        { issueId: harness.issueId, title: "Proposed branch title", kind: "rename" },
        { issueId: newIssueId, title: "Created on the reviewed branch", kind: "create" },
      ]),
    );
    expect(preview.conflicts).toEqual([
      {
        issueId: harness.issueId,
        reason: "main_changed",
        mainTitle: "Changed on main during review",
        branchTitle: "Proposed branch title",
      },
    ]);
    const request: MergeRequest = {
      branchId,
      mergeId: await branch.evaluate(() => window.recovery.newId()),
      expectedBranchHeadSeq: preview.branchHeadSeq,
      expectedMainSyncSeq: preview.mainSyncSeq,
      resolutions: [{ issueId: harness.issueId, choice: "edit", title: "Human-approved merged title" }],
    };
    const merge = () =>
      branch.evaluate(async (body) => {
        const response = await fetch("/sync/branch/merge", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        return { status: response.status, result: (await response.json()) as MergeResult };
      }, request);

    harness.dropNextMergeResponse("alice");
    await expect(merge()).rejects.toThrow();
    expect(harness.merges).toHaveLength(1);
    const committedAttempt = harness.merges[0]!;
    expect(committedAttempt).toMatchObject({ actor: harness.actors.alice, request, responseDropped: true });
    expect(committedAttempt.result).toMatchObject({
      ok: true,
      branchId,
      mergeId: request.mergeId,
      appliedEvents: 2,
      skippedEntities: 0,
    });
    expect(committedAttempt.seqAfter).toBeGreaterThan(committedAttempt.seqBefore);
    const committed = harness.inspect();
    expect(committed.issues.find((issue) => issue.id === harness.issueId)?.title).toBe("Human-approved merged title");
    expect(committed.issues.find((issue) => issue.id === newIssueId)).toMatchObject({
      number: 2,
      title: "Created on the reviewed branch",
    });

    await harness.restart();
    expect(harness.inspect().issues).toEqual(committed.issues);
    expect(harness.inspect().log).toEqual(committed.log);
    const retried = await merge();
    expect(retried.status).toBe(200);
    expect(retried.result).toEqual(committedAttempt.result);
    expect(harness.merges).toHaveLength(2);
    expect(harness.merges[1]?.rawBody).toBe(committedAttempt.rawBody);
    expect(harness.merges[1]?.seqAfter).toBe(committedAttempt.seqAfter);
    expect(harness.inspect().log).toEqual(committed.log);
    const mainState = await main.evaluate(() => window.recovery.pull());
    expect(mainState.issues).toEqual([...committed.issues].sort((a, b) => a.id.localeCompare(b.id)));

    const closed = await branch.evaluate(
      async ({ id, clientId }) => {
        const response = await fetch(
          `/sync/bootstrap?clientId=${encodeURIComponent(clientId)}&branchId=${encodeURIComponent(id)}`,
          { credentials: "include" },
        );
        return { status: response.status, body: (await response.json()) as { error?: string } };
      },
      { id: branchId, clientId: branchState.clientId },
    );
    expect(closed.status).toBe(403);
    expect(closed.body.error).toMatch(/not open/);
    const nextId = await main.evaluate((teamId) => {
      const id = window.recovery.newId();
      window.recovery.mutate("issueCreate", {
        id,
        teamId,
        title: "The merge retry consumed no extra number",
        subscriptionId: window.recovery.newId(),
      });
      return id;
    }, harness.teamId);
    const nextState = await main.evaluate(() => window.recovery.push());
    expect(nextState.issues.find((issue) => issue.id === nextId)?.number).toBe(3);
    expect(pageErrors).toEqual([]);
    await testInfo.attach("branch-merge-recovery-evidence", {
      body: JSON.stringify(
        { branchId, preview, request, committed, retried, mainState, closed, merges: harness.merges },
        null,
        2,
      ),
      contentType: "application/json",
    });
  } finally {
    await context.close();
  }
});
