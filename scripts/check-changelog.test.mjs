import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const checker = fileURLToPath(new URL("./check-changelog.mjs", import.meta.url));
const initial = "# Changelog\n\n## [Unreleased]\n\n## [0.0.0] - 2026-10-01\n\n- Earlier behavior.\n";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "kanbun-changelog-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", ["-C", directory, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const write = (name, text) => writeFileSync(join(directory, name), text);
  const commit = (message) => {
    git("add", ".");
    git("commit", "-m", message);
  };
  const entry = () =>
    write("CHANGELOG.md", initial.replace("## [Unreleased]\n", "## [Unreleased]\n\n### Added\n\n- New behavior.\n"));
  const check = (expected, args = [], event) => {
    const command = [checker, "--base", "main", ...args];
    if (event !== undefined) {
      const path = join(directory, ".git", "event.json");
      writeFileSync(path, JSON.stringify(event));
      command.push("--event", path);
    }
    const result = spawnSync(process.execPath, command, {
      cwd: directory,
      encoding: "utf8",
    });
    assert.equal(result.status, expected, result.stdout + result.stderr);
    return result;
  };
  git("init", "-b", "main");
  git("config", "user.name", "Changelog tests");
  git("config", "user.email", "test@example.com");
  write("CHANGELOG.md", initial);
  write("behavior.txt", "original\n");
  commit("base");
  git("switch", "-c", "feature");
  return { directory, git, write, commit, entry, check };
}

test("a committed entry covers the complete PR, including later commits", (t) => {
  const r = fixture(t);
  r.entry();
  r.commit("entry");
  r.write("behavior.txt", "changed\n");
  r.commit("implementation");
  r.check(0);
});

test("uncommitted and staged entries do not cover committed behavior", (t) => {
  const r = fixture(t);
  r.write("behavior.txt", "changed\n");
  r.commit("implementation");
  r.entry();
  r.check(1);
  r.git("add", "CHANGELOG.md");
  r.check(1);
  r.commit("entry");
  r.check(0);
});

test("blank, heading-only, deletion and historical edits do not count", (t) => {
  const r = fixture(t);
  for (const text of [
    "",
    initial + "\n",
    initial.replace("## [Unreleased]\n", "## [Unreleased]\n\n### Added\n"),
    initial.replace("## [Unreleased]\n", "## [Unreleased]\n\n### Added\n\n- \n"),
    initial.replace("Earlier behavior.", "Reworded historical behavior."),
  ]) {
    r.git("reset", "--hard", "main");
    r.write("behavior.txt", "changed\n");
    r.write("CHANGELOG.md", text);
    r.commit("no new entry");
    r.check(1);
  }
  r.git("reset", "--hard", "main");
  r.git("rm", "CHANGELOG.md");
  r.commit("delete changelog");
  r.check(1);
});

test("renaming the changelog does not count", (t) => {
  const r = fixture(t);
  r.git("mv", "CHANGELOG.md", "history.md");
  r.commit("rename");
  r.check(1);
});

test("an exemption requires both the label and a nonempty reason", (t) => {
  const r = fixture(t);
  r.write("behavior.txt", "changed\n");
  r.commit("implementation");
  for (const [labels, body, expected] of [
    [[], "Changelog exemption: Tests only.", 1],
    [[{ name: "no-changelog" }], "", 1],
    [[{ name: "no-changelog" }], null, 1],
    [[{ name: "no-changelog" }], undefined, 1],
    [[{ name: "no-changelog" }], "Changelog exemption:   \nOther text", 1],
    [[{ name: "no-changelog" }], "Changelog exemption: Regression tests only.", 0],
  ]) {
    r.check(expected, [], { pull_request: { labels, body } });
  }
});

test("malformed exemption bodies cannot bypass the entry requirement", (t) => {
  const r = fixture(t);
  r.write("behavior.txt", "changed\n");
  r.commit("implementation");
  for (const body of [["Changelog exemption: Tests only."], { reason: "Tests only." }, 123]) {
    r.check(1, [], { pull_request: { labels: [{ name: "no-changelog" }], body } });
  }
});

test("missing base, unborn HEAD and malformed events fail", (t) => {
  const r = fixture(t);
  r.check(1, ["--base", "missing"]);
  r.write("behavior.txt", "changed\n");
  r.commit("implementation");
  r.check(1, [], {});
  r.write("event.json", "invalid json");
  r.check(1, ["--event", join(r.directory, "event.json")]);
  r.git("switch", "--orphan", "unborn");
  r.check(1);
});

test("an entry added only to the target branch does not cover a feature", (t) => {
  const r = fixture(t);
  r.git("switch", "main");
  r.entry();
  r.commit("unrelated base entry");
  r.git("switch", "feature");
  r.write("behavior.txt", "changed\n");
  r.commit("feature");
  r.check(1);
});

test("stacked PRs use their actual target, so a parent entry cannot cover a child", (t) => {
  const r = fixture(t);
  r.entry();
  r.commit("parent slice");
  r.git("branch", "parent");
  r.write("behavior.txt", "child change\n");
  r.commit("child slice");
  r.check(0);
  r.check(1, ["--base", "parent"]);
  r.write(
    "CHANGELOG.md",
    readFileSync(join(r.directory, "CHANGELOG.md"), "utf8").replace(
      "- New behavior.\n",
      "- New behavior.\n- Child behavior.\n",
    ),
  );
  r.commit("child entry");
  r.check(0, ["--base", "parent"]);
});

test("adding the first changelog with an entry counts against an existing base", (t) => {
  const r = fixture(t);
  r.git("switch", "main");
  r.git("rm", "CHANGELOG.md");
  r.commit("base without changelog");
  r.git("switch", "feature");
  r.git("merge", "--ff-only", "main");
  r.entry();
  r.commit("initial changelog");
  r.check(0);
});

test("bots follow the same explicit policy", (t) => {
  const r = fixture(t);
  r.write("behavior.txt", "changed\n");
  r.commit("bot update");
  r.check(1, [], { pull_request: { user: { login: "dependabot[bot]", type: "Bot" }, labels: [], body: "" } });
});

test("no committed changes pass", (t) => {
  fixture(t).check(0);
});

test("the base defaults to CHANGELOG_BASE or origin/main and an explicit base takes precedence", (t) => {
  const r = fixture(t);
  r.git("branch", "origin/main", "main");
  for (const [env, args, expected] of [
    [{ CHANGELOG_BASE: undefined }, [], 0],
    [{ CHANGELOG_BASE: "main" }, [], 0],
    [{ CHANGELOG_BASE: "missing" }, [], 1],
    [{ CHANGELOG_BASE: "missing" }, ["--base", "main"], 0],
  ]) {
    const result = spawnSync(process.execPath, [checker, ...args], {
      cwd: r.directory,
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    assert.equal(result.status, expected, result.stdout + result.stderr);
  }
});

test("documentation and tooling paths do not automatically qualify for an exemption", (t) => {
  const r = fixture(t);
  for (const name of ["README.md", "package.json"]) {
    r.git("reset", "--hard", "main");
    r.write(name, "changed\n");
    r.commit("maintenance");
    r.check(1);
  }
});
