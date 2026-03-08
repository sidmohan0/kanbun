import { and, asc, eq, isNotNull, or } from "drizzle-orm";
import { db } from "@/db/client";
import { connectedAccounts } from "@/db/schema";
import { syncGoogleContactsForAccount } from "@/lib/google";

type WorkerLogger = Pick<Console, "error" | "info">;

async function claimNextGoogleSyncAccountId() {
  const account = await db.query.connectedAccounts.findFirst({
    where: and(
      eq(connectedAccounts.provider, "google"),
      isNotNull(connectedAccounts.syncRequestedAt),
      or(
        eq(connectedAccounts.status, "connected"),
        eq(connectedAccounts.status, "degraded"),
        eq(connectedAccounts.status, "reconnect_required"),
      ),
    ),
    orderBy: [asc(connectedAccounts.syncRequestedAt)],
  });

  if (!account) {
    return null;
  }

  await db
    .update(connectedAccounts)
    .set({
      lastError: null,
      syncRequestedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(connectedAccounts.id, account.id));

  return account.id;
}

export async function processNextGoogleSync(logger: WorkerLogger = console) {
  const accountId = await claimNextGoogleSyncAccountId();

  if (!accountId) {
    return false;
  }

  try {
    const result = await syncGoogleContactsForAccount(accountId);
    logger.info(
      `[kanbun-worker] synced ${result.syncedCount} Google contacts for account ${accountId}`,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Google sync failed.";
    const account = await db.query.connectedAccounts.findFirst({
      where: eq(connectedAccounts.id, accountId),
      columns: {
        status: true,
      },
    });
    await db
      .update(connectedAccounts)
      .set({
        lastError: message,
        status:
          account?.status === "reconnect_required"
            ? "reconnect_required"
            : "degraded",
        updatedAt: new Date(),
      })
      .where(eq(connectedAccounts.id, accountId));

    logger.error(`[kanbun-worker] Google sync failed for ${accountId}`, error);
  }

  return true;
}
