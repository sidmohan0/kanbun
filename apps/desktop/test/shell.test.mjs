import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { _electron as electron, expect } from "@playwright/test";
import executablePath from "electron";
import { readHookStatuses } from "../dist/hook-store.js";
import { hookCommand } from "../dist/hook-setup.js";

test("an email callback delivered by the OS returns to the requesting desktop session", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "kanbun-desktop-signin-"));
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end("<h1>Check your email</h1>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const token = "a".repeat(43);
  const hash = `#signin/${token}/%23settings%2Fintegrations`;
  const callback = `kanbun://signin/${token}/%23settings%2Fintegrations`;
  const launch = (extra = []) =>
    electron.launch({
      executablePath: process.env.KANBUN_DESKTOP_EXECUTABLE ?? executablePath,
      args: (process.env.KANBUN_DESKTOP_EXECUTABLE
        ? ["--no-sandbox"]
        : ["--no-sandbox", fileURLToPath(new URL("../dist/main.js", import.meta.url))]
      ).concat(extra),
      env: { ...process.env, KANBUN_DESKTOP_URL: origin, XDG_CONFIG_HOME: directory },
    });
  let desktop;
  try {
    desktop = await launch(["--background"]);
    assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 0);
    await desktop.evaluate(({ app }) => app.emit("second-instance", {}, ["kanbun"]));
    const page = await desktop.firstWindow();
    await page.waitForSelector("h1");
    await page.evaluate(() => localStorage.setItem("requesting-session", "desktop"));
    await desktop.evaluate(({ app }, url) => {
      app.emit("open-url", { preventDefault() {} }, url);
    }, callback);
    await page.waitForURL(`${origin}/${hash}`, { timeout: 2000 });
    assert.equal(await page.evaluate(() => localStorage.getItem("requesting-session")), "desktop");
    await page.goto(origin);
    await desktop.evaluate(({ app }, url) => {
      app.emit("second-instance", {}, ["kanbun", url]);
    }, callback);
    await page.waitForURL(`${origin}/${hash}`, { timeout: 2000 });
    await page.goto(origin);
    await desktop.evaluate(async ({ clipboard, Menu }, url) => {
      await clipboard.writeText(url);
      Menu.getApplicationMenu().getMenuItemById("open-signin-link").click();
    }, `${origin}/${hash}`);
    await page.waitForURL(`${origin}/${hash}`, { timeout: 2000 });
    await desktop.close();
    desktop = await launch([callback]);
    const restarted = await desktop.firstWindow();
    await restarted.waitForURL(`${origin}/${hash}`, { timeout: 2000 });
    assert.equal(await restarted.evaluate(() => localStorage.getItem("requesting-session")), "desktop");
  } finally {
    await desktop?.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("the early hook bootstrap handles events without waiting for stdin EOF", async () => {
  const spool = await mkdtemp(path.join(tmpdir(), "kanbun-desktop-hook-"));
  const child = spawn(executablePath, ["--no-sandbox", fileURLToPath(new URL("../dist/main.js", import.meta.url))], {
    env: {
      ...process.env,
      KANBUN_SESSION_HOOK: "1",
      KANBUN_SESSION_HOOK_PROVIDER: "codex",
      KANBUN_SESSION_HOOK_DIRECTORY: spool,
    },
    stdio: ["pipe", "ignore", "pipe"],
  });
  const stderr = [];
  child.stderr.setEncoding("utf8").on("data", (chunk) => stderr.push(chunk));
  child.stdin.write(JSON.stringify({ session_id: "early-hook", hook_event_name: "UserPromptSubmit" }));
  try {
    let timeout;
    const result = await Promise.race([
      new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal }))),
      new Promise((resolve) => (timeout = setTimeout(() => resolve("timeout"), 5000))),
    ]);
    clearTimeout(timeout);
    if (result === "timeout") child.kill("SIGKILL");
    assert.notEqual(result, "timeout", `hook bootstrap did not exit: ${stderr.join("")}`);
    assert.deepEqual(result, { code: 0, signal: null }, stderr.join(""));
    assert.equal((await readHookStatuses(spool)).get("codex:early-hook"), "running");
  } finally {
    child.kill("SIGKILL");
    await rm(spool, { recursive: true, force: true });
  }
});

test("the macOS generated command streams hook input through a temporary FIFO", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "kanbun packaged fifo "));
  const spool = path.join(directory, "kanbun observer with spaces");
  const launcher = path.join(directory, "kanbun hook launcher");
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  const main = fileURLToPath(new URL("../dist/main.js", import.meta.url));
  try {
    await writeFile(launcher, `#!/bin/sh\nexec ${quote(executablePath)} --no-sandbox ${quote(main)} "$@"\n`);
    await chmod(launcher, 0o700);
    const command = hookCommand("codex", launcher, "unused", spool, "darwin");
    const result = spawnSync(command, {
      shell: true,
      input: JSON.stringify({
        session_id: "fifo-hook",
        hook_event_name: "UserPromptSubmit",
        prompt: "private fifo fixture",
      }),
      encoding: "utf8",
      timeout: 10000,
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...process.env, TMPDIR: directory },
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    assert.equal((await readHookStatuses(spool)).get("codex:fifo-hook"), "running");
    const records = await readdir(spool);
    assert.doesNotMatch(await readFile(path.join(spool, records[0]), "utf8"), /private fifo fixture/);
    assert.equal(
      (await readdir(directory)).some((name) => name.startsWith("kanbun-session-hook.")),
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("desktop shell isolates hosted content, restricts navigation and restores its session", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "kanbun-desktop-"));
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<title>kanbun fixture</title><h1>Workspace</h1><a href="file:///etc/passwd">Unsafe</a><a href="/?kanbun-browser=integrations#settings/integrations" target="_blank">Manage integrations in browser</a>',
    );
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
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
    await desktop.evaluate(({ app }) => app.emit("second-instance", {}, ["kanbun"]));
    assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);

    await page.evaluate(() => {
      localStorage.setItem("desktop-session-test", "retained");
      document.cookie = "session-test=retained; Max-Age=3600; SameSite=Lax";
    });
    // Replace only the OS boundary; the real renderer click and shell navigation policy remain active.
    await desktop.evaluate(({ shell }) => {
      globalThis.openedBrowserLinks = [];
      shell.openExternal = async (value) => {
        globalThis.openedBrowserLinks.push(value);
      };
    });
    await page.getByText("Manage integrations in browser", { exact: true }).click();
    await expect
      .poll(() => desktop.evaluate(() => globalThis.openedBrowserLinks))
      .toEqual([`${url}/#settings/integrations`]);
    assert.equal(page.url(), `${url}/`);
    assert.equal(desktop.windows().length, 1);
    assert.match(await page.evaluate(() => document.cookie), /session-test=retained/);
    const csvFile = path.join(directory, "workspace-export.csv");
    await desktop.evaluate(({ BrowserWindow }, filename) => {
      globalThis.csvDownloadState = "waiting";
      BrowserWindow.getAllWindows()[0].webContents.session.once("will-download", (_event, item) => {
        item.setSavePath(filename);
        item.once("done", (_finished, state) => {
          globalThis.csvDownloadState = state;
        });
      });
    }, csvFile);
    await page.evaluate(() => {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob(["ID\r\n42\r\n"], { type: "text/csv" }));
      link.download = "kanbun-issues.csv";
      document.body.append(link);
      link.click();
      link.remove();
    });
    await expect.poll(() => desktop.evaluate(() => globalThis.csvDownloadState)).toBe("completed");
    assert.equal(await readFile(csvFile, "utf8"), "ID\r\n42\r\n");
    assert.equal(page.url(), `${url}/`);
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

test("a second process can disable startup and both instances exit", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "kanbun-desktop-remove-"));
  const executable = process.env.KANBUN_DESKTOP_EXECUTABLE ?? executablePath;
  const args = process.env.KANBUN_DESKTOP_EXECUTABLE
    ? ["--no-sandbox"]
    : ["--no-sandbox", fileURLToPath(new URL("../dist/main.js", import.meta.url))];
  const env = { ...process.env, KANBUN_DESKTOP_URL: "http://127.0.0.1:1", XDG_CONFIG_HOME: directory };
  let desktop;
  try {
    desktop = await electron.launch({ executablePath: executable, args: [...args, "--background"], env });
    const firstExited = new Promise((resolve) => desktop.process().once("exit", resolve));
    const child = spawn(executable, [...args, "--remove-startup"], { env, stdio: "ignore" });
    const status = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("Removal process did not exit"));
      }, 10000);
      child.on("error", reject);
      child.on("exit", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });
    assert.equal(status, 0);
    await Promise.race([
      firstExited,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Running app did not exit")), 10000)),
    ]);
  } finally {
    await desktop?.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});
