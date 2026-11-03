import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { xlsxParts, sheetCells } from "./analytics-starter/inspect-xlsx.mjs";

const directory = new URL("../apps/web/public/analytics/", import.meta.url);
const bytes = readFileSync(new URL("kanbun-analytics-starter.xlsx", directory));
const proof = JSON.parse(readFileSync(new URL("starter-proof.json", directory), "utf8"));
const parts = xlsxParts(bytes);

test("downloaded starter matches its recalculated, reviewed source and contains blank raw inputs", () => {
  assert.equal(createHash("sha256").update(bytes).digest("hex"), proof.sha256);
  assert.equal(
    createHash("sha256")
      .update(readFileSync(new URL("analytics-starter/build.mjs", import.meta.url)))
      .digest("hex"),
    proof.generatorSha256,
  );
  assert.equal(proof.remoteGoogleAccessValidated, false);
  const workbook = parts.get("xl/workbook.xml");
  for (const name of ["Issue analytics", "Project planning", "Raw Issues", "Raw Projects", "Guide"])
    assert.ok(workbook.includes(`name="${name}"`));
  for (const number of [3, 4]) {
    const cells = sheetCells(parts, number);
    const ordinal = (letters) => [...letters].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0);
    const headers = [...cells]
      .filter(([address]) => /^[A-Z]+1$/.test(address))
      .sort(([a], [b]) => ordinal(a.slice(0, -1)) - ordinal(b.slice(0, -1)))
      .map(([, cell]) => cell.value);
    assert.deepEqual(headers, number === 3 ? proof.issueHeaders : proof.projectHeaders);
    for (const [address, cell] of cells)
      if (Number(address.replace(/[A-Z]+/, "")) > 1)
        assert.equal(cell.value, "", `raw input ${number}:${address} must be blank`);
    assert.ok(![...cells.values()].some((cell) => cell.formula));
  }
  assert.ok(![...parts.keys()].some((name) => name.startsWith("xl/externalLinks/")));
});

test("starter retains live formulas, unavailable blanks and truthful Google import examples", () => {
  const issues = sheetCells(parts, 1),
    planning = sheetCells(parts, 2),
    guide = sheetCells(parts, 5);
  for (const [cells, cell] of [
    [issues, "B9"],
    [issues, "F20"],
    [issues, "M20"],
    [issues, "N20"],
    [issues, "O20"],
    [planning, "B10"],
    [planning, "I10"],
  ])
    assert.ok(cells.get(cell).formula, `${cell} must remain calculated rather than a cached constant`);
  assert.equal(issues.get("M19").value, "Created (UTC)");
  assert.equal(issues.get("N19").value, "Time-to-start days");
  assert.equal(issues.get("O19").value, "Start timing");
  assert.equal(issues.get("B9").value, "");
  assert.equal(planning.get("I10").value, "");
  for (const cell of ["B4", "D4", "B5", "D5", "F5"])
    assert.equal(issues.get(cell)?.value ?? "", "", `${cell} input must start blank`);
  for (let row = 10; row <= 39; row++)
    for (const column of ["A", "F", "G", "H"])
      assert.equal(planning.get(`${column}${row}`)?.value ?? "", "", `${column}${row} assumption must start blank`);
  assert.ok([...guide.values()].some((cell) => cell.value?.includes('IMPORTRANGE("SOURCE_URL","Issues!A1:AA")')));
  assert.ok([...guide.values()].some((cell) => cell.value?.includes("Allow access")));
  for (const cells of [issues, planning, guide])
    assert.ok(![...cells.values()].some((cell) => /IMPORTRANGE/.test(cell.formula ?? "")));
});

test("hash-bound authoring proof matches independent synthetic fixture outcomes", () => {
  const results = Object.fromEntries(proof.checks.map((check) => [check.label, check.actual]));
  for (const [label, expected] of Object.entries({
    "exclusive end boundary": 3,
    "numeric text import converted": 3,
    "zero estimate retained in detail": 0,
    "missing estimate distinguished": 1,
    "invalid pair excluded from duration": 1.5,
    "invalid pair counted": 1,
    "valid time-to-start count": 1,
    "same-day time-to-start retains zero": 0,
    "missing time-to-start pair counted": 1,
    "negative time-to-start pair counted": 1,
    "negative time-to-start duration excluded": "",
    "negative time-to-start pair labeled": "Invalid date order",
    "real VLOOKUP": "Public launch",
    "planning score": 2,
    "planning rank": 1,
    "assignee and cycle filter": 2,
    "duplicate cycle number scoped to other team": 1,
    "blank team includes all teams with cycle number": 3,
    "duplicate cycle number scoped to selected team": 2,
    "zero confidence is a real zero": 0,
    "zero effort unavailable": "",
    "duplicate ID unavailable": "Missing or duplicate ID",
    "missing ID lookup": "Check project ID",
    "overflow never undercounts": "",
    "blank template has no false zero": "",
  }))
    assert.equal(results[label], expected, label);
});
