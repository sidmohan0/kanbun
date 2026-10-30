import { ACTOR_TYPES } from "@kanbun/model";
import { z } from "zod";

const id = z.string().min(1);
const nullableId = id.nullable();
const timestamp = z.string().datetime({ offset: true });
const nullableTimestamp = timestamp.nullable();
const title = z
  .string()
  .min(1)
  .max(500)
  .refine((value) => value === value.trim(), "title must be trimmed");

/** Initial issue values are finalized by decide before a reducer sees them. */
export const issueCreatedPayloadSchema = z.strictObject({
  number: z.number().int().nonnegative(),
  title,
  description: z.string().nullable(),
  descriptionContentId: nullableId,
  priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  prioritySortOrder: id,
  estimate: z.number().nonnegative().nullable(),
  dueDate: z.iso.date().nullable(),
  sortOrder: id,
  boardOrder: id,
  subIssueSortOrder: nullableId,
  stateId: id,
  assigneeId: nullableId,
  creatorId: id,
  parentId: nullableId,
  projectId: nullableId,
  projectMilestoneId: nullableId,
  cycleId: nullableId,
  sourceCommentId: nullableId,
  startedAt: nullableTimestamp,
  completedAt: nullableTimestamp,
  canceledAt: nullableTimestamp,
  triagedAt: nullableTimestamp,
  startedTriageAt: nullableTimestamp,
  addedToTeamAt: timestamp,
  addedToProjectAt: nullableTimestamp,
  addedToCycleAt: nullableTimestamp,
  labelLinks: z.array(z.strictObject({ id, labelId: id })),
  subscriptions: z.array(z.strictObject({ id, userId: id })),
});

export const issueTitledPayloadSchema = z.strictObject({ title });

const subject = {
  entityType: z.literal("issue"),
  entityId: id,
  teamId: id,
  scopeUserId: nullableId,
};

const issueCreatedIntent = z.strictObject({
  ...subject,
  type: z.literal("IssueCreated"),
  payload: issueCreatedPayloadSchema,
});
const issueTitledIntent = z.strictObject({
  ...subject,
  type: z.literal("IssueTitled"),
  payload: issueTitledPayloadSchema,
});

/** A decision carries business meaning; the execution boundary supplies provenance. */
export const pendingEventSchema = z.discriminatedUnion("type", [issueCreatedIntent, issueTitledIntent]);

const actorSchema = z.strictObject({ id, type: z.enum(ACTOR_TYPES), via: id.optional() });
const envelope = {
  /** Zero belongs only to an optimistic apply; persisted events have positive seq. */
  seq: z.number().int().nonnegative(),
  eventIndex: z.number().int().nonnegative(),
  branchId: id,
  txnId: id,
  actor: actorSchema,
  clientId: nullableId,
  mutationId: z.number().int().positive().nullable(),
  sessionId: nullableId,
  sourceRef: nullableId,
  /** Semantic event sequence, resolved by the authority from the visible source patch. */
  causationSeq: z.number().int().positive().nullable(),
  reason: z.string().nullable(),
  /** Authoritative milliseconds since epoch, copied into projections at apply. */
  ts: z.number().int().nonnegative(),
};

/** The closed vocabulary accepted by durable storage and deterministic replay. */
export const eventSchema = z.discriminatedUnion("type", [
  issueCreatedIntent.extend(envelope),
  issueTitledIntent.extend(envelope),
]);

export type PendingEvent = z.infer<typeof pendingEventSchema>;
export type DomainEvent = z.infer<typeof eventSchema>;
export type EventActor = z.infer<typeof actorSchema>;
export type IssueCreatedEvent = Extract<DomainEvent, { type: "IssueCreated" }>;
export type IssueTitledEvent = Extract<DomainEvent, { type: "IssueTitled" }>;
export type IssueCreatedPayload = z.infer<typeof issueCreatedPayloadSchema>;
export type IssueTitledPayload = z.infer<typeof issueTitledPayloadSchema>;
