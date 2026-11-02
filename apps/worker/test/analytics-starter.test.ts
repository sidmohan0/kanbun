import { readFileSync } from "node:fs";
import { it, expect } from "vitest";
import { MemoryStore } from "@kanbun/sync";
import { sheetsExport } from "../src/sheets-export";

it("keeps the downloadable starter aligned with the actual privacy-filtered export columns", () => {
  const proof = JSON.parse(
    readFileSync(new URL("../../web/public/analytics/starter-proof.json", import.meta.url), "utf8"),
  );
  const sheets = sheetsExport(new MemoryStore(), true);
  expect(proof.issueHeaders).toEqual(sheets[0]!.values[0]);
  expect(proof.projectHeaders).toEqual(sheets[1]!.values[0]);
});
