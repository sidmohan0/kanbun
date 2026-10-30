import { ACTOR_TYPES, modelNames } from "@kanbun/model";
import { z } from "zod";

const nonempty = z.string().min(1);
const sequence = z.number().int().nonnegative().safe();
const querySequence = z
  .string()
  .regex(/^(0|[1-9]\d*)$/, "Expected a nonnegative decimal cursor")
  .transform(Number)
  .pipe(sequence);
const branchId = z.union([z.literal("main"), z.uuidv7()]);
const selectedBranch = { branchId: branchId.default("main") };
const scope = z.strictObject({ teamIds: z.array(nonempty).default([]), projectIds: z.array(nonempty).default([]) });

export const bootstrapQuery = z.strictObject({ clientId: nonempty, ...selectedBranch });
export const connectQuery = z.strictObject({ clientId: nonempty, branchId: z.literal("main").default("main") });
export const pullQuery = z.strictObject({ clientId: nonempty, since: querySequence, ...selectedBranch });
export const loadQuery = z.strictObject({ model: z.enum(modelNames), parentId: nonempty, ...selectedBranch });
export const branchQuery = z.strictObject({ branchId: z.uuidv7() });
export const eventsQuery = z.strictObject({
  since: querySequence.default(0),
  entityId: nonempty.optional(),
  limit: querySequence.pipe(z.number().min(1).max(5000)).default(500),
  ...selectedBranch,
});
export const activityQuery = z.strictObject({
  model: z.enum(modelNames).optional(),
  rowId: nonempty.optional(),
  actorType: z.enum(ACTOR_TYPES).optional(),
  txnId: nonempty.optional(),
  before: querySequence.pipe(z.number().positive()).optional(),
  limit: querySequence.pipe(z.number().min(1).max(500)).default(100),
  ...selectedBranch,
});
export const pushBody = z.strictObject({
  clientId: nonempty,
  mutations: z
    .array(
      z.strictObject({
        id: z.number().int().positive().safe(),
        name: nonempty,
        args: z.unknown(),
        ts: z.iso.datetime({ offset: true }),
        reason: z.string().optional(),
        causationSeq: z.number().int().positive().safe().optional(),
      }),
    )
    .max(500),
  ...selectedBranch,
});
export const createBody = z.strictObject({
  id: z.uuidv7(),
  name: z.string().trim().min(1).max(160),
  scope: scope.default({ teamIds: [], projectIds: [] }),
});
export const mergeBody = z.strictObject({
  branchId: z.uuidv7(),
  mergeId: z.uuidv7(),
  expectedBranchHeadSeq: sequence,
  expectedMainSyncSeq: sequence,
  resolutions: z
    .array(
      z.discriminatedUnion("choice", [
        z.strictObject({ issueId: nonempty, choice: z.literal("branch") }),
        z.strictObject({ issueId: nonempty, choice: z.literal("main") }),
        z.strictObject({ issueId: nonempty, choice: z.literal("edit"), title: z.string().trim().min(1).max(500) }),
      ]),
    )
    .optional(),
});
export const seedBody = z.strictObject({ seedIssue: z.boolean().default(true) });

export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

export function query<S extends z.ZodType>(schema: S, url: URL): z.output<S> {
  const values: Record<string, string> = Object.create(null);
  for (const [key, value] of url.searchParams) {
    if (Object.hasOwn(values, key)) throw new RequestError(`Duplicate query parameter: ${key}`);
    values[key] = value;
  }
  return schema.parse(values);
}

export async function body<S extends z.ZodType>(schema: S, request: Request): Promise<z.output<S>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new RequestError("Expected a valid JSON request body");
  }
  return schema.parse(value);
}
