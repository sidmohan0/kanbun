import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  root: "ui",
  build: { outDir: "../dist/ui" },
});
