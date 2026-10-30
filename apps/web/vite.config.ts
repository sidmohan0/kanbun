import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/sync": "http://localhost:8787", "/auth": "http://localhost:8787", "/api": "http://localhost:8787" },
  },
});
