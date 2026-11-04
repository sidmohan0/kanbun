import { app } from "electron";
import { runHookFromFile, runHookFromStdin } from "./hook-runtime.js";

const hookArgumentIndex = process.argv.indexOf("--kanbun-session-hook");
if (process.env.KANBUN_SESSION_HOOK === "1" || hookArgumentIndex >= 0) {
  const provider = process.env.KANBUN_SESSION_HOOK_PROVIDER ?? process.argv[hookArgumentIndex + 1] ?? "";
  const directory = process.env.KANBUN_SESSION_HOOK_DIRECTORY ?? process.argv[hookArgumentIndex + 2] ?? "";
  const inputFile = process.env.KANBUN_SESSION_HOOK_INPUT_FILE;
  const hook = inputFile ? runHookFromFile(provider, directory, inputFile) : runHookFromStdin(provider, directory);
  void hook.finally(() => app.exit(0));
} else {
  void import("./main-app.js");
}
