import crypto from "node:crypto";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  connectedAccounts,
  contactIdentities,
  contactSources,
  contacts,
} from "@/db/schema";
import { buildUniqueSlug, mergeContactFields } from "@/lib/contacts";
import { normalizeEmail } from "@/lib/csv";
import { env } from "@/lib/env";
import { upsertMergeReview } from "@/lib/merge-reviews";
import { decryptSecret, encryptSecret } from "@/lib/secrets";

const MICROSOFT_OAUTH_STATE_COOKIE = "kanbun_microsoft_oauth_state";
const MICROSOFT_SCOPES = [
  "offline_access",
  "openid",
  "profile",
  "email",
  "User.Read",
  "Contacts.Read",
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
  value?: MicrosoftContact[];
};

function microsoftTenantAuthority() {
  return `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}`;
}

function microsoftRedirectUri() {
  return `${env.APP_URL}/api/auth/microsoft/callback`;
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

function pickPrimaryEmail(contact: MicrosoftContact) {
  return normalizeEmail(contact.emailAddresses?.find((email) => email.address)?.address);
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

export async function syncMicrosoftContactsForAccount(accountId: string) {
  const account = await db.query.connectedAccounts.findFirst({
    where: eq(connectedAccounts.id, accountId),
  });

  if (!account) {
    throw new Error("Connected Microsoft account not found.");
  }

  const accessToken = await getMicrosoftAccessToken(accountId);
  let nextLink:
    | string
    | undefined = "https://graph.microsoft.com/v1.0/me/contacts?$top=200&$select=id,displayName,emailAddresses,companyName,jobTitle";
  let syncedCount = 0;

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
            displayName: person.displayName?.trim() || email || "Unnamed contact",
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
  }

  await db
    .update(connectedAccounts)
    .set({
      lastError: null,
      lastSuccessfulSyncAt: new Date(),
      lastSyncedContactCount: syncedCount,
      status: "connected",
      syncRequestedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(connectedAccounts.id, account.id));

  return {
    syncedCount,
  };
}
