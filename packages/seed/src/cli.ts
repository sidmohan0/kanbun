/**
 * `pnpm seed [path.sqlite] [--issues=N]`: builds a seeded workspace database
 * and reports timings, including a cold bootstrap of a fresh client — the
 * phase-0 performance fixture.
 */
import { SyncServer } from "@kanbun/sync/server";
import { openWorkspaceDb } from "@kanbun/sync/server/node";
import { mutators, seedWorkspace } from "./index";

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith("--")) ?? ":memory:";
const issues = Number(args.find((a) => a.startsWith("--issues="))?.split("=")[1] ?? 5000);

const { driver } = openWorkspaceDb(path);
const server = new SyncServer({ driver, mutators });
const r = seedWorkspace(server, { issues });
console.log(`seeded ${path} in ${r.ms.toFixed(0)} ms:`, r.counts);

const t0 = performance.now();
const b = server.bootstrap({ id: r.ownerId, type: "user" }, "perf-client");
const t1 = performance.now();
const bytes = JSON.stringify(b).length;
const rows = Object.values(b.rows).reduce((n, xs) => n + (xs?.length ?? 0), 0);
console.log(
  `bootstrap: ${rows} rows, ${(bytes / 1e6).toFixed(2)} MB JSON, ${(t1 - t0).toFixed(0)} ms server-side, seq ${b.seq}`,
);
