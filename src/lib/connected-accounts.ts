import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { connectedAccounts } from "@/db/schema";
import {
  deriveProviderAccountStatus,
  getMetadataDate,
  getMetadataNumber,
  getMetadataString,
} from "@/lib/provider-health";
import {
  GOOGLE_CONTACTS_SCOPE,
  GOOGLE_REPLY_READ_SCOPE,
  GOOGLE_SEND_SCOPE,
  MICROSOFT_CONTACTS_SCOPE,
  MICROSOFT_REPLY_READ_SCOPE,
  MICROSOFT_SEND_SCOPE,
} from "@/lib/provider-scopes";

function missingScopes(account: typeof connectedAccounts.$inferSelect) {
  if (account.provider === "google") {
    return [
      GOOGLE_CONTACTS_SCOPE,
      GOOGLE_SEND_SCOPE,
      GOOGLE_REPLY_READ_SCOPE,
    ].filter((scope) => !account.grantedScopes.includes(scope));
  }

  if (account.provider === "microsoft") {
    return [
      MICROSOFT_CONTACTS_SCOPE,
      MICROSOFT_SEND_SCOPE,
      MICROSOFT_REPLY_READ_SCOPE,
    ].filter((scope) => !account.grantedScopes.includes(scope));
  }

  return [];
}

export function decorateConnectedAccount(
  account: typeof connectedAccounts.$inferSelect,
) {
  const missing = missingScopes(account);
  const decorated = {
    ...account,
    contactSyncFailureCategory: getMetadataString(
      account.metadata,
      "contactSyncFailureCategory",
    ),
    contactSyncLastError: getMetadataString(account.metadata, "contactSyncLastError"),
    contactSyncLastResultCount: getMetadataNumber(
      account.metadata,
      "contactSyncLastResultCount",
    ),
    contactSyncLastRunAt: getMetadataDate(account.metadata, "contactSyncLastRunAt"),
    contactSyncLastSuccessAt: getMetadataDate(
      account.metadata,
      "contactSyncLastSuccessAt",
    ),
    contactSyncMode: getMetadataString(account.metadata, "contactSyncMode"),
    contactSyncOperatorAction: getMetadataString(
      account.metadata,
      "contactSyncOperatorAction",
    ),
    contactSyncRetryAt: getMetadataDate(account.metadata, "contactSyncRetryAt"),
    missingScopes: missing,
    outboundSendFailureCategory: getMetadataString(
      account.metadata,
      "outboundSendFailureCategory",
    ),
    outboundSendLastError: getMetadataString(
      account.metadata,
      "outboundSendLastError",
    ),
    outboundSendLastErrorAt: getMetadataDate(
      account.metadata,
      "outboundSendLastErrorAt",
    ),
    outboundSendLastMessageId: getMetadataString(
      account.metadata,
      "outboundSendLastMessageId",
    ),
    outboundSendLastRunAt: getMetadataDate(
      account.metadata,
      "outboundSendLastRunAt",
    ),
    outboundSendLastSuccessAt: getMetadataDate(
      account.metadata,
      "outboundSendLastSuccessAt",
    ),
    outboundSendOperatorAction: getMetadataString(
      account.metadata,
      "outboundSendOperatorAction",
    ),
    outboundSendRetryAt: getMetadataDate(account.metadata, "outboundSendRetryAt"),
    replySyncFailureCategory: getMetadataString(
      account.metadata,
      "replySyncFailureCategory",
    ),
    replySyncLastDetectedCount: getMetadataNumber(
      account.metadata,
      "replySyncLastDetectedCount",
    ),
    replySyncLastError: getMetadataString(account.metadata, "replySyncLastError"),
    replySyncLastRunAt: getMetadataDate(account.metadata, "replySyncLastRunAt"),
    replySyncLastCheckedCount: getMetadataNumber(
      account.metadata,
      "replySyncLastCheckedCount",
    ),
    replySyncLastSuccessAt: getMetadataDate(
      account.metadata,
      "replySyncLastSuccessAt",
    ),
    replySyncMode: getMetadataString(account.metadata, "replySyncMode"),
    replySyncRetryAt: getMetadataDate(account.metadata, "replySyncRetryAt"),
    replySyncOperatorAction: getMetadataString(
      account.metadata,
      "replySyncOperatorAction",
    ),
  };

  return {
    ...decorated,
    status: deriveProviderAccountStatus({
      metadata: account.metadata as Record<string, unknown> | null | undefined,
      missingScopes: missing,
      rawStatus: account.status,
    }),
  };
}

export async function listConnectedAccountsForUser(userId: string) {
  const accounts = await db.query.connectedAccounts.findMany({
    where: eq(connectedAccounts.userId, userId),
    orderBy: [connectedAccounts.provider, desc(connectedAccounts.updatedAt)],
  });

  return accounts.map(decorateConnectedAccount);
}
