import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { _electron as electron } from "@playwright/test";
import executablePath from "electron";

test("desktop shell isolates hosted content, restricts navigation and restores its session", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "kanbun-desktop-"));
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end('<title>kanbun fixture</title><h1>Workspace</h1><a href="file:///etc/passwd">Unsafe</a>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const launch = () =>
    electron.launch({
      executablePath: process.env.KANBUN_DESKTOP_EXECUTABLE ?? executablePath,
      args: process.env.KANBUN_DESKTOP_EXECUTABLE
        ? ["--no-sandbox"]
        : ["--no-sandbox", fileURLToPath(new URL("../dist/main.js", import.meta.url))],
      env: { ...process.env, KANBUN_DESKTOP_URL: url, XDG_CONFIG_HOME: directory },
    });
  let desktop;
  try {
    desktop = await launch();
    const page = await desktop.firstWindow();
    await page.waitForSelector("h1");
    assert.equal(await page.title(), "kanbun fixture");
    assert.equal(await page.evaluate(() => typeof window.require), "undefined");
    const preferences = await desktop.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      const preferences = contents.getLastWebPreferences();
      return {
        sandbox: preferences.sandbox,
        nodeIntegration: preferences.nodeIntegration,
        contextIsolation: preferences.contextIsolation,
      };
    });
    assert.deepEqual(preferences, { sandbox: true, nodeIntegration: false, contextIsolation: true });
    await page.evaluate(() => {
      localStorage.setItem("desktop-session-test", "retained");
      document.cookie = "session-test=retained; Max-Age=3600; SameSite=Lax";
    });
    await page.getByText("Unsafe").click();
    assert.equal(new URL(page.url()).origin, url);
    await page.evaluate(() => window.open("file:///etc/passwd"));
    assert.equal(desktop.windows().length, 1);
    await desktop.close();
    desktop = await launch();
    const restored = await desktop.firstWindow();
    await restored.waitForSelector("h1");
    assert.equal(await restored.evaluate(() => localStorage.getItem("desktop-session-test")), "retained");
    assert.match(await restored.evaluate(() => document.cookie), /session-test=retained/);
  } finally {
    if (desktop) await desktop.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
