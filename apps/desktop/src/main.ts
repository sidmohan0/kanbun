import { app, BrowserWindow, dialog, Menu, shell } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import { appUrl, linkAction } from "./policy.js";

const application = appUrl(process.env.KANBUN_DESKTOP_URL);
app.setName("kanbun");
let window: BrowserWindow | null = null;

async function openExternal(url: string) {
  try {
    await shell.openExternal(url);
  } catch {
    dialog.showErrorBox("Unable to open link", "Open this link in your browser instead.");
  }
}

function createWindow() {
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
  current.on("closed", () => {
    window = null;
  });
  void current.loadURL(application.href).catch(() => {});
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.show();
    window?.focus();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  void app.whenReady().then(() => {
    const menu: MenuItemConstructorOptions[] = [
      ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
      { role: "fileMenu" },
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
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}
