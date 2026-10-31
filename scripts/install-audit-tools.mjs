import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Runs during devcontainer image construction. Release archives are pinned by SHA-256.
const destination = process.argv[2];
if (process.platform !== "linux" || !destination || !path.isAbsolute(destination))
  throw new Error("Supply an absolute binary destination inside the Linux devcontainer.");
const tools = JSON.parse(await readFile(new URL("../config/audit-tools.json", import.meta.url), "utf8"));
await mkdir(destination, { recursive: true });
const directory = await mkdtemp(path.join(tmpdir(), "kanbun-tools-"));
try {
  for (const [name, tool] of Object.entries(tools)) {
    const asset = tool.platforms[process.arch];
    if (!asset) throw new Error(`Unsupported audit tool architecture: ${process.arch}`);
    const response = await fetch(asset.url);
    if (!response.ok) throw new Error(`Cannot download ${name} ${tool.version}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256)
      throw new Error(`Release checksum mismatch for ${name} ${tool.version}`);
    const archive = path.join(directory, `${name}.tar.gz`);
    await writeFile(archive, bytes);
    execFileSync("tar", ["-xzf", archive, "-C", destination, tool.binary]);
    console.log(`Installed ${name} ${tool.version} (${process.arch}).`);
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
