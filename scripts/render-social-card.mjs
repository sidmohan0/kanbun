#!/usr/bin/env node
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Use the repository's pinned Chromium package and render the tracked original SVG locally.
const require = createRequire(new URL("../packages/verifier/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const source = await readFile(new URL("../brand/svg/social-og-1200x630.svg", import.meta.url), "utf8");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0">${source}</body></html>`);
  await page.locator("svg").evaluate((svg) => svg.ownerDocument.fonts.ready);
  await page.locator("svg").screenshot({ path: fileURLToPath(new URL("../apps/web/public/og.png", import.meta.url)) });
} finally {
  await browser.close();
}
