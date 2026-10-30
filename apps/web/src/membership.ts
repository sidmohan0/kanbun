export type WorkspaceMember = {
  userId: string;
  name: string;
  email: string;
  role: "owner" | "member";
  active: boolean;
};
export type WorkspaceInvitation = {
  id: string;
  email: string;
  createdAt: string;
  expiresAt: string | null;
  acceptedAt: string | null;
  revokedAt: string | null;
};
export type MembershipList = { members: WorkspaceMember[]; invitations: WorkspaceInvitation[] };

export class MembershipError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Browser requests carry only the current Access session; invitations remain in request bodies. */
export async function membershipRequest(path: string, input?: object): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: input === undefined ? "GET" : "POST",
      credentials: "include",
      cache: "no-store",
      redirect: "manual",
      ...(input === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(input) }),
    });
  } catch {
    throw new MembershipError("Connection unavailable. Check your connection and try again.", 0);
  }
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400))
    throw new MembershipError("Sign in again with the invited account, then reopen this link.", 401);
  if (response.status === 401)
    throw new MembershipError("Your sign-in has expired. Sign in with the invited email, then reopen this link.", 401);
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new MembershipError("The server returned an invalid response. Please try again.", response.status);
  }
  if (!response.ok) {
    const error =
      value !== null && typeof value === "object" && "error" in value && typeof value.error === "string"
        ? value.error
        : "This action could not be completed.";
    throw new MembershipError(error, response.status);
  }
  return value;
}

export function membershipList(value: unknown): MembershipList {
  if (
    value === null ||
    typeof value !== "object" ||
    !("members" in value) ||
    !Array.isArray(value.members) ||
    !("invitations" in value) ||
    !Array.isArray(value.invitations)
  )
    throw new Error("The server returned an invalid member list.");
  for (const member of value.members)
    if (
      member === null ||
      typeof member !== "object" ||
      typeof member.userId !== "string" ||
      typeof member.name !== "string" ||
      typeof member.email !== "string" ||
      !["owner", "member"].includes(member.role) ||
      typeof member.active !== "boolean"
    )
      throw new Error("The server returned an invalid member list.");
  for (const invitation of value.invitations)
    if (
      invitation === null ||
      typeof invitation !== "object" ||
      typeof invitation.id !== "string" ||
      typeof invitation.email !== "string" ||
      typeof invitation.createdAt !== "string" ||
      ![invitation.expiresAt, invitation.acceptedAt, invitation.revokedAt].every(
        (entry) => entry === null || typeof entry === "string",
      )
    )
      throw new Error("The server returned an invalid invitation list.");
  return value as MembershipList;
}
