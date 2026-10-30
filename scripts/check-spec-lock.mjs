#!/usr/bin/env node
/**
 * Spec lock. SPEC.md may only change together with a version bump.
 *
 * Checks, against a base ref (default origin/main):
 *   1. If SPEC.md's body changed, `version:` in its front matter must differ from the base.
 *   2. The new version must have a row in the "Version history" table.
 *   3. The outgoing version must be archived verbatim at docs/spec/SPEC-v<old>.md
 *      (its body must equal the base SPEC.md body).
 *   4. docs/spec/SPEC-v<new>.md must exist and its body must equal the new body.
 *   5. Archived versions are never modified or deleted.
 *
 * Usage: node scripts/check-spec-lock.mjs [baseRef] [--initial]
 *
 * The base ref must exist: an unreadable base is an error, not "nothing to
 * compare against", so a misconfigured CI cannot pass by accident. For the
 * very first commit, or a branch with no base, pass --initial to check only
 * the current version's shape and archive.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const initial = args.includes("--initial");
const base = args.find((a) => !a.startsWith("--")) ?? "origin/main";
const SPEC = "SPEC.md";

const sh = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const fail = (msg) => {
  console.error(`spec-lock: ${msg}`);
  process.exitCode = 1;
};

function refExists(ref) {
  try {
    sh(`git rev-parse --verify --quiet ${ref}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

/** The file at the base ref; null only when the ref exists and the file does not (a true first version). */
function baseFile(path) {
  if (!refExists(base))
    throw new Error(`base ref ${base} is not readable; pass an existing ref, or --initial for a first commit`);
  try {
    return sh(`git show ${base}:${path}`);
  } catch {
    return null;
  }
}

const frontMatter = (text) => {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return {};
  return Object.fromEntries(
    m[1]
      .split("\n")
      .map((l) => l.split(/:\s*/, 2))
      .filter((kv) => kv.length === 2),
  );
};

/** The body is everything after the horizontal rule that follows the History section. */
const body = (text) => {
  const h = text.indexOf("\n## History");
  const i = text.indexOf("\n---\n\n", h < 0 ? 0 : h);
  return i < 0 ? text : text.slice(i + "\n---\n\n".length);
};

const archiveBody = (text) => {
  // Archived copies carry one quote line after the H1; everything after the first blank-line-separated note is the body.
  const parts = text.split("\n\n");
  return parts.slice(2).join("\n\n").replaceAll("](figures/", "](docs/spec/figures/");
};

const current = readFileSync(SPEC, "utf8");
let previous = null;
if (!initial) {
  try {
    previous = baseFile(SPEC);
  } catch (e) {
    fail(e.message);
    process.exit(1);
  }
}
const cur = frontMatter(current);
const prev = previous ? frontMatter(previous) : {};

if (!cur.version) fail("SPEC.md front matter has no version");
if (cur.status !== "locked") fail(`SPEC.md status must be "locked" (is "${cur.status}")`);

let changedFiles = [];
if (!initial) {
  try {
    changedFiles = sh(`git diff --name-status ${base}...HEAD`).split("\n").filter(Boolean);
  } catch {
    changedFiles = sh(`git diff --name-status ${base}`).split("\n").filter(Boolean);
  }
}

// 5. archive is append-only
for (const line of changedFiles) {
  const [status, path] = line.split("\t");
  if (path?.startsWith("docs/spec/SPEC-v") && status !== "A")
    fail(`archived spec version modified or deleted: ${path} (${status}); the archive is append-only`);
  if (path?.startsWith("docs/spec/pdf/") && status !== "A")
    fail(`circulated PDF modified or deleted: ${path} (${status})`);
}

if (previous !== null && body(previous).trim() !== body(current).trim()) {
  // 1. version bump
  if (cur.version === prev.version) fail(`SPEC.md body changed but version is still ${cur.version}; bump it`);
  // 2. history row
  const row = new RegExp(`^\\|\\s*\\*{0,2}${cur.version.replace(".", "\\.")}\\*{0,2}\\s*\\|`, "m");
  if (!row.test(current)) fail(`no row for version ${cur.version} in the Version history table`);
  // 3. outgoing version archived verbatim
  const oldArchive = `docs/spec/SPEC-v${prev.version}.md`;
  if (!existsSync(oldArchive)) fail(`outgoing version ${prev.version} is not archived at ${oldArchive}`);
  else if (archiveBody(readFileSync(oldArchive, "utf8")).trim() !== body(previous).trim())
    fail(`${oldArchive} does not match the outgoing SPEC.md body`);
}

// 4. current version archived
const newArchive = `docs/spec/SPEC-v${cur.version}.md`;
if (!existsSync(newArchive)) fail(`current version ${cur.version} must also be archived at ${newArchive}`);
else if (archiveBody(readFileSync(newArchive, "utf8")).trim() !== body(current).trim())
  fail(`${newArchive} does not match the current SPEC.md body`);

if (process.exitCode) process.exit(process.exitCode);
console.log(`spec-lock: ok (version ${cur.version}, ${initial ? "initial" : `base ${base}`})`);
