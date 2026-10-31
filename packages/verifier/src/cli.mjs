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
      help: { type: "boolean", short: "h" },
    },
  });
  json = values.json ?? false;
  if (values.help) {
    const usage =
      "kanbun-verify [all|doctor|check|build|smoke|preflight|recovery|docs] [--json] [--output <directory>]";
    console.log(json ? JSON.stringify({ usage }) : usage);
  } else {
    if (positionals.length > 1) throw new Error("Choose one verification profile.");
    const report = await runVerification({
      root: fileURLToPath(new URL("../../../", import.meta.url)),
      command: positionals[0] ?? "all",
      outputDirectory: values.output,
      onProgress: ({ name, state, durationMs }) =>
        console.error(
          `[verify] ${state.toUpperCase()} ${name}${durationMs === undefined ? "" : ` (${(durationMs / 1000).toFixed(1)}s)`}`,
        ),
    });
    if (json) console.log(JSON.stringify(report));
    else {
      for (const step of report.steps) {
        console.log(`${step.executed ? (step.pass ? "PASS" : "FAIL") : "NOT RUN"} ${step.name}`);
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
