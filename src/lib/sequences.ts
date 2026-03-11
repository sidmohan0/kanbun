import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lte,
  or,
} from "drizzle-orm";
import { db } from "@/db/client";
import {
  auditEvents,
  connectedAccounts,
  contacts,
  outboundMessages,
  replySignals,
  sequenceEnrollments,
  sequences,
  sequenceSteps,
} from "@/db/schema";
import { sendGoogleMessage } from "@/lib/google";
import { sendMicrosoftMessage } from "@/lib/microsoft";
import { planOutboundAutoRetry } from "@/lib/outbound-retry";
import {
  applyProviderFailureMetadata,
  applyProviderSuccessMetadata,
  classifyOutboundProviderFailure,
  deriveProviderAccountStatus,
  getMetadataString,
} from "@/lib/provider-health";
import {
  GOOGLE_SEND_SCOPE,
  MICROSOFT_SEND_SCOPE,
} from "@/lib/provider-scopes";

function addDays(base: Date, days: number) {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfToday() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

function nextLocalHour(hour: number, dayOffset = 0) {
  const next = new Date();
  next.setHours(hour, 0, 0, 0);
  next.setDate(next.getDate() + dayOffset);
  return next;
}

function sanitizeHour(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(23, Math.max(0, Math.trunc(value!)));
}

function sanitizeDailyCap(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return 25;
  }

  return Math.max(1, Math.trunc(value!));
}

function extractFirstName(displayName: string) {
  return displayName.trim().split(/\s+/)[0] ?? displayName;
}

function getSendScope(provider: "google" | "microsoft") {
  return provider === "google" ? GOOGLE_SEND_SCOPE : MICROSOFT_SEND_SCOPE;
}

function isSendCapableAccount(
  account: typeof connectedAccounts.$inferSelect | null | undefined,
): account is typeof connectedAccounts.$inferSelect {
  if (!account) {
    return false;
  }

  if (account.status === "disconnected") {
    return false;
  }

  if (account.provider !== "google" && account.provider !== "microsoft") {
    return false;
  }

  if (
    getMetadataString(
      account.metadata as Record<string, unknown> | null | undefined,
      "outboundSendStatus",
    ) ===
    "reconnect_required"
  ) {
    return false;
  }

  return account.grantedScopes.includes(getSendScope(account.provider));
}

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

function renderTemplate(
  template: string,
  variables: Record<string, string>,
) {
  const missing = new Set<string>();
  const unknown = new Set<string>();

  const rendered = template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    if (!(key in variables)) {
      unknown.add(key);
      return "";
    }

    const value = variables[key]?.trim();

    if (!value) {
      missing.add(key);
      return "";
    }

    return value;
  });

  return {
    rendered: rendered.trim(),
    missing: Array.from(missing),
    unknown: Array.from(unknown),
  };
}

function buildTemplateVariables(input: {
  contact: typeof contacts.$inferSelect;
  sequence: typeof sequences.$inferSelect;
}) {
  return {
    company: input.contact.company ?? "",
    first_name: extractFirstName(input.contact.displayName),
    full_name: input.contact.displayName,
    primary_email: input.contact.primaryEmail ?? "",
    sequence_name: input.sequence.name,
    title: input.contact.title ?? "",
  };
}

function getMetadataNumber(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return typeof value === "number" ? value : 0;
}

function appendDraftRevision(
  metadata: Record<string, unknown> | null | undefined,
  input: {
    actorUserId?: string | null;
    body: string;
    reason: "approved" | "edited_failed" | "edited_queued" | "requeued";
    subject: string;
  },
) {
  const previousRevisions = Array.isArray(metadata?.draftRevisions)
    ? metadata?.draftRevisions
    : [];
  const revisionNumber = getMetadataNumber(metadata, "copyRevision") + 1;
  const nextRevision = {
    actorUserId: input.actorUserId ?? "local",
    approvedAt: new Date().toISOString(),
    body: input.body,
    reason: input.reason,
    revision: revisionNumber,
    subject: input.subject,
  };

  return {
    ...(metadata ?? {}),
    copyRevision: revisionNumber,
    draftRevisions: [...previousRevisions, nextRevision].slice(-10),
    lastApprovedAt: nextRevision.approvedAt,
    queuedBy: input.actorUserId ?? "local",
  };
}

async function markConnectedAccountSendFailure(
  accountId: string | null | undefined,
  errorMessage: string,
) {
  if (!accountId) {
    return;
  }

  const account = await db.query.connectedAccounts.findFirst({
    where: eq(connectedAccounts.id, accountId),
    columns: {
      id: true,
      metadata: true,
      status: true,
    },
  });

  if (!account) {
    return;
  }

  const classification = classifyOutboundProviderFailure(errorMessage);
  if (classification.category === "invalid_recipient") {
    return;
  }
  const nextMetadata = applyProviderFailureMetadata(
    (account.metadata as Record<string, unknown>) ?? {},
    {
      classification,
      message: errorMessage,
      operation: "outboundSend",
      values: {
        outboundSendLastMessageId: null,
      },
    },
  );

  await db
    .update(connectedAccounts)
    .set({
      lastError: errorMessage,
      metadata: nextMetadata,
      status: deriveProviderAccountStatus({
        metadata: nextMetadata,
        rawStatus: classification.accountStatus,
      }),
      updatedAt: new Date(),
    })
    .where(eq(connectedAccounts.id, account.id));
}

async function markConnectedAccountSendSuccess(input: {
  accountId: string | null | undefined;
  messageId: string;
}) {
  if (!input.accountId) {
    return;
  }

  const account = await db.query.connectedAccounts.findFirst({
    where: eq(connectedAccounts.id, input.accountId),
    columns: {
      id: true,
      metadata: true,
      status: true,
    },
  });

  if (!account) {
    return;
  }

  const nextMetadata = applyProviderSuccessMetadata(
    (account.metadata as Record<string, unknown>) ?? {},
    {
      operation: "outboundSend",
      values: {
        outboundSendLastMessageId: input.messageId,
      },
    },
  );

  await db
    .update(connectedAccounts)
    .set({
      lastError: null,
      metadata: nextMetadata,
      status: deriveProviderAccountStatus({
        metadata: nextMetadata,
        rawStatus: account.status,
      }),
      updatedAt: new Date(),
    })
    .where(eq(connectedAccounts.id, account.id));
}

async function getConnectedSendAccountsForUser(userId: string) {
  const accounts = await db.query.connectedAccounts.findMany({
    where: and(
      eq(connectedAccounts.userId, userId),
      or(
        eq(connectedAccounts.provider, "google"),
        eq(connectedAccounts.provider, "microsoft"),
      ),
    ),
    orderBy: [asc(connectedAccounts.provider), desc(connectedAccounts.updatedAt)],
  });

  return accounts.filter(isSendCapableAccount);
}

async function getConnectedSendAccountById(accountId: string) {
  const account = await db.query.connectedAccounts.findFirst({
    where: eq(connectedAccounts.id, accountId),
  });

  return isSendCapableAccount(account) ? account : null;
}

async function pickDefaultSendAccountForUser(userId: string) {
  const accounts = await getConnectedSendAccountsForUser(userId);
  return accounts[0] ?? null;
}

async function getReplySignalCount(contactId: string) {
  const rows = await db.query.replySignals.findMany({
    where: eq(replySignals.contactId, contactId),
    columns: {
      id: true,
    },
  });

  return rows.length;
}

async function getStepForEnrollment(
  enrollment: typeof sequenceEnrollments.$inferSelect,
) {
  return db.query.sequenceSteps.findFirst({
    where: and(
      eq(sequenceSteps.sequenceId, enrollment.sequenceId),
      eq(sequenceSteps.position, enrollment.currentStepPosition),
    ),
  });
}

async function getSequenceForEnrollment(
  enrollment: typeof sequenceEnrollments.$inferSelect,
) {
  return db.query.sequences.findFirst({
    where: eq(sequences.id, enrollment.sequenceId),
  });
}

async function getSendPolicyBlock(
  message: typeof outboundMessages.$inferSelect,
) {
  const sequence = message.sequenceId
    ? await db.query.sequences.findFirst({
        where: eq(sequences.id, message.sequenceId),
      })
    : null;

  const sendWindowStartHour = sanitizeHour(
    sequence?.sendWindowStartHour,
    8,
  );
  const sendWindowEndHour = sanitizeHour(sequence?.sendWindowEndHour, 17);
  const dailySendCap = sanitizeDailyCap(sequence?.dailySendCap);
  const now = new Date();
  const hour = now.getHours();

  if (hour < sendWindowStartHour || hour >= sendWindowEndHour) {
    const retryAt =
      hour < sendWindowStartHour
        ? nextLocalHour(sendWindowStartHour)
        : nextLocalHour(sendWindowStartHour, 1);

    return {
      reason: `Waiting for send window (${String(sendWindowStartHour).padStart(2, "0")}:00-${String(sendWindowEndHour).padStart(2, "0")}:00 local time).`,
      retryAt,
    };
  }

  if (!message.connectedAccountId) {
    return null;
  }

  const sentToday = await db.query.outboundMessages.findMany({
    where: and(
      eq(outboundMessages.connectedAccountId, message.connectedAccountId),
      eq(outboundMessages.status, "sent"),
      gte(outboundMessages.sentAt, startOfToday()),
    ),
    columns: {
      id: true,
    },
  });

  if (sentToday.length >= dailySendCap) {
    return {
      reason: `Daily send cap reached (${dailySendCap}) for this sending account.`,
      retryAt: nextLocalHour(sendWindowStartHour, 1),
    };
  }

  return null;
}

export async function listSequencesOverview() {
  const [sequenceRows, enrollmentRows, draftRows, sentRows, stepRows] =
    await Promise.all([
      db.query.sequences.findMany({
        orderBy: [desc(sequences.updatedAt)],
      }),
      db.query.sequenceEnrollments.findMany(),
      db.query.outboundMessages.findMany({
        where: or(
          eq(outboundMessages.status, "draft"),
          eq(outboundMessages.status, "failed"),
        ),
        columns: {
          dueAt: true,
          sequenceId: true,
        },
      }),
      db.query.outboundMessages.findMany({
        where: eq(outboundMessages.status, "sent"),
        columns: {
          sequenceId: true,
        },
      }),
      db.query.sequenceSteps.findMany({
        orderBy: [asc(sequenceSteps.sequenceId), asc(sequenceSteps.position)],
      }),
    ]);

  return sequenceRows.map((sequence) => {
    const enrollments = enrollmentRows.filter(
      (enrollment) => enrollment.sequenceId === sequence.id,
    );
    const drafts = draftRows.filter((draft) => draft.sequenceId === sequence.id);
    const nextDueAt = enrollments
      .map((enrollment) => enrollment.nextDueAt)
      .filter((value): value is Date => Boolean(value))
      .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;

    return {
      ...sequence,
      activeEnrollmentCount: enrollments.filter(
        (enrollment) => enrollment.status === "active",
      ).length,
      pausedEnrollmentCount: enrollments.filter(
        (enrollment) => enrollment.status === "paused",
      ).length,
      pendingApprovalCount: drafts.length,
      sentCount: sentRows.filter((message) => message.sequenceId === sequence.id)
        .length,
      steps: stepRows.filter((step) => step.sequenceId === sequence.id),
      nextDueAt,
    };
  });
}

export async function listPendingOutboundApprovals() {
  const drafts = await db.query.outboundMessages.findMany({
    where: or(
      eq(outboundMessages.status, "draft"),
      eq(outboundMessages.status, "failed"),
      eq(outboundMessages.status, "queued"),
    ),
    orderBy: [asc(outboundMessages.dueAt), desc(outboundMessages.createdAt)],
  });

  const contactIds = Array.from(new Set(drafts.map((draft) => draft.contactId)));
  const sequenceIds = Array.from(
    new Set(
      drafts
        .map((draft) => draft.sequenceId)
        .filter((sequenceId): sequenceId is string => Boolean(sequenceId)),
    ),
  );
  const connectedAccountIds = Array.from(
    new Set(
      drafts
        .map((draft) => draft.connectedAccountId)
        .filter((accountId): accountId is string => Boolean(accountId)),
    ),
  );

  const [contactRows, sequenceRows, accountRows] = await Promise.all([
    contactIds.length
      ? db.query.contacts.findMany({
          where: inArray(contacts.id, contactIds),
          columns: {
            displayName: true,
            id: true,
            primaryEmail: true,
            slug: true,
          },
        })
      : [],
    sequenceIds.length
      ? db.query.sequences.findMany({
          where: inArray(sequences.id, sequenceIds),
          columns: {
            id: true,
            name: true,
          },
        })
      : [],
    connectedAccountIds.length
      ? db.query.connectedAccounts.findMany({
          where: inArray(connectedAccounts.id, connectedAccountIds),
          columns: {
            email: true,
            id: true,
            provider: true,
            status: true,
          },
        })
      : [],
  ]);

  const contactMap = new Map(contactRows.map((contact) => [contact.id, contact]));
  const sequenceMap = new Map(
    sequenceRows.map((sequence) => [sequence.id, sequence]),
  );
  const accountMap = new Map(accountRows.map((account) => [account.id, account]));

  return drafts.map((draft) => ({
    ...draft,
    connectedAccount: draft.connectedAccountId
      ? (accountMap.get(draft.connectedAccountId) ?? null)
      : null,
    contact: contactMap.get(draft.contactId) ?? null,
    sequence: draft.sequenceId ? (sequenceMap.get(draft.sequenceId) ?? null) : null,
  }));
}

export async function listActiveSequencesForContact(contactId: string) {
  const [sequenceRows, enrollmentRows] = await Promise.all([
    db.query.sequences.findMany({
      where: eq(sequences.status, "active"),
      orderBy: [asc(sequences.name)],
    }),
    db.query.sequenceEnrollments.findMany({
      where: eq(sequenceEnrollments.contactId, contactId),
      columns: {
        sequenceId: true,
        status: true,
      },
    }),
  ]);

  const enrollmentMap = new Map(
    enrollmentRows.map((enrollment) => [enrollment.sequenceId, enrollment.status]),
  );

  return sequenceRows.map((sequence) => ({
    ...sequence,
    enrollmentStatus: enrollmentMap.get(sequence.id) ?? null,
  }));
}

export async function listContactSequenceEnrollments(contactId: string) {
  const enrollments = await db.query.sequenceEnrollments.findMany({
    where: eq(sequenceEnrollments.contactId, contactId),
    orderBy: [desc(sequenceEnrollments.updatedAt)],
  });

  const sequenceIds = Array.from(
    new Set(enrollments.map((enrollment) => enrollment.sequenceId)),
  );

  const sequenceRows = sequenceIds.length
    ? await db.query.sequences.findMany({
        where: inArray(sequences.id, sequenceIds),
      })
    : [];

  const sequenceMap = new Map(
    sequenceRows.map((sequence) => [sequence.id, sequence]),
  );

  return enrollments.map((enrollment) => ({
    ...enrollment,
    sequence: sequenceMap.get(enrollment.sequenceId) ?? null,
  }));
}

export async function pauseSequence(input: {
  actorUserId?: string | null;
  sequenceId: string;
}) {
  const sequence = await db.query.sequences.findFirst({
    where: eq(sequences.id, input.sequenceId),
  });

  if (!sequence) {
    throw new Error("Sequence not found.");
  }

  await db
    .update(sequences)
    .set({
      status: "paused",
      updatedAt: new Date(),
    })
    .where(eq(sequences.id, sequence.id));

  await db
    .update(sequenceEnrollments)
    .set({
      status: "paused",
      stopReason: "Paused because the sequence was paused by the operator.",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sequenceEnrollments.sequenceId, sequence.id),
        eq(sequenceEnrollments.status, "active"),
      ),
    );

  await recordAuditEvent({
    actorUserId: input.actorUserId,
    entityId: sequence.id,
    entityType: "sequence",
    eventName: "sequence.paused",
  });
}

export async function resumeSequence(input: {
  actorUserId?: string | null;
  sequenceId: string;
}) {
  const sequence = await db.query.sequences.findFirst({
    where: eq(sequences.id, input.sequenceId),
  });

  if (!sequence) {
    throw new Error("Sequence not found.");
  }

  await db
    .update(sequences)
    .set({
      status: "active",
      updatedAt: new Date(),
    })
    .where(eq(sequences.id, sequence.id));

  const pausedEnrollments = await db.query.sequenceEnrollments.findMany({
    where: and(
      eq(sequenceEnrollments.sequenceId, sequence.id),
      eq(sequenceEnrollments.status, "paused"),
    ),
  });

  for (const enrollment of pausedEnrollments) {
    if (
      enrollment.stopReason &&
      enrollment.stopReason !==
        "Paused because the sequence was paused by the operator."
    ) {
      continue;
    }

    await db
      .update(sequenceEnrollments)
      .set({
        nextDueAt: enrollment.nextDueAt ?? new Date(),
        status: "active",
        stopReason: null,
        updatedAt: new Date(),
      })
      .where(eq(sequenceEnrollments.id, enrollment.id));
  }

  await recordAuditEvent({
    actorUserId: input.actorUserId,
    entityId: sequence.id,
    entityType: "sequence",
    eventName: "sequence.resumed",
  });
}

export async function pauseEnrollment(input: {
  actorUserId?: string | null;
  enrollmentId: string;
}) {
  const enrollment = await db.query.sequenceEnrollments.findFirst({
    where: eq(sequenceEnrollments.id, input.enrollmentId),
  });

  if (!enrollment) {
    throw new Error("Enrollment not found.");
  }

  if (enrollment.status !== "active") {
    throw new Error("Only active enrollments can be paused.");
  }

  await db
    .update(sequenceEnrollments)
    .set({
      status: "paused",
      stopReason: "Paused by operator.",
      updatedAt: new Date(),
    })
    .where(eq(sequenceEnrollments.id, enrollment.id));

  await recordAuditEvent({
    actorUserId: input.actorUserId,
    entityId: enrollment.id,
    entityType: "sequence_enrollment",
    eventName: "sequence_enrollment.paused",
  });
}

export async function resumeEnrollment(input: {
  actorUserId?: string | null;
  enrollmentId: string;
}) {
  const enrollment = await db.query.sequenceEnrollments.findFirst({
    where: eq(sequenceEnrollments.id, input.enrollmentId),
  });

  if (!enrollment) {
    throw new Error("Enrollment not found.");
  }

  if (enrollment.status !== "paused") {
    throw new Error("Only paused enrollments can be resumed.");
  }

  const sequence = await getSequenceForEnrollment(enrollment);

  if (!sequence || sequence.status !== "active") {
    throw new Error("Resume the parent sequence before resuming this enrollment.");
  }

  const replySignalCount = await getReplySignalCount(enrollment.contactId);

  if (replySignalCount > 0) {
    throw new Error("This contact already has a reply signal. Resume is blocked.");
  }

  await db
    .update(sequenceEnrollments)
    .set({
      nextDueAt: enrollment.nextDueAt ?? new Date(),
      status: "active",
      stopReason: null,
      updatedAt: new Date(),
    })
    .where(eq(sequenceEnrollments.id, enrollment.id));

  await recordAuditEvent({
    actorUserId: input.actorUserId,
    entityId: enrollment.id,
    entityType: "sequence_enrollment",
    eventName: "sequence_enrollment.resumed",
  });
}

export async function listReplySignalsForContact(contactId: string) {
  return db.query.replySignals.findMany({
    where: eq(replySignals.contactId, contactId),
    orderBy: [desc(replySignals.createdAt)],
  });
}

export async function createSequence(input: {
  actorUserId?: string | null;
  bodyTemplate: string;
  dailySendCap?: number;
  delayDays?: number;
  description?: string | null;
  name: string;
  sendWindowEndHour?: number;
  sendWindowStartHour?: number;
  subjectTemplate: string;
}) {
  const name = input.name.trim();
  const subjectTemplate = input.subjectTemplate.trim();
  const bodyTemplate = input.bodyTemplate.trim();
  const delayDays = Math.max(0, input.delayDays ?? 0);
  const dailySendCap = sanitizeDailyCap(input.dailySendCap);
  const sendWindowEndHour = sanitizeHour(input.sendWindowEndHour, 17);
  const sendWindowStartHour = sanitizeHour(input.sendWindowStartHour, 8);

  if (!name) {
    throw new Error("Sequence name is required.");
  }

  if (!subjectTemplate || !bodyTemplate) {
    throw new Error("The first sequence step needs both subject and body.");
  }

  const [sequence] = await db
    .insert(sequences)
    .values({
      dailySendCap,
      description: input.description?.trim() || null,
      name,
      sendWindowEndHour,
      sendWindowStartHour,
      status: "active",
    })
    .returning();

  await db.insert(sequenceSteps).values({
    bodyTemplate,
    delayDays,
    position: 1,
    sequenceId: sequence.id,
    subjectTemplate,
    title: "Initial email",
  });

  await recordAuditEvent({
    actorUserId: input.actorUserId,
    entityId: sequence.id,
    entityType: "sequence",
    eventName: "sequence.created",
    metadata: {
      dailySendCap,
      delayDays,
      name,
      sendWindowEndHour,
      sendWindowStartHour,
    },
  });

  return sequence.id;
}

export async function updateSequence(input: {
  actorUserId?: string | null;
  dailySendCap?: number;
  description?: string | null;
  name: string;
  sendWindowEndHour?: number;
  sendWindowStartHour?: number;
  sequenceId: string;
}) {
  const existing = await db.query.sequences.findFirst({
    where: eq(sequences.id, input.sequenceId),
  });

  if (!existing) {
    throw new Error("Sequence not found.");
  }

  const name = input.name.trim();

  if (!name) {
    throw new Error("Sequence name is required.");
  }

  await db
    .update(sequences)
    .set({
      dailySendCap: sanitizeDailyCap(input.dailySendCap),
      description: input.description?.trim() || null,
      name,
      sendWindowEndHour: sanitizeHour(input.sendWindowEndHour, 17),
      sendWindowStartHour: sanitizeHour(input.sendWindowStartHour, 8),
      updatedAt: new Date(),
    })
    .where(eq(sequences.id, input.sequenceId));

  await recordAuditEvent({
    actorUserId: input.actorUserId,
    entityId: input.sequenceId,
    entityType: "sequence",
    eventName: "sequence.updated",
  });
}

export async function addSequenceStep(input: {
  actorUserId?: string | null;
  bodyTemplate: string;
  delayDays?: number;
  sequenceId: string;
  subjectTemplate: string;
  title: string;
}) {
  const existingSteps = await db.query.sequenceSteps.findMany({
    where: eq(sequenceSteps.sequenceId, input.sequenceId),
    orderBy: [desc(sequenceSteps.position)],
    columns: {
      position: true,
    },
  });

  const position = (existingSteps[0]?.position ?? 0) + 1;
  const title = input.title.trim() || `Step ${position}`;
  const subjectTemplate = input.subjectTemplate.trim();
  const bodyTemplate = input.bodyTemplate.trim();

  if (!subjectTemplate || !bodyTemplate) {
    throw new Error("Each step requires both subject and body.");
  }

  await db.insert(sequenceSteps).values({
    bodyTemplate,
    delayDays: Math.max(0, input.delayDays ?? 0),
    position,
    sequenceId: input.sequenceId,
    subjectTemplate,
    title,
  });

  await recordAuditEvent({
    actorUserId: input.actorUserId,
    entityId: input.sequenceId,
    entityType: "sequence",
    eventName: "sequence.step_added",
    metadata: {
      position,
      title,
    },
  });
}

export async function updateSequenceStep(input: {
  actorUserId?: string | null;
  bodyTemplate: string;
  delayDays?: number;
  stepId: string;
  subjectTemplate: string;
  title: string;
}) {
  const step = await db.query.sequenceSteps.findFirst({
    where: eq(sequenceSteps.id, input.stepId),
  });

  if (!step) {
    throw new Error("Sequence step not found.");
  }

  const subjectTemplate = input.subjectTemplate.trim();
  const bodyTemplate = input.bodyTemplate.trim();

  if (!subjectTemplate || !bodyTemplate) {
    throw new Error("Each step requires both subject and body.");
  }

  await db
    .update(sequenceSteps)
    .set({
      bodyTemplate,
      delayDays: Math.max(0, input.delayDays ?? 0),
      subjectTemplate,
      title: input.title.trim() || `Step ${step.position}`,
      updatedAt: new Date(),
    })
    .where(eq(sequenceSteps.id, input.stepId));

  await recordAuditEvent({
    actorUserId: input.actorUserId,
    entityId: step.sequenceId,
    entityType: "sequence",
    eventName: "sequence.step_updated",
    metadata: {
      stepId: input.stepId,
    },
  });
}

async function resequenceSteps(sequenceId: string) {
  const steps = await db.query.sequenceSteps.findMany({
    where: eq(sequenceSteps.sequenceId, sequenceId),
    orderBy: [asc(sequenceSteps.position)],
  });

  for (const [index, step] of steps.entries()) {
    const nextPosition = index + 1;

    if (step.position === nextPosition) {
      continue;
    }

    await db
      .update(sequenceSteps)
      .set({
        position: nextPosition,
        updatedAt: new Date(),
      })
      .where(eq(sequenceSteps.id, step.id));
  }
}

export async function deleteSequenceStep(input: {
  actorUserId?: string | null;
  stepId: string;
}) {
  const step = await db.query.sequenceSteps.findFirst({
    where: eq(sequenceSteps.id, input.stepId),
  });

  if (!step) {
    throw new Error("Sequence step not found.");
  }

  const siblingCount = await db.query.sequenceSteps.findMany({
    where: eq(sequenceSteps.sequenceId, step.sequenceId),
    columns: {
      id: true,
    },
  });

  if (siblingCount.length <= 1) {
    throw new Error("A sequence must keep at least one step.");
  }

  await db.delete(sequenceSteps).where(eq(sequenceSteps.id, input.stepId));
  await resequenceSteps(step.sequenceId);

  await recordAuditEvent({
    actorUserId: input.actorUserId,
    entityId: step.sequenceId,
    entityType: "sequence",
    eventName: "sequence.step_deleted",
    metadata: {
      stepId: step.id,
    },
  });
}

export async function enrollContactInSequence(input: {
  actorUserId?: string | null;
  contactId: string;
  sequenceId: string;
  userId: string;
}) {
  const [contact, sequence, existingEnrollment, firstStep, sendAccount] =
    await Promise.all([
      db.query.contacts.findFirst({
        where: eq(contacts.id, input.contactId),
      }),
      db.query.sequences.findFirst({
        where: eq(sequences.id, input.sequenceId),
      }),
      db.query.sequenceEnrollments.findFirst({
        where: and(
          eq(sequenceEnrollments.contactId, input.contactId),
          eq(sequenceEnrollments.sequenceId, input.sequenceId),
          or(
            eq(sequenceEnrollments.status, "active"),
            eq(sequenceEnrollments.status, "paused"),
          ),
        ),
      }),
      db.query.sequenceSteps.findFirst({
        where: eq(sequenceSteps.sequenceId, input.sequenceId),
        orderBy: [asc(sequenceSteps.position)],
      }),
      pickDefaultSendAccountForUser(input.userId),
    ]);

  if (!contact) {
    throw new Error("Contact not found.");
  }

  if (!sequence) {
    throw new Error("Sequence not found.");
  }

  if (existingEnrollment) {
    throw new Error("This contact is already enrolled in the selected sequence.");
  }

  if (!firstStep) {
    throw new Error("Add at least one sequence step before enrolling contacts.");
  }

  if (!sendAccount) {
    throw new Error(
      "Reconnect Gmail or Microsoft with send permissions before enrolling a sequence.",
    );
  }

  const dueAt = addDays(new Date(), firstStep.delayDays);

  const [enrollment] = await db
    .insert(sequenceEnrollments)
    .values({
      connectedAccountId: sendAccount.id,
      contactId: input.contactId,
      currentStepPosition: firstStep.position,
      nextDueAt: dueAt,
      sequenceId: input.sequenceId,
      status: "active",
    })
    .returning();

  await recordAuditEvent({
    actorUserId: input.actorUserId,
    entityId: enrollment.id,
    entityType: "sequence_enrollment",
    eventName: "sequence.enrolled",
    metadata: {
      connectedAccountId: sendAccount.id,
      contactId: input.contactId,
      dueAt: dueAt.toISOString(),
      sequenceId: input.sequenceId,
    },
  });

  return {
    contactSlug: contact.slug,
    sequenceName: sequence.name,
  };
}

export async function generateDraftForEnrollment(
  enrollmentId: string,
  actorUserId?: string | null,
) {
  const enrollment = await db.query.sequenceEnrollments.findFirst({
    where: eq(sequenceEnrollments.id, enrollmentId),
  });

  if (!enrollment || enrollment.status !== "active") {
    return null;
  }

  const [contact, sequence, step, existingDraft, replySignalCount] =
    await Promise.all([
    db.query.contacts.findFirst({
      where: eq(contacts.id, enrollment.contactId),
    }),
    db.query.sequences.findFirst({
      where: eq(sequences.id, enrollment.sequenceId),
    }),
    getStepForEnrollment(enrollment),
    db.query.outboundMessages.findFirst({
      where: and(
        eq(outboundMessages.sequenceEnrollmentId, enrollment.id),
        eq(outboundMessages.status, "draft"),
      ),
    }),
    getReplySignalCount(enrollment.contactId),
  ]);

  if (existingDraft) {
    return existingDraft.id;
  }

  if (!contact || !sequence) {
    throw new Error("Unable to load sequence enrollment context.");
  }

  if (sequence.status !== "active") {
    return null;
  }

  if (replySignalCount > 0) {
    await db
      .update(sequenceEnrollments)
      .set({
        nextDueAt: null,
        status: "stopped",
        stopReason: "Stopped because a reply signal was recorded for this contact.",
        updatedAt: new Date(),
      })
      .where(eq(sequenceEnrollments.id, enrollment.id));

    return null;
  }

  if (!step) {
    await db
      .update(sequenceEnrollments)
      .set({
        nextDueAt: null,
        status: "completed",
        stopReason: null,
        updatedAt: new Date(),
      })
      .where(eq(sequenceEnrollments.id, enrollment.id));

    return null;
  }

  if (!contact.primaryEmail) {
    await db
      .update(sequenceEnrollments)
      .set({
        nextDueAt: null,
        status: "paused",
        stopReason: "Primary email is missing for this contact.",
        updatedAt: new Date(),
      })
      .where(eq(sequenceEnrollments.id, enrollment.id));

    return null;
  }

  const sendingAccount = enrollment.connectedAccountId
    ? await getConnectedSendAccountById(enrollment.connectedAccountId)
    : null;

  if (!sendingAccount) {
    await db
      .update(sequenceEnrollments)
      .set({
        nextDueAt: null,
        status: "paused",
        stopReason:
          "Reconnect the selected Gmail or Microsoft account with send permissions.",
        updatedAt: new Date(),
      })
      .where(eq(sequenceEnrollments.id, enrollment.id));

    return null;
  }

  const variables = buildTemplateVariables({ contact, sequence });
  const subject = renderTemplate(step.subjectTemplate, variables);
  const body = renderTemplate(step.bodyTemplate, variables);
  const unresolved = [
    ...subject.missing,
    ...subject.unknown,
    ...body.missing,
    ...body.unknown,
  ];

  if (!subject.rendered || !body.rendered || unresolved.length > 0) {
    await db
      .update(sequenceEnrollments)
      .set({
        nextDueAt: null,
        status: "paused",
        stopReason: `Fix unresolved sequence variables: ${Array.from(new Set(unresolved)).join(", ")}`,
        updatedAt: new Date(),
      })
      .where(eq(sequenceEnrollments.id, enrollment.id));

    return null;
  }

  const [message] = await db
    .insert(outboundMessages)
    .values({
      bodyTemplate: step.bodyTemplate,
      connectedAccountId: sendingAccount.id,
      contactId: contact.id,
      dueAt: new Date(),
      finalBody: body.rendered,
      finalSubject: subject.rendered,
      metadata: {
        renderedWith: variables,
        stepPosition: step.position,
      },
      provider: sendingAccount.provider,
      renderedBody: body.rendered,
      renderedSubject: subject.rendered,
      sequenceEnrollmentId: enrollment.id,
      sequenceId: sequence.id,
      sequenceStepId: step.id,
      status: "draft",
      subjectTemplate: step.subjectTemplate,
    })
    .returning();

  await db
    .update(sequenceEnrollments)
    .set({
      nextDueAt: null,
      stopReason: null,
      updatedAt: new Date(),
    })
    .where(eq(sequenceEnrollments.id, enrollment.id));

  await recordAuditEvent({
    actorUserId,
    entityId: message.id,
    entityType: "outbound_message",
    eventName: "outbound.draft_created",
    metadata: {
      contactId: contact.id,
      sequenceEnrollmentId: enrollment.id,
      sequenceStepId: step.id,
    },
  });

  return message.id;
}

export async function approveOutboundDraft(input: {
  actorUserId?: string | null;
  body: string;
  messageId: string;
  subject: string;
}) {
  const message = await db.query.outboundMessages.findFirst({
    where: eq(outboundMessages.id, input.messageId),
  });

  if (!message) {
    throw new Error("Outbound draft not found.");
  }

  if (
    message.status !== "draft" &&
    message.status !== "failed" &&
    message.status !== "queued"
  ) {
    throw new Error("Only draft, failed, or queued outbound items can be edited.");
  }

  const subject = input.subject.trim();
  const body = input.body.trim();

  if (!subject || !body) {
    throw new Error("Subject and body are both required before send.");
  }

  const sendingAccount = message.connectedAccountId
    ? await getConnectedSendAccountById(message.connectedAccountId)
    : null;

  if (!sendingAccount) {
    throw new Error(
      "Reconnect the selected Gmail or Microsoft account before sending.",
    );
  }

  const previousMetadata = (message.metadata as Record<string, unknown>) ?? {};
  const reason =
    message.status === "failed"
      ? "edited_failed"
      : message.status === "queued"
        ? "edited_queued"
        : "approved";

  await db
    .update(outboundMessages)
    .set({
      approvedAt: new Date(),
      failedAt: null,
      finalBody: body,
      finalSubject: subject,
      lastError: null,
      metadata: {
        ...appendDraftRevision(previousMetadata, {
          actorUserId: input.actorUserId,
          body,
          reason,
          subject,
        }),
        blockedAt: null,
        blockedReason: null,
        deliveryRetryAt: null,
        deliveryDiagnostic:
          getMetadataString(previousMetadata, "deliveryDiagnostic"),
        failureCategory: null,
        retryable: true,
      },
      queuedAt: new Date(),
      status: "queued",
      updatedAt: new Date(),
    })
    .where(eq(outboundMessages.id, message.id));

  await recordAuditEvent({
    actorUserId: input.actorUserId,
    entityId: message.id,
    entityType: "outbound_message",
    eventName: "outbound.queued",
    metadata: {
      connectedAccountId: sendingAccount.id,
    },
  });
}

export async function retryOutboundMessage(input: {
  actorUserId?: string | null;
  messageId: string;
}) {
  const message = await db.query.outboundMessages.findFirst({
    where: eq(outboundMessages.id, input.messageId),
  });

  if (!message || message.status !== "failed") {
    throw new Error("Only failed outbound items can be retried.");
  }

  await approveOutboundDraft({
    actorUserId: input.actorUserId,
    body: message.finalBody,
    messageId: message.id,
    subject: message.finalSubject,
  });
}

export async function cancelOutboundMessage(input: {
  actorUserId?: string | null;
  messageId: string;
}) {
  const message = await db.query.outboundMessages.findFirst({
    where: eq(outboundMessages.id, input.messageId),
  });

  if (!message) {
    throw new Error("Outbound item not found.");
  }

  if (
    message.status !== "draft" &&
    message.status !== "failed" &&
    message.status !== "queued"
  ) {
    throw new Error("Only draft, failed, or queued items can be cancelled.");
  }

  await db
    .update(outboundMessages)
    .set({
      lastError: "Cancelled by operator.",
      metadata: {
        ...((message.metadata as Record<string, unknown>) ?? {}),
        deliveryState: "cancelled",
      },
      status: "cancelled",
      updatedAt: new Date(),
    })
    .where(eq(outboundMessages.id, input.messageId));

  if (message.sequenceEnrollmentId) {
    await db
      .update(sequenceEnrollments)
      .set({
        nextDueAt: null,
        status: "stopped",
        stopReason: "Stopped because the operator cancelled the current step.",
        updatedAt: new Date(),
      })
      .where(eq(sequenceEnrollments.id, message.sequenceEnrollmentId));
  }

  await recordAuditEvent({
    actorUserId: input.actorUserId,
    entityId: message.id,
    entityType: "outbound_message",
    eventName: "outbound.cancelled",
  });
}

export async function recordReplySignal(input: {
  actorUserId?: string | null;
  contactId: string;
  sourceType?: string;
  summary?: string | null;
}) {
  const contact = await db.query.contacts.findFirst({
    where: eq(contacts.id, input.contactId),
  });

  if (!contact) {
    throw new Error("Contact not found.");
  }

  await db.insert(replySignals).values({
    contactId: contact.id,
    sourceType: input.sourceType?.trim() || "manual",
    summary: input.summary?.trim() || "Manual reply recorded by operator.",
  });

  const activeEnrollments = await db.query.sequenceEnrollments.findMany({
    where: and(
      eq(sequenceEnrollments.contactId, contact.id),
      or(
        eq(sequenceEnrollments.status, "active"),
        eq(sequenceEnrollments.status, "paused"),
      ),
    ),
    columns: {
      id: true,
    },
  });

  for (const enrollment of activeEnrollments) {
    await db
      .update(sequenceEnrollments)
      .set({
        nextDueAt: null,
        status: "stopped",
        stopReason: "Stopped because a reply signal was recorded for this contact.",
        updatedAt: new Date(),
      })
      .where(eq(sequenceEnrollments.id, enrollment.id));
  }

  const activeMessages = await db.query.outboundMessages.findMany({
    where: and(
      eq(outboundMessages.contactId, contact.id),
      or(
        eq(outboundMessages.status, "draft"),
        eq(outboundMessages.status, "queued"),
      ),
    ),
    columns: {
      id: true,
    },
  });

  for (const message of activeMessages) {
    const existingMessage = await db.query.outboundMessages.findFirst({
      where: eq(outboundMessages.id, message.id),
    });

    await db
      .update(outboundMessages)
      .set({
        lastError: "Cancelled because a reply signal was recorded.",
        metadata: {
          ...((existingMessage?.metadata as Record<string, unknown>) ?? {}),
          deliveryState: "cancelled",
        },
        status: "cancelled",
        updatedAt: new Date(),
      })
      .where(eq(outboundMessages.id, message.id));
  }

  await recordAuditEvent({
    actorUserId: input.actorUserId,
    entityId: contact.id,
    entityType: "contact",
    eventName: "contact.reply_recorded",
  });

  return contact.slug;
}

async function advanceEnrollmentAfterSend(message: typeof outboundMessages.$inferSelect) {
  if (!message.sequenceEnrollmentId) {
    return;
  }

  const enrollment = await db.query.sequenceEnrollments.findFirst({
    where: eq(sequenceEnrollments.id, message.sequenceEnrollmentId),
  });

  if (!enrollment) {
    return;
  }

  const replySignalCount = await getReplySignalCount(enrollment.contactId);

  if (replySignalCount > 0) {
    await db
      .update(sequenceEnrollments)
      .set({
        nextDueAt: null,
        status: "stopped",
        stopReason: "Stopped because a reply signal was recorded for this contact.",
        updatedAt: new Date(),
      })
      .where(eq(sequenceEnrollments.id, enrollment.id));
    return;
  }

  const currentStep = message.sequenceStepId
    ? await db.query.sequenceSteps.findFirst({
        where: eq(sequenceSteps.id, message.sequenceStepId),
      })
    : await getStepForEnrollment(enrollment);

  if (!currentStep) {
    await db
      .update(sequenceEnrollments)
      .set({
        nextDueAt: null,
        status: "completed",
        stopReason: null,
        updatedAt: new Date(),
      })
      .where(eq(sequenceEnrollments.id, enrollment.id));
    return;
  }

  const nextStep = await db.query.sequenceSteps.findFirst({
    where: and(
      eq(sequenceSteps.sequenceId, enrollment.sequenceId),
      eq(sequenceSteps.position, currentStep.position + 1),
    ),
  });

  if (!nextStep) {
    await db
      .update(sequenceEnrollments)
      .set({
        currentStepPosition: currentStep.position,
        nextDueAt: null,
        status: "completed",
        stopReason: null,
        updatedAt: new Date(),
      })
      .where(eq(sequenceEnrollments.id, enrollment.id));
    return;
  }

  await db
    .update(sequenceEnrollments)
    .set({
      currentStepPosition: nextStep.position,
      nextDueAt: addDays(new Date(), nextStep.delayDays),
      status: "active",
      stopReason: null,
      updatedAt: new Date(),
    })
    .where(eq(sequenceEnrollments.id, enrollment.id));
}

export async function sendOutboundMessage(messageId: string) {
  const message = await db.query.outboundMessages.findFirst({
    where: eq(outboundMessages.id, messageId),
  });

  if (!message) {
    throw new Error("Outbound message not found.");
  }

  const [contact, sendingAccount] = await Promise.all([
    db.query.contacts.findFirst({
      where: eq(contacts.id, message.contactId),
    }),
    message.connectedAccountId
      ? getConnectedSendAccountById(message.connectedAccountId)
      : Promise.resolve(null),
  ]);

  if (!contact?.primaryEmail) {
    throw new Error("A primary email is required before sending.");
  }

  if (!sendingAccount) {
    throw new Error(
      "Reconnect the selected Gmail or Microsoft account before sending.",
    );
  }

  const payload = {
    accountId: sendingAccount.id,
    bodyText: message.finalBody,
    messageId: message.id,
    subject: message.finalSubject,
    to: contact.primaryEmail,
  };

  const previousMetadata = (message.metadata as Record<string, unknown>) ?? {};
  const providerResult =
    sendingAccount.provider === "google"
      ? await sendGoogleMessage(payload)
      : await sendMicrosoftMessage(payload);

  await db
    .update(outboundMessages)
    .set({
      failedAt: null,
      lastError: null,
      metadata: {
        ...previousMetadata,
        attemptCount: getMetadataNumber(previousMetadata, "attemptCount") + 1,
        blockedAt: null,
        blockedReason: null,
        deliveryState: "sent",
        deliveryDiagnostic: providerResult.diagnostic ?? null,
        failureCategory: null,
        lastAttemptAt: new Date().toISOString(),
        lastReplySyncMode: "thread_aware",
        providerReplyAddress: contact.primaryEmail,
        providerInternetMessageId: providerResult.providerInternetMessageId ?? null,
        retryable: true,
      },
      providerMessageId: providerResult.providerMessageId,
      providerThreadId: providerResult.providerThreadId,
      sentAt: new Date(),
      status: "sent",
      updatedAt: new Date(),
    })
    .where(eq(outboundMessages.id, message.id));

  await markConnectedAccountSendSuccess({
    accountId: message.connectedAccountId,
    messageId: message.id,
  });

  await advanceEnrollmentAfterSend(message);

  await recordAuditEvent({
    entityId: message.id,
    entityType: "outbound_message",
    eventName: "outbound.sent",
    metadata: {
      contactId: message.contactId,
      provider: sendingAccount.provider,
    },
  });
}

export async function markOutboundMessageFailed(
  messageId: string,
  errorMessage: string,
) {
  const message = await db.query.outboundMessages.findFirst({
    where: eq(outboundMessages.id, messageId),
  });

  if (!message) {
    return;
  }

  const previousMetadata = (message.metadata as Record<string, unknown>) ?? {};
  const classification = classifyOutboundProviderFailure(errorMessage);
  const nextAttemptCount = getMetadataNumber(previousMetadata, "attemptCount") + 1;
  const retryPlan = planOutboundAutoRetry({
    attemptCount: nextAttemptCount,
    classification,
  });
  const nextRetryAt = retryPlan.retryAt?.toISOString() ?? null;

  await db
    .update(outboundMessages)
    .set({
      failedAt: retryPlan.autoRetry ? null : new Date(),
      lastError: errorMessage,
      metadata: {
        ...previousMetadata,
        attemptCount: nextAttemptCount,
        blockedAt: null,
        blockedReason: null,
        deliveryRetryAt: nextRetryAt,
        deliveryState: retryPlan.autoRetry ? "retry_scheduled" : "failed",
        failureCategory: classification.category,
        lastAttemptAt: new Date().toISOString(),
        lastErrorAt: new Date().toISOString(),
        retryable: retryPlan.retryable,
      },
      queuedAt: retryPlan.autoRetry ? new Date() : message.queuedAt,
      status: retryPlan.autoRetry ? "queued" : "failed",
      updatedAt: new Date(),
    })
    .where(eq(outboundMessages.id, messageId));

  await markConnectedAccountSendFailure(message.connectedAccountId, errorMessage);

  if (message.sequenceEnrollmentId && !retryPlan.autoRetry) {
    await db
      .update(sequenceEnrollments)
      .set({
        nextDueAt: null,
        status: "paused",
        stopReason: errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(sequenceEnrollments.id, message.sequenceEnrollmentId));
  }

  if (retryPlan.autoRetry) {
    await recordAuditEvent({
      entityId: message.id,
      entityType: "outbound_message",
      eventName: "outbound.retry_scheduled",
      metadata: {
        failureCategory: classification.category,
        retryAt: nextRetryAt,
      },
    });
  }
}

export async function claimNextDueEnrollmentId() {
  const enrollments = await db.query.sequenceEnrollments.findMany({
    where: and(
      eq(sequenceEnrollments.status, "active"),
      lte(sequenceEnrollments.nextDueAt, new Date()),
    ),
    orderBy: [asc(sequenceEnrollments.nextDueAt)],
    limit: 25,
  });

  for (const enrollment of enrollments) {
    const sequence = await getSequenceForEnrollment(enrollment);

    if (!sequence || sequence.status !== "active") {
      continue;
    }

    await db
      .update(sequenceEnrollments)
      .set({
        nextDueAt: null,
        updatedAt: new Date(),
      })
      .where(eq(sequenceEnrollments.id, enrollment.id));

    return enrollment.id;
  }

  return null;
}

export async function claimNextQueuedOutboundMessageId() {
  const messages = await db.query.outboundMessages.findMany({
    where: eq(outboundMessages.status, "queued"),
    orderBy: [asc(outboundMessages.queuedAt)],
    limit: 25,
  });

  for (const message of messages) {
    const previousMetadata = (message.metadata as Record<string, unknown>) ?? {};
    const deliveryRetryAt = getMetadataString(previousMetadata, "deliveryRetryAt");

    if (deliveryRetryAt) {
      const retryAt = new Date(deliveryRetryAt);

      if (!Number.isNaN(retryAt.getTime()) && retryAt.getTime() > Date.now()) {
        continue;
      }
    }

    const block = await getSendPolicyBlock(message);

    if (block) {
      await db
        .update(outboundMessages)
        .set({
          lastError: block.reason,
          metadata: {
            ...previousMetadata,
            blockedAt: new Date().toISOString(),
            blockedReason: block.reason,
            deliveryRetryAt: block.retryAt.toISOString(),
            deliveryState: "blocked",
          },
          updatedAt: new Date(),
        })
        .where(eq(outboundMessages.id, message.id));
      continue;
    }

    await db
      .update(outboundMessages)
      .set({
        lastError: null,
        metadata: {
          ...previousMetadata,
          blockedAt: null,
          blockedReason: null,
          deliveryRetryAt: null,
          deliveryState: "sending",
        },
        status: "sending",
        updatedAt: new Date(),
      })
      .where(eq(outboundMessages.id, message.id));

    return message.id;
  }

  return null;
}

export async function listSendCapableAccountsForUser(userId: string) {
  return getConnectedSendAccountsForUser(userId);
}
