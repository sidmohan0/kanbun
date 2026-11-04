import { app } from "electron";
import { runHookFromFile, runHookFromStdin } from "./hook-runtime.js";

const hookArgumentIndex = process.argv.indexOf("--kanbun-session-hook");
if (process.env.KANBUN_SESSION_HOOK === "1" || hookArgumentIndex >= 0) {
  if (process.env.KANBUN_HOOK_DIAGNOSTICS === "1") process.stderr.write("hook dispatcher entered\n");
  const provider = process.env.KANBUN_SESSION_HOOK_PROVIDER ?? process.argv[hookArgumentIndex + 1] ?? "";
  const directory = process.env.KANBUN_SESSION_HOOK_DIRECTORY ?? process.argv[hookArgumentIndex + 2] ?? "";
  const inputFile =
    process.env.KANBUN_SESSION_HOOK_INPUT_FILE ??
    (hookArgumentIndex >= 0 ? process.argv[hookArgumentIndex + 3] : undefined);
  if (process.env.KANBUN_HOOK_DIAGNOSTICS === "1")
    process.stderr.write(`hook input source: ${inputFile ? "fifo" : "stdin"}\n`);
  const hook = inputFile ? runHookFromFile(provider, directory, inputFile) : runHookFromStdin(provider, directory);
  void hook.finally(() => {
    if (process.env.KANBUN_HOOK_DIAGNOSTICS === "1") process.stderr.write("hook dispatcher complete\n");
    app.exit(0);
  });
} else {
  void import("./main-app.js");
}
