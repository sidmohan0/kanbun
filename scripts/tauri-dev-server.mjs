import net from "node:net";
import { spawn } from "node:child_process";

const PORT = 3002;
const HOST = "127.0.0.1";

function isPortAvailable(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => resolve(false));
    server.listen({ port, host }, () => {
      server.close(() => resolve(true));
    });
  });
}

const available = await isPortAvailable(PORT, HOST);
if (!available) {
  console.error(
    `[tauri] Port ${PORT} is already in use. Stop the process using ${PORT} and rerun "npm run tauri dev".`
  );
  process.exit(1);
}

const child = spawn(
  "npx",
  ["next", "dev", "--hostname", HOST, "--port", String(PORT)],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
  }
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
