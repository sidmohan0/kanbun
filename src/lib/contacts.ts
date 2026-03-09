import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  auditEvents,
  contactIdentities,
  contactMergeReviews,
  contactSources,
  contacts,
  tasks,
} from "@/db/schema";
import { normalizeEmail, slugify } from "@/lib/csv";

type ContactSourceType = "csv" | "google" | "manual" | "microsoft";

type ListContactsOptions = {
  needsAttentionOnly?: boolean;
  query?: string;
  sourceType?: ContactSourceType | "all";
};

async function recordAuditEvent(input: {
  actorUserId?: string | null;
  entityId: string;
  entityType: string;
  eventName: string;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(auditEvents).values({
    actorUserId: input.actorUserId ?? null,
    entityId: input.entityId,
    entityType: input.entityType,
    eventName: input.eventName,
    metadata: input.metadata ?? {},
  });
}

export async function listContacts(options: ListContactsOptions = {}) {
  const rows = await db.query.contacts.findMany({
    orderBy: [asc(contacts.displayName)],
  });

  const openTasks = await db.query.tasks.findMany({
    where: eq(tasks.status, "open"),
    columns: {
      id: true,
      contactId: true,
      dueAt: true,
    },
  });
  const openMergeReviews = await db.query.contactMergeReviews.findMany({
    where: eq(contactMergeReviews.status, "open"),
    columns: {
      id: true,
      contactId: true,
    },
  });
  const sourceRows = await db.query.contactSources.findMany({
    orderBy: [desc(contactSources.importedAt)],
    columns: {
      contactId: true,
      sourceType: true,
    },
  });

  return rows
    .map((contact) => {
      const dueTasks = openTasks.filter((task) => task.contactId === contact.id);
      const reviewCount = openMergeReviews.filter(
        (review) => review.contactId === contact.id,
      ).length;
      const nextTask = dueTasks
        .filter((task) => task.dueAt)
        .sort((left, right) => {
          if (!left.dueAt || !right.dueAt) {
            return 0;
          }

          return left.dueAt.getTime() - right.dueAt.getTime();
        })[0];
      const sourceTypes = Array.from(
        new Set(
          sourceRows
            .filter((source) => source.contactId === contact.id)
            .map((source) => source.sourceType),
        ),
      );

      return {
        ...contact,
        openMergeReviewCount: reviewCount,
        openTaskCount: dueTasks.length,
        nextDueAt: nextTask?.dueAt ?? null,
        sourceTypes,
      };
    })
    .filter((contact) => {
      const query = options.query?.trim().toLowerCase();

      if (query) {
        const haystack = [
          contact.displayName,
          contact.primaryEmail,
          contact.company,
          contact.title,
          contact.relationshipSummary,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(query)) {
          return false;
        }
      }

      if (
        options.sourceType &&
        options.sourceType !== "all" &&
        !contact.sourceTypes.includes(options.sourceType)
      ) {
        return false;
      }

      if (
        options.needsAttentionOnly &&
        contact.openTaskCount === 0 &&
        contact.openMergeReviewCount === 0
      ) {
        return false;
      }

      return true;
    });
}

export async function getContactBySlug(slug: string) {
  const contact = await db.query.contacts.findFirst({
    where: eq(contacts.slug, slug),
  });

  if (!contact) {
    return null;
  }

  const [sources, identities, followUps, mergeReviews] = await Promise.all([
    db.query.contactSources.findMany({
      where: eq(contactSources.contactId, contact.id),
      orderBy: [desc(contactSources.importedAt)],
    }),
    db.query.contactIdentities.findMany({
      where: eq(contactIdentities.contactId, contact.id),
      orderBy: [asc(contactIdentities.createdAt)],
    }),
    db.query.tasks.findMany({
      where: and(eq(tasks.contactId, contact.id), eq(tasks.status, "open")),
      orderBy: [asc(tasks.dueAt), desc(tasks.createdAt)],
    }),
    db.query.contactMergeReviews.findMany({
      where: and(
        eq(contactMergeReviews.contactId, contact.id),
        eq(contactMergeReviews.status, "open"),
      ),
      orderBy: [desc(contactMergeReviews.lastSeenAt)],
    }),
  ]);

  return {
    ...contact,
    mergeReviews,
    sources,
    identities,
    followUps,
  };
}

export async function listOpenTasks() {
  const taskRows = await db.query.tasks.findMany({
    where: eq(tasks.status, "open"),
    orderBy: [asc(tasks.dueAt), desc(tasks.createdAt)],
  });

  const contactIds = taskRows
    .map((task) => task.contactId)
    .filter((contactId): contactId is string => Boolean(contactId));

  const taskContacts =
    contactIds.length > 0
      ? await db.query.contacts.findMany({
          where: inArray(contacts.id, contactIds),
          columns: {
            id: true,
            slug: true,
            displayName: true,
          },
        })
      : [];

  const contactMap = new Map(
    taskContacts.map((contact) => [contact.id, contact]),
  );

  return taskRows.map((task) => ({
    ...task,
    contact: task.contactId ? (contactMap.get(task.contactId) ?? null) : null,
  }));
}

export async function createFollowUpTask(
  contactId: string,
  options?: {
    mirrorToTodoist?: boolean;
  },
) {
  const contact = await db.query.contacts.findFirst({
    where: eq(contacts.id, contactId),
  });

  if (!contact) {
    return null;
  }

  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + 1);
  dueAt.setHours(9, 0, 0, 0);

  await db.insert(tasks).values({
    contactId: contact.id,
    title: `Follow up with ${contact.displayName}`,
    kind: "follow_up",
    status: "open",
    dueAt,
    todoistSyncRequestedAt: options?.mirrorToTodoist ? new Date() : null,
    todoistSyncStatus: options?.mirrorToTodoist ? "queued" : "not_mirrored",
  });

  return contact.slug;
}

export async function createManualContact(input: {
  actorUserId?: string | null;
  company?: string | null;
  displayName: string;
  primaryEmail?: string | null;
  relationshipSummary?: string | null;
  title?: string | null;
}) {
  const displayName = input.displayName.trim();
  const primaryEmail = normalizeEmail(input.primaryEmail);

  if (!displayName && !primaryEmail) {
    throw new Error("Add at least a name or email before creating a contact.");
  }

  if (primaryEmail) {
    const existingIdentity = await findContactIdentityByEmail(primaryEmail);

    if (existingIdentity) {
      throw new Error("A contact with this primary email already exists.");
    }
  }

  const slug = await buildUniqueSlug(displayName || primaryEmail || "contact");
  const [contact] = await db
    .insert(contacts)
    .values({
      company: input.company?.trim() || null,
      displayName: displayName || primaryEmail || "Unnamed contact",
      primaryEmail,
      relationshipSummary: input.relationshipSummary?.trim() || null,
      slug,
      title: input.title?.trim() || null,
    })
    .returning();

  await db.insert(contactSources).values({
    contactId: contact.id,
    sourceLabel: "Created in Kanbun",
    sourceRef: `manual:${contact.id}`,
    sourceType: "manual",
  });

  if (primaryEmail) {
    await db.insert(contactIdentities).values({
      contactId: contact.id,
      kind: "email",
      normalizedValue: primaryEmail,
      sourceType: "manual",
      value: primaryEmail,
    });
  }

  await recordAuditEvent({
    actorUserId: input.actorUserId,
    entityId: contact.id,
    entityType: "contact",
    eventName: "contact.created_manual",
  });

  return contact;
}

export async function updateContact(input: {
  actorUserId?: string | null;
  company?: string | null;
  contactId: string;
  displayName: string;
  primaryEmail?: string | null;
  relationshipSummary?: string | null;
  title?: string | null;
}) {
  const existing = await db.query.contacts.findFirst({
    where: eq(contacts.id, input.contactId),
  });

  if (!existing) {
    throw new Error("Contact not found.");
  }

  const displayName = input.displayName.trim();
  const primaryEmail = normalizeEmail(input.primaryEmail);

  if (!displayName && !primaryEmail) {
    throw new Error("A contact still needs a name or email.");
  }

  if (primaryEmail) {
    const existingIdentity = await findContactIdentityByEmail(primaryEmail);

    if (existingIdentity && existingIdentity.contactId !== existing.id) {
      throw new Error("That email is already attached to another contact.");
    }
  }

  await db
    .update(contacts)
    .set({
      company: input.company?.trim() || null,
      displayName: displayName || primaryEmail || existing.displayName,
      primaryEmail,
      relationshipSummary: input.relationshipSummary?.trim() || null,
      title: input.title?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(contacts.id, existing.id));

  if (primaryEmail) {
    const identity = await db.query.contactIdentities.findFirst({
      where: and(
        eq(contactIdentities.contactId, existing.id),
        eq(contactIdentities.kind, "email"),
        eq(contactIdentities.sourceType, "manual"),
      ),
    });

    if (identity) {
      await db
        .update(contactIdentities)
        .set({
          normalizedValue: primaryEmail,
          value: primaryEmail,
          updatedAt: new Date(),
        })
        .where(eq(contactIdentities.id, identity.id));
    } else {
      await db.insert(contactIdentities).values({
        contactId: existing.id,
        kind: "email",
        normalizedValue: primaryEmail,
        sourceType: "manual",
        value: primaryEmail,
      });
    }
  }

  await recordAuditEvent({
    actorUserId: input.actorUserId,
    entityId: existing.id,
    entityType: "contact",
    eventName: "contact.updated_manual",
  });

  return existing.slug;
}

export async function findContactIdentityByEmail(normalizedEmail: string) {
  return db.query.contactIdentities.findFirst({
    where: and(
      eq(contactIdentities.kind, "email"),
      eq(contactIdentities.normalizedValue, normalizedEmail),
    ),
  });
}

export async function findContactById(contactId: string) {
  return db.query.contacts.findFirst({
    where: eq(contacts.id, contactId),
  });
}

export async function buildUniqueSlug(baseValue: string) {
  const baseSlug = slugify(baseValue);
  let slug = baseSlug;
  let suffix = 2;

  for (;;) {
    const existing = await db.query.contacts.findFirst({
      where: eq(contacts.slug, slug),
      columns: { id: true },
    });

    if (!existing) {
      return slug;
    }

    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
}

export function mergeContactFields(
  contact: {
    displayName: string;
    primaryEmail: string | null;
    company: string | null;
    title: string | null;
    relationshipSummary: string | null;
  },
  update: {
    displayName: string;
    primaryEmail: string | null;
    company: string | null;
    title: string | null;
    relationshipSummary?: string | null;
  },
) {
  return {
    displayName:
      contact.displayName.length >= update.displayName.length
        ? contact.displayName
        : update.displayName,
    primaryEmail: contact.primaryEmail ?? normalizeEmail(update.primaryEmail),
    company: contact.company ?? update.company,
    title: contact.title ?? update.title,
    relationshipSummary:
      contact.relationshipSummary ?? update.relationshipSummary ?? null,
  };
}

export function isTaskOverdue(dueAt: Date | null) {
  return Boolean(dueAt && dueAt.getTime() < Date.now());
}
