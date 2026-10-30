/**
 * Accounts schema: lives in D1. Everything here must work without touching
 * any workspace Durable Object: login, invite acceptance, API-key lookup,
 * and the directory that maps a workspace URL key to its DO.
 */
import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { bool, json, type UserRole } from "./common";

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    avatarUrl: text("avatar_url"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("accounts_email").on(t.email)],
);

/** Per-account preferences that follow the person across workspaces. */
export const accountPreferences = sqliteTable("account_preferences", {
  accountId: text("account_id").primaryKey(),
  theme: text("theme").notNull().default("system"),
  customTheme: json<Record<string, string> | null>("custom_theme"),
  showCodeBlockLineNumbers: bool("show_code_block_line_numbers").notNull().default(false),
  fontSize: text("font_size").notNull().default("default"),
  updatedAt: text("updated_at").notNull(),
});

export const authIdentities = sqliteTable(
  "auth_identities",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    provider: text("provider", { enum: ["email", "google", "github", "cloudflare-access"] }).notNull(),
    providerUserId: text("provider_user_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("auth_identities_provider").on(t.provider, t.providerUserId),
    index("auth_identities_account").on(t.accountId),
  ],
);

export const magicLinks = sqliteTable(
  "magic_links",
  {
    tokenHash: text("token_hash").primaryKey(),
    email: text("email").notNull(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("magic_links_email").on(t.email)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_account").on(t.accountId)],
);

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    urlKey: text("url_key").notNull(),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull(),
    deletionRequestedAt: text("deletion_requested_at"),
  },
  (t) => [uniqueIndex("workspaces_url_key").on(t.urlKey)],
);

export const workspaceMembers = sqliteTable(
  "workspace_members",
  {
    workspaceId: text("workspace_id").notNull(),
    accountId: text("account_id").notNull(),
    role: text("role").$type<UserRole>().notNull().default("user"),
    createdAt: text("created_at").notNull(),
    removedAt: text("removed_at"),
  },
  (t) => [
    uniqueIndex("workspace_members_pair").on(t.workspaceId, t.accountId),
    index("workspace_members_account").on(t.accountId),
  ],
);

export const invites = sqliteTable(
  "invites",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    email: text("email").notNull(),
    role: text("role").$type<UserRole>().notNull().default("user"),
    inviterAccountId: text("inviter_account_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at"),
    acceptedAt: text("accepted_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("invites_workspace").on(t.workspaceId), uniqueIndex("invites_token").on(t.tokenHash)],
);

export const inviteLinks = sqliteTable("invite_links", {
  workspaceId: text("workspace_id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  enabled: bool("enabled").notNull().default(false),
  role: text("role").$type<UserRole>().notNull().default("user"),
  rotatedAt: text("rotated_at").notNull(),
});

export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    accountId: text("account_id").notNull(),
    label: text("label").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    scopes: json<string[]>("scopes").notNull(),
    lastUsedAt: text("last_used_at"),
    createdAt: text("created_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (t) => [uniqueIndex("api_keys_hash").on(t.keyHash), index("api_keys_workspace").on(t.workspaceId)],
);

export const oauthStates = sqliteTable("oauth_states", {
  state: text("state").primaryKey(),
  provider: text("provider").notNull(),
  redirectTo: text("redirect_to"),
  codeVerifier: text("code_verifier"),
  expiresAt: text("expires_at").notNull(),
});
