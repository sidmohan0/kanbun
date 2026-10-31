import { z } from "zod";
import type { Row } from "@kanbun/model";

/** A recreated UUID is a different issue and must never reopen an older body or draft. */
export function issueIncarnation(issue: Pick<Row<"issue">, "createdSeq" | "createdAt">): string {
  return issue.createdSeq > 0 ? `seq:${issue.createdSeq}` : `legacy:${issue.createdAt}`;
}

/** Identity and workspace selected by the server, never by browser mutation arguments. */
export const workspaceContextSchema = z.strictObject({
  mode: z.enum(["local", "hosted"]),
  role: z.enum(["owner", "member"]),
  admissionId: z.string().nullable(),
  workspaceId: z.string().min(1),
  workspaceName: z.string().min(1),
  actor: z.strictObject({ id: z.string().min(1), type: z.literal("user") }),
  name: z.string().min(1),
  email: z.string().nullable(),
  authentication: z.enum(["access", "email"]).optional(),
});

export type WorkspaceContext = z.infer<typeof workspaceContextSchema>;
