import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { connectedAccounts } from "@/db/schema";
import {
  GOOGLE_CONTACTS_SCOPE,
  GOOGLE_REPLY_READ_SCOPE,
  GOOGLE_SEND_SCOPE,
  MICROSOFT_CONTACTS_SCOPE,
  MICROSOFT_REPLY_READ_SCOPE,
  MICROSOFT_SEND_SCOPE,
} from "@/lib/provider-scopes";

function getMetadataString(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function getMetadataNumber(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object") {
    return 0;
  }

  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "number" ? value : 0;
}

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

export async function listConnectedAccountsForUser(userId: string) {
  const accounts = await db.query.connectedAccounts.findMany({
    where: eq(connectedAccounts.userId, userId),
    orderBy: [connectedAccounts.provider, desc(connectedAccounts.updatedAt)],
  });

  return accounts.map((account) => {
    const missing = missingScopes(account);

    return {
      ...account,
      contactSyncMode: getMetadataString(account.metadata, "contactSyncMode"),
      missingScopes: missing,
      replySyncLastDetectedCount: getMetadataNumber(
        account.metadata,
        "replySyncLastDetectedCount",
      ),
      replySyncLastRunAt: getMetadataString(
        account.metadata,
        "replySyncLastRunAt",
      ),
      replySyncMode: getMetadataString(account.metadata, "replySyncMode"),
      status:
        account.status === "connected" && missing.length > 0
          ? "reconnect_required"
          : account.status,
    };
  });
}
