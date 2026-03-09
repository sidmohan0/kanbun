import {
  claimNextDueEnrollmentId,
  claimNextQueuedOutboundMessageId,
  generateDraftForEnrollment,
  markOutboundMessageFailed,
  sendOutboundMessage,
} from "@/lib/sequences";

type WorkerLogger = Pick<Console, "error" | "info">;

export async function processNextSequenceDraft(
  logger: WorkerLogger = console,
) {
  const enrollmentId = await claimNextDueEnrollmentId();

  if (!enrollmentId) {
    return false;
  }

  try {
    const messageId = await generateDraftForEnrollment(enrollmentId);
    logger.info(
      `[kanbun-worker] generated sequence draft ${messageId ?? "none"} for enrollment ${enrollmentId}`,
    );
  } catch (error) {
    logger.error(
      `[kanbun-worker] sequence draft generation failed for ${enrollmentId}`,
      error,
    );
  }

  return true;
}

export async function processNextOutboundSend(logger: WorkerLogger = console) {
  const messageId = await claimNextQueuedOutboundMessageId();

  if (!messageId) {
    return false;
  }

  try {
    await sendOutboundMessage(messageId);
    logger.info(`[kanbun-worker] sent outbound message ${messageId}`);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Outbound send failed.";
    await markOutboundMessageFailed(messageId, message);
    logger.error(`[kanbun-worker] outbound send failed for ${messageId}`, error);
  }

  return true;
}
