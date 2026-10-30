import { z } from "zod";

/** Identity and workspace selected by the server, never by browser mutation arguments. */
export const workspaceContextSchema = z.strictObject({
  mode: z.enum(["local", "hosted"]),
  workspaceId: z.string().min(1),
  workspaceName: z.string().min(1),
  actor: z.strictObject({ id: z.string().min(1), type: z.literal("user") }),
  name: z.string().min(1),
  email: z.string().nullable(),
});

export type WorkspaceContext = z.infer<typeof workspaceContextSchema>;
