import {
  boolean,
  integer,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { idColumn, timestamps } from "./helpers";

export const userRoleEnum = pgEnum("user_role", ["owner", "disabled"]);
export const userStatusEnum = pgEnum("user_status", ["active", "disabled"]);
export const providerEnum = pgEnum("provider", [
  "google",
  "microsoft",
  "todoist",
]);
export const connectedAccountStatusEnum = pgEnum("connected_account_status", [
  "connected",
  "degraded",
  "reconnect_required",
  "disconnected",
]);

export const users = pgTable(
  "users",
  {
    id: idColumn(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name"),
    role: userRoleEnum("role").default("owner").notNull(),
    status: userStatusEnum("status").default("active").notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: idColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_id_idx").on(table.userId),
  ],
);

export const connectedAccounts = pgTable(
  "connected_accounts",
  {
    id: idColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: providerEnum("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    email: text("email"),
    displayName: text("display_name"),
    grantedScopes: text("granted_scopes").array().default([]).notNull(),
    encryptedAccessToken: text("encrypted_access_token"),
    encryptedRefreshToken: text("encrypted_refresh_token"),
    status: connectedAccountStatusEnum("status")
      .default("disconnected")
      .notNull(),
    syncCursor: text("sync_cursor"),
    syncRequestedAt: timestamp("sync_requested_at", {
      withTimezone: true,
    }),
    lastSyncedContactCount: integer("last_synced_contact_count")
      .default(0)
      .notNull(),
    lastSuccessfulSyncAt: timestamp("last_successful_sync_at", {
      withTimezone: true,
    }),
    lastError: text("last_error"),
    metadata: jsonb("metadata").default({}).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("connected_accounts_provider_account_unique").on(
      table.provider,
      table.providerAccountId,
    ),
    index("connected_accounts_user_id_idx").on(table.userId),
    index("connected_accounts_provider_sync_requested_at_idx").on(
      table.provider,
      table.syncRequestedAt,
    ),
  ],
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    id: idColumn(),
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumed: boolean("consumed").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("verification_tokens_token_unique").on(table.token)],
);
