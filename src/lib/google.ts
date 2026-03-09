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
  GOOGLE_CONTACTS_SCOPE,
  GOOGLE_REPLY_READ_SCOPE,
  GOOGLE_SEND_SCOPE,
} from "@/lib/provider-scopes";
import {
  extractMessageReferenceIds,
  extractEmailAddress,
  matchThreadedInboundReplies,
  normalizeMessageReferenceId,
} from "@/lib/reply-detection";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { recordReplySignal } from "@/lib/sequences";

const GOOGLE_OAUTH_STATE_COOKIE = "kanbun_google_oauth_state";
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  GOOGLE_CONTACTS_SCOPE,
  GOOGLE_REPLY_READ_SCOPE,
  GOOGLE_SEND_SCOPE,
];

type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
};

type GoogleUserInfo = {
  email?: string;
  name?: string;
  sub: string;
};

type GoogleConnection = {
  etag?: string;
  emailAddresses?: Array<{ value?: string }>;
  etag2?: string;
  names?: Array<{ displayName?: string; givenName?: string; familyName?: string }>;
  organizations?: Array<{ name?: string; title?: string }>;
  resourceName: string;
};

type GoogleConnectionsResponse = {
  connections?: GoogleConnection[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

type GmailListMessagesResponse = {
  messages?: Array<{
    id: string;
    threadId?: string;
  }>;
};

type GmailMetadataMessage = {
  id: string;
  internalDate?: string;
  payload?: {
    headers?: Array<{
      name?: string;
      value?: string;
    }>;
  };
  threadId?: string;
};

type GmailSendDiagnosticMessage = {
  id?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: {
    headers?: Array<{
      name?: string;
      value?: string;
    }>;
  };
  threadId?: string;
};

type GmailSendResponse = {
  id?: string;
  threadId?: string;
};

function googleRedirectUri() {
  return `${env.KANBUN_URL}/api/auth/google/callback`;
}

function buildStateCookieValue() {
  return crypto.randomBytes(24).toString("hex");
}

function parseScopes(scope: string | undefined) {
  return scope?.split(" ").filter(Boolean) ?? GOOGLE_SCOPES;
}

function ensureGoogleConfigured() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Google OAuth is not configured.");
  }
}

async function googleFetch<T>(
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

async function googleFetchWithOptionalJson<T>(
  url: string,
  init: RequestInit,
  errorMessage: string,
) {
  const response = await fetch(url, init);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${errorMessage} (${response.status}): ${body}`);
  }

  if (response.status === 204) {
    return null as T;
  }

  return (await response.json()) as T;
}

function pickPrimaryEmail(connection: GoogleConnection) {
  return normalizeEmail(
    connection.emailAddresses?.find((email) => email.value)?.value ?? null,
  );
}

function pickDisplayName(connection: GoogleConnection) {
  const primaryName = connection.names?.find(
    (name) => name.displayName || name.givenName || name.familyName,
  );

  if (!primaryName) {
    return "";
  }

  return (
    primaryName.displayName?.trim() ||
    [primaryName.givenName, primaryName.familyName].filter(Boolean).join(" ").trim()
  );
}

function pickOrganization(connection: GoogleConnection) {
  return connection.organizations?.find((organization) => organization.name || organization.title) ?? null;
}

function getGoogleMetadataTimestamp(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" ? value : null;
}

function getGoogleReplySummary(message: GmailMetadataMessage) {
  const subject =
    message.payload?.headers?.find((header) => header.name === "Subject")?.value ??
    null;

  return subject ? `Automatic Gmail reply detected: ${subject}` : null;
}

function getGoogleHeaderValue(
  message: GmailMetadataMessage | GmailSendDiagnosticMessage | null | undefined,
  name: string,
) {
  return (
    message?.payload?.headers?.find(
      (header) => header.name?.toLowerCase() === name.toLowerCase(),
    )?.value ?? null
  );
}

function getGoogleProviderInternetMessageId(
  message: GmailSendDiagnosticMessage | null,
) {
  return normalizeMessageReferenceId(getGoogleHeaderValue(message, "Message-ID"));
}

async function ensureIdentity(params: {
  contactId: string;
  kind: "email" | "provider_contact_id" | "provider_person_id";
  normalizedValue: string;
  sourceType: "google";
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
      eq(contactSources.sourceType, "google"),
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
      sourceType: "google",
    })
    .returning();

  return source;
}

export function isGoogleOAuthConfigured() {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export async function createGoogleOAuthUrl() {
  ensureGoogleConfigured();

  const state = buildStateCookieValue();
  const cookieStore = await cookies();
  cookieStore.set(GOOGLE_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    maxAge: 60 * 10,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  const params = new URLSearchParams({
    access_type: "offline",
    client_id: env.GOOGLE_CLIENT_ID!,
    include_granted_scopes: "true",
    prompt: "consent",
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function consumeGoogleOAuthCallback(input: {
  code: string;
  state: string;
  userId: string;
}) {
  ensureGoogleConfigured();

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(GOOGLE_OAUTH_STATE_COOKIE);

  if (!expectedState || input.state !== expectedState) {
    throw new Error("Google OAuth state validation failed.");
  }

  const token = await googleFetch<GoogleTokenResponse>(
    "https://oauth2.googleapis.com/token",
    {
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        code: input.code,
        grant_type: "authorization_code",
        redirect_uri: googleRedirectUri(),
      }),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    },
    "Unable to exchange Google authorization code",
  );
  const profile = await googleFetch<GoogleUserInfo>(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
      },
    },
    "Unable to fetch Google account profile",
  );

  const existing = await db.query.connectedAccounts.findFirst({
    where: and(
      eq(connectedAccounts.provider, "google"),
      eq(connectedAccounts.providerAccountId, profile.sub),
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
        displayName: profile.name ?? existing.displayName,
        email: profile.email ?? existing.email,
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
      displayName: profile.name ?? null,
      email: profile.email ?? null,
      encryptedAccessToken: encryptSecret(token.access_token),
      encryptedRefreshToken: encryptSecret(token.refresh_token ?? null),
      grantedScopes: parseScopes(token.scope),
      metadata,
      provider: "google",
      providerAccountId: profile.sub,
      status: "connected",
      syncRequestedAt: new Date(),
      userId: input.userId,
    })
    .returning();

  return account.id;
}

export async function requestGoogleAccountSync(userId: string) {
  const account = await db.query.connectedAccounts.findFirst({
    where: and(
      eq(connectedAccounts.userId, userId),
      eq(connectedAccounts.provider, "google"),
    ),
  });

  if (!account) {
    throw new Error("Google account is not connected.");
  }

  if (
    account.status === "disconnected" ||
    account.status === "reconnect_required"
  ) {
    throw new Error("Reconnect Google before syncing contacts.");
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

export async function disconnectGoogleAccount(userId: string) {
  const account = await db.query.connectedAccounts.findFirst({
    where: and(
      eq(connectedAccounts.userId, userId),
      eq(connectedAccounts.provider, "google"),
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

export async function refreshGoogleAccessToken(accountId: string) {
  ensureGoogleConfigured();

  const account = await db.query.connectedAccounts.findFirst({
    where: eq(connectedAccounts.id, accountId),
  });

  if (!account) {
    throw new Error("Connected Google account not found.");
  }

  const refreshToken = decryptSecret(account.encryptedRefreshToken);

  if (!refreshToken) {
    await db
      .update(connectedAccounts)
      .set({
        lastError: "Missing refresh token. Reconnect Google to continue syncing.",
        status: "reconnect_required",
        updatedAt: new Date(),
      })
      .where(eq(connectedAccounts.id, account.id));
    throw new Error("Missing Google refresh token.");
  }

  const token = await googleFetch<GoogleTokenResponse>(
    "https://oauth2.googleapis.com/token",
    {
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    },
    "Unable to refresh Google access token",
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

export async function getGoogleAccessToken(accountId: string) {
  const account = await db.query.connectedAccounts.findFirst({
    where: eq(connectedAccounts.id, accountId),
  });

  if (!account) {
    throw new Error("Connected Google account not found.");
  }

  const tokenExpiresAt = (account.metadata as Record<string, unknown>)?.tokenExpiresAt;
  const accessToken = decryptSecret(account.encryptedAccessToken);

  if (
    accessToken &&
    typeof tokenExpiresAt === "string" &&
    new Date(tokenExpiresAt).getTime() > Date.now() + 60_000
  ) {
    return accessToken;
  }

  return refreshGoogleAccessToken(accountId);
}

async function listRecentGoogleInboundMessages(input: {
  accessToken: string;
  since: Date;
}) {
  const query = `in:inbox after:${Math.floor(input.since.getTime() / 1000)}`;
  const listResponse = await googleFetch<GmailListMessagesResponse>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({
      maxResults: "50",
      q: query,
    }).toString()}`,
    {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
      },
    },
    "Unable to list recent Gmail messages",
  );

  const results = await Promise.all(
    (listResponse.messages ?? []).map((message) => {
      const metadataParams = (() => {
        const params = new URLSearchParams({
          format: "metadata",
        });
        params.append("metadataHeaders", "From");
        params.append("metadataHeaders", "Subject");
        params.append("metadataHeaders", "In-Reply-To");
        params.append("metadataHeaders", "References");
        return params;
      })();

      return googleFetch<GmailMetadataMessage>(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?${metadataParams.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${input.accessToken}`,
          },
        },
        "Unable to fetch Gmail reply metadata",
      );
    }),
  );

  return results
    .map((message) => ({
      inReplyTo: getGoogleHeaderValue(message, "In-Reply-To"),
      providerThreadId: message.threadId ?? null,
      referenceMessageIds: extractMessageReferenceIds(
        getGoogleHeaderValue(message, "References"),
      ),
      receivedAt: new Date(Number(message.internalDate ?? Date.now())),
      senderEmail: extractEmailAddress(
        getGoogleHeaderValue(message, "From"),
      ),
      summary: getGoogleReplySummary(message),
    }))
    .filter((message) => !Number.isNaN(message.receivedAt.getTime()));
}

export async function syncGoogleRepliesForAccount(accountId: string) {
  const account = await db.query.connectedAccounts.findFirst({
    where: eq(connectedAccounts.id, accountId),
  });

  if (!account) {
    throw new Error("Connected Google account not found.");
  }

  if (!account.grantedScopes.includes(GOOGLE_REPLY_READ_SCOPE)) {
    return {
      checkedCount: 0,
      detectedCount: 0,
      skippedReason: "Reconnect Google to enable automatic reply detection.",
    };
  }

  const accessToken = await getGoogleAccessToken(accountId);
  const metadata = (account.metadata as Record<string, unknown>) ?? {};
  const cursorAt =
    getGoogleMetadataTimestamp(metadata, "replySyncCursorAt") ??
    new Date(Date.now() - 1000 * 60 * 60 * 24 * 14).toISOString();

  const [recentInboundMessages, sentMessages] = await Promise.all([
    listRecentGoogleInboundMessages({
      accessToken,
      since: new Date(cursorAt),
    }),
    db.query.outboundMessages.findMany({
      where: and(
        eq(outboundMessages.connectedAccountId, accountId),
        eq(outboundMessages.provider, "google"),
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
      providerInternetMessageId?: string | null;
      senderEmail: string;
      sentAt: Date;
    }
  >();
  const sentMessageReferences = new Map<
    string,
    {
      contactId: string;
      contactName: string;
      providerInternetMessageId?: string | null;
      senderEmail: string;
      sentAt: Date;
    }
  >();

  for (const message of sentMessages) {
    const providerThreadId = message.providerThreadId?.trim();
    const contact = contactMap.get(message.contactId);
    const senderEmail = normalizeEmail(contact?.primaryEmail);
    const providerInternetMessageId = normalizeMessageReferenceId(
      typeof (message.metadata as Record<string, unknown> | null)?.providerInternetMessageId ===
        "string"
        ? ((message.metadata as Record<string, unknown>).providerInternetMessageId as string)
        : null,
    );

    if (!providerThreadId || !senderEmail || !message.sentAt) {
      continue;
    }

    const existing = sentThreads.get(providerThreadId);

    if (!existing || existing.sentAt.getTime() < message.sentAt.getTime()) {
      sentThreads.set(providerThreadId, {
        contactId: message.contactId,
        contactName: contact?.displayName ?? "Contact",
        providerInternetMessageId,
        senderEmail,
        sentAt: message.sentAt,
      });
    }

    if (providerInternetMessageId) {
      sentMessageReferences.set(providerInternetMessageId, {
        contactId: message.contactId,
        contactName: contact?.displayName ?? "Contact",
        providerInternetMessageId,
        senderEmail,
        sentAt: message.sentAt,
      });
    }
  }

  const replyMatches = matchThreadedInboundReplies(
    sentThreads,
    recentInboundMessages,
    sentMessageReferences,
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
      sourceType: "google_auto",
      summary:
        match.summary ??
        `Automatic Gmail reply detected from ${match.senderEmail}.`,
    });
    detectedCount += 1;
  }

  const newestTimestamp =
    recentInboundMessages
      .map((message) => message.receivedAt.getTime())
      .sort((left, right) => right - left)[0] ?? Date.now();

  await db
    .update(connectedAccounts)
    .set({
      metadata: {
        ...metadata,
        replySyncCursorAt: new Date(newestTimestamp).toISOString(),
        replySyncLastDetectedCount: detectedCount,
        replySyncLastError: null,
        replySyncLastRunAt: new Date().toISOString(),
        replySyncMode: "thread",
      },
      updatedAt: new Date(),
    })
    .where(eq(connectedAccounts.id, account.id));

  return {
    checkedCount: recentInboundMessages.length,
    detectedCount,
    skippedReason: null,
  };
}

export async function syncGoogleContactsForAccount(accountId: string) {
  const account = await db.query.connectedAccounts.findFirst({
    where: eq(connectedAccounts.id, accountId),
  });

  if (!account) {
    throw new Error("Connected Google account not found.");
  }

  const accessToken = await getGoogleAccessToken(accountId);
  let nextPageToken: string | undefined;
  let nextSyncToken = account.syncCursor ?? undefined;
  let syncedCount = 0;

  try {
    do {
      const params = new URLSearchParams({
        personFields: "names,emailAddresses,organizations",
        pageSize: "200",
        requestSyncToken: nextSyncToken ? "false" : "true",
        sortOrder: "LAST_MODIFIED_ASCENDING",
      });

      if (nextPageToken) {
        params.set("pageToken", nextPageToken);
      }

      if (nextSyncToken) {
        params.set("syncToken", nextSyncToken);
      }

      const response = await googleFetch<GoogleConnectionsResponse>(
        `https://people.googleapis.com/v1/people/me/connections?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
        "Unable to fetch Google contacts",
      );

      for (const person of response.connections ?? []) {
        const providerPersonKey = `google:${person.resourceName}`;
        const providerIdentity = await db.query.contactIdentities.findFirst({
          where: and(
            eq(contactIdentities.kind, "provider_person_id"),
            eq(contactIdentities.normalizedValue, providerPersonKey),
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
        const displayName = pickDisplayName(person);
        const organization = pickOrganization(person);

        let contactId = matchedContactId;
        let hasPrimaryEmailConflict = false;

        if (contactId) {
          const existingContact = await db.query.contacts.findFirst({
            where: eq(contacts.id, contactId),
          });

          if (existingContact) {
            const proposedValues = {
              company: organization?.name ?? null,
              displayName: displayName || email || existingContact.displayName,
              primaryEmail: email,
              title: organization?.title ?? null,
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
              provider: "google",
              sourceLabel: account.email ?? account.displayName,
              sourceRef: `${account.id}:${person.resourceName}`,
            });
            hasPrimaryEmailConflict = review.conflictFields.includes("primaryEmail");
            const nextPrimaryEmail = review.conflictFields.includes("primaryEmail")
              ? existingContact.primaryEmail
              : merged.primaryEmail;

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
                primaryEmail: nextPrimaryEmail,
                title:
                  review.autoUpdates.title !== undefined
                    ? merged.title
                    : existingContact.title,
                updatedAt: new Date(),
              })
              .where(eq(contacts.id, existingContact.id));
          }
        } else {
          const slug = await buildUniqueSlug(displayName || email || "contact");
          const [contact] = await db
            .insert(contacts)
            .values({
              company: organization?.name ?? null,
              displayName: displayName || email || "Unnamed contact",
              primaryEmail: email,
              slug,
              title: organization?.title ?? null,
            })
            .returning();

          contactId = contact.id;
        }

        if (!contactId) {
          continue;
        }

        await ensureIdentity({
          contactId,
          kind: "provider_person_id",
          normalizedValue: providerPersonKey,
          sourceType: "google",
          value: person.resourceName,
        });

        await ensureIdentity({
          contactId,
          kind: "provider_contact_id",
          normalizedValue: providerPersonKey,
          sourceType: "google",
          value: person.resourceName,
        });

        if (email && !hasPrimaryEmailConflict) {
          await ensureIdentity({
            contactId,
            kind: "email",
            normalizedValue: email,
            sourceType: "google",
            value: email,
          });
        }

        await ensureContactSource({
          contactId,
          sourceLabel: account.email ?? account.displayName,
          sourceRef: `${account.id}:${person.resourceName}`,
        });

        syncedCount += 1;
      }

      nextPageToken = response.nextPageToken;

      if (response.nextSyncToken) {
        nextSyncToken = response.nextSyncToken;
      }
    } while (nextPageToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google sync failed.";

    if (message.includes("(410)") && account.syncCursor) {
      await db
        .update(connectedAccounts)
        .set({
          syncCursor: null,
          updatedAt: new Date(),
        })
        .where(eq(connectedAccounts.id, account.id));

      return syncGoogleContactsForAccount(accountId);
    }

    throw error;
  }
  await db
    .update(connectedAccounts)
    .set({
      lastError: null,
      lastSuccessfulSyncAt: new Date(),
      lastSyncedContactCount: syncedCount,
      status: "connected",
      metadata: {
        ...((account.metadata as Record<string, unknown>) ?? {}),
        contactSyncCursorUpdatedAt: new Date().toISOString(),
        contactSyncMode: "incremental",
      },
      syncCursor: nextSyncToken ?? null,
      syncRequestedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(connectedAccounts.id, account.id));

  return {
    syncedCount,
  };
}

function toBase64Url(value: string) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function sendGoogleMessage(input: {
  accountId: string;
  bodyText: string;
  messageId: string;
  subject: string;
  to: string;
}) {
  const accessToken = await getGoogleAccessToken(input.accountId);
  const rawMessage = [
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "Content-Type: text/plain; charset=UTF-8",
    "MIME-Version: 1.0",
    "",
    input.bodyText,
  ].join("\r\n");

  const response = await googleFetchWithOptionalJson<GmailSendResponse>(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      body: JSON.stringify({
        raw: toBase64Url(rawMessage),
      }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
    "Unable to send Gmail message",
  );

  const messageMetadata = response?.id
    ? await googleFetch<GmailSendDiagnosticMessage>(
        (() => {
          const params = new URLSearchParams({
            format: "metadata",
          });
          params.append("metadataHeaders", "Message-ID");
          return `https://gmail.googleapis.com/gmail/v1/users/me/messages/${response.id}?${params.toString()}`;
        })(),
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
        "Unable to fetch Gmail sent message metadata",
      )
    : null;

  return {
    diagnostic: messageMetadata?.id
      ? `gmail message ${messageMetadata.id} in thread ${messageMetadata.threadId ?? "unknown"}`
      : `gmail send completed for outbound ${input.messageId}`,
    providerInternetMessageId: getGoogleProviderInternetMessageId(messageMetadata),
    providerMessageId: response?.id ?? null,
    providerThreadId: messageMetadata?.threadId ?? response?.threadId ?? null,
  };
}
