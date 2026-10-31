import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Invoked by check-local-install.sh inside its disposable checkout's devcontainer.
const root = fileURLToPath(new URL("..", import.meta.url));
if (process.env.KANBUN_LOCAL_REHEARSAL !== "1")
  throw new Error("Use scripts/check-local-install.sh; this probe operates on a disposable clone only.");
const [operation] = process.argv.slice(2);
const runId = process.env.KANBUN_LOCAL_REHEARSAL_ID;
assert.match(runId ?? "", /^kanbun-install\.[A-Za-z0-9]+$/, "A disposable rehearsal run ID is required.");
// The host-created clone can have a different UID from the container's node user.
// Trust only this explicit disposable checkout for this read, without a global Git exception.
const sourceCommit = execFileSync("git", ["-c", `safe.directory=${root.replace(/\/$/, "")}`, "rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const output = new URL("../artifacts/launch/local/", import.meta.url);
await mkdir(output, { recursive: true });
const expectedPath = new URL("expected.json", output);
const title = "Persisted local installation rehearsal";
const request = async (route, body) => {
  const response = await fetch(`http://127.0.0.1:5173${route}`, {
    ...(body === undefined
      ? {}
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200, `Unexpected status for ${route}`);
  return response.json();
};
if (operation === "reset") {
  const expected = JSON.parse(await readFile(expectedPath, "utf8"));
  assert.equal(expected.runId, runId);
  assert.equal(expected.sourceCommit, sourceCommit);
  await rm(new URL("../apps/worker/.wrangler/state", import.meta.url), { recursive: true, force: true });
  console.log("Reset the disposable checkout's local Worker storage.");
} else {
  // Startup has an explicit failure boundary; unavailable services never become passing evidence.
  const deadline = Date.now() + 60000;
  while (true) {
    try {
      await request("/api/context");
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (operation === "create") {
    const seed = await request("/__local/seed", {});
    assert.deepEqual(await request("/__local/seed", {}), seed);
    const issueId = "019a0000-0000-7000-8000-000000000123";
    const pushed = await request("/sync/push", {
      clientId: "local-install-rehearsal",
      mutations: [
        {
          id: 1,
          name: "issueCreate",
          args: {
            id: issueId,
            teamId: seed.teamId,
            subscriptionId: "019a0000-0000-7000-8000-000000000124",
            title: "Created during local installation rehearsal",
          },
          ts: new Date().toISOString(),
        },
        { id: 2, name: "issueUpdate", args: { id: issueId, patch: { title } }, ts: new Date().toISOString() },
      ],
    });
    assert.equal(pushed.ok, true);
    assert.deepEqual(pushed.rejected, []);
    const bootstrap = await request("/sync/bootstrap?clientId=local-install-rehearsal");
    const issue = bootstrap.rows.issue.find((row) => row.id === issueId);
    assert.equal(issue.title, title);
    await writeFile(
      expectedPath,
      JSON.stringify(
        { runId, sourceCommit, teamId: seed.teamId, seedIssueId: seed.issueId, issueId, number: issue.number, title },
        null,
        2,
      ),
    );
  } else if (["restart", "rebuild", "reset-verified"].includes(operation)) {
    const expected = JSON.parse(await readFile(expectedPath, "utf8"));
    assert.equal(expected.runId, runId);
    assert.equal(expected.sourceCommit, sourceCommit);
    const seed = await request("/__local/seed", {});
    const bootstrap = await request("/sync/bootstrap?clientId=local-install-rehearsal");
    if (operation === "reset-verified") {
      assert.notEqual(seed.teamId, expected.teamId);
      assert.equal(
        bootstrap.rows.issue.some((row) => row.id === expected.issueId),
        false,
      );
      assert.equal(
        bootstrap.rows.issue.some((row) => row.title === title),
        false,
      );
    } else {
      assert.equal(seed.teamId, expected.teamId);
      assert.equal(seed.issueId, expected.seedIssueId);
      const issue = bootstrap.rows.issue.find((row) => row.id === expected.issueId);
      assert.equal(issue?.title, expected.title);
      assert.equal(issue?.number, expected.number);
    }
  } else throw new Error("Choose create, restart, rebuild, reset, or reset-verified.");
  await writeFile(
    new URL(`${operation}.json`, output),
    JSON.stringify(
      { pass: true, operation, root, runId, sourceCommit, performedAt: new Date().toISOString() },
      null,
      2,
    ),
  );
  console.log(`Local installation ${operation}: passed.`);
}
