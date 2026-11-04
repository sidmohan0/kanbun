import { runHookFromStdin } from "./hook-runtime.js";

const [provider, directory] = process.argv.slice(2);
await runHookFromStdin(provider ?? "", directory ?? "");
