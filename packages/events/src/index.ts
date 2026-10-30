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
  /** Original placement intent for merge-time revalidation; absent on older facts. */
  position: z.enum(["top", "bottom"]).optional(),
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
  assertedStateId: nullableId.optional(),
  derivedStateId: id.optional(),
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
export const issueDescribedPayloadSchema = z.strictObject({
  description: z.string(),
  descriptionContentId: id,
  contentState: z.string().regex(/^[a-f0-9]{64}$/),
});

export const branchScopeSchema = z.strictObject({
  teamIds: z.array(id).default([]),
  projectIds: z.array(id).default([]),
});

export const branchCreatedPayloadSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  baseSeq: z.number().int().nonnegative(),
  /** Absent on historical branch creation facts; never inferred from later patches. */
  baseSyncSeq: z.number().int().nonnegative().optional(),
  ownerId: id,
  ownerType: z.enum(ACTOR_TYPES),
  ownerUserId: id,
  scope: branchScopeSchema,
});

const branchCreatedIntent = z.strictObject({
  entityType: z.literal("workspaceBranch"),
  entityId: id,
  teamId: z.null(),
  scopeUserId: id,
  type: z.literal("BranchCreated"),
  payload: branchCreatedPayloadSchema,
});

export const branchMergedPayloadSchema = z.strictObject({
  mergeId: id,
  branchHeadSeq: z.number().int().nonnegative(),
  sourceEventSeqs: z.array(z.number().int().positive()),
  skippedEntityIds: z.array(id),
});

const resolution = {
  mergeId: id,
  issueId: id,
  mainSyncSeq: z.number().int().nonnegative(),
};

export const branchConflictResolvedPayloadSchema = z.discriminatedUnion("choice", [
  z.strictObject({ ...resolution, choice: z.literal("branch") }),
  z.strictObject({ ...resolution, choice: z.literal("main") }),
  z.strictObject({ ...resolution, choice: z.literal("edit"), title }),
]);

const branchMergedIntent = z.strictObject({
  entityType: z.literal("workspaceBranch"),
  entityId: id,
  teamId: z.null(),
  scopeUserId: id,
  type: z.literal("BranchMerged"),
  payload: branchMergedPayloadSchema,
});

const branchConflictResolvedIntent = z.strictObject({
  entityType: z.literal("workspaceBranch"),
  entityId: id,
  teamId: z.null(),
  scopeUserId: id,
  type: z.literal("BranchConflictResolved"),
  payload: branchConflictResolvedPayloadSchema,
});

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
const issueDescribedIntent = z.strictObject({
  ...subject,
  type: z.literal("IssueDescribed"),
  payload: issueDescribedPayloadSchema,
});
const issuePrioritizedIntent = z.strictObject({
  ...subject,
  type: z.literal("IssuePrioritized"),
  payload: z.strictObject({ priority: issueCreatedPayloadSchema.shape.priority }),
});
const humanAssertedStatusIntent = z.strictObject({
  ...subject,
  type: z.literal("HumanAssertedStatus"),
  payload: z.strictObject({
    stateId: nullableId,
    derivedStateId: id,
    effectiveStateId: id,
    boardOrder: id,
    startedAt: nullableTimestamp,
    completedAt: nullableTimestamp,
    canceledAt: nullableTimestamp,
    triagedAt: nullableTimestamp,
    startedTriageAt: nullableTimestamp,
  }),
});
const issueAssignedIntent = z.strictObject({
  ...subject,
  type: z.literal("IssueAssigned"),
  payload: z.strictObject({ assigneeId: id }),
});
const issueUnassignedIntent = z.strictObject({
  ...subject,
  type: z.literal("IssueUnassigned"),
  payload: z.strictObject({}),
});
const subscriberAddedIntent = z.strictObject({
  ...subject,
  type: z.literal("SubscriberAdded"),
  payload: z.strictObject({ id, userId: id }),
});
const labelAddedIntent = z.strictObject({
  ...subject,
  type: z.literal("LabelAdded"),
  payload: z.strictObject({ labelId: id, linkId: id }),
});
const labelRemovedIntent = z.strictObject({
  ...subject,
  type: z.literal("LabelRemoved"),
  payload: z.strictObject({ labelId: id, linkId: id }),
});
const issueArchivedIntent = z.strictObject({
  ...subject,
  type: z.literal("IssueArchived"),
  payload: z.strictObject({}),
});
const issueRestoredIntent = z.strictObject({
  ...subject,
  type: z.literal("IssueRestored"),
  payload: z.strictObject({ from: z.literal("archive") }),
});
const commentSubject = { entityType: z.literal("comment"), entityId: id, teamId: id, scopeUserId: z.null() };
const commentBody = z
  .string()
  .max(20_000)
  .refine((body) => body.trim().length > 0, "comment is empty");
const commentBodyData = z.record(z.string(), z.unknown()).nullable();
const commentPostedIntent = z.strictObject({
  ...commentSubject,
  type: z.literal("CommentPosted"),
  payload: z
    .strictObject({
      issueId: id,
      body: commentBody,
      bodyData: commentBodyData,
      parentId: nullableId,
      quotedText: z.string().max(2000).nullable(),
      userId: nullableId,
      agentId: nullableId,
    })
    .refine((payload) => (payload.userId === null) !== (payload.agentId === null), "A comment must have one author"),
});
const commentEditedIntent = z.strictObject({
  ...commentSubject,
  type: z.literal("CommentEdited"),
  payload: z.strictObject({ issueId: id, body: commentBody, bodyData: commentBodyData }),
});
const commentResolvedIntent = z.strictObject({
  ...commentSubject,
  type: z.literal("CommentResolved"),
  payload: z.strictObject({
    issueId: id,
    resolved: z.boolean(),
    resolvingUserId: nullableId,
    resolvingCommentId: nullableId,
  }),
});

/** A decision carries business meaning; the execution boundary supplies provenance. */
export const pendingEventSchema = z.discriminatedUnion("type", [
  commentPostedIntent,
  commentEditedIntent,
  commentResolvedIntent,
  issueCreatedIntent,
  issueTitledIntent,
  issueDescribedIntent,
  issuePrioritizedIntent,
  humanAssertedStatusIntent,
  issueAssignedIntent,
  issueUnassignedIntent,
  subscriberAddedIntent,
  labelAddedIntent,
  labelRemovedIntent,
  issueArchivedIntent,
  issueRestoredIntent,
  branchCreatedIntent,
  branchMergedIntent,
  branchConflictResolvedIntent,
]);

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
  /** Semantic event sequence, resolved from a visible source patch or assigned to a merge fact by the authority. */
  causationSeq: z.number().int().positive().nullable(),
  reason: z.string().nullable(),
  /** Authoritative milliseconds since epoch, copied into projections at apply. */
  ts: z.number().int().nonnegative(),
};

/** The closed vocabulary accepted by durable storage and deterministic replay. */
export const eventSchema = z.discriminatedUnion("type", [
  commentPostedIntent.extend(envelope),
  commentEditedIntent.extend(envelope),
  commentResolvedIntent.extend(envelope),
  issueCreatedIntent.extend(envelope),
  issueTitledIntent.extend(envelope),
  issueDescribedIntent.extend(envelope),
  issuePrioritizedIntent.extend(envelope),
  humanAssertedStatusIntent.extend(envelope),
  issueAssignedIntent.extend(envelope),
  issueUnassignedIntent.extend(envelope),
  subscriberAddedIntent.extend(envelope),
  labelAddedIntent.extend(envelope),
  labelRemovedIntent.extend(envelope),
  issueArchivedIntent.extend(envelope),
  issueRestoredIntent.extend(envelope),
  branchCreatedIntent.extend(envelope),
  branchMergedIntent.extend(envelope),
  branchConflictResolvedIntent.extend(envelope),
]);

export type PendingEvent = z.infer<typeof pendingEventSchema>;
export type DomainEvent = z.infer<typeof eventSchema>;
export type EventActor = z.infer<typeof actorSchema>;
export type IssueCreatedEvent = Extract<DomainEvent, { type: "IssueCreated" }>;
export type IssueTitledEvent = Extract<DomainEvent, { type: "IssueTitled" }>;
export type IssueDescribedEvent = Extract<DomainEvent, { type: "IssueDescribed" }>;
export type BranchCreatedEvent = Extract<DomainEvent, { type: "BranchCreated" }>;
export type BranchMergedEvent = Extract<DomainEvent, { type: "BranchMerged" }>;
export type BranchConflictResolvedEvent = Extract<DomainEvent, { type: "BranchConflictResolved" }>;
export type IssueCreatedPayload = z.infer<typeof issueCreatedPayloadSchema>;
export type IssueTitledPayload = z.infer<typeof issueTitledPayloadSchema>;
