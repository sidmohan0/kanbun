import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const read = (root, path) => readFileSync(join(root, path), "utf8");
const json = (root, path) => JSON.parse(read(root, path));

function withoutFences(text, shellSnippets) {
  let fence;
  let language;
  let body = [];
  return text
    .split("\n")
    .map((line) => {
      const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (!fence && match) {
        fence = match[1];
        language = match[2].trim();
        body = [];
      } else if (fence && new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(line)) {
        if (["", "sh", "bash", "shell", "zsh"].includes(language)) shellSnippets?.push(body.join("\n"));
        fence = undefined;
      } else if (!fence) return line;
      else body.push(line);
      return "";
    })
    .join("\n");
}

function documents(root) {
  const paths = ["README.md", "CONTRIBUTING.md", "CHANGELOG.md"];
  function walk(directory) {
    if (!existsSync(join(root, directory))) return;
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && /\.(?:md|html?)$/i.test(entry.name)) paths.push(path);
    }
  }
  walk("docs");
  return paths;
}

function attributes(tag) {
  return Object.fromEntries(
    Array.from(tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g), (match) => [
      match[1].toLowerCase(),
      match[2] ?? match[3],
    ]),
  );
}

function references(text) {
  const refs = [];
  const prose = text.replace(/(`+)[\s\S]*?\1/g, "");
  const definitions = new Map();
  for (const match of prose.matchAll(/^ {0,3}\[([^\]]+)\]:\s*(<[^>]+>|\S+)/gm)) {
    definitions.set(match[1].trim().toLowerCase(), match[2].replace(/^<|>$/g, ""));
  }
  for (const match of prose.matchAll(/!?\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^\s)]+)(?:\s+["'][^\n]*?["'])?\s*\)/g)) {
    refs.push(match[1].replace(/^<|>$/g, ""));
  }
  for (const match of prose.matchAll(/!?\[([^\]\n]+)\](?:\[([^\]\n]*)\])?/g)) {
    const destination = definitions.get((match[2] || match[1]).trim().toLowerCase());
    if (destination) refs.push(destination);
  }
  for (const match of prose.matchAll(/<(?:a|img|source|script|link)\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    for (const name of ["src", "href"]) if (attrs[name]) refs.push(attrs[name]);
    if (attrs.srcset && !attrs.srcset.startsWith("data:")) {
      refs.push(...attrs.srcset.split(",").map((candidate) => candidate.trim().split(/\s+/)[0]));
    }
  }
  return refs;
}

function anchors(text) {
  const found = new Set();
  for (const match of text.matchAll(/<[a-z][\w:-]*\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    if (attrs.id || attrs.name) found.add(attrs.id || attrs.name);
  }
  for (const match of withoutFences(text).matchAll(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = match[1]
      .replace(/<[^>]*>/g, "")
      .replace(/[`*_~]/g, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
      .replace(/\s/g, "-");
    let slug = base;
    for (let index = 1; found.has(slug); index++) slug = `${base}-${index}`;
    found.add(slug);
  }
  return found;
}

function localTarget(root, document, reference) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) return null;
  const [rawPath, rawAnchor] = reference.split("#", 2);
  const path = decodeURIComponent(rawPath.split("?", 1)[0]);
  const anchor = rawAnchor ? decodeURIComponent(rawAnchor) : "";
  let target;
  if (!path) target = resolve(root, document);
  else if (path.startsWith("/") && document === "apps/web/index.html") {
    target = resolve(root, path.startsWith("/src/") ? "apps/web" : "apps/web/public", path.slice(1));
  } else target = path.startsWith("/") ? resolve(root, path.slice(1)) : resolve(root, dirname(document), path);
  const inside = relative(root, target);
  if (isAbsolute(inside) || inside === ".." || inside.startsWith(`..${sep}`))
    throw new Error("target leaves repository");
  let current = root;
  for (const part of inside.split(sep).filter(Boolean)) {
    if (!readdirSync(current).includes(part)) throw new Error("target is missing or has different letter casing");
    current = join(current, part);
  }
  if (anchor) {
    const headingFile = statSync(target).isDirectory() ? join(target, "README.md") : target;
    if (!/\.md$/i.test(headingFile) || !anchors(readFileSync(headingFile, "utf8")).has(anchor)) {
      throw new Error(`heading anchor #${anchor} is missing`);
    }
  }
  return target;
}

function linkErrors(root) {
  const errors = [];
  for (const document of [...documents(root), "apps/web/index.html"]) {
    const text = withoutFences(read(root, document));
    for (const reference of references(text)) {
      try {
        localTarget(root, document, reference);
      } catch (error) {
        errors.push(`${document}: ${reference}: ${error.message}`);
      }
    }
  }
  return errors;
}

function commandErrors(root) {
  const scripts = json(root, "package.json").scripts ?? {};
  const builtins = new Set([
    "install",
    "audit",
    "run",
    "exec",
    "dlx",
    "add",
    "remove",
    "update",
    "list",
    "why",
    "licenses",
  ]);
  const errors = [];
  for (const document of documents(root)) {
    if (/^docs\/spec\/SPEC-v/.test(document)) continue;
    // Check executable shell fences and inline snippets, but not literal text examples.
    let text = read(root, document);
    if (document === "CHANGELOG.md") {
      const heading = /^## \[Unreleased\][ \t]*$/m.exec(text);
      text = heading ? text.slice(heading.index + heading[0].length).split(/^## /m, 1)[0] : "";
    }
    const snippets = [];
    const prose = withoutFences(text, snippets);
    for (const match of prose.matchAll(/(`+)([\s\S]*?)\1/g)) snippets.push(match[2]);
    for (const snippet of snippets) {
      for (const match of snippet.matchAll(/\bpnpm[ \t]+(?:--silent[ \t]+)?(?:run[ \t]+)?([a-zA-Z][\w:.-]*)/g)) {
        const command = match[1];
        if (!builtins.has(command) && !Object.hasOwn(scripts, command)) {
          errors.push(`${document}: pnpm ${command} is not a root package script or recognized built-in`);
        }
      }
    }
  }
  return [...new Set(errors)];
}

function metadataErrors(root) {
  const manifest = json(root, "package.json");
  const web = json(root, "apps/web/public/manifest.webmanifest");
  const kit = read(root, "brand/KIT.txt");
  const html = read(root, "apps/web/index.html");
  const metas = new Map();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    metas.set(attrs.name || attrs.property, attrs.content);
  }
  const errors = [];
  const compare = (label, actual, expected) => {
    if (typeof expected !== "string" || !expected.trim() || actual !== expected)
      errors.push(`${label} differs from root package metadata`);
  };
  compare("web manifest name", web.name, manifest.name);
  compare("web manifest short_name", web.short_name, manifest.name);
  compare("web manifest description", web.description, manifest.description);
  compare("HTML title", /<title>([^<]*)<\/title>/i.exec(html)?.[1], manifest.name);
  compare("HTML description", metas.get("description"), manifest.description);
  compare("Open Graph title", metas.get("og:title"), manifest.name);
  compare("Open Graph description", metas.get("og:description"), manifest.description);
  compare("brand kit name", /^Name[ \t]+(\S+)/m.exec(kit)?.[1], manifest.name);
  compare("brand kit description", /^Description[ \t]+(.+)$/m.exec(kit)?.[1], manifest.description);
  return errors;
}

function changelogErrors(root) {
  const text = withoutFences(read(root, "CHANGELOG.md"));
  const headings = [...text.matchAll(/^## \[Unreleased\][ \t]*$/gm)];
  if (headings.length !== 1) return ["CHANGELOG.md must contain one exact ## [Unreleased] heading"];
  const section = text.slice(headings[0].index + headings[0][0].length).split(/^## /m, 1)[0];
  return /^\s*-\s*$/m.test(section) ? ["CHANGELOG.md has an empty Unreleased bullet"] : [];
}

function inventoryErrors(root) {
  const yaml = read(root, "pnpm-workspace.yaml");
  const section = /^packages:[ \t]*(?:#.*)?\n((?:(?:[ \t]+[^\n]*|[ \t]*|#[^\n]*)\n?)*)/m.exec(yaml)?.[1];
  if (section === undefined) throw new Error("pnpm-workspace.yaml must declare a packages list");
  const expected = new Set();
  for (const line of section.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const pattern = /^[ \t]+-[ \t]+(?:'([^']+)'|"([^"]+)"|([^#\s]+))[ \t]*(?:#.*)?$/.exec(line);
    const value = pattern?.[1] ?? pattern?.[2] ?? pattern?.[3];
    if (!value || !/^[\w.-]+(?:\/[\w.-]+)*(?:\/\*)?$/.test(value)) {
      throw new Error(`unsupported workspace pattern: ${line.trim()}`);
    }
    const paths = value.endsWith("/*")
      ? readdirSync(join(root, value.slice(0, -2)), { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith("."))
          .map((entry) => `${value.slice(0, -1)}${entry.name}`)
      : [value];
    for (const path of paths) if (existsSync(join(root, path, "package.json"))) expected.add(path);
  }
  const readme = read(root, "README.md");
  const marker = /<!-- workspace-inventory:start -->([\s\S]*?)<!-- workspace-inventory:end -->/g;
  const blocks = [...readme.matchAll(marker)];
  if (blocks.length !== 1) return ["README.md must contain one marked workspace inventory"];
  const documented = [...blocks[0][1].matchAll(/^- `([^`]+)`[ \t]*$/gm)].map((match) => match[1]);
  const errors = [];
  if (new Set(documented).size !== documented.length) errors.push("README.md workspace inventory contains duplicates");
  for (const path of expected)
    if (!documented.includes(path)) errors.push(`README.md workspace inventory is missing ${path}`);
  for (const path of documented)
    if (!expected.has(path)) errors.push(`README.md workspace inventory lists absent workspace ${path}`);
  return errors;
}

/** Deterministic documentation contracts; prose accuracy still requires review. */
export function checkDocumentation(root) {
  root = resolve(root);
  return [
    ["documentation links", linkErrors],
    ["documented commands", commandErrors],
    ["product metadata", metadataErrors],
    ["changelog structure", changelogErrors],
    ["workspace inventory", inventoryErrors],
  ].map(([name, check]) => {
    try {
      const errors = check(root);
      return { name, pass: errors.length === 0, details: errors.join("; ") || "Consistent" };
    } catch (error) {
      return { name, pass: false, details: error.message };
    }
  });
}
