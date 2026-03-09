import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  auditEvents,
  contactIdentities,
  contactMergeReviews,
  contactSources,
  contacts,
  outboundMessages,
  replySignals,
  sequenceEnrollments,
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

function normalizeDisplayName(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

function emailLocalPart(value: string | null | undefined) {
  const email = normalizeEmail(value);

  if (!email || !email.includes("@")) {
    return null;
  }

  return email.split("@")[0] ?? null;
}

async function recalculatePrimaryEmail(contactId: string) {
  const emailIdentity = await db.query.contactIdentities.findFirst({
    where: and(
      eq(contactIdentities.contactId, contactId),
      eq(contactIdentities.kind, "email"),
    ),
    orderBy: [asc(contactIdentities.createdAt)],
  });

  await db
    .update(contacts)
    .set({
      primaryEmail: emailIdentity?.normalizedValue ?? null,
      updatedAt: new Date(),
    })
    .where(eq(contacts.id, contactId));
}

export async function listContacts(options: ListContactsOptions = {}) {
  const rows = await db.query.contacts.findMany({
    where: eq(contacts.status, "active"),
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

export async function listPotentialDuplicateContacts(contactId: string) {
  const contact = await db.query.contacts.findFirst({
    where: eq(contacts.id, contactId),
  });

  if (!contact) {
    return [];
  }

  const candidates = await db.query.contacts.findMany({
    where: eq(contacts.status, "active"),
    orderBy: [asc(contacts.displayName)],
  });

  const normalizedName = normalizeDisplayName(contact.displayName);
  const primaryLocalPart = emailLocalPart(contact.primaryEmail);

  return candidates
    .filter((candidate) => candidate.id !== contact.id)
    .map((candidate) => {
      const reasons: string[] = [];

      if (
        normalizedName &&
        normalizeDisplayName(candidate.displayName) === normalizedName
      ) {
        reasons.push("Same display name");
      }

      if (
        contact.company &&
        candidate.company &&
        contact.company.trim().toLowerCase() ===
          candidate.company.trim().toLowerCase()
      ) {
        if (
          contact.title &&
          candidate.title &&
          contact.title.trim().toLowerCase() ===
            candidate.title.trim().toLowerCase()
        ) {
          reasons.push("Same company and title");
        }

        if (
          normalizedName &&
          normalizeDisplayName(candidate.displayName).includes(
            normalizedName.split(" ")[0] ?? "",
          )
        ) {
          reasons.push("Same company and similar name");
        }
      }

      if (
        primaryLocalPart &&
        primaryLocalPart === emailLocalPart(candidate.primaryEmail) &&
        contact.primaryEmail !== candidate.primaryEmail
      ) {
        reasons.push("Matching email local-part");
      }

      return {
        ...candidate,
        reasons,
      };
    })
    .filter((candidate) => candidate.reasons.length > 0)
    .sort((left, right) => right.reasons.length - left.reasons.length);
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

export async function mergeContacts(input: {
  actorUserId?: string | null;
  sourceContactId: string;
  targetContactId: string;
}) {
  if (input.sourceContactId === input.targetContactId) {
    throw new Error("Choose two different contacts to merge.");
  }

  const [source, target] = await Promise.all([
    db.query.contacts.findFirst({
      where: eq(contacts.id, input.sourceContactId),
    }),
    db.query.contacts.findFirst({
      where: eq(contacts.id, input.targetContactId),
    }),
  ]);

  if (!source || !target) {
    throw new Error("One of the contacts could not be found.");
  }

  const merged = mergeContactFields(target, {
    company: source.company,
    displayName: source.displayName,
    primaryEmail: source.primaryEmail,
    relationshipSummary:
      target.relationshipSummary ?? source.relationshipSummary ?? null,
    title: source.title,
  });

  await db
    .update(contacts)
    .set({
      company: merged.company,
      displayName: merged.displayName,
      primaryEmail: merged.primaryEmail,
      relationshipSummary:
        target.relationshipSummary ?? source.relationshipSummary ?? null,
      title: merged.title,
      updatedAt: new Date(),
    })
    .where(eq(contacts.id, target.id));

  const sourceIdentities = await db.query.contactIdentities.findMany({
    where: eq(contactIdentities.contactId, source.id),
  });

  for (const identity of sourceIdentities) {
    const existing = await db.query.contactIdentities.findFirst({
      where: and(
        eq(contactIdentities.kind, identity.kind),
        eq(contactIdentities.normalizedValue, identity.normalizedValue),
      ),
    });

    if (existing && existing.contactId === target.id) {
      await db.delete(contactIdentities).where(eq(contactIdentities.id, identity.id));
      continue;
    }

    await db
      .update(contactIdentities)
      .set({
        contactId: target.id,
        updatedAt: new Date(),
      })
      .where(eq(contactIdentities.id, identity.id));
  }

  const sourceRows = await db.query.contactSources.findMany({
    where: eq(contactSources.contactId, source.id),
  });

  for (const row of sourceRows) {
    const existing = await db.query.contactSources.findFirst({
      where: and(
        eq(contactSources.sourceType, row.sourceType),
        eq(contactSources.sourceRef, row.sourceRef),
      ),
    });

    if (existing && existing.contactId === target.id) {
      await db.delete(contactSources).where(eq(contactSources.id, row.id));
      continue;
    }

    await db
      .update(contactSources)
      .set({
        contactId: target.id,
        updatedAt: new Date(),
      })
      .where(eq(contactSources.id, row.id));
  }

  await Promise.all([
    db
      .update(tasks)
      .set({ contactId: target.id, updatedAt: new Date() })
      .where(eq(tasks.contactId, source.id)),
    db
      .update(contactMergeReviews)
      .set({ contactId: target.id, updatedAt: new Date() })
      .where(eq(contactMergeReviews.contactId, source.id)),
    db
      .update(replySignals)
      .set({ contactId: target.id, updatedAt: new Date() })
      .where(eq(replySignals.contactId, source.id)),
    db
      .update(outboundMessages)
      .set({ contactId: target.id, updatedAt: new Date() })
      .where(eq(outboundMessages.contactId, source.id)),
    db
      .update(sequenceEnrollments)
      .set({ contactId: target.id, updatedAt: new Date() })
      .where(eq(sequenceEnrollments.contactId, source.id)),
  ]);

  await db
    .update(contacts)
    .set({
      status: "archived",
      updatedAt: new Date(),
    })
    .where(eq(contacts.id, source.id));

  await recalculatePrimaryEmail(target.id);
  await recalculatePrimaryEmail(source.id);

  await recordAuditEvent({
    actorUserId: input.actorUserId,
    entityId: target.id,
    entityType: "contact",
    eventName: "contact.merged",
    metadata: {
      sourceContactId: source.id,
      targetContactId: target.id,
    },
  });

  return target.slug;
}

export async function splitContact(input: {
  actorUserId?: string | null;
  company?: string | null;
  displayName: string;
  identityIds: string[];
  primaryEmail?: string | null;
  relationshipSummary?: string | null;
  sourceContactId: string;
  sourceIds: string[];
  title?: string | null;
}) {
  const source = await db.query.contacts.findFirst({
    where: eq(contacts.id, input.sourceContactId),
  });

  if (!source) {
    throw new Error("Source contact not found.");
  }

  if (input.identityIds.length === 0 && input.sourceIds.length === 0) {
    throw new Error("Select at least one identity or source to split out.");
  }

  const slug = await buildUniqueSlug(
    input.displayName.trim() || input.primaryEmail || "contact",
  );
  const normalizedPrimaryEmail = normalizeEmail(input.primaryEmail);
  const ownedIdentityIds = (
    await db.query.contactIdentities.findMany({
      where: and(
        eq(contactIdentities.contactId, source.id),
        inArray(contactIdentities.id, input.identityIds),
      ),
      columns: {
        id: true,
      },
    })
  ).map((identity) => identity.id);
  const ownedSourceIds = (
    await db.query.contactSources.findMany({
      where: and(
        eq(contactSources.contactId, source.id),
        inArray(contactSources.id, input.sourceIds),
      ),
      columns: {
        id: true,
      },
    })
  ).map((row) => row.id);

  if (ownedIdentityIds.length === 0 && ownedSourceIds.length === 0) {
    throw new Error("No movable identities or sources were selected.");
  }

  const [created] = await db
    .insert(contacts)
    .values({
      company: input.company?.trim() || null,
      displayName:
        input.displayName.trim() || normalizedPrimaryEmail || "Unnamed contact",
      primaryEmail: normalizedPrimaryEmail,
      relationshipSummary: input.relationshipSummary?.trim() || null,
      slug,
      title: input.title?.trim() || null,
    })
    .returning();

  if (ownedIdentityIds.length > 0) {
    await db
      .update(contactIdentities)
      .set({
        contactId: created.id,
        updatedAt: new Date(),
      })
      .where(inArray(contactIdentities.id, ownedIdentityIds));
  }

  if (ownedSourceIds.length > 0) {
    await db
      .update(contactSources)
      .set({
        contactId: created.id,
        updatedAt: new Date(),
      })
      .where(inArray(contactSources.id, ownedSourceIds));
  }

  await recalculatePrimaryEmail(source.id);
  await recalculatePrimaryEmail(created.id);

  await recordAuditEvent({
    actorUserId: input.actorUserId,
    entityId: source.id,
    entityType: "contact",
    eventName: "contact.split",
    metadata: {
      createdContactId: created.id,
      identityIds: ownedIdentityIds,
      sourceIds: ownedSourceIds,
    },
  });

  return created;
}

export async function listContactTimeline(contactId: string) {
  const [auditRows, sourceRows, taskRows, replyRows, outboundRows, enrollmentRows, sequenceRows] =
    await Promise.all([
      db.query.auditEvents.findMany({
        where: and(
          eq(auditEvents.entityType, "contact"),
          eq(auditEvents.entityId, contactId),
        ),
        orderBy: [desc(auditEvents.createdAt)],
      }),
      db.query.contactSources.findMany({
        where: eq(contactSources.contactId, contactId),
        orderBy: [desc(contactSources.importedAt)],
      }),
      db.query.tasks.findMany({
        where: eq(tasks.contactId, contactId),
        orderBy: [desc(tasks.updatedAt)],
      }),
      db.query.replySignals.findMany({
        where: eq(replySignals.contactId, contactId),
        orderBy: [desc(replySignals.createdAt)],
      }),
      db.query.outboundMessages.findMany({
        where: eq(outboundMessages.contactId, contactId),
        orderBy: [desc(outboundMessages.updatedAt)],
      }),
      db.query.sequenceEnrollments.findMany({
        where: eq(sequenceEnrollments.contactId, contactId),
        orderBy: [desc(sequenceEnrollments.updatedAt)],
      }),
      db.query.sequences.findMany(),
    ]);

  const sequenceMap = new Map(sequenceRows.map((sequence) => [sequence.id, sequence]));

  return [
    ...sourceRows.map((source) => ({
      id: `source-${source.id}`,
      kind: "source",
      timestamp: source.importedAt,
      title: `Source attached from ${source.sourceType.toUpperCase()}`,
      detail: source.sourceLabel ?? source.sourceRef,
    })),
    ...taskRows.map((task) => ({
      id: `task-${task.id}`,
      kind: "task",
      timestamp: task.updatedAt,
      title: `Task ${task.status}: ${task.title}`,
      detail: task.dueAt ? `Due ${task.dueAt.toLocaleString()}` : "No due date",
    })),
    ...replyRows.map((reply) => ({
      id: `reply-${reply.id}`,
      kind: "reply",
      timestamp: reply.createdAt,
      title: "Reply signal recorded",
      detail: `${reply.sourceType} · ${reply.summary ?? "No summary"}`,
    })),
    ...outboundRows.map((message) => ({
      id: `outbound-${message.id}`,
      kind: "outbound",
      timestamp: message.sentAt ?? message.updatedAt,
      title: `Outbound ${message.status}: ${message.finalSubject}`,
      detail:
        message.lastError ??
        `Provider thread ${message.providerThreadId ?? "not captured"}`,
    })),
    ...enrollmentRows.map((enrollment) => ({
      id: `enrollment-${enrollment.id}`,
      kind: "enrollment",
      timestamp: enrollment.updatedAt,
      title: `Sequence ${enrollment.status}: ${sequenceMap.get(enrollment.sequenceId)?.name ?? "Sequence"}`,
      detail: enrollment.stopReason ?? "Enrollment active",
    })),
    ...auditRows.map((event) => ({
      id: `audit-${event.id}`,
      kind: "audit",
      timestamp: event.createdAt,
      title: event.eventName,
      detail: null,
    })),
  ].sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime());
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
