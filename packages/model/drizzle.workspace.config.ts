import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  schema: "./src/workspace.ts",
  out: "./migrations/workspace",
});
