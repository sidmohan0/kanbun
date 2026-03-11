import crypto from "node:crypto";
import { cookies } from "next/headers";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  connectedAccounts,
  contactIdentities,
  contactSources,
  contacts,
  outboundMessages,
  replySignals,
} from "@/db/schema";
import { buildUniqueSlug, mergeContactFields } from "@/lib/contacts";
import { normalizeEmail } from "@/lib/csv";
import { env } from "@/lib/env";
import { upsertMergeReview } from "@/lib/merge-reviews";
import {
  applyProviderSuccessMetadata,
  deriveProviderAccountStatus,
} from "@/lib/provider-health";
import {
  MICROSOFT_CONTACTS_SCOPE,
  MICROSOFT_REPLY_READ_SCOPE,
  MICROSOFT_SEND_SCOPE,
} from "@/lib/provider-scopes";
import {
  matchThreadedInboundReplies,
} from "@/lib/reply-detection";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { recordReplySignal } from "@/lib/sequences";

const MICROSOFT_OAUTH_STATE_COOKIE = "kanbun_microsoft_oauth_state";
const MICROSOFT_SCOPES = [
  "offline_access",
  "openid",
  "profile",
  "email",
  "User.Read",
  MICROSOFT_CONTACTS_SCOPE,
  MICROSOFT_REPLY_READ_SCOPE,
  MICROSOFT_SEND_SCOPE,
];

type MicrosoftTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
};

type MicrosoftProfile = {
  displayName?: string;
  id: string;
  mail?: string | null;
  userPrincipalName?: string | null;
};

type MicrosoftContact = {
  companyName?: string | null;
  displayName?: string | null;
  emailAddresses?: Array<{ address?: string | null; name?: string | null }>;
  id: string;
  jobTitle?: string | null;
};

type MicrosoftContactsResponse = {
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
  value?: MicrosoftContact[];
};

type MicrosoftInboxMessage = {
  conversationId?: string | null;
  from?: {
    emailAddress?: {
      address?: string | null;
    };
  };
  id: string;
  receivedDateTime?: string | null;
  subject?: string | null;
};

type MicrosoftInboxMessagesResponse = {
  value?: MicrosoftInboxMessage[];
};

type MicrosoftDraftMessage = {
  conversationId?: string | null;
  id?: string | null;
  internetMessageId?: string | null;
};

type MicrosoftSubscriptionResponse = {
  expirationDateTime?: string;
  id: string;
  resource?: string;
};

function microsoftTenantAuthority() {
  return `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}`;
}

function microsoftRedirectUri() {
  return `${env.KANBUN_URL}/api/auth/microsoft/callback`;
}

function microsoftNotificationsUrl() {
  return `${env.KANBUN_URL}/api/webhooks/microsoft/notifications`;
}

function microsoftLifecycleUrl() {
  return `${env.KANBUN_URL}/api/webhooks/microsoft/lifecycle`;
}

export function getMicrosoftWebhookClientState() {
  return env.MICROSOFT_WEBHOOK_CLIENT_STATE ?? env.APP_ENCRYPTION_KEY.slice(0, 32);
}

function hasPublicWebhookUrl() {
  const hostname = new URL(env.KANBUN_URL).hostname;
  return hostname !== "localhost" && hostname !== "127.0.0.1";
}

function buildStateCookieValue() {
  return crypto.randomBytes(24).toString("hex");
}

function parseScopes(scope: string | undefined) {
  return scope?.split(" ").filter(Boolean) ?? MICROSOFT_SCOPES;
}

function ensureMicrosoftConfigured() {
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) {
    throw new Error("Microsoft OAuth is not configured.");
  }
}

async function microsoftFetch<T>(
  url: string,
  init: RequestInit,
  errorMessage: string,
) {
  const response = await fetch(url, init);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${errorMessage} (${response.status}): ${body}`);
  }

  return (await response.json()) as T;
}

async function microsoftFetchWithoutJson(
  url: string,
  init: RequestInit,
  errorMessage: string,
) {
  const response = await fetch(url, init);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${errorMessage} (${response.status}): ${body}`);
  }
}

function pickPrimaryEmail(contact: MicrosoftContact) {
  return normalizeEmail(contact.emailAddresses?.find((email) => email.address)?.address);
}

function getMicrosoftMetadataTimestamp(
  metadata: Record<string, unknown>,
  key: string,
) {
  const value = metadata[key];
  return typeof value === "string" ? value : null;
}

async function ensureIdentity(params: {
  contactId: string;
  kind: "email" | "provider_contact_id" | "provider_person_id";
  normalizedValue: string;
  sourceType: "microsoft";
  value: string;
}) {
  const existing = await db.query.contactIdentities.findFirst({
    where: and(
      eq(contactIdentities.kind, params.kind),
      eq(contactIdentities.normalizedValue, params.normalizedValue),
    ),
  });

  if (existing) {
    return existing;
  }

  const [identity] = await db.insert(contactIdentities).values(params).returning();
  return identity;
}

async function ensureContactSource(params: {
  contactId: string;
  sourceLabel: string | null;
  sourceRef: string;
}) {
  const existing = await db.query.contactSources.findFirst({
    where: and(
      eq(contactSources.sourceType, "microsoft"),
      eq(contactSources.sourceRef, params.sourceRef),
    ),
  });

  if (existing) {
    return existing;
  }

  const [source] = await db
    .insert(contactSources)
    .values({
      contactId: params.contactId,
      sourceLabel: params.sourceLabel,
      sourceRef: params.sourceRef,
      sourceType: "microsoft",
    })
    .returning();

  return source;
}

export function isMicrosoftOAuthConfigured() {
  return Boolean(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET);
}

export function isMicrosoftWebhookConfigured() {
  return isMicrosoftOAuthConfigured() && hasPublicWebhookUrl();
}

export async function createMicrosoftOAuthUrl() {
  ensureMicrosoftConfigured();

  const state = buildStateCookieValue();
  const cookieStore = await cookies();
  cookieStore.set(MICROSOFT_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    maxAge: 60 * 10,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  const params = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID!,
    prompt: "select_account",
    redirect_uri: microsoftRedirectUri(),
    response_mode: "query",
    response_type: "code",
    scope: MICROSOFT_SCOPES.join(" "),
    state,
  });

  return `${microsoftTenantAuthority()}/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function consumeMicrosoftOAuthCallback(input: {
  code: string;
  state: string;
  userId: string;
}) {
  ensureMicrosoftConfigured();

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(MICROSOFT_OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(MICROSOFT_OAUTH_STATE_COOKIE);

  if (!expectedState || input.state !== expectedState) {
    throw new Error("Microsoft OAuth state validation failed.");
  }

  const token = await microsoftFetch<MicrosoftTokenResponse>(
    `${microsoftTenantAuthority()}/oauth2/v2.0/token`,
    {
      body: new URLSearchParams({
        client_id: env.MICROSOFT_CLIENT_ID!,
        client_secret: env.MICROSOFT_CLIENT_SECRET!,
        code: input.code,
        grant_type: "authorization_code",
        redirect_uri: microsoftRedirectUri(),
        scope: MICROSOFT_SCOPES.join(" "),
      }),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    },
    "Unable to exchange Microsoft authorization code",
  );

  const profile = await microsoftFetch<MicrosoftProfile>(
    "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName",
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
      },
    },
    "Unable to fetch Microsoft account profile",
  );

  const existing = await db.query.connectedAccounts.findFirst({
    where: and(
      eq(connectedAccounts.provider, "microsoft"),
      eq(connectedAccounts.providerAccountId, profile.id),
    ),
  });

  const metadata = {
    oauthConnectedAt: new Date().toISOString(),
    tokenExpiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
  };

  if (existing) {
    await db
      .update(connectedAccounts)
      .set({
        displayName: profile.displayName ?? existing.displayName,
        email:
          profile.mail ?? profile.userPrincipalName ?? existing.email ?? null,
        encryptedAccessToken: encryptSecret(token.access_token),
        encryptedRefreshToken: encryptSecret(
          token.refresh_token ??
            decryptSecret(existing.encryptedRefreshToken) ??
            null,
        ),
        grantedScopes: parseScopes(token.scope),
        lastError: null,
        metadata,
        status: "connected",
        syncRequestedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(connectedAccounts.id, existing.id));

    return existing.id;
  }

  const [account] = await db
    .insert(connectedAccounts)
    .values({
      displayName: profile.displayName ?? null,
      email: profile.mail ?? profile.userPrincipalName ?? null,
      encryptedAccessToken: encryptSecret(token.access_token),
      encryptedRefreshToken: encryptSecret(token.refresh_token ?? null),
      grantedScopes: parseScopes(token.scope),
      metadata,
      provider: "microsoft",
      providerAccountId: profile.id,
      status: "connected",
      syncRequestedAt: new Date(),
      userId: input.userId,
    })
    .returning();

  return account.id;
}

export async function requestMicrosoftAccountSync(userId: string) {
  const account = await db.query.connectedAccounts.findFirst({
    where: and(
      eq(connectedAccounts.userId, userId),
      eq(connectedAccounts.provider, "microsoft"),
    ),
  });

  if (!account) {
    throw new Error("Microsoft account is not connected.");
  }

  if (
    account.status === "disconnected" ||
    account.status === "reconnect_required"
  ) {
    throw new Error("Reconnect Microsoft before syncing contacts.");
  }

  await db
    .update(connectedAccounts)
    .set({
      lastError: null,
      syncRequestedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(connectedAccounts.id, account.id));

  return account.id;
}

async function upsertMicrosoftSubscription(input: {
  accessToken: string;
  changeType: string;
  existingSubscriptionId?: string | null;
  operation: "contactSync" | "replySync";
  resource: string;
}) {
  const expirationDateTime = new Date(
    Date.now() + 1000 * 60 * 60 * 24 * 2,
  ).toISOString();

  if (input.existingSubscriptionId) {
    return microsoftFetch<MicrosoftSubscriptionResponse>(
      `https://graph.microsoft.com/v1.0/subscriptions/${input.existingSubscriptionId}`,
      {
        body: JSON.stringify({
          expirationDateTime,
        }),
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json",
        },
        method: "PATCH",
      },
      `Unable to renew Microsoft ${input.operation} subscription`,
    );
  }

  return microsoftFetch<MicrosoftSubscriptionResponse>(
    "https://graph.microsoft.com/v1.0/subscriptions",
    {
      body: JSON.stringify({
        changeType: input.changeType,
        clientState: getMicrosoftWebhookClientState(),
        expirationDateTime,
        lifecycleNotificationUrl: microsoftLifecycleUrl(),
        notificationUrl: microsoftNotificationsUrl(),
        resource: input.resource,
      }),
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
    `Unable to create Microsoft ${input.operation} subscription`,
  );
}

export async function ensureMicrosoftGraphSubscriptions(accountId: string) {
  if (!isMicrosoftWebhookConfigured()) {
    return null;
  }

  const account = await db.query.connectedAccounts.findFirst({
    where: eq(connectedAccounts.id, accountId),
  });

  if (!account || account.provider !== "microsoft") {
    throw new Error("Connected Microsoft account not found.");
  }

  const accessToken = await getMicrosoftAccessToken(accountId);
  const metadata = (account.metadata as Record<string, unknown>) ?? {};
  const [contactSubscription, replySubscription] = await Promise.all([
    account.grantedScopes.includes(MICROSOFT_CONTACTS_SCOPE)
      ? upsertMicrosoftSubscription({
          accessToken,
          changeType: "created,updated,deleted",
          existingSubscriptionId:
            typeof metadata.microsoftContactSubscriptionId === "string"
              ? metadata.microsoftContactSubscriptionId
              : null,
          operation: "contactSync",
          resource: "me/contacts",
        })
      : null,
    account.grantedScopes.includes(MICROSOFT_REPLY_READ_SCOPE)
      ? upsertMicrosoftSubscription({
          accessToken,
          changeType: "created",
          existingSubscriptionId:
            typeof metadata.microsoftReplySubscriptionId === "string"
              ? metadata.microsoftReplySubscriptionId
              : null,
          operation: "replySync",
          resource: "me/mailFolders('Inbox')/messages",
        })
      : null,
  ]);
  const nextMetadata = {
    ...metadata,
    contactSyncMode: contactSubscription ? "incremental_delta_webhook" : metadata.contactSyncMode,
    microsoftContactSubscriptionExpiresAt:
      contactSubscription?.expirationDateTime ?? metadata.microsoftContactSubscriptionExpiresAt ?? null,
    microsoftContactSubscriptionId:
      contactSubscription?.id ?? metadata.microsoftContactSubscriptionId ?? null,
    microsoftReplySubscriptionExpiresAt:
      replySubscription?.expirationDateTime ?? metadata.microsoftReplySubscriptionExpiresAt ?? null,
    microsoftReplySubscriptionId:
      replySubscription?.id ?? metadata.microsoftReplySubscriptionId ?? null,
    replySyncMode: replySubscription ? "webhook_thread_aware" : metadata.replySyncMode,
  };

  await db
    .update(connectedAccounts)
    .set({
      lastError: null,
      metadata: nextMetadata,
      status: deriveProviderAccountStatus({
        metadata: nextMetadata,
        rawStatus: account.status,
      }),
      updatedAt: new Date(),
    })
    .where(eq(connectedAccounts.id, account.id));

  return {
    contactSubscription,
    replySubscription,
  };
}

export async function handleMicrosoftGraphNotification(input: {
  kind: "contactSync" | "replySync";
  subscriptionId: string;
}) {
  const accounts = await db.query.connectedAccounts.findMany({
    where: eq(connectedAccounts.provider, "microsoft"),
  });
  const account = accounts.find((entry) => {
    const metadata = (entry.metadata as Record<string, unknown>) ?? {};
    return input.kind === "contactSync"
      ? metadata.microsoftContactSubscriptionId === input.subscriptionId
      : metadata.microsoftReplySubscriptionId === input.subscriptionId;
  });

  if (!account) {
    return false;
  }

  const metadata = (account.metadata as Record<string, unknown>) ?? {};

  await db
    .update(connectedAccounts)
    .set({
      metadata: {
        ...metadata,
        ...(input.kind === "contactSync"
          ? {
              contactSyncLastNotificationAt: new Date().toISOString(),
              contactSyncMode: "incremental_delta_webhook",
            }
          : {
              replySyncDueAt: new Date().toISOString(),
              replySyncLastNotificationAt: new Date().toISOString(),
              replySyncMode: "webhook_thread_aware",
            }),
      },
      syncRequestedAt:
        input.kind === "contactSync" ? new Date() : account.syncRequestedAt,
      updatedAt: new Date(),
    })
    .where(eq(connectedAccounts.id, account.id));

  return true;
}

export async function handleMicrosoftGraphLifecycleEvent(input: {
  kind: "contactSync" | "replySync";
  subscriptionId: string;
}) {
  const accounts = await db.query.connectedAccounts.findMany({
    where: eq(connectedAccounts.provider, "microsoft"),
  });
  const account = accounts.find((entry) => {
    const metadata = (entry.metadata as Record<string, unknown>) ?? {};
    return input.kind === "contactSync"
      ? metadata.microsoftContactSubscriptionId === input.subscriptionId
      : metadata.microsoftReplySubscriptionId === input.subscriptionId;
  });

  if (!account) {
    return false;
  }

  const metadata = (account.metadata as Record<string, unknown>) ?? {};

  await db
    .update(connectedAccounts)
    .set({
      metadata: {
        ...metadata,
        ...(input.kind === "contactSync"
          ? {
              microsoftContactSubscriptionExpiresAt: new Date().toISOString(),
            }
          : {
              microsoftReplySubscriptionExpiresAt: new Date().toISOString(),
            }),
      },
      updatedAt: new Date(),
    })
    .where(eq(connectedAccounts.id, account.id));

  return true;
}

export async function disconnectMicrosoftAccount(userId: string) {
  const account = await db.query.connectedAccounts.findFirst({
    where: and(
      eq(connectedAccounts.userId, userId),
      eq(connectedAccounts.provider, "microsoft"),
    ),
  });

  if (!account) {
    return null;
  }

  await db
    .update(connectedAccounts)
    .set({
      encryptedAccessToken: null,
      encryptedRefreshToken: null,
      grantedScopes: [],
      lastError: null,
      metadata: {},
      status: "disconnected",
      syncCursor: null,
      syncRequestedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(connectedAccounts.id, account.id));

  return account.id;
}

export async function refreshMicrosoftAccessToken(accountId: string) {
  ensureMicrosoftConfigured();

  const account = await db.query.connectedAccounts.findFirst({
    where: eq(connectedAccounts.id, accountId),
  });

  if (!account) {
    throw new Error("Connected Microsoft account not found.");
  }

  const refreshToken = decryptSecret(account.encryptedRefreshToken);

  if (!refreshToken) {
    await db
      .update(connectedAccounts)
      .set({
        lastError:
          "Missing refresh token. Reconnect Microsoft to continue syncing.",
        status: "reconnect_required",
        updatedAt: new Date(),
      })
      .where(eq(connectedAccounts.id, account.id));
    throw new Error("Missing Microsoft refresh token.");
  }

  const token = await microsoftFetch<MicrosoftTokenResponse>(
    `${microsoftTenantAuthority()}/oauth2/v2.0/token`,
    {
      body: new URLSearchParams({
        client_id: env.MICROSOFT_CLIENT_ID!,
        client_secret: env.MICROSOFT_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: MICROSOFT_SCOPES.join(" "),
      }),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    },
    "Unable to refresh Microsoft access token",
  );

  const nextMetadata = {
    ...(account.metadata as Record<string, unknown>),
    tokenExpiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
  };

  await db
    .update(connectedAccounts)
    .set({
      encryptedAccessToken: encryptSecret(token.access_token),
      encryptedRefreshToken: encryptSecret(token.refresh_token ?? refreshToken),
      grantedScopes: parseScopes(token.scope),
      lastError: null,
      metadata: nextMetadata,
      status: "connected",
      updatedAt: new Date(),
    })
    .where(eq(connectedAccounts.id, account.id));

  return token.access_token;
}

export async function getMicrosoftAccessToken(accountId: string) {
  const account = await db.query.connectedAccounts.findFirst({
    where: eq(connectedAccounts.id, accountId),
  });

  if (!account) {
    throw new Error("Connected Microsoft account not found.");
  }

  const tokenExpiresAt = (account.metadata as Record<string, unknown>)
    ?.tokenExpiresAt;
  const accessToken = decryptSecret(account.encryptedAccessToken);

  if (
    accessToken &&
    typeof tokenExpiresAt === "string" &&
    new Date(tokenExpiresAt).getTime() > Date.now() + 60_000
  ) {
    return accessToken;
  }

  return refreshMicrosoftAccessToken(accountId);
}

async function listRecentMicrosoftInboxMessages(input: {
  accessToken: string;
  since: Date;
}) {
  const params = new URLSearchParams({
    $filter: `receivedDateTime ge ${input.since.toISOString()}`,
    $orderby: "receivedDateTime desc",
    $select: "conversationId,id,from,receivedDateTime,subject",
    $top: "50",
  });

  const response = await microsoftFetch<MicrosoftInboxMessagesResponse>(
    `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
      },
    },
    "Unable to fetch Microsoft inbox messages",
  );

  return (response.value ?? [])
    .map((message) => ({
      providerThreadId: message.conversationId ?? null,
      receivedAt: new Date(message.receivedDateTime ?? Date.now()),
      senderEmail: normalizeEmail(message.from?.emailAddress?.address ?? null),
      summary: message.subject
        ? `Automatic Outlook reply detected: ${message.subject}`
        : null,
    }))
    .filter((message) => !Number.isNaN(message.receivedAt.getTime()));
}

export async function syncMicrosoftRepliesForAccount(accountId: string) {
  const account = await db.query.connectedAccounts.findFirst({
    where: eq(connectedAccounts.id, accountId),
  });

  if (!account) {
    throw new Error("Connected Microsoft account not found.");
  }

  if (!account.grantedScopes.includes(MICROSOFT_REPLY_READ_SCOPE)) {
    return {
      checkedCount: 0,
      detectedCount: 0,
      skippedReason: "Reconnect Microsoft to enable automatic reply detection.",
    };
  }

  const accessToken = await getMicrosoftAccessToken(accountId);
  const metadata = (account.metadata as Record<string, unknown>) ?? {};
  const cursorAt =
    getMicrosoftMetadataTimestamp(metadata, "replySyncCursorAt") ??
    new Date(Date.now() - 1000 * 60 * 60 * 24 * 14).toISOString();

  const [recentInboundMessages, sentMessages] = await Promise.all([
    listRecentMicrosoftInboxMessages({
      accessToken,
      since: new Date(cursorAt),
    }),
    db.query.outboundMessages.findMany({
      where: and(
        eq(outboundMessages.connectedAccountId, accountId),
        eq(outboundMessages.provider, "microsoft"),
        eq(outboundMessages.status, "sent"),
      ),
      orderBy: [desc(outboundMessages.sentAt)],
      limit: 250,
    }),
  ]);

  const contactIds = Array.from(
    new Set(
      sentMessages
        .filter((message) => Boolean(message.providerThreadId))
        .map((message) => message.contactId),
    ),
  );
  const contactRows = contactIds.length
    ? await db.query.contacts.findMany({
        where: inArray(contacts.id, contactIds),
        columns: {
          displayName: true,
          id: true,
          primaryEmail: true,
        },
      })
    : [];
  const contactMap = new Map(contactRows.map((contact) => [contact.id, contact]));
  const sentThreads = new Map<
    string,
    {
      contactId: string;
      contactName: string;
      senderEmail: string;
      sentAt: Date;
    }
  >();

  for (const message of sentMessages) {
    const providerThreadId = message.providerThreadId?.trim();
    const contact = contactMap.get(message.contactId);
    const senderEmail = normalizeEmail(contact?.primaryEmail);

    if (!providerThreadId || !senderEmail || !message.sentAt) {
      continue;
    }

    const existing = sentThreads.get(providerThreadId);

    if (!existing || existing.sentAt.getTime() < message.sentAt.getTime()) {
      sentThreads.set(providerThreadId, {
        contactId: message.contactId,
        contactName: contact?.displayName ?? "Contact",
        senderEmail,
        sentAt: message.sentAt,
      });
    }
  }

  const replyMatches = matchThreadedInboundReplies(
    sentThreads,
    recentInboundMessages,
  );

  let detectedCount = 0;

  for (const match of replyMatches) {
    const existingSignal = await db.query.replySignals.findFirst({
      where: eq(replySignals.contactId, match.contactId),
      columns: {
        id: true,
      },
    });

    if (existingSignal) {
      continue;
    }

    await recordReplySignal({
      contactId: match.contactId,
      sourceType: "microsoft_auto",
      summary:
        match.summary ??
        `Automatic Outlook reply detected from ${match.senderEmail}.`,
    });
    detectedCount += 1;
  }

  const newestTimestamp =
    recentInboundMessages
      .map((message) => message.receivedAt.getTime())
      .sort((left, right) => right - left)[0] ?? Date.now();
  const nextMetadata = applyProviderSuccessMetadata(metadata, {
    operation: "replySync",
    values: {
      replySyncCursorAt: new Date(newestTimestamp).toISOString(),
      replySyncLastCheckedCount: recentInboundMessages.length,
      replySyncLastDetectedCount: detectedCount,
      replySyncMode: "thread_aware",
    },
  });

  await db
    .update(connectedAccounts)
    .set({
      lastError: null,
      metadata: nextMetadata,
      status: deriveProviderAccountStatus({
        metadata: nextMetadata,
        rawStatus: account.status,
      }),
      updatedAt: new Date(),
    })
    .where(eq(connectedAccounts.id, account.id));

  return {
    checkedCount: recentInboundMessages.length,
    detectedCount,
    skippedReason: null,
  };
}

export async function syncMicrosoftContactsForAccount(accountId: string) {
  const account = await db.query.connectedAccounts.findFirst({
    where: eq(connectedAccounts.id, accountId),
  });

  if (!account) {
    throw new Error("Connected Microsoft account not found.");
  }

  const accessToken = await getMicrosoftAccessToken(accountId);
  let nextLink: string | undefined =
    account.syncCursor ??
    "https://graph.microsoft.com/v1.0/me/contacts/delta?$top=200&$select=id,displayName,emailAddresses,companyName,jobTitle";
  let syncedCount = 0;
  let nextDeltaLink = account.syncCursor ?? null;

  try {
    while (nextLink) {
      const response: MicrosoftContactsResponse =
        await microsoftFetch<MicrosoftContactsResponse>(
          nextLink,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
          "Unable to fetch Microsoft contacts",
        );

      for (const person of response.value ?? []) {
        const providerContactKey = `microsoft:${person.id}`;
        const providerIdentity = await db.query.contactIdentities.findFirst({
          where: and(
            eq(contactIdentities.kind, "provider_contact_id"),
            eq(contactIdentities.normalizedValue, providerContactKey),
          ),
        });
        const email = pickPrimaryEmail(person);
        const emailIdentity = email
          ? await db.query.contactIdentities.findFirst({
              where: and(
                eq(contactIdentities.kind, "email"),
                eq(contactIdentities.normalizedValue, email),
              ),
            })
          : null;
        const matchedContactId =
          providerIdentity?.contactId ?? emailIdentity?.contactId ?? null;

        let contactId = matchedContactId;
        let hasPrimaryEmailConflict = false;

        if (contactId) {
          const existingContact = await db.query.contacts.findFirst({
            where: eq(contacts.id, contactId),
          });

          if (existingContact) {
            const proposedValues = {
              company: person.companyName ?? null,
              displayName:
                person.displayName?.trim() || email || existingContact.displayName,
              primaryEmail: email,
              title: person.jobTitle ?? null,
            } as const;
            const merged = mergeContactFields(existingContact, proposedValues);
            const review = await upsertMergeReview({
              connectedAccountId: account.id,
              contactId: existingContact.id,
              currentValues: {
                company: existingContact.company,
                displayName: existingContact.displayName,
                primaryEmail: existingContact.primaryEmail,
                title: existingContact.title,
              },
              proposedValues,
              provider: "microsoft",
              sourceLabel: account.email ?? account.displayName,
              sourceRef: `${account.id}:${person.id}`,
            });
            hasPrimaryEmailConflict = review.conflictFields.includes("primaryEmail");

            await db
              .update(contacts)
              .set({
                company:
                  review.autoUpdates.company !== undefined
                    ? merged.company
                    : existingContact.company,
                displayName:
                  review.autoUpdates.displayName !== undefined
                    ? merged.displayName
                    : existingContact.displayName,
                primaryEmail: hasPrimaryEmailConflict
                  ? existingContact.primaryEmail
                  : merged.primaryEmail,
                title:
                  review.autoUpdates.title !== undefined
                    ? merged.title
                    : existingContact.title,
                updatedAt: new Date(),
              })
              .where(eq(contacts.id, existingContact.id));
          }
        } else {
          const slug = await buildUniqueSlug(
            person.displayName?.trim() || email || "contact",
          );
          const [contact] = await db
            .insert(contacts)
            .values({
              company: person.companyName ?? null,
              displayName:
                person.displayName?.trim() || email || "Unnamed contact",
              primaryEmail: email,
              slug,
              title: person.jobTitle ?? null,
            })
            .returning();

          contactId = contact.id;
        }

        if (!contactId) {
          continue;
        }

        await ensureIdentity({
          contactId,
          kind: "provider_contact_id",
          normalizedValue: providerContactKey,
          sourceType: "microsoft",
          value: person.id,
        });

        if (email && !hasPrimaryEmailConflict) {
          await ensureIdentity({
            contactId,
            kind: "email",
            normalizedValue: email,
            sourceType: "microsoft",
            value: email,
          });
        }

        await ensureContactSource({
          contactId,
          sourceLabel: account.email ?? account.displayName,
          sourceRef: `${account.id}:${person.id}`,
        });

        syncedCount += 1;
      }

      nextLink = response["@odata.nextLink"];
      if (response["@odata.deltaLink"]) {
        nextDeltaLink = response["@odata.deltaLink"];
      }
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Microsoft sync failed.";

    if (
      (message.includes("(410)") || message.includes("(400)")) &&
      account.syncCursor
    ) {
      await db
        .update(connectedAccounts)
        .set({
          syncCursor: null,
          updatedAt: new Date(),
        })
        .where(eq(connectedAccounts.id, account.id));

      return syncMicrosoftContactsForAccount(accountId);
    }

    throw error;
  }

  const nextMetadata = applyProviderSuccessMetadata(
    (account.metadata as Record<string, unknown>) ?? {},
    {
      operation: "contactSync",
      values: {
        contactSyncCursorUpdatedAt: new Date().toISOString(),
        contactSyncLastResultCount: syncedCount,
        contactSyncMode: "incremental_delta",
      },
    },
  );

  await db
    .update(connectedAccounts)
    .set({
      lastError: null,
      lastSuccessfulSyncAt: new Date(),
      lastSyncedContactCount: syncedCount,
      metadata: nextMetadata,
      status: deriveProviderAccountStatus({
        metadata: nextMetadata,
        rawStatus: account.status,
      }),
      syncCursor: nextDeltaLink,
      syncRequestedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(connectedAccounts.id, account.id));

  return {
    syncedCount,
  };
}

export async function sendMicrosoftMessage(input: {
  accountId: string;
  bodyText: string;
  messageId: string;
  subject: string;
  to: string;
}) {
  const accessToken = await getMicrosoftAccessToken(input.accountId);

  const draft = await microsoftFetch<MicrosoftDraftMessage>(
    "https://graph.microsoft.com/v1.0/me/messages",
    {
      body: JSON.stringify({
        body: {
          content: input.bodyText,
          contentType: "Text",
        },
        subject: input.subject,
        toRecipients: [
          {
            emailAddress: {
              address: input.to,
            },
          },
        ],
      }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
    "Unable to create Microsoft draft message",
  );

  if (!draft.id) {
    throw new Error("Microsoft draft creation did not return a message id.");
  }

  await microsoftFetchWithoutJson(
    `https://graph.microsoft.com/v1.0/me/messages/${draft.id}/send`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      method: "POST",
    },
    "Unable to send Microsoft message",
  );

  return {
    diagnostic: draft.id
      ? `microsoft message ${draft.id} in conversation ${draft.conversationId ?? "unknown"}`
      : `microsoft send completed for outbound ${input.messageId}`,
    providerInternetMessageId: draft.internetMessageId ?? null,
    providerMessageId: draft.id ?? null,
    providerThreadId: draft.conversationId ?? null,
  };
}
