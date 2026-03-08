import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  auditEvents,
  contactMergeReviews,
  contacts,
  providerEnum,
} from "@/db/schema";

type ReviewField = "company" | "displayName" | "primaryEmail" | "title";
type ProviderName = (typeof providerEnum.enumValues)[number];
type FieldValueMap = Record<ReviewField, string | null>;

const reviewFields: ReviewField[] = [
  "displayName",
  "primaryEmail",
  "company",
  "title",
];

function normalizeFieldValue(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function valuesEqual(left: string | null, right: string | null) {
  return normalizeFieldValue(left) === normalizeFieldValue(right);
}

async function recordAuditEvent({
  actorUserId,
  entityId,
  entityType,
  eventName,
  metadata,
}: {
  actorUserId?: string | null;
  entityId: string;
  entityType: string;
  eventName: string;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(auditEvents).values({
    actorUserId: actorUserId ?? null,
    entityId,
    entityType,
    eventName,
    metadata: metadata ?? {},
  });
}

export function evaluateMergeReview(params: {
  current: FieldValueMap;
  proposed: FieldValueMap;
}) {
  const conflictFields: ReviewField[] = [];
  const autoUpdates: Partial<FieldValueMap> = {};

  for (const field of reviewFields) {
    const currentValue = normalizeFieldValue(params.current[field]);
    const proposedValue = normalizeFieldValue(params.proposed[field]);

    if (!proposedValue || valuesEqual(currentValue, proposedValue)) {
      continue;
    }

    if (!currentValue) {
      autoUpdates[field] = proposedValue;
      continue;
    }

    conflictFields.push(field);
  }

  return {
    autoUpdates,
    conflictFields,
  };
}

export async function upsertMergeReview(params: {
  connectedAccountId?: string | null;
  contactId: string;
  currentValues: FieldValueMap;
  proposedValues: FieldValueMap;
  provider: ProviderName;
  sourceLabel?: string | null;
  sourceRef: string;
}) {
  const existing = await db.query.contactMergeReviews.findFirst({
    where: and(
      eq(contactMergeReviews.provider, params.provider),
      eq(contactMergeReviews.sourceRef, params.sourceRef),
    ),
  });

  const { autoUpdates, conflictFields } = evaluateMergeReview({
    current: params.currentValues,
    proposed: params.proposedValues,
  });

  if (conflictFields.length === 0) {
    if (existing && existing.status === "open") {
      await db
        .update(contactMergeReviews)
        .set({
          conflictFields: [],
          currentValues: params.currentValues,
          proposedValues: params.proposedValues,
          resolvedAt: new Date(),
          resolution: {},
          status: "resolved",
          updatedAt: new Date(),
        })
        .where(eq(contactMergeReviews.id, existing.id));
    }

    return {
      autoUpdates,
      conflictFields,
      reviewId: existing?.id ?? null,
      shouldReview: false,
    };
  }

  if (existing) {
    await db
      .update(contactMergeReviews)
      .set({
        connectedAccountId: params.connectedAccountId ?? null,
        contactId: params.contactId,
        conflictFields,
        currentValues: params.currentValues,
        lastSeenAt: new Date(),
        proposedValues: params.proposedValues,
        resolvedAt: null,
        sourceLabel: params.sourceLabel ?? null,
        status: "open",
        updatedAt: new Date(),
      })
      .where(eq(contactMergeReviews.id, existing.id));

    return {
      autoUpdates,
      conflictFields,
      reviewId: existing.id,
      shouldReview: true,
    };
  }

  const [review] = await db
    .insert(contactMergeReviews)
    .values({
      connectedAccountId: params.connectedAccountId ?? null,
      contactId: params.contactId,
      conflictFields,
      currentValues: params.currentValues,
      proposedValues: params.proposedValues,
      provider: params.provider,
      sourceLabel: params.sourceLabel ?? null,
      sourceRef: params.sourceRef,
      status: "open",
    })
    .returning();

  return {
    autoUpdates,
    conflictFields,
    reviewId: review.id,
    shouldReview: true,
  };
}

export async function listOpenMergeReviews(contactId?: string) {
  const reviews = await db.query.contactMergeReviews.findMany({
    where: contactId
      ? and(
          eq(contactMergeReviews.status, "open"),
          eq(contactMergeReviews.contactId, contactId),
        )
      : eq(contactMergeReviews.status, "open"),
    orderBy: [desc(contactMergeReviews.lastSeenAt), asc(contactMergeReviews.provider)],
  });

  const contactIds = Array.from(new Set(reviews.map((review) => review.contactId)));
  const reviewContacts =
    contactIds.length > 0
      ? await db.query.contacts.findMany({
          where: inArray(contacts.id, contactIds),
          columns: {
            id: true,
            slug: true,
            displayName: true,
            primaryEmail: true,
          },
        })
      : [];
  const contactMap = new Map(
    reviewContacts.map((contact) => [contact.id, contact]),
  );

  return reviews.map((review) => ({
    ...review,
    contact: contactMap.get(review.contactId) ?? null,
  }));
}

export async function countOpenMergeReviews() {
  const reviews = await db.query.contactMergeReviews.findMany({
    where: eq(contactMergeReviews.status, "open"),
    columns: {
      id: true,
    },
  });

  return reviews.length;
}

export async function resolveMergeReview(params: {
  actorUserId?: string | null;
  decisions: Partial<Record<ReviewField, "current" | "proposed">>;
  reviewId: string;
}) {
  const review = await db.query.contactMergeReviews.findFirst({
    where: eq(contactMergeReviews.id, params.reviewId),
  });

  if (!review) {
    throw new Error("Merge review not found.");
  }

  if (review.status !== "open") {
    return review.id;
  }

  const contact = await db.query.contacts.findFirst({
    where: eq(contacts.id, review.contactId),
  });

  if (!contact) {
    throw new Error("Review contact not found.");
  }

  const nextValues: Partial<FieldValueMap> = {};

  for (const field of review.conflictFields as ReviewField[]) {
    const decision = params.decisions[field] ?? "current";
    nextValues[field] =
      decision === "proposed"
        ? normalizeFieldValue(review.proposedValues[field] ?? null)
        : normalizeFieldValue(review.currentValues[field] ?? null);
  }

  await db
    .update(contacts)
    .set({
      company: nextValues.company ?? contact.company,
      displayName: nextValues.displayName ?? contact.displayName,
      primaryEmail: nextValues.primaryEmail ?? contact.primaryEmail,
      title: nextValues.title ?? contact.title,
      updatedAt: new Date(),
    })
    .where(eq(contacts.id, contact.id));

  await db
    .update(contactMergeReviews)
    .set({
      resolution: params.decisions,
      resolvedAt: new Date(),
      status: "resolved",
      updatedAt: new Date(),
    })
    .where(eq(contactMergeReviews.id, review.id));

  await recordAuditEvent({
    actorUserId: params.actorUserId,
    entityId: review.id,
    entityType: "contact_merge_review",
    eventName: "merge_review.resolved",
    metadata: {
      contactId: review.contactId,
      decisions: params.decisions,
    },
  });

  return review.id;
}

export async function dismissMergeReview(params: {
  actorUserId?: string | null;
  reviewId: string;
}) {
  const review = await db.query.contactMergeReviews.findFirst({
    where: eq(contactMergeReviews.id, params.reviewId),
  });

  if (!review) {
    throw new Error("Merge review not found.");
  }

  if (review.status !== "open") {
    return review.id;
  }

  await db
    .update(contactMergeReviews)
    .set({
      resolution: {},
      resolvedAt: new Date(),
      status: "dismissed",
      updatedAt: new Date(),
    })
    .where(eq(contactMergeReviews.id, review.id));

  await recordAuditEvent({
    actorUserId: params.actorUserId,
    entityId: review.id,
    entityType: "contact_merge_review",
    eventName: "merge_review.dismissed",
    metadata: {
      contactId: review.contactId,
    },
  });

  return review.id;
}
