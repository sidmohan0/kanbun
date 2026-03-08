import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { idColumn, timestamps } from "./helpers";

export const contactIdentityKindEnum = pgEnum("contact_identity_kind", [
  "email",
  "provider_contact_id",
  "provider_person_id",
]);
export const contactSourceTypeEnum = pgEnum("contact_source_type", [
  "manual",
  "csv",
  "google",
  "microsoft",
]);
export const contactStatusEnum = pgEnum("contact_status", [
  "active",
  "archived",
]);

export const contacts = pgTable(
  "contacts",
  {
    id: idColumn(),
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    primaryEmail: text("primary_email"),
    company: text("company"),
    title: text("title"),
    status: contactStatusEnum("status").default("active").notNull(),
    relationshipSummary: text("relationship_summary"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("contacts_slug_unique").on(table.slug),
    index("contacts_display_name_idx").on(table.displayName),
  ],
);

export const contactIdentities = pgTable(
  "contact_identities",
  {
    id: idColumn(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    kind: contactIdentityKindEnum("kind").notNull(),
    value: text("value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    sourceType: contactSourceTypeEnum("source_type").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("contact_identities_kind_normalized_unique").on(
      table.kind,
      table.normalizedValue,
    ),
    index("contact_identities_contact_id_idx").on(table.contactId),
  ],
);

export const contactSources = pgTable(
  "contact_sources",
  {
    id: idColumn(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    sourceType: contactSourceTypeEnum("source_type").notNull(),
    sourceRef: text("source_ref").notNull(),
    sourceLabel: text("source_label"),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("contact_sources_type_ref_unique").on(
      table.sourceType,
      table.sourceRef,
    ),
    index("contact_sources_contact_id_idx").on(table.contactId),
  ],
);
