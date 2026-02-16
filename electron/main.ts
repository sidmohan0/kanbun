import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

// Start the embedded Hono server before opening the window
async function startEmbeddedServer() {
  const fs = await import("node:fs");

  // Resolve the app root — in packaged app this is Resources/app/
  const appRoot = path.resolve(__dirname, "..", "..");

  // dotenv — in production, look in user data dir; in dev, look in project root
  const dotenvPath = app.isPackaged
    ? path.join(app.getPath("userData"), ".env")
    : path.join(appRoot, ".env");
  if (fs.existsSync(dotenvPath)) {
    const lines = fs.readFileSync(dotenvPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  }

  // Use a stable user-data location for the database
  // In dev: project root/data/   In production: ~/Library/Application Support/kanbun/
  const userDataDir = app.isPackaged
    ? path.join(app.getPath("userData"))
    : path.join(appRoot, "data");

  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  // Copy DB from bundle to user data if it doesn't exist yet (first launch)
  const userDbPath = path.join(userDataDir, "kanbun.db");
  if (!fs.existsSync(userDbPath)) {
    // Check extraResources (packaged) or app root/data (dev)
    const bundledDb = app.isPackaged
      ? path.join(process.resourcesPath, "data", "kanbun.db")
      : path.join(appRoot, "data", "kanbun.db");
    if (fs.existsSync(bundledDb)) {
      fs.copyFileSync(bundledDb, userDbPath);
    }
  }

  // Set env so getDb() finds the right path
  process.env.KANBUN_DB_PATH = userDbPath;

  // Also set cwd to app root so static file serving works
  process.chdir(app.isPackaged ? path.join(process.resourcesPath, "app") : appRoot);

  // Import and start the server
  const { startServer } = await import(
    path.join(__dirname, "..", "src", "server", "start.js")
  );
  startServer();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "Kanbun",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  const PORT = Number(process.env.KANBUN_PORT ?? 7890);
  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await startEmbeddedServer();
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});
