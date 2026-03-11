import { and, asc, desc, eq, isNotNull, or } from "drizzle-orm";
import { db } from "@/db/client";
import { connectedAccounts, outboundMessages } from "@/db/schema";
import {
  ensureMicrosoftGraphSubscriptions,
  isMicrosoftWebhookConfigured,
  syncMicrosoftContactsForAccount,
  syncMicrosoftRepliesForAccount,
} from "@/lib/microsoft";
import {
  applyProviderFailureMetadata,
  classifyProviderFailure,
  deriveProviderAccountStatus,
  getMetadataDate,
} from "@/lib/provider-health";
import {
  MICROSOFT_CONTACTS_SCOPE,
  MICROSOFT_REPLY_READ_SCOPE,
} from "@/lib/provider-scopes";

type WorkerLogger = Pick<Console, "error" | "info">;
const REPLY_SYNC_INTERVAL_MS = 1000 * 60 * 10;
const SUBSCRIPTION_RENEWAL_WINDOW_MS = 1000 * 60 * 60 * 6;

async function claimNextMicrosoftSyncAccountId() {
  const account = await db.query.connectedAccounts.findFirst({
    where: and(
      eq(connectedAccounts.provider, "microsoft"),
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

export async function processNextMicrosoftSync(logger: WorkerLogger = console) {
  const accountId = await claimNextMicrosoftSyncAccountId();

  if (!accountId) {
    return false;
  }

  try {
    const result = await syncMicrosoftContactsForAccount(accountId);
    logger.info(
      `[kanbun-worker] synced ${result.syncedCount} Microsoft contacts for account ${accountId}`,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Microsoft sync failed.";
    const classification = classifyProviderFailure(message);
    const account = await db.query.connectedAccounts.findFirst({
      where: eq(connectedAccounts.id, accountId),
      columns: {
        metadata: true,
        status: true,
      },
    });
    const nextMetadata = applyProviderFailureMetadata(
      (account?.metadata as Record<string, unknown>) ?? {},
      {
        classification,
        message,
        operation: "contactSync",
      },
    );
    await db
      .update(connectedAccounts)
      .set({
        lastError: message,
        metadata: nextMetadata,
        status: deriveProviderAccountStatus({
          metadata: nextMetadata,
          rawStatus: classification.accountStatus,
        }),
        updatedAt: new Date(),
      })
      .where(eq(connectedAccounts.id, accountId));

    logger.error(
      `[kanbun-worker] Microsoft sync failed for ${accountId}`,
      error,
    );
  }

  return true;
}

async function claimNextMicrosoftReplySyncAccountId() {
  const accounts = await db.query.connectedAccounts.findMany({
    where: and(
      eq(connectedAccounts.provider, "microsoft"),
      or(
        eq(connectedAccounts.status, "connected"),
        eq(connectedAccounts.status, "degraded"),
        eq(connectedAccounts.status, "reconnect_required"),
      ),
    ),
    orderBy: [desc(connectedAccounts.updatedAt)],
  });

  for (const account of accounts) {
    if (!account.grantedScopes.includes(MICROSOFT_REPLY_READ_SCOPE)) {
      continue;
    }

    const retryAt = getMetadataDate(account.metadata, "replySyncRetryAt");

    if (retryAt && retryAt.getTime() > Date.now()) {
      continue;
    }

    const hasSentOutbound = await db.query.outboundMessages.findFirst({
      where: and(
        eq(outboundMessages.connectedAccountId, account.id),
        eq(outboundMessages.provider, "microsoft"),
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

export async function processNextMicrosoftReplySync(
  logger: WorkerLogger = console,
) {
  const accountId = await claimNextMicrosoftReplySyncAccountId();

  if (!accountId) {
    return false;
  }

  try {
    const result = await syncMicrosoftRepliesForAccount(accountId);
    logger.info(
      `[kanbun-worker] checked ${result.checkedCount} Outlook messages and detected ${result.detectedCount} replies for account ${accountId}`,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Microsoft reply sync failed.";
    const classification = classifyProviderFailure(message);
    const account = await db.query.connectedAccounts.findFirst({
      where: eq(connectedAccounts.id, accountId),
    });

    const nextMetadata = applyProviderFailureMetadata(
      (account?.metadata as Record<string, unknown>) ?? {},
      {
        classification,
        message,
        operation: "replySync",
      },
    );
    await db
      .update(connectedAccounts)
      .set({
        lastError: message,
        metadata: nextMetadata,
        status: deriveProviderAccountStatus({
          metadata: nextMetadata,
          rawStatus: classification.accountStatus,
        }),
        updatedAt: new Date(),
      })
      .where(eq(connectedAccounts.id, accountId));

    logger.error(
      `[kanbun-worker] Microsoft reply sync failed for ${accountId}`,
      error,
    );
  }

  return true;
}

async function claimNextMicrosoftSubscriptionRenewalAccountId() {
  if (!isMicrosoftWebhookConfigured()) {
    return null;
  }

  const accounts = await db.query.connectedAccounts.findMany({
    where: and(
      eq(connectedAccounts.provider, "microsoft"),
      or(
        eq(connectedAccounts.status, "connected"),
        eq(connectedAccounts.status, "degraded"),
        eq(connectedAccounts.status, "reconnect_required"),
      ),
    ),
    orderBy: [desc(connectedAccounts.updatedAt)],
  });

  for (const account of accounts) {
    const contactExpiresAt = getMetadataDate(
      account.metadata,
      "microsoftContactSubscriptionExpiresAt",
    );
    const replyExpiresAt = getMetadataDate(
      account.metadata,
      "microsoftReplySubscriptionExpiresAt",
    );
    const needsContactRenewal =
      account.grantedScopes.includes(MICROSOFT_CONTACTS_SCOPE) &&
      (!contactExpiresAt ||
        contactExpiresAt.getTime() - Date.now() <= SUBSCRIPTION_RENEWAL_WINDOW_MS);
    const needsReplyRenewal =
      account.grantedScopes.includes(MICROSOFT_REPLY_READ_SCOPE) &&
      (!replyExpiresAt ||
        replyExpiresAt.getTime() - Date.now() <= SUBSCRIPTION_RENEWAL_WINDOW_MS);

    if (needsContactRenewal || needsReplyRenewal) {
      return account.id;
    }
  }

  return null;
}

export async function processNextMicrosoftSubscriptionRenewal(
  logger: WorkerLogger = console,
) {
  const accountId = await claimNextMicrosoftSubscriptionRenewalAccountId();

  if (!accountId) {
    return false;
  }

  try {
    await ensureMicrosoftGraphSubscriptions(accountId);
    logger.info(
      `[kanbun-worker] renewed Microsoft Graph subscriptions for account ${accountId}`,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to renew Microsoft Graph subscriptions.";
    const classification = classifyProviderFailure(message);
    const account = await db.query.connectedAccounts.findFirst({
      where: eq(connectedAccounts.id, accountId),
    });
    const nextMetadata = applyProviderFailureMetadata(
      (account?.metadata as Record<string, unknown>) ?? {},
      {
        classification,
        message,
        operation: "replySync",
        values: {
          microsoftSubscriptionRenewalErrorAt: new Date().toISOString(),
        },
      },
    );
    await db
      .update(connectedAccounts)
      .set({
        lastError: message,
        metadata: nextMetadata,
        status: deriveProviderAccountStatus({
          metadata: nextMetadata,
          rawStatus: classification.accountStatus,
        }),
        updatedAt: new Date(),
      })
      .where(eq(connectedAccounts.id, accountId));

    logger.error(
      `[kanbun-worker] Microsoft subscription renewal failed for ${accountId}`,
      error,
    );
  }

  return true;
}
