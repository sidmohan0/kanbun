#!/usr/bin/env node
/** Require a committed Unreleased entry or explicit exemption across a PR. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function exempt(eventPath) {
  const pr = JSON.parse(readFileSync(eventPath, "utf8")).pull_request;
  if (!pr || !Array.isArray(pr.labels)) throw new Error("Malformed pull_request event labels.");
  const hasLabel = pr.labels.some((label) => {
    if (typeof label?.name !== "string") throw new Error("Malformed pull_request event label.");
    return label.name === "no-changelog";
  });
  if (!hasLabel) return false;
  if (pr.body != null && typeof pr.body !== "string") throw new Error("Malformed pull_request event body.");
  const reason = /^Changelog exemption:[ \t]*([^\r\n]+)/m.exec(pr.body || "");
  if (!reason?.[1].trim()) {
    throw new Error("The no-changelog label requires 'Changelog exemption: <reason>' in the PR body.");
  }
  console.log("Explicit changelog exemption found.");
  return true;
}

function hasEntry(base) {
  const patch = git("diff", "--no-ext-diff", "--no-renames", "--unified=0", base, "HEAD", "--", "CHANGELOG.md");
  const added = new Set();
  let lineNumber = null;
  for (const line of patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) lineNumber = Number(hunk[1]);
    else if (lineNumber !== null && line.startsWith("+")) added.add(lineNumber++);
    else if (lineNumber !== null && line.startsWith(" ")) lineNumber++;
  }
  if (!added.size) return false;
  let unreleased = false;
  for (const [index, line] of git("show", "HEAD:CHANGELOG.md").split("\n").entries()) {
    if (line.startsWith("## ")) unreleased = line.trim() === "## [Unreleased]";
    if (unreleased && added.has(index + 1) && /^- \S/.test(line)) return true;
  }
  return false;
}

function main() {
  try {
    const { values } = parseArgs({
      options: {
        base: { type: "string", default: process.env.CHANGELOG_BASE ?? "origin/main" },
        event: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (values.help) {
      console.log("Usage: node scripts/check-changelog.mjs [--base <ref>] [--event <event.json>]");
      return 0;
    }
    const base = git("merge-base", values.base, "HEAD").trim();
    if (!git("diff", "--name-only", "-z", base, "HEAD")) {
      console.log("No changes to check.");
      return 0;
    }
    if (values.event && exempt(values.event)) return 0;
    if (hasEntry(base)) {
      console.log("Unreleased changelog entry found.");
      return 0;
    }
    console.error(
      "Add an entry under [Unreleased] in CHANGELOG.md, or use the explicit exemption described in CONTRIBUTING.md.",
    );
  } catch (error) {
    console.error(`Cannot validate changelog: ${error.message}`);
    console.error("Fetch the PR base, or set CHANGELOG_BASE to its local ref.");
  }
  return 1;
}

process.exitCode = main();
