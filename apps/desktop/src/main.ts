import { app, BrowserWindow, clipboard, dialog, Menu, nativeImage, shell, Tray } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectSessions, type Collection } from "./collector.js";
import { configureHooks } from "./hook-setup.js";
import { readHookStatuses } from "./hook-store.js";
import { linuxAutostart } from "./autostart.js";
import type { MenuItemConstructorOptions } from "electron";
import { appUrl, linkAction, signInDestination } from "./policy.js";

const application = appUrl(process.env.KANBUN_DESKTOP_URL);
app.setName("kanbun");
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let collection: Collection | null = null;
let collecting = false;
let hookStatuses = new Map<string, string>();
let hooksLoading = false;
let hookTimer: ReturnType<typeof setInterval> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let loginEnabled = false;

async function setLogin(enabled: boolean) {
  if (!app.isPackaged) return;
  if (process.platform === "linux") await linuxAutostart(enabled, process.env.APPIMAGE || process.execPath);
  else app.setLoginItemSettings({ openAtLogin: enabled, args: ["--background"], name: "kanbun" });
  loginEnabled = enabled;
  updateTray();
}

function showWindow() {
  if (!window) createWindow();
  else {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
}

async function refreshSessions() {
  if (collecting) return;
  collecting = true;
  try {
    collection = await collectSessions();
  } finally {
    collecting = false;
    updateTray();
  }
}

async function changeHooks(provider: "codex" | "claude", enabled: boolean) {
  try {
    const directory = path.join(app.getPath("userData"), "kanbun-session-observer");
    await configureHooks(
      provider,
      enabled,
      process.execPath,
      path.join(path.dirname(fileURLToPath(import.meta.url)), "hook.js"),
      directory,
    );
    await dialog.showMessageBox({
      message: enabled ? `${provider} hooks configured` : `${provider} hooks removed`,
      detail:
        enabled && provider === "codex"
          ? "Review and trust the new hooks using /hooks in Codex. Existing sessions may need to be restarted."
          : "Existing sessions may need to be restarted. Session data stays on this computer.",
    });
  } catch (error) {
    dialog.showErrorBox(
      "Unable to update hooks",
      error instanceof Error ? error.message : "Check provider settings permissions.",
    );
  }
}

async function refreshHooks() {
  if (hooksLoading) return;
  hooksLoading = true;
  try {
    hookStatuses = await readHookStatuses(path.join(app.getPath("userData"), "kanbun-session-observer"));
  } catch {
    hookStatuses = new Map();
  }
  hooksLoading = false;
  updateTray();
}

async function showSessions() {
  await refreshHooks();
  const statuses = hookStatuses;
  const known = new Set(collection?.sessions.map((item) => `${item.provider}:${item.id}`) ?? []);
  const discovered = [...statuses.keys()]
    .filter((key) => !known.has(key))
    .map((key) => {
      const [provider, id] = key.split(":");
      return {
        provider: provider as "codex" | "claude",
        id: id!,
        title: `Session ${id}`,
        updatedAt: Date.now(),
        status: "unknown",
      };
    });
  const rows =
    [...(collection?.sessions ?? []), ...discovered]
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 30) ?? [];
  const detail = rows
    .map(
      (item) =>
        `${item.provider}: ${item.title} (${statuses.get(`${item.provider}:${item.id}`) ?? "unknown"}; ${new Date(item.updatedAt).toLocaleString()})`,
    )
    .join("\n");
  void dialog.showMessageBox({
    title: "Agent sessions",
    message: collection ? `${collection.sessions.length} sessions observed locally` : "Collecting sessions…",
    detail: [
      detail,
      ...(collection?.errors ?? []),
      "Status is unknown when the provider cannot report it. No session data is uploaded.",
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
}

function updateTray() {
  if (!tray) return;
  tray.setToolTip("Kanbun — agent session collector");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: `Agent activity: ${[...hookStatuses.values()].filter((v) => v === "running").length} running, ${[...hookStatuses.values()].filter((v) => v === "waiting").length} waiting`,
        enabled: false,
      },
      { label: "Open Kanbun", click: showWindow },
      { label: "Agent sessions…", click: () => void showSessions() },
      {
        label: "Live status hooks",
        submenu: [
          { label: "Enable Codex hooks", click: () => void changeHooks("codex", true) },
          { label: "Disable Codex hooks", click: () => void changeHooks("codex", false) },
          { label: "Enable Claude Code hooks", click: () => void changeHooks("claude", true) },
          { label: "Disable Claude Code hooks", click: () => void changeHooks("claude", false) },
        ],
      },
      {
        label: collecting ? "Refreshing…" : "Refresh sessions",
        enabled: !collecting,
        click: () => void refreshSessions(),
      },
      { type: "separator" },
      {
        label: "Start at login",
        type: "checkbox",
        checked: loginEnabled,
        enabled: app.isPackaged,
        click: (item) =>
          void setLogin(item.checked).catch(() =>
            dialog.showErrorBox("Unable to update startup", "Check your system login settings."),
          ),
      },
      {
        label: "Disable startup and quit",
        enabled: app.isPackaged,
        click: () =>
          void setLogin(false)
            .then(() => {
              quitting = true;
              app.quit();
            })
            .catch(() => dialog.showErrorBox("Unable to disable startup", "Check your system login settings.")),
      },
      {
        label: "Quit Kanbun",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

let pendingSignIn = process.argv.map((value) => signInDestination(value, application)).find(Boolean) ?? null;

function receiveSignIn(value: string): boolean {
  const destination = signInDestination(value, application);
  if (!destination) return false;
  if (!app.isReady()) pendingSignIn = destination;
  else if (!window) createWindow(destination);
  else {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    void window.loadURL(destination).catch(() => {});
  }
  return true;
}

// macOS can deliver the launch URL before ready or before the first window exists.
app.on("open-url", (event, value) => {
  event.preventDefault();
  receiveSignIn(value);
});

async function openExternal(url: string) {
  try {
    await shell.openExternal(url);
  } catch {
    dialog.showErrorBox("Unable to open link", "Open this link in your browser instead.");
  }
}

async function openClipboardSignIn() {
  try {
    if (receiveSignIn(await clipboard.readText())) return;
  } catch {
    // Clipboard failures and invalid links share a response that never echoes their contents.
  }
  dialog.showErrorBox("Invalid sign-in link", "Copy the complete sign-in link from your Kanbun email, then try again.");
}

function createWindow(destination = pendingSignIn ?? application.href) {
  pendingSignIn = null;
  const current = new BrowserWindow({
    title: "kanbun",
    width: 1280,
    height: 850,
    minWidth: 800,
    minHeight: 600,
    show: false,
    webPreferences: {
      partition: "persist:kanbun",
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
    },
  });
  window = current;
  current.webContents.setUserAgent(`${current.webContents.getUserAgent()} KanbunDesktop/1.0`);
  current.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  current.webContents.session.setPermissionCheckHandler(() => false);
  current.webContents.on("will-attach-webview", (event) => event.preventDefault());
  current.webContents.on("will-navigate", (event, url) => {
    const action = linkAction(url, application);
    if (action !== "internal") {
      event.preventDefault();
      if (action === "external") void openExternal(url);
    }
  });
  current.webContents.on("will-redirect", (event, url) => {
    if (linkAction(url, application) !== "internal") event.preventDefault();
  });
  current.webContents.setWindowOpenHandler(({ url }) => {
    const action = linkAction(url, application);
    if (action === "internal") void current.loadURL(url);
    else if (action === "external") void openExternal(url);
    return { action: "deny" };
  });
  current.webContents.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) {
      current.show();
      void dialog.showMessageBox(current, {
        type: "error",
        message: "Unable to load kanbun",
        detail: "Check your connection and use View → Reload to try again.",
      });
    }
  });
  current.once("ready-to-show", () => current.show());
  current.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      current.hide();
    }
  });
  current.on("closed", () => {
    window = null;
  });
  void current.loadURL(destination).catch(() => {});
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else if (process.platform === "darwin" && process.argv.includes("--remove-startup")) {
  // A running instance can exit after handling this command before the new
  // process checks the lock. Electron may never reach ready in that race.
  try {
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: false, args: ["--background"], name: "kanbun" });
    app.exit(0);
  } catch {
    app.exit(1);
  }
} else {
  app.on("second-instance", (_event, commandLine) => {
    if (commandLine.includes("--remove-startup")) {
      void setLogin(false)
        .then(() => {
          quitting = true;
          app.quit();
        })
        .catch(() => dialog.showErrorBox("Unable to disable startup", "Check your system login settings."));
      return;
    }
    for (const value of commandLine) if (receiveSignIn(value)) return;
    if (!commandLine.includes("--background")) showWindow();
  });
  app.on("before-quit", () => {
    quitting = true;
    if (timer) clearInterval(timer);
    if (hookTimer) clearInterval(hookTimer);
  });
  void app.whenReady().then(async () => {
    if (process.argv.includes("--remove-startup")) {
      try {
        await setLogin(false);
      } catch {
        app.exit(1);
        return;
      }
      app.exit(0);
      return;
    }
    if (app.isPackaged) app.setAsDefaultProtocolClient("kanbun");
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, "tray.png")
      : path.join(path.dirname(fileURLToPath(import.meta.url)), "../../web/public/icons/icon-192.png");
    tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 20, height: 20 }));
    tray.on("click", showWindow);
    if (app.isPackaged) {
      if (process.platform !== "linux") loginEnabled = app.getLoginItemSettings({ args: ["--background"] }).openAtLogin;
      // Enable on first launch; subsequently preserve the user's explicit choice.
      const { existsSync, writeFileSync, mkdirSync } = await import("node:fs");
      const marker = path.join(app.getPath("userData"), "startup-configured");
      if (!existsSync(marker)) {
        try {
          await setLogin(true);
          mkdirSync(path.dirname(marker), { recursive: true });
          writeFileSync(marker, "1", { mode: 0o600 });
        } catch {
          dialog.showErrorBox("Unable to enable startup", "Enable Kanbun at login from the tray menu.");
        }
      } else if (process.platform === "linux") {
        const { autostartPath } = await import("./autostart.js");
        loginEnabled = existsSync(autostartPath());
      }
    }
    updateTray();
    void refreshSessions();
    timer = setInterval(() => void refreshSessions(), 30000);
    void refreshHooks();
    hookTimer = setInterval(() => void refreshHooks(), 3000);
    const menu: MenuItemConstructorOptions[] = [
      ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
      {
        label: "File",
        submenu: [
          {
            id: "open-signin-link",
            label: "Open sign-in link from clipboard",
            accelerator: "CmdOrCtrl+Shift+O",
            click: () => void openClipboardSignIn(),
          },
          { type: "separator" },
          { role: process.platform === "darwin" ? "close" : "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
    const launchedAtLogin =
      app.isPackaged && process.platform === "darwin" && app.getLoginItemSettings().wasOpenedAtLogin;
    if ((!process.argv.includes("--background") && !launchedAtLogin) || pendingSignIn) createWindow();
    app.on("activate", showWindow);
  });
}
