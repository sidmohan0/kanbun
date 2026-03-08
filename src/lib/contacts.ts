import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  contactIdentities,
  contactMergeReviews,
  contactSources,
  contacts,
  tasks,
} from "@/db/schema";
import { normalizeEmail, slugify } from "@/lib/csv";

export async function listContacts() {
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

  return rows.map((contact) => {
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

    return {
      ...contact,
      openMergeReviewCount: reviewCount,
      openTaskCount: dueTasks.length,
      nextDueAt: nextTask?.dueAt ?? null,
    };
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
