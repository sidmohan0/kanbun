/** Shared Zod fragments for mutator args. */
import { z } from "zod";

/** Client-generated UUIDv7 (any UUID accepted). */
export const id = z.string().uuid();
/** A user or agent id: UUID in production, any short string in tests and seeds. */
export const actorRef = z.string().min(1).max(64);
export const iso = z.string().datetime({ offset: true });
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
export const priority = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const nullable = <T extends z.ZodType>(t: T) => t.nullable();
/** A ProseMirror document. Validated structurally only; the editor schema is the authority. */
export const pmDoc = z.object({ type: z.literal("doc"), content: z.array(z.unknown()).optional() }).passthrough();
