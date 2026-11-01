import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Render every retained verifier receipt; tolerate setup failures and partial artifacts. */
export async function verificationSummary(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return "## Verification durations\n\nNo verifier receipt was produced.\n";
    throw error;
  }
  const reports = [];
  for (const entry of entries.filter((item) => item.isDirectory() && item.name.startsWith("run-"))) {
    try {
      const report = JSON.parse(await readFile(path.join(directory, entry.name, "report.json"), "utf8"));
      if (Array.isArray(report.steps)) reports.push(report);
    } catch {
      // A killed or interrupted run may not have written a complete receipt.
    }
  }
  if (!reports.length) return "## Verification durations\n\nNo complete verifier receipt was produced.\n";
  reports.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  const escape = (value) => String(value).replace(/[|\r\n]/g, " ");
  const sections = reports.map((report) => {
    const rows = report.steps.map((step) => {
      const result = !step.executed ? "Skipped" : step.pass ? "Passed" : "Failed";
      const duration = Number.isFinite(step.durationMs) ? (step.durationMs / 1000).toFixed(1) : "—";
      return `| ${escape(step.name)} | ${result} | ${duration} |`;
    });
    return `### ${escape(report.command)} · ${report.pass ? "Passed" : "Failed"}\n\n| Step | Result | Seconds |\n| --- | --- | ---: |\n${rows.join("\n")}\n`;
  });
  return `## Verification durations\n\n${sections.join("\n")}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  process.stdout.write(await verificationSummary(process.argv[2] ?? "artifacts/verification"));
