import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { checkDocumentation } from "../src/docs.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "kanbun-docs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = {
    "package.json": JSON.stringify({
      name: "kanbun",
      description: "An issue tracker for people and agents.",
      scripts: { test: "node --test", "format:check": "prettier --check ." },
    }),
    "pnpm-workspace.yaml": "packages:\n  - apps/*\n  - packages/*\n",
    "apps/web/package.json": '{"name":"@kanbun/web"}',
    "packages/model/package.json": '{"name":"@kanbun/model"}',
    "README.md": [
      "# kanbun",
      "[Contributing](CONTRIBUTING.md#local-checks)",
      '<picture><source srcset="brand/logo.svg 1x, brand/logo.svg 2x"><img src="brand/logo.svg"></picture>',
      "<!-- workspace-inventory:start -->",
      "- `apps/web`",
      "- `packages/model`",
      "<!-- workspace-inventory:end -->",
      "The future `apps/worker` and `packages/events` are not implemented.",
      "The pnpm setup and pnpm version are described in this guide.",
      "Run `pnpm format:check` or `pnpm install --frozen-lockfile`.",
      "Examples can use `pnpm run <script>` and `pnpm --version` placeholders.",
      "[External](https://example.invalid/not-fetched)",
      "```text",
      "[Illustrative link](missing-example.md)",
      "pnpm illustrative-command",
      "```",
    ].join("\n"),
    "CONTRIBUTING.md": "# Contributing\n\n## Local checks\n\n```sh\npnpm test\n```\n",
    "CHANGELOG.md": "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Added initial behavior.\n",
    "docs/guide.md": "# Guide\n\n[README][home]\n\n[home]: ../README.md\n",
    "brand/KIT.txt": "Name         kanbun (lowercase)\nDescription  An issue tracker for people and agents.\n",
    "brand/logo.svg": '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    "apps/web/index.html":
      '<title>kanbun</title><meta name="description" content="An issue tracker for people and agents."><meta property="og:title" content="kanbun"><meta property="og:description" content="An issue tracker for people and agents."><link rel="icon" href="/favicon.svg"><script src="/src/main.tsx"></script>',
    "apps/web/public/manifest.webmanifest": JSON.stringify({
      name: "kanbun",
      short_name: "kanbun",
      description: "An issue tracker for people and agents.",
    }),
    "apps/web/public/favicon.svg": '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    "apps/web/src/main.tsx": "export {};\n",
  };
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  return root;
}

test("valid documentation permits planned paths and ignores literal examples and remote links", (t) => {
  const results = checkDocumentation(fixture(t));
  assert.equal(
    results.every((result) => result.pass),
    true,
    JSON.stringify(results),
  );
});

test("local documentation links catch missing files, casing, and heading anchors", (t) => {
  const root = fixture(t);
  writeFileSync(
    join(root, "README.md"),
    "[Missing](missing.md)\n[Wrong case](contributing.md)\n[Heading](CONTRIBUTING.md#absent)\n",
  );
  const result = checkDocumentation(root).find((entry) => entry.name === "documentation links");
  assert.equal(result.pass, false);
  assert.match(result.details, /missing\.md/);
  assert.match(result.details, /contributing\.md/);
  assert.match(result.details, /#absent/);
});

test("HTML and reference-style assets are checked relative to their document", (t) => {
  const root = fixture(t);
  writeFileSync(join(root, "docs/guide.md"), '<img src="missing.png">\n[Missing][target]\n\n[target]: absent.md\n');
  const result = checkDocumentation(root).find((entry) => entry.name === "documentation links");
  assert.equal(result.pass, false);
  assert.match(result.details, /docs\/guide\.md: missing\.png/);
  assert.match(result.details, /absent\.md/);
});

test("stale inline and shell-fenced script commands are reported without executing them", (t) => {
  const root = fixture(t);
  writeFileSync(
    join(root, "CONTRIBUTING.md"),
    "# Contributing\n\n## Local checks\n\nRun `pnpm removed-script`.\n\n```bash\npnpm --silent run old-command\n```\n",
  );
  const result = checkDocumentation(root).find((entry) => entry.name === "documented commands");
  assert.equal(result.pass, false);
  assert.match(result.details, /removed-script/);
  assert.match(result.details, /old-command/);
});

test("product metadata reports stale manifest, HTML, and kit descriptions", (t) => {
  const root = fixture(t);
  for (const path of ["apps/web/public/manifest.webmanifest", "apps/web/index.html", "brand/KIT.txt"]) {
    const file = join(root, path);
    writeFileSync(
      file,
      readFileSync(file, "utf8").replaceAll("An issue tracker for people and agents.", "An outdated description."),
    );
  }
  const result = checkDocumentation(root).find((entry) => entry.name === "product metadata");
  assert.equal(result.pass, false);
  assert.match(result.details, /web manifest description/);
  assert.match(result.details, /HTML description/);
  assert.match(result.details, /brand kit description/);
});

test("a newly added workspace must appear in the marked README inventory", (t) => {
  const root = fixture(t);
  mkdirSync(join(root, "packages/new-feature"));
  writeFileSync(join(root, "packages/new-feature/package.json"), '{"name":"@kanbun/new-feature"}');
  const result = checkDocumentation(root).find((entry) => entry.name === "workspace inventory");
  assert.equal(result.pass, false);
  assert.match(result.details, /missing packages\/new-feature/);
});

test("unsupported workspace globs fail explicitly instead of silently missing packages", (t) => {
  const root = fixture(t);
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'packages/**'\n");
  const result = checkDocumentation(root).find((entry) => entry.name === "workspace inventory");
  assert.equal(result.pass, false);
  assert.match(result.details, /unsupported workspace pattern/);
});

test("an empty Unreleased section is valid, but empty bullets and duplicate headings are not", (t) => {
  const root = fixture(t);
  const file = join(root, "CHANGELOG.md");
  writeFileSync(file, "# Changelog\n\n## [Unreleased]\n\n## [1.0.0]\n\n- Historical `pnpm obsolete-command`.\n");
  assert.equal(checkDocumentation(root).find((entry) => entry.name === "changelog structure").pass, true);
  assert.equal(checkDocumentation(root).find((entry) => entry.name === "documented commands").pass, true);
  writeFileSync(file, "# Changelog\n\n## [Unreleased]\n\n- \n");
  assert.equal(checkDocumentation(root).find((entry) => entry.name === "changelog structure").pass, false);
  writeFileSync(file, "# Changelog\n\n## [Unreleased]\n\n## [Unreleased]\n");
  assert.equal(checkDocumentation(root).find((entry) => entry.name === "changelog structure").pass, false);
});
