import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "**/node_modules/",
    "**/.pnpm-store/",
    "**/dist/",
    "**/coverage/",
    "**/.wrangler/",
    "artifacts/recovery/",
    "artifacts/recovery-preflight/",
    "artifacts/deployment/",
    "artifacts/preview-health/",
    "artifacts/verification/",
    "artifacts/docs-drift/",
    "artifacts/launch/",
    "_to_delete/",
    "packages/model/migrations/",
    "SPEC.md",
    "docs/spec/",
  ]),
  {
    files: ["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"],
    extends: [js.configs.recommended],
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  {
    files: ["**/*.{ts,mts,cts,tsx}"],
    extends: [tseslint.configs.recommended],
  },
  {
    files: ["*.{js,mjs,cjs}", "scripts/**/*.{js,mjs,cjs}", "packages/**/*.{js,mjs,cjs,ts}", "apps/*/*.config.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/worker/src/**/*.ts"],
    languageOptions: { globals: globals.worker },
  },
  {
    files: ["apps/worker/test/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/web/src/**/*.{js,jsx,ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  eslintConfigPrettier,
]);
