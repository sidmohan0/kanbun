import { sql } from "@/db/client";
import { runWorker } from "@/lib/worker";

const once = process.argv.includes("--once");

runWorker({ once })
  .then(async () => {
    if (once) {
      await sql.end();
      process.exit(0);
    }
  })
  .catch(async (error) => {
    console.error("[kanbun-import-worker] fatal error", error);
    await sql.end({ timeout: 1 });
    process.exitCode = 1;
  });
