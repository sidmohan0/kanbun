import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import type { Unstable_RawConfig } from "wrangler";
import { createRuntimeHarness } from "./harness";

it("the deploy-button setup profile serves assets while denying sign-in, fixture identities and workspace access", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const config = JSON.parse(await readFile(resolve(root, "wrangler.json"), "utf8")) as Unstable_RawConfig;
  if (config.vars?.["INSTALLATION_STAGE"] === "ready") {
    // Configured forks still exercise an unconfigured setup identity; the installer tests
    // separately require the actual ready profile to pass all deployment safety checks.
    config.vars = { LOCAL_DEV: "false", AUTH_MODE: "email", INSTALLATION_STAGE: "setup" };
    config.workers_dev = true;
    delete config.routes;
  }
  for (const key of [
    "APP_ORIGIN",
    "AUTH_EMAIL_DOMAIN",
    "AUTH_FROM_EMAIL",
    "TURNSTILE_SITE_KEY",
    "PREVIEW_OWNER_EMAIL",
    "PREVIEW_WORKSPACE_ID",
    "PREVIEW_WORKSPACE_NAME",
  ])
    expect(Object.hasOwn(config.vars!, key)).toBe(false);
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
    const signIn = await fetch(new URL("/api/auth/request", url), {
      method: "POST",
      headers: { "content-type": "application/json", origin: new URL(url).origin },
      body: JSON.stringify({ email: "owner@acme.dev", turnstileToken: "unconfigured-setup" }),
    });
    expect(signIn.status).toBe(503);
  } finally {
    await harness.close();
  }
});
