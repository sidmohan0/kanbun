import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_KANBUN_PORT ?? "7891");
const baseURL =
  process.env.PLAYWRIGHT_KANBUN_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `KANBUN_PORT=${port} KANBUN_URL=${baseURL} OWNER_MODE_ENABLED=false pnpm exec next dev --turbopack --port ${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    url: baseURL,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
});
