#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runVerification } from "./index.mjs";

let json = process.argv.includes("--json");
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
      output: { type: "string" },
      evidence: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  json = values.json ?? false;
  if (values.help) {
    const usage =
      "kanbun-verify [all|doctor|check|build|smoke|preflight|recovery|scale|docs|launch] [--json] [--output <directory>] [--evidence <launch-evidence.json>]";
    console.log(json ? JSON.stringify({ usage }) : usage);
  } else {
    if (positionals.length > 1) throw new Error("Choose one verification profile.");
    const report = await runVerification({
      root: fileURLToPath(new URL("../../../", import.meta.url)),
      command: positionals[0] ?? "all",
      outputDirectory: values.output,
      evidenceFile: values.evidence,
      onProgress: ({ name, state, durationMs }) =>
        console.error(
          `[verify] ${state.toUpperCase()} ${name}${durationMs === undefined ? "" : ` (${(durationMs / 1000).toFixed(1)}s)`}`,
        ),
    });
    if (json) console.log(JSON.stringify(report));
    else {
      for (const step of report.steps) {
        console.log(`${step.executed ? (step.pass ? "PASS" : "FAIL") : "NOT RUN"} ${step.name}`);
        if (step.launch) {
          for (const requirement of step.launch.requirements) {
            console.log(`${requirement.pass ? "PASS" : "OPEN"} ${requirement.id} ${requirement.title}`);
            for (const criterion of requirement.criteria) {
              const reason =
                criterion.method === "documentation"
                  ? "Mechanical documentation checks failed; inspect the receipt for individual findings."
                  : criterion.details;
              console.log(
                `  ${criterion.status.toUpperCase()} ${criterion.id}${criterion.status === "passed" ? "" : `: ${reason}`}`,
              );
            }
          }
          for (const error of step.launch.errors) console.error(error);
        }
      }
      console.log(
        `${report.pass ? "Verification passed" : "Verification failed"}: ${report.runDirectory ?? report.error}`,
      );
      if (report.error && report.runDirectory) console.error(report.error);
    }
    process.exitCode = report.pass ? 0 : 1;
  }
} catch (error) {
  const report = { schemaVersion: 1, pass: false, executed: false, steps: [], error: error.message };
  if (json) console.log(JSON.stringify(report));
  else console.error(error.message);
  process.exitCode = 1;
}
