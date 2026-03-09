import { and, asc, desc, eq, isNotNull, or } from "drizzle-orm";
import { db } from "@/db/client";
import { connectedAccounts, outboundMessages } from "@/db/schema";
import { syncGoogleContactsForAccount, syncGoogleRepliesForAccount } from "@/lib/google";
import {
  classifyProviderFailure,
  getMetadataDate,
} from "@/lib/provider-health";
import { GOOGLE_REPLY_READ_SCOPE } from "@/lib/provider-scopes";

type WorkerLogger = Pick<Console, "error" | "info">;
const REPLY_SYNC_INTERVAL_MS = 1000 * 60 * 10;

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

  const retryAt = getMetadataDate(account.metadata, "contactSyncRetryAt");

  if (retryAt && retryAt.getTime() > Date.now()) {
    return null;
  }

  await db
    .update(connectedAccounts)
    .set({
      metadata: {
        ...((account.metadata as Record<string, unknown>) ?? {}),
        contactSyncLastRunAt: new Date().toISOString(),
      },
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
    const classification = classifyProviderFailure(message);
    const account = await db.query.connectedAccounts.findFirst({
      where: eq(connectedAccounts.id, accountId),
      columns: {
        metadata: true,
        status: true,
      },
    });
    await db
      .update(connectedAccounts)
      .set({
        lastError: message,
        metadata: {
          ...((account?.metadata as Record<string, unknown>) ?? {}),
          contactSyncFailureCategory: classification.category,
          contactSyncLastError: message,
          contactSyncLastRunAt: new Date().toISOString(),
          contactSyncOperatorAction: classification.operatorAction,
          contactSyncRetryAt: classification.retryDelayMs
            ? new Date(Date.now() + classification.retryDelayMs).toISOString()
            : null,
        },
        status: classification.accountStatus,
        updatedAt: new Date(),
      })
      .where(eq(connectedAccounts.id, accountId));

    logger.error(`[kanbun-worker] Google sync failed for ${accountId}`, error);
  }

  return true;
}

async function claimNextGoogleReplySyncAccountId() {
  const accounts = await db.query.connectedAccounts.findMany({
    where: and(
      eq(connectedAccounts.provider, "google"),
      or(
        eq(connectedAccounts.status, "connected"),
        eq(connectedAccounts.status, "degraded"),
        eq(connectedAccounts.status, "reconnect_required"),
      ),
    ),
    orderBy: [desc(connectedAccounts.updatedAt)],
  });

  for (const account of accounts) {
    if (!account.grantedScopes.includes(GOOGLE_REPLY_READ_SCOPE)) {
      continue;
    }

    const retryAt = getMetadataDate(account.metadata, "replySyncRetryAt");

    if (retryAt && retryAt.getTime() > Date.now()) {
      continue;
    }

    const hasSentOutbound = await db.query.outboundMessages.findFirst({
      where: and(
        eq(outboundMessages.connectedAccountId, account.id),
        eq(outboundMessages.provider, "google"),
        eq(outboundMessages.status, "sent"),
      ),
      columns: {
        id: true,
      },
    });

    if (!hasSentOutbound) {
      continue;
    }

    const metadata = (account.metadata as Record<string, unknown>) ?? {};
    const dueAt =
      typeof metadata.replySyncDueAt === "string"
        ? new Date(metadata.replySyncDueAt).getTime()
        : 0;

    if (dueAt && dueAt > Date.now()) {
      continue;
    }

    await db
      .update(connectedAccounts)
      .set({
        metadata: {
          ...metadata,
          replySyncDueAt: new Date(
            Date.now() + REPLY_SYNC_INTERVAL_MS,
          ).toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(connectedAccounts.id, account.id));

    return account.id;
  }

  return null;
}

export async function processNextGoogleReplySync(
  logger: WorkerLogger = console,
) {
  const accountId = await claimNextGoogleReplySyncAccountId();

  if (!accountId) {
    return false;
  }

  try {
    const result = await syncGoogleRepliesForAccount(accountId);
    const account = await db.query.connectedAccounts.findFirst({
      where: eq(connectedAccounts.id, accountId),
    });

    await db
      .update(connectedAccounts)
      .set({
        lastError: null,
        metadata: {
          ...((account?.metadata as Record<string, unknown>) ?? {}),
          replySyncFailureCategory: null,
          replySyncLastCheckedCount: result.checkedCount,
          replySyncLastDetectedCount: result.detectedCount,
          replySyncLastError: null,
          replySyncLastRunAt: new Date().toISOString(),
          replySyncOperatorAction: null,
          replySyncRetryAt: null,
        },
        status: "connected",
        updatedAt: new Date(),
      })
      .where(eq(connectedAccounts.id, accountId));

    logger.info(
      `[kanbun-worker] checked ${result.checkedCount} Gmail messages and detected ${result.detectedCount} replies for account ${accountId}`,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Google reply sync failed.";
    const classification = classifyProviderFailure(message);
    const account = await db.query.connectedAccounts.findFirst({
      where: eq(connectedAccounts.id, accountId),
    });

    await db
      .update(connectedAccounts)
      .set({
        lastError: message,
        metadata: {
          ...((account?.metadata as Record<string, unknown>) ?? {}),
          replySyncFailureCategory: classification.category,
          replySyncLastError: message,
          replySyncLastRunAt: new Date().toISOString(),
          replySyncOperatorAction: classification.operatorAction,
          replySyncRetryAt: classification.retryDelayMs
            ? new Date(Date.now() + classification.retryDelayMs).toISOString()
            : null,
        },
        status: classification.accountStatus,
        updatedAt: new Date(),
      })
      .where(eq(connectedAccounts.id, accountId));

    logger.error(
      `[kanbun-worker] Google reply sync failed for ${accountId}`,
      error,
    );
  }

  return true;
}
