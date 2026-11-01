import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { startGithubRuntime, emailLink } from "@kanbun/worker/testing";
import { createServer } from "vite";

// A disposable local Worker and fake provider data; never touches a hosted workspace.
const root = fileURLToPath(new URL("../../..", import.meta.url));
const webRoot = path.join(root, "apps/web");
const output = path.resolve(root, process.env.KANBUN_CAPTURE_DIR ?? "output/ui-capture");
const temporary = await mkdtemp(path.join(tmpdir(), "kanbun-capture-hosted-"));
const runtime = await startGithubRuntime();
let browser, server;
try {
  let browserOrigin = "";
  server = await createServer({
    configFile: path.join(webRoot, "vite.config.ts"),
    root: webRoot,
    cacheDir: path.join(temporary, "vite"),
    server: {
      port: 0,
      strictPort: false,
      host: "127.0.0.1",
      hmr: false,
      proxy: {
        "/sync": {
          target: runtime.origin,
          ws: true,
          configure(proxy) {
            const authorize = (request, incoming) => {
              if (incoming.headers.origin === browserOrigin) request.setHeader("Origin", runtime.appOrigin);
            };
            proxy.on("proxyReq", authorize);
            proxy.on("proxyReqWs", authorize);
          },
        },
        "/api": {
          target: runtime.origin,
          configure(proxy) {
            proxy.on("proxyReq", (request, incoming) => {
              if (incoming.headers.origin === browserOrigin) request.setHeader("Origin", runtime.appOrigin);
            });
            proxy.on("proxyRes", (response) => {
              const location = response.headers.location;
              if (location?.startsWith(runtime.appOrigin + "/"))
                response.headers.location = browserOrigin + location.slice(runtime.appOrigin.length);
            });
          },
        },
        "/__local": runtime.origin,
      },
    },
  });
  await server.listen();
  browserOrigin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({ headless: true });
  const owner = await browser.newContext({
    viewport: { width: 1920, height: 1320 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const other = await browser.newContext({
    viewport: { width: 1920, height: 1320 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  for (const context of [owner, other])
    await context.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: 'window.turnstile={render(e,o){queueMicrotask(()=>o.callback("fixture-human-token"));return "fixture-widget"},reset(){},remove(){}};',
      }),
    );
  await owner.route("https://github.com/login/oauth/authorize?**", (route) => {
    const state = new URL(route.request().url()).searchParams.get("state");
    return route.fulfill({
      status: 302,
      headers: {
        location: `${browserOrigin}/api/integrations/github/callback?code=fixture-code&iss=${encodeURIComponent("https://github.com/login/oauth")}&state=${encodeURIComponent(state)}`,
      },
    });
  });
  const page = await owner.newPage();
  const names = [];
  const capture = async (p, name) => {
    await p.screenshot({ path: path.join(output, `${name}.png`), animations: "disabled" });
    names.push(name);
    console.log(`Captured ${name}`);
  };
  await page.goto(browserOrigin);
  await expect(page.getByRole("heading", { name: "Sign in to kanbun" })).toBeVisible();
  await capture(page, "15-hosted-sign-in");
  await page.getByRole("textbox", { name: "Email address" }).fill(runtime.ownerEmail);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await expect.poll(async () => (await runtime.capturedEmails()).length).toBe(1);
  await capture(page, "16-check-email");
  const link = emailLink((await runtime.capturedEmails())[0]);
  const wrongBrowser = await other.newPage();
  await wrongBrowser.goto(`${browserOrigin}/${link.hash}`);
  await expect(wrongBrowser.getByRole("alert")).toBeVisible();
  await capture(wrongBrowser, "17-unavailable-sign-in");
  await page.goto(`${browserOrigin}/${link.hash}`);
  await expect(page.getByRole("button", { name: `Sign in as ${runtime.ownerEmail}` })).toBeVisible();
  await capture(page, "18-confirm-sign-in");
  await page.getByRole("button", { name: `Sign in as ${runtime.ownerEmail}` }).click();
  await expect(page.locator(".sync-indicator")).toContainText("Saved");
  await page.getByRole("button", { name: "New issue" }).click();
  await page.getByRole("textbox", { name: "Issue title" }).fill("Track the pilot implementation");
  await page.getByRole("button", { name: "Create issue", exact: true }).click();
  await expect(page.locator(".sync-indicator")).toContainText("Saved");
  await page.goto(`${browserOrigin}/#members`);
  await expect(page.getByRole("heading", { name: "Members", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Members" })).toBeVisible();
  await capture(page, "19-members");
  await page.goto(`${browserOrigin}/#settings/integrations`);
  const connection = page.getByRole("region", { name: "GitHub connection" });
  await expect(connection.getByRole("button", { name: "Connect GitHub", exact: true })).toBeVisible();
  await connection.getByRole("button", { name: "Connect GitHub", exact: true }).click();
  await expect(connection.getByRole("combobox", { name: "GitHub repository" })).toContainText("example/pilot");
  await connection
    .getByRole("combobox", { name: "GitHub repository" })
    .selectOption({ label: "example/pilot (private repository)" });
  await connection.getByRole("button", { name: "Connect repository to team" }).click();
  await expect(connection.getByRole("button", { name: "Update GitHub authorization" })).toBeEnabled();
  await expect(connection.getByRole("button", { name: /^Disconnect example\/pilot from / })).toBeVisible();
  await capture(page, "20-integrations");
  await page.goto(`${browserOrigin}/#issues`);
  await page
    .getByRole("link", { name: /^Open KAN-/ })
    .first()
    .click();
  const development = page.getByRole("region", { name: "Development" });
  await development.getByRole("textbox", { name: "Pull request URL" }).fill("https://github.com/example/pilot/pull/42");
  await development.getByRole("button", { name: "Link pull request" }).click();
  await expect(development).toContainText("Ship the pilot");
  await capture(page, "21-issue-github");
  await page.getByRole("textbox", { name: "Add a comment" }).fill("Please review this implementation.");
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(page.getByText("Please review this implementation.")).toBeVisible();
  await expect(page.locator(".sync-indicator")).toContainText("Saved");
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /^Reply to/ })).toBeVisible();
  await capture(page, "22-comment-reply");
  await page.goto(`${browserOrigin}/#issues`);
  await expect(page.getByRole("link", { name: "example/pilot pull request #42: Ship the pilot" })).toBeVisible();
  await capture(page, "23-list-github");
  await writeFile(
    path.join(output, "HOSTED-FIXTURES.txt"),
    `Captured at 1920 × 1320 using a disposable local Worker and test accounts/provider data. No hosted account was accessed.\n${names.join("\n")}\n`,
  );
} finally {
  await browser?.close();
  await server?.close();
  await runtime.close();
  await rm(temporary, { recursive: true, force: true });
}
