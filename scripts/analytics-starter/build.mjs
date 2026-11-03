// Authoring-only tool: run a disposable copy with the bundled Spreadsheets runtime.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Workbook, SpreadsheetFile } from "@oai/artifact-tool";

const output = process.argv[2];
if (!output) throw new Error("Supply the output directory");
await fs.mkdir(output, { recursive: true });
const issueHeaders = [
  "ID",
  "Team",
  "Title",
  "Description",
  "Status",
  "Estimate",
  "Priority",
  "Project ID",
  "Project",
  "Creator",
  "Assignee",
  "Labels",
  "Cycle Number",
  "Cycle Name",
  "Cycle Start",
  "Cycle End",
  "Due Date",
  "Parent issue",
  "Project Milestone ID",
  "Project Milestone",
  "Created",
  "Updated",
  "Started",
  "Triaged",
  "Completed",
  "Canceled",
  "Archived",
];
const projectHeaders = [
  "ID",
  "Name",
  "Description",
  "Status",
  "Priority",
  "Milestones",
  "Creator",
  "Lead",
  "Start Date",
  "Target Date",
  "Created",
  "Started",
  "Updated",
  "Completed",
  "Canceled",
  "Archived",
  "Teams",
  "Health",
];
const capacity = 1000;
const end = capacity + 1;
const last = capacity + 19;
const wb = Workbook.create();
const analytics = wb.worksheets.add("Issue analytics");
const planning = wb.worksheets.add("Project planning");
const rawIssues = wb.worksheets.add("Raw Issues");
const rawProjects = wb.worksheets.add("Raw Projects");
const guide = wb.worksheets.add("Guide");
const sheets = [analytics, planning, rawIssues, rawProjects, guide];
for (const s of sheets) {
  s.showGridLines = false;
  s.getRange("A1:L30").format.font = { name: "Arial", size: 10, color: "#20252b" };
  s.getRange("A1:L30").format.columnWidth = 18;
  s.getRange("A1:L30").format.rowHeight = 22;
}
function title(s, text) {
  s.getRange("A2").values = [[text]];
  s.getRange("A2").format.font = { name: "Arial", size: 15, bold: true };
}
function header(s, range, values) {
  s.getRange(range).values = [values];
  s.getRange(range).format = {
    fill: "#273444",
    font: { name: "Arial", size: 10, bold: true, color: "#ffffff" },
    rowHeight: 32,
    wrapText: true,
    horizontalAlignment: "center",
    verticalAlignment: "center",
  };
}
function input(s, range) {
  s.getRange(range).format.fill = "#fff1cb";
}
function value(s, cell, v) {
  s.getRange(cell).values = [[v]];
}
function formula(s, cell, v) {
  s.getRange(cell).formulas = [[v]];
}
title(analytics, "Issue analytics");
analytics.tabColor = "#273444";
analytics.getRange("A4:D7").values = [
  ["From (UTC, inclusive)", null, "To (UTC, exclusive)", null],
  ["Assignee name", null, "Cycle number", null],
  ["Leave any filter blank for all records", null, null, null],
  ["Source coverage", null, null, null],
];
input(analytics, "B4");
input(analytics, "D4");
input(analytics, "B5");
input(analytics, "D5");
value(analytics, "E5", "Team name");
input(analytics, "F5");
analytics.getRange("B4").setNumberFormat("yyyy-mm-dd");
analytics.getRange("D4").setNumberFormat("yyyy-mm-dd");
analytics.getRange("A6").format.font.italic = true;
formula(
  analytics,
  "B7",
  `=IF('Raw Issues'!A${end + 1}<>"","Extend ranges: over 1000 rows",IF(COUNTA('Raw Issues'!A2:A${end})=0,"Import issue rows","Ready"))`,
);
value(analytics, "A8", "Date window");
formula(
  analytics,
  "B8",
  '=IF(OR(NOT(ISNUMBER(B4)),NOT(ISNUMBER(D4))),"Enter both UTC dates",IF(D4<=B4,"End must follow start","Ready"))',
);
value(analytics, "A9", "Completed issues");
value(analytics, "A10", "Completed estimate total");
value(analytics, "A11", "Missing/invalid estimates");
value(analytics, "A12", "Mean completion days");
value(analytics, "A13", "Invalid date pairs");
value(analytics, "E9", "Valid time-to-start pairs");
value(analytics, "E10", "Mean time-to-start days");
value(analytics, "E11", "Missing timestamps");
value(analytics, "E12", "Invalid date pairs");
const ranges = Object.fromEntries("ABCDEFGHIJKL".split("").map((c) => [c, `$${c}$20:$${c}$${last}`]));
for (const c of ["M", "N", "O"]) ranges[c] = `$${c}$20:$${c}$${last}`;
const conditions = `${ranges.G},">="&$B$4,${ranges.G},"<"&$D$4,${ranges.L},1`;
const createdConditions = `${ranges.M},">="&$B$4,${ranges.M},"<"&$D$4,${ranges.L},1`;
const ready = '$B$7<>"Ready",NOT(ISNUMBER($B$4)),NOT(ISNUMBER($D$4)),$D$4<=$B$4';
formula(analytics, "B9", `=IF(OR(${ready}),"",COUNTIFS(${conditions}))`);
formula(
  analytics,
  "B10",
  `=IF(NOT(ISNUMBER(B9)),"",IF(B9=0,0,IF(SUMIFS(${ranges.K},${conditions})=0,"No estimates",SUMIFS(${ranges.E},${conditions}))))`,
);
formula(analytics, "B11", `=IF(NOT(ISNUMBER(B9)),"",B9-SUMIFS(${ranges.K},${conditions}))`);
formula(
  analytics,
  "B12",
  `=IF(NOT(ISNUMBER(B9)),"",IF(COUNTIFS(${conditions},${ranges.J},"OK")=0,"No valid date pairs",SUMIFS(${ranges.H},${conditions},${ranges.J},"OK")/COUNTIFS(${conditions},${ranges.J},"OK")))`,
);
formula(analytics, "B13", `=IF(NOT(ISNUMBER(B9)),"",COUNTIFS(${conditions},${ranges.J},"Invalid date order"))`);
formula(analytics, "F9", `=IF(OR(${ready}),"",COUNTIFS(${createdConditions},${ranges.O},"OK"))`);
formula(
  analytics,
  "F10",
  `=IF(NOT(ISNUMBER(F9)),"",IF(F9=0,"No valid date pairs",SUMIFS(${ranges.N},${createdConditions},${ranges.O},"OK")/F9))`,
);
formula(analytics, "F11", `=IF(NOT(ISNUMBER(F9)),"",COUNTIFS(${createdConditions},${ranges.O},"Missing timestamps"))`);
formula(analytics, "F12", `=IF(NOT(ISNUMBER(F9)),"",COUNTIFS(${createdConditions},${ranges.O},"Invalid date order"))`);
analytics.getRange("B12").setNumberFormat("0.00");
analytics.getRange("F10").setNumberFormat("0.00");
value(analytics, "A15", "Enter both dates. Filter names match exported display names; identical names are grouped.");
value(
  analytics,
  "A16",
  "Completion uses Completed; time-to-start uses Created. Each metric uses that event date in the window.",
);
value(analytics, "A17", "Missing dates are counted separately; invalid negative durations are excluded from means.");
value(analytics, "A18", "Detail uses UTC ISO timestamps. Review invalid dates before interpreting durations.");
header(analytics, "A19:O19", [
  "Issue ID",
  "Team",
  "Assignee",
  "Cycle number",
  "Estimate",
  "Started (UTC)",
  "Completed (UTC)",
  "Completion days",
  "Labels",
  "Date pair",
  "Has estimate",
  "Matches filters",
  "Created (UTC)",
  "Time-to-start days",
  "Start timing",
]);
const letters = (n) => {
  let s = "";
  for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
};
const source = (h, r) => `'Raw Issues'!${letters(issueHeaders.indexOf(h))}${r}`;
const timestamp = (ref) =>
  `IF(LEN(${ref})=0,"",IF(ISNUMBER(${ref}),${ref},DATEVALUE(LEFT(${ref},10))+TIMEVALUE(MID(${ref},12,8))))`;
const detail = [];
for (let r = 20; r <= last; r++) {
  const n = r - 18,
    id = source("ID", n);
  detail.push([
    `=IF(${id}="","",${id})`,
    ...["Team", "Assignee"].map((h) => `=IF(${id}="","",IF(LEN(${source(h, n)})=0,"",${source(h, n)}))`),
    `=IF(OR(${id}="",LEN(${source("Cycle Number", n)})=0),"",IFERROR(VALUE(${source("Cycle Number", n)}),"Invalid cycle"))`,
    `=IF(OR(${id}="",LEN(${source("Estimate", n)})=0),"",IF(ISNUMBER(${source("Estimate", n)}),${source("Estimate", n)},IFERROR(VALUE(${source("Estimate", n)}),"Invalid estimate")))`,
    `=IF(${id}="","",${timestamp(source("Started", n))})`,
    `=IF(${id}="","",${timestamp(source("Completed", n))})`,
    `=IF(OR(F${r}="",G${r}="",G${r}<F${r}),"",G${r}-F${r})`,
    `=IF(${id}="","",${source("Labels", n)})`,
    `=IF(A${r}="","",IF(OR(F${r}="",G${r}=""),"Missing timestamps",IF(G${r}<F${r},"Invalid date order","OK")))`,
    `=IF(AND(${id}<>"",ISNUMBER(E${r})),1,0)`,
    `=IF(AND(A${r}<>"",OR($B$5="",C${r}=$B$5),OR($D$5="",D${r}=$D$5),OR($F$5="",B${r}=$F$5)),1,0)`,
    `=IF(${id}="","",${timestamp(source("Created", n))})`,
    `=IF(OR(${id}="",M${r}="",F${r}="",F${r}<M${r}),"",F${r}-M${r})`,
    `=IF(${id}="","",IF(OR(M${r}="",F${r}=""),"Missing timestamps",IF(F${r}<M${r},"Invalid date order","OK")))`,
  ]);
}
analytics.getRange(`A20:O${last}`).formulas = detail;
analytics.getRange(`A20:O${last}`).format.font = { name: "Arial", size: 10 };
analytics.getRange(`K20:L${last}`).setNumberFormat("0;-0;;@");
analytics.getRange(`F20:G${last}`).setNumberFormat("yyyy-mm-dd hh:mm");
analytics.getRange(`M20:M${last}`).setNumberFormat("yyyy-mm-dd hh:mm");
analytics.getRange(`H20:H${last}`).setNumberFormat("0.00");
analytics.getRange(`N20:N${last}`).setNumberFormat("0.00");
analytics.getRange("A1:A19").format.columnWidth = 27;
analytics.getRange("C1:C19").format.columnWidth = 23;
analytics.getRange("E1:E19").format.columnWidth = 27;
analytics.getRange("F1:F19").format.columnWidth = 23;
analytics.getRange("M1:M19").format.columnWidth = 23;
analytics.getRange("N1:N19").format.columnWidth = 20;
analytics.getRange("O1:O19").format.columnWidth = 24;
analytics.freezePanes.freezeRows(19);
title(planning, "Project prioritization");
planning.tabColor = "#475569";
value(planning, "A4", "Enter a project ID and your own planning assumptions in amber cells.");
value(planning, "A5", "Score = impact × confidence ÷ effort. Confidence is 0–100%; effort must be positive.");
value(
  planning,
  "A6",
  "These inputs are your estimates, not Kanbun fields or AI assessments. Sort the whole table by rank.",
);
value(planning, "A7", "Source coverage");
value(planning, "A8", "Example: impact 8 × confidence 50% ÷ effort 2 gives a score of 2.");
formula(
  planning,
  "B7",
  `=IF('Raw Projects'!A${end + 1}<>"","Extend ranges: over 1000 rows",IF(COUNTA('Raw Projects'!A2:A${end})=0,"Import project rows","Ready"))`,
);
header(planning, "A9:K9", [
  "Project ID",
  "Name",
  "Priority",
  "Lead",
  "Target date",
  "Impact (1–10)",
  "Confidence",
  "Effort",
  "Score",
  "Rank",
  "Input status",
]);
for (let r = 10; r <= 39; r++) {
  const key = `SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(A${r},"~","~~"),"*","~*"),"?","~?")`;
  for (const [column, index] of [
    ["B", 2],
    ["C", 5],
    ["D", 8],
    ["E", 10],
  ])
    formula(
      planning,
      `${column}${r}`,
      `=IF(A${r}="","",IF(COUNTIF('Raw Projects'!$A$2:$A$${end},${key})<>1,"Check project ID",IF(LEN(INDEX('Raw Projects'!$A$2:$R$${end},MATCH(${key},'Raw Projects'!$A$2:$A$${end},0),${index}))=0,"",VLOOKUP(${key},'Raw Projects'!$A$2:$R$${end},${index},FALSE))))`,
    );
  formula(
    planning,
    `K${r}`,
    `=IF(A${r}="","",IF($B$7<>"Ready",$B$7,IF(COUNTIF('Raw Projects'!$A$2:$A$${end},${key})<>1,"Missing or duplicate ID",IF(COUNTA(F${r}:H${r})<3,"Enter assumptions",IF(OR(NOT(ISNUMBER(F${r})),NOT(ISNUMBER(G${r})),NOT(ISNUMBER(H${r})),F${r}<1,F${r}>10,G${r}<0,G${r}>1,H${r}<=0),"Invalid assumptions","Ready")))))`,
  );
  formula(planning, `I${r}`, `=IF(K${r}<>"Ready","",F${r}*G${r}/H${r})`);
  formula(planning, `J${r}`, `=IF(ISNUMBER(I${r}),COUNTIF($I$10:$I$39,">"&I${r})+1,"")`);
}
input(planning, "A10:A39");
input(planning, "F10:H39");
planning.getRange("G10:G39").setNumberFormat("0%");
planning.getRange("I10:I39").setNumberFormat("0.00");
planning.getRange("B1:B39").format.columnWidth = 28;
planning.getRange("K1:K39").format.columnWidth = 28;
planning.freezePanes.freezeRows(9);
for (const [s, headers, lastColumn] of [
  [rawIssues, issueHeaders, "AA"],
  [rawProjects, projectHeaders, "R"],
]) {
  header(s, `A1:${lastColumn}1`, headers);
  s.freezePanes.freezeRows(1);
  s.freezePanes.freezeColumns(1);
  s.getRange(`A1:${lastColumn}12`).format.columnWidth = 18;
}
title(guide, "Import your own data");
const instructions = [
  "This blank starter contains no workspace data. Keep it in a separate workbook you control.",
  "Google Sheets: upload this XLSX to Drive, open with Google Sheets and save as Google Sheets.",
  "Open Kanbun → Analytics starter to copy your import formulas.",
  "Paste the copied formula normally into Raw tab A1; leave its cell format as Automatic.",
  "Google will ask Allow access for each IMPORTRANGE. You need permission to the source file.",
  "Set File → Settings → Time zone to GMT. Import formulas run only in Google Sheets, not Excel.",
];
instructions.forEach((t, i) => value(guide, `A${i + 4}`, t));
value(
  guide,
  "A10",
  "If Google asks for more rows, add rows to the Raw tab. Summaries remain limited to 1,000 records.",
);
value(guide, "A11", "Manual alternative: type the formulas below, replacing SOURCE_URL with your synced file URL.");
value(guide, "A13", "Copy this formula into Raw Issues!A1:");
value(guide, "A14", '\'=IMPORTRANGE("SOURCE_URL","Issues!A1:AA")');
value(guide, "A16", "Copy this formula into Raw Projects!A1:");
value(guide, "A17", '\'=IMPORTRANGE("SOURCE_URL","Projects!A1:R")');
value(guide, "A19", "CSV / Excel: download both CSV exports from Kanbun Settings → Integrations.");
value(guide, "A20", "Import each CSV into its matching Raw tab at A1, replacing contents and keeping headers.");
value(guide, "A21", "Google CSV import: turn OFF conversion of text to numbers/dates/formulas to retain literal text.");
value(
  guide,
  "A22",
  "Keep existing headers/order and UTC ISO timestamp text. Numeric estimate/cycle text is normalized.",
);
value(
  guide,
  "A23",
  "Issue analytics reports Completed − Started and Created-to-Started; their date windows use Completed and Created respectively.",
);
value(
  guide,
  "A24",
  "Only public-team export data belongs here. Sharing this workbook can reveal copied/imported data.",
);
value(guide, "A25", "Do not put formulas in Kanbun-owned Issues/Projects tabs: sync overwrites them.");
value(
  guide,
  "A26",
  "Up to 1,000 source rows. Overflow blocks summaries; extend detail formulas and all bounded ranges.",
);
value(
  guide,
  "A27",
  "Refresh CSV by replacing raw contents. Planning assumptions remain attached to the project ID you entered.",
);
value(guide, "A28", "Source: your Kanbun public export. Reference: https://linear.app/docs/google-sheets");
guide.getRange("A1:A29").format.columnWidth = 105;
// Formula proof uses synthetic rows only, then removes every fixture and assumption before export.
function row(headers, values) {
  return headers.map((h) => values[h] ?? "");
}
const fixtureIssues = [
  {
    ID: "KAN-1",
    Team: "Public",
    Assignee: "Alice",
    Estimate: "3",
    "Cycle Number": "1",
    Started: "2026-11-01T00:00:00.000Z",
    Completed: "2026-11-03T00:00:00.000Z",
    Created: "2026-11-01T00:00:00.000Z",
  },
  {
    ID: "KAN-2",
    Team: "Public",
    Assignee: "Alice",
    Estimate: 0,
    "Cycle Number": 1,
    Started: "2026-11-02T00:00:00.000Z",
    Completed: "2026-11-03T00:00:00.000Z",
    Created: "2026-11-02T00:00:00.000Z",
  },
  {
    ID: "KAN-3",
    Team: "Other public team",
    Assignee: "Bob",
    "Cycle Number": 1,
    Started: "2026-11-04T00:00:00.000Z",
    Completed: "2026-11-03T00:00:00.000Z",
    Created: "2026-11-01T00:00:00.000Z",
  },
  {
    ID: "KAN-4",
    Team: "Public",
    Assignee: "Alice",
    Estimate: 9,
    Started: "2026-11-03T00:00:00.000Z",
    Completed: "2026-11-04T00:00:00.000Z",
    Created: "2026-11-03T00:00:00.000Z",
  },
  {
    ID: "KAN-5",
    Team: "Public",
    Started: "2026-11-02T00:00:00.000Z",
    Created: "2026-11-03T00:00:00.000Z",
  },
  {
    ID: "KAN-6",
    Team: "Public",
    Assignee: "Alice",
    "Cycle Number": 1,
    Created: "2026-11-03T00:00:00.000Z",
  },
];
rawIssues.getRange("A2:AA7").values = fixtureIssues.map((v) => row(issueHeaders, v));
rawProjects.getRange("A2:R3").values = [
  row(projectHeaders, { ID: "p-one", Name: "Public launch", Priority: 1, Lead: "Alice", "Target Date": "2026-12-01" }),
  row(projectHeaders, { ID: "p-two", Name: "Follow-up", Priority: 0 }),
];
value(analytics, "B4", 46329);
value(analytics, "D4", 46330);
value(planning, "A10", "p-one");
planning.getRange("F10:H10").values = [[8, 0.5, 2]];
value(planning, "A11", "p-two");
planning.getRange("F11:H11").values = [[5, 1, 5]];
wb.recalculate();
const proof = [];
function check(sheet, cell, expected, label) {
  const actual = sheet.getRange(cell).values[0][0];
  assert.equal(actual, expected, label);
  proof.push({ label, cell: `${sheet.name}!${cell}`, actual });
}
check(analytics, "B9", 3, "exclusive end boundary");
check(analytics, "B10", 3, "estimate total");
check(analytics, "E20", 3, "numeric text import converted");
check(analytics, "E21", 0, "zero estimate retained in detail");
check(analytics, "B11", 1, "missing estimate distinguished");
check(analytics, "B12", 1.5, "invalid pair excluded from duration");
check(analytics, "B13", 1, "invalid pair counted");
check(analytics, "F9", 1, "valid time-to-start count");
check(analytics, "F10", 0, "same-day time-to-start retains zero");
check(analytics, "F11", 1, "missing time-to-start pair counted");
check(analytics, "F12", 1, "negative time-to-start pair counted");
check(analytics, "N24", "", "negative time-to-start duration excluded");
check(analytics, "O24", "Invalid date order", "negative time-to-start pair labeled");
check(planning, "B10", "Public launch", "real VLOOKUP");
check(planning, "I10", 2, "planning score");
check(planning, "J10", 1, "planning rank");
value(analytics, "B5", "Alice");
value(analytics, "D5", 1);
wb.recalculate();
check(analytics, "B9", 2, "assignee and cycle filter");
value(analytics, "B5", "");
value(analytics, "F5", "Other public team");
wb.recalculate();
check(analytics, "B9", 1, "duplicate cycle number scoped to other team");
value(analytics, "F5", "");
wb.recalculate();
check(analytics, "B9", 3, "blank team includes all teams with cycle number");
value(analytics, "F5", "Public");
wb.recalculate();
check(analytics, "B9", 2, "duplicate cycle number scoped to selected team");
value(planning, "G10", 0);
wb.recalculate();
check(planning, "I10", 0, "zero confidence is a real zero");
value(planning, "H10", 0);
wb.recalculate();
check(planning, "I10", "", "zero effort unavailable");
check(planning, "K10", "Invalid assumptions", "invalid input guidance");
rawProjects.getRange("A3").values = [["p-one"]];
value(planning, "A10", "p-one");
wb.recalculate();
check(planning, "K10", "Missing or duplicate ID", "duplicate ID unavailable");
value(planning, "A10", "missing");
wb.recalculate();
check(planning, "B10", "Check project ID", "missing ID lookup");
value(rawIssues, `A${end + 1}`, "overflow");
wb.recalculate();
check(analytics, "B9", "", "overflow never undercounts");
rawIssues.getRange(`A2:AA${end + 1}`).clear({ applyTo: "contents" });
rawProjects.getRange("A2:R3").clear({ applyTo: "contents" });
analytics.getRange("B4").clear({ applyTo: "contents" });
analytics.getRange("D4:D5").clear({ applyTo: "contents" });
analytics.getRange("B5").clear({ applyTo: "contents" });
analytics.getRange("F5").clear({ applyTo: "contents" });
planning.getRange("A10:A39").clear({ applyTo: "contents" });
planning.getRange("F10:H39").clear({ applyTo: "contents" });
wb.recalculate();
check(analytics, "B9", "", "blank template has no false zero");
check(planning, "I10", "", "blank planning remains unavailable");
const errors = await wb.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#SPILL!",
  options: { useRegex: true, maxResults: 20 },
  maxChars: 1500,
});
await fs.writeFile(path.join(output, "formula-errors.ndjson"), errors.ndjson);
for (const [s, range] of [
  [analytics, "A1:O24"],
  [planning, "A1:K15"],
  [rawIssues, "A1:G5"],
  [rawProjects, "A1:G5"],
  [guide, "A1:B28"],
]) {
  const preview = await wb.render({ sheetName: s.name, range, scale: 1.5, format: "png" });
  await fs.writeFile(
    path.join(output, `${s.name.replaceAll(" ", "-")}.png`),
    new Uint8Array(await preview.arrayBuffer()),
  );
}
const file = await SpreadsheetFile.exportXlsx(wb);
const destination = path.join(output, "kanbun-analytics-starter.xlsx");
await file.save(destination);
const digest = createHash("sha256")
  .update(await fs.readFile(destination))
  .digest("hex");
await fs.writeFile(
  path.join(output, "proof.json"),
  JSON.stringify(
    {
      format: 1,
      capacity,
      issueHeaders,
      projectHeaders,
      sha256: digest,
      generatorSha256: createHash("sha256")
        .update(await fs.readFile(new URL(import.meta.url)))
        .digest("hex"),
      engine: "artifact-tool bundled26.1020.11618",
      checks: proof,
      remoteGoogleAccessValidated: false,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    file: destination,
    sha256: digest,
    generatorSha256: createHash("sha256")
      .update(await fs.readFile(new URL(import.meta.url)))
      .digest("hex"),
    engine: "artifact-tool bundled26.1020.11618",
    checks: proof.length,
  }),
);
