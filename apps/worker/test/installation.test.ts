import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import type { Unstable_RawConfig } from "wrangler";
import { createRuntimeHarness } from "./harness";

it("the deploy-button setup profile serves assets while denying sign-in, fixture identities and workspace access", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const config = JSON.parse(await readFile(resolve(root, "wrangler.json"), "utf8")) as Unstable_RawConfig;
  // The fixture substitutes only the asset service; the shipped identity configuration is unchanged.
  delete config.assets;
  const harness = await createRuntimeHarness([
    {
      ...config,
      main: resolve(root, config.main!),
      d1_databases: config.d1_databases!.map((database) => ({
        ...database,
        migrations_dir: resolve(root, database.migrations_dir!),
      })),
      services: [{ binding: "ASSETS", service: "install-assets" }],
    },
    { name: "install-assets", main: "test/assets-worker.ts", compatibility_date: config.compatibility_date },
  ]);
  try {
    const { url } = await harness.listen();
    const shell = await fetch(new URL("/", url));
    expect(shell.status).toBe(200);
    expect(await shell.text()).toBe("Protected preview asset");
    for (const path of ["/api/auth/config", "/api/context", "/sync/bootstrap", "/sync/connect", "/api/members"]) {
      const response = await fetch(new URL(path, url), { headers: { "X-Kanbun-Local-Actor": "alice" } });
      expect(response.status).toBe(path === "/api/auth/config" ? 503 : 401);
      expect(response.headers.get("content-type")).toContain("application/json");
    }
    const seed = await fetch(new URL("/__local/seed", url), { method: "POST" });
    expect(seed.status).toBe(404);
  } finally {
    await harness.close();
  }
});
