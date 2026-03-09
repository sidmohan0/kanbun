import { env } from "@/lib/env";
import { processNextGoogleSync } from "@/lib/google-worker";
import { processNextImportBatch } from "@/lib/import-worker";
import { processNextMicrosoftSync } from "@/lib/microsoft-worker";
import {
  processNextOutboundSend,
  processNextSequenceDraft,
} from "@/lib/sequence-worker";
import {
  processNextTodoistAccountSync,
  processNextTodoistTaskSync,
} from "@/lib/todoist-worker";

type WorkerLogger = Pick<Console, "error" | "info">;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runWorker(options?: {
  importBatchSize?: number;
  logger?: WorkerLogger;
  once?: boolean;
  pollIntervalMs?: number;
}) {
  const importBatchSize = options?.importBatchSize ?? 25;
  const logger = options?.logger ?? console;
  const once = options?.once ?? false;
  const pollIntervalMs =
    options?.pollIntervalMs ?? env.IMPORT_WORKER_POLL_INTERVAL_MS;

  logger.info(
    `[kanbun-worker] starting (poll=${pollIntervalMs}ms, import-batch=${importBatchSize})`,
  );

  for (;;) {
    try {
      const [
        processedGoogle,
        processedImport,
        processedMicrosoft,
        processedOutboundSend,
        processedSequenceDraft,
        processedTodoistAccount,
        processedTodoistTask,
      ] =
        await Promise.all([
          processNextGoogleSync(logger),
          processNextImportBatch(importBatchSize),
          processNextMicrosoftSync(logger),
          processNextOutboundSend(logger),
          processNextSequenceDraft(logger),
          processNextTodoistAccountSync(logger),
          processNextTodoistTaskSync(logger),
        ]);

      if (once) {
        return;
      }

      if (
        !processedGoogle &&
        !processedImport &&
        !processedMicrosoft &&
        !processedOutboundSend &&
        !processedSequenceDraft &&
        !processedTodoistAccount &&
        !processedTodoistTask
      ) {
        await sleep(pollIntervalMs);
      }
    } catch (error) {
      logger.error("[kanbun-worker] cycle failed", error);

      if (once) {
        throw error;
      }

      await sleep(pollIntervalMs);
    }
  }
}
