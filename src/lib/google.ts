import crypto from "node:crypto";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { connectedAccounts, contactIdentities, contactSources, contacts } from "@/db/schema";
import { buildUniqueSlug, mergeContactFields } from "@/lib/contacts";
import { normalizeEmail } from "@/lib/csv";
import { env } from "@/lib/env";
import { upsertMergeReview } from "@/lib/merge-reviews";
import { decryptSecret, encryptSecret } from "@/lib/secrets";

const GOOGLE_OAUTH_STATE_COOKIE = "kanbun_google_oauth_state";
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/contacts.readonly",
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

function googleRedirectUri() {
  return `${env.APP_URL}/api/auth/google/callback`;
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

  await db
    .update(connectedAccounts)
    .set({
      lastError: null,
      lastSuccessfulSyncAt: new Date(),
      lastSyncedContactCount: syncedCount,
      status: "connected",
      syncCursor: nextSyncToken ?? null,
      syncRequestedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(connectedAccounts.id, account.id));

  return {
    syncedCount,
  };
}
