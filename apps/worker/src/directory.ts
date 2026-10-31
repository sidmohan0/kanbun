import { uuidv7 } from "@kanbun/model";
import type { WorkspaceContext } from "@kanbun/sync";
import { configuration, emailDomain, type AccessIdentity, type AuthEnvironment, type HostedPrincipal } from "./auth";
import { RequestError } from "./requests";
import { requireEmailSession } from "./email-auth";

export type DirectoryEnvironment = AuthEnvironment & { ACCOUNTS?: D1Database };
type Account = { id: string; email: string; name: string };
type Invitation = {
  id: string;
  workspace_id: string;
  email: string;
  expires_at: string | null;
  accepted_at: string | null;
  accepted_account_id: string | null;
  revoked_at: string | null;
  created_at: string;
};

type IdentityKey = Pick<AccessIdentity, "issuer" | "subject"> & {
  provider?: "email" | "cloudflare-access" | undefined;
};
const identityProvider = (identity: IdentityKey) => identity.provider ?? "cloudflare-access";
const providerKey = (identity: IdentityKey) =>
  identity.provider === "email" ? identity.subject.toLowerCase() : JSON.stringify([identity.issuer, identity.subject]);

function database(env: DirectoryEnvironment): D1Database {
  if (!env.ACCOUNTS) throw new RequestError("Preview account directory is not configured", 503);
  return env.ACCOUNTS;
}

export async function accountForIdentity(env: DirectoryEnvironment, identity: IdentityKey) {
  return database(env)
    .prepare(
      "SELECT a.id, a.email, a.name FROM auth_identities i JOIN accounts a ON a.id = i.account_id WHERE i.provider = ? AND i.provider_user_id = ?",
    )
    .bind(identityProvider(identity), providerKey(identity))
    .first<Account>();
}

/** First owner admission is one D1 batch; later admission never resurrects membership. */
export async function admitMember(env: DirectoryEnvironment, identity: AccessIdentity): Promise<HostedPrincipal> {
  const config = configuration(env);
  const db = database(env);
  let account = await accountForIdentity(env, identity);
  if (account && account.email.toLowerCase() !== identity.email)
    throw new RequestError("Identity email does not match its account", 403);
  if (!account && identity.email !== config.ownerEmail.toLowerCase())
    throw new RequestError("An invitation is required to join this workspace", 403);
  if (!account) {
    const existing = await db.prepare("SELECT id FROM accounts WHERE lower(email) = ?").bind(identity.email).first();
    if (existing) {
      account = await accountForIdentity(env, identity);
      if (!account) throw new RequestError("This email is already linked to another identity", 403);
    }
    if (!account) {
      const accountId = uuidv7();
      const now = new Date().toISOString();
      try {
        await db.batch([
          db
            .prepare("INSERT INTO accounts (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
            .bind(accountId, identity.email, identity.name, now, now),
          db
            .prepare(
              "INSERT INTO auth_identities (id, account_id, provider, provider_user_id, created_at) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(uuidv7(), accountId, identityProvider(identity), providerKey(identity), now),
          db
            .prepare(
              "INSERT INTO workspaces (id, url_key, name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
            )
            .bind(config.workspaceId, `preview-${config.workspaceId.slice(0, 8)}`, config.workspaceName, now),
          db
            .prepare(
              "INSERT INTO workspace_members (workspace_id, account_id, role, created_at) VALUES (?, ?, 'owner', ?) ON CONFLICT(workspace_id, account_id) DO NOTHING",
            )
            .bind(config.workspaceId, accountId, now),
        ]);
      } catch (failure) {
        // Parallel first requests may race; only the winner's same verified identity is reusable.
        account = await accountForIdentity(env, identity);
        if (!account) throw failure;
      }
      account ??= await accountForIdentity(env, identity);
    }
  }
  if (!account) throw new RequestError("Owner identity could not be initialized", 503);
  if (identity.provider === "email" && identity.email === config.ownerEmail.toLowerCase()) {
    const workspace = await db.prepare("SELECT id FROM workspaces WHERE id = ?").bind(config.workspaceId).first();
    if (!workspace) {
      const now = new Date().toISOString();
      await db.batch([
        db
          .prepare("INSERT INTO workspaces (id,url_key,name,created_at) VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING")
          .bind(config.workspaceId, `preview-${config.workspaceId.slice(0, 8)}`, config.workspaceName, now),
        db
          .prepare(
            "INSERT INTO workspace_members (workspace_id,account_id,role,created_at) SELECT ?,?,'owner',? WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ? AND created_at = ? AND deletion_requested_at IS NULL) ON CONFLICT(workspace_id,account_id) DO NOTHING",
          )
          .bind(config.workspaceId, account.id, now, config.workspaceId, now),
      ]);
    }
  }
  const membership = await directoryMembership(env, account.id);
  const principal: HostedPrincipal = {
    mode: "hosted",
    workspaceId: config.workspaceId,
    actor: { id: account.id, type: "user" },
    issuer: identity.issuer,
    subject: identity.subject,
    expiresAt: identity.expiresAt,
    admissionId: membership?.admission_id ?? null,
    ...(identity.provider ? { provider: identity.provider } : {}),
    ...(identity.sessionId ? { sessionId: identity.sessionId } : {}),
  };
  await activeMember(env, principal);
  return principal;
}

/** Re-read directory authority for every request and every outbound socket notification. */
export async function activeMember(env: DirectoryEnvironment, principal: HostedPrincipal): Promise<WorkspaceContext> {
  const config = configuration(env);
  if (env.AUTH_MODE === "email") await requireEmailSession(env, principal);
  else if (principal.provider === "email" || principal.sessionId)
    throw new RequestError("Workspace identity is unavailable", 401);
  if (
    principal.workspaceId !== config.workspaceId ||
    principal.issuer !== config.issuer ||
    principal.expiresAt <= Date.now()
  )
    throw new RequestError("Workspace identity has expired or is unavailable", 403);
  const row = await database(env)
    .prepare(
      "SELECT a.id, a.email, a.name, w.name AS workspace_name, m.role, m.admission_id FROM accounts a JOIN auth_identities i ON i.account_id = a.id JOIN workspace_members m ON m.account_id = a.id JOIN workspaces w ON w.id = m.workspace_id WHERE a.id = ? AND i.provider = ? AND i.provider_user_id = ? AND w.id = ? AND w.deletion_requested_at IS NULL AND m.removed_at IS NULL AND m.role IN ('owner', 'user')",
    )
    .bind(principal.actor.id, identityProvider(principal), providerKey(principal), config.workspaceId)
    .first<Account & { workspace_name: string; role: "owner" | "user"; admission_id: string | null }>();
  if (
    !row ||
    row.admission_id !== principal.admissionId ||
    (row.role === "user" && row.admission_id === null) ||
    (row.role === "owner" && row.email.toLowerCase() !== config.ownerEmail.toLowerCase())
  )
    throw new RequestError("Active workspace membership is required", 403);
  if (principal.expiresAt <= Date.now()) throw new RequestError("Workspace identity has expired", 403);
  return {
    mode: "hosted",
    authentication: env.AUTH_MODE === "email" ? "email" : "access",
    role: row.role === "owner" ? "owner" : "member",
    admissionId: row.admission_id,
    workspaceId: config.workspaceId,
    workspaceName: row.workspace_name,
    actor: { id: row.id, type: "user" },
    name: row.name,
    email: row.email,
  };
}

export function principalForIdentity(
  env: DirectoryEnvironment,
  identity: AccessIdentity,
  accountId: string,
  admissionId: string | null,
): HostedPrincipal {
  return {
    mode: "hosted",
    workspaceId: configuration(env).workspaceId,
    actor: { id: accountId, type: "user" },
    issuer: identity.issuer,
    subject: identity.subject,
    expiresAt: identity.expiresAt,
    admissionId,
    ...(identity.provider ? { provider: identity.provider } : {}),
    ...(identity.sessionId ? { sessionId: identity.sessionId } : {}),
  };
}

export function directoryMembership(env: DirectoryEnvironment, userId: string) {
  return database(env)
    .prepare("SELECT role, removed_at, admission_id FROM workspace_members WHERE workspace_id = ? AND account_id = ?")
    .bind(configuration(env).workspaceId, userId)
    .first<{ role: string; removed_at: string | null; admission_id: string | null }>();
}

async function owner(env: DirectoryEnvironment, principal: HostedPrincipal) {
  const context = await activeMember(env, principal);
  if (context.role !== "owner") throw new RequestError("Only the workspace owner may manage members", 403);
  return context;
}

/** D1 is the name authority; the next authenticated DO request reconciles its projection. */
export async function renameWorkspace(env: DirectoryEnvironment, principal: HostedPrincipal, name: string) {
  const context = await owner(env, principal);
  await database(env)
    .prepare(
      "UPDATE workspaces SET name = ? WHERE id = ? AND deletion_requested_at IS NULL AND EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = ? AND account_id = ? AND role = 'owner' AND removed_at IS NULL)",
    )
    .bind(name, context.workspaceId, context.workspaceId, context.actor.id)
    .run();
  return owner(env, principal);
}

const invitationView = (row: Invitation) => ({
  id: row.id,
  email: row.email,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  acceptedAt: row.accepted_at,
  revokedAt: row.revoked_at,
});

async function tokenHash(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function listMembership(env: DirectoryEnvironment, principal: HostedPrincipal) {
  await owner(env, principal);
  const workspaceId = configuration(env).workspaceId;
  const members = await database(env)
    .prepare(
      "SELECT a.id AS userId, a.name, a.email, m.role, m.removed_at FROM workspace_members m JOIN accounts a ON a.id = m.account_id WHERE m.workspace_id = ? ORDER BY m.created_at, a.id",
    )
    .bind(workspaceId)
    .all<{ userId: string; name: string; email: string; role: string; removed_at: string | null }>();
  const invitations = await database(env)
    .prepare("SELECT * FROM invites WHERE workspace_id = ? ORDER BY created_at DESC, id")
    .bind(workspaceId)
    .all<Invitation>();
  return {
    members: members.results.map(({ removed_at, role, ...member }) => ({
      ...member,
      role: role === "owner" ? ("owner" as const) : ("member" as const),
      active: removed_at === null,
    })),
    invitations: invitations.results.map(invitationView),
  };
}

export async function createInvitation(
  env: DirectoryEnvironment,
  principal: HostedPrincipal,
  email: string,
  expiresAt: string | null,
) {
  const context = await owner(env, principal);
  if (
    env.AUTH_MODE === "email" &&
    email !== configuration(env).ownerEmail.toLowerCase() &&
    !email.endsWith(`@${emailDomain(env)}`)
  )
    throw new RequestError(`Invitations require an address at @${emailDomain(env)}.`, 400);

  const db = database(env);
  const existing = await db
    .prepare(
      "SELECT m.removed_at FROM workspace_members m JOIN accounts a ON a.id = m.account_id WHERE m.workspace_id = ? AND lower(a.email) = ?",
    )
    .bind(context.workspaceId, email)
    .first<{ removed_at: string | null }>();
  if (existing && existing.removed_at === null)
    throw new RequestError("This account already has a workspace membership", 409);
  if (expiresAt !== null && Date.parse(expiresAt) <= Date.now())
    throw new RequestError("Invitation expiry must be in the future");
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const token = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const id = uuidv7();
  const now = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO invites (id, workspace_id, email, role, inviter_account_id, token_hash, expires_at, created_at) SELECT ?, ?, ?, 'user', ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = ? AND account_id = ? AND role = 'owner' AND removed_at IS NULL)",
    )
    .bind(
      id,
      context.workspaceId,
      email,
      context.actor.id,
      await tokenHash(token),
      expiresAt,
      now,
      context.workspaceId,
      context.actor.id,
    )
    .run();
  await owner(env, principal);
  const row = await db.prepare("SELECT * FROM invites WHERE id = ?").bind(id).first<Invitation>();
  if (!row) throw new RequestError("Invitation could not be created", 403);
  return { invitation: invitationView(row), token, url: `${configuration(env).appOrigin}/#invite/${token}` };
}

export async function revokeInvitation(env: DirectoryEnvironment, principal: HostedPrincipal, id: string) {
  const context = await owner(env, principal);
  const row = await database(env)
    .prepare("SELECT * FROM invites WHERE id = ? AND workspace_id = ?")
    .bind(id, context.workspaceId)
    .first<Invitation>();
  if (!row) throw new RequestError("Invitation not found", 404);
  if (row.accepted_at) throw new RequestError("Accepted invitations cannot be revoked; remove the member instead", 409);
  await database(env)
    .prepare(
      "UPDATE invites SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND workspace_id = ? AND accepted_at IS NULL AND EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = ? AND account_id = ? AND role = 'owner' AND removed_at IS NULL)",
    )
    .bind(new Date().toISOString(), id, context.workspaceId, context.workspaceId, context.actor.id)
    .run();
  await owner(env, principal);
  const current = await database(env)
    .prepare("SELECT accepted_at, revoked_at FROM invites WHERE id = ? AND workspace_id = ?")
    .bind(id, context.workspaceId)
    .first<{ accepted_at: string | null; revoked_at: string | null }>();
  if (current?.accepted_at)
    throw new RequestError("Accepted invitations cannot be revoked; remove the member instead", 409);
  if (!current?.revoked_at) throw new RequestError("Invitation revocation did not complete", 503);
}

export async function removeMembership(env: DirectoryEnvironment, principal: HostedPrincipal, userId: string) {
  const context = await owner(env, principal);
  const row = await database(env)
    .prepare(
      "SELECT m.role, m.admission_id, a.email FROM workspace_members m JOIN accounts a ON a.id = m.account_id WHERE m.workspace_id = ? AND m.account_id = ?",
    )
    .bind(context.workspaceId, userId)
    .first<{ role: string; admission_id: string | null; email: string }>();
  if (!row) throw new RequestError("Member not found", 404);
  if (row.role !== "user" || userId === context.actor.id)
    throw new RequestError("The workspace owner cannot be removed", 403);
  const now = new Date().toISOString();
  await database(env).batch([
    database(env)
      .prepare(
        "UPDATE workspace_members SET removed_at = COALESCE(removed_at, ?) WHERE workspace_id = ? AND account_id = ? AND role = 'user' AND EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = ? AND account_id = ? AND role = 'owner' AND removed_at IS NULL)",
      )
      .bind(now, context.workspaceId, userId, context.workspaceId, context.actor.id),
    database(env)
      .prepare(
        "UPDATE invites SET revoked_at = COALESCE(revoked_at, ?) WHERE workspace_id = ? AND email = ? AND accepted_at IS NULL AND EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = ? AND account_id = ? AND role = 'owner' AND removed_at IS NULL)",
      )
      .bind(now, context.workspaceId, row.email, context.workspaceId, context.actor.id),
  ]);
  await owner(env, principal);
  const current = await directoryMembership(env, userId);
  return {
    userId,
    admissionId: row.admission_id,
    removed: current?.removed_at !== null && current?.admission_id === row.admission_id,
  };
}

async function targetedInvitation(env: DirectoryEnvironment, identity: AccessIdentity, token: string) {
  if (identity.expiresAt <= Date.now() || identity.issuer !== configuration(env).issuer)
    throw new RequestError("Workspace identity has expired", 403);
  const row = await database(env)
    .prepare(
      "SELECT i.* FROM invites i JOIN workspaces w ON w.id = i.workspace_id WHERE i.token_hash = ? AND i.workspace_id = ? AND w.deletion_requested_at IS NULL",
    )
    .bind(await tokenHash(token), configuration(env).workspaceId)
    .first<Invitation>();
  if (
    !row ||
    row.email !== identity.email ||
    row.revoked_at ||
    (row.expires_at !== null && Date.parse(row.expires_at) <= Date.now())
  )
    throw new RequestError("This invitation is unavailable for this identity", 403);
  return row;
}

export async function inspectInvitation(env: DirectoryEnvironment, identity: AccessIdentity, token: string) {
  const row = await targetedInvitation(env, identity, token);
  const account = await accountForIdentity(env, identity);
  if (account && account.email.toLowerCase() !== identity.email)
    throw new RequestError("Identity email does not match its account", 403);
  if (
    !account &&
    (await database(env).prepare("SELECT id FROM accounts WHERE lower(email) = ?").bind(identity.email).first())
  )
    throw new RequestError("This email is already linked to another identity", 403);
  if (row.accepted_at && (!account || row.accepted_account_id !== account.id))
    throw new RequestError("This invitation has already been accepted", 403);
  if (row.accepted_at) await activeMember(env, principalForIdentity(env, identity, account!.id, row.id));
  return {
    email: row.email,
    workspaceName: configuration(env).workspaceName,
    expiresAt: row.expires_at,
    accepted: row.accepted_at !== null,
  };
}

export async function acceptInvitation(
  env: DirectoryEnvironment,
  identity: AccessIdentity,
  token: string,
): Promise<HostedPrincipal> {
  const row = await targetedInvitation(env, identity, token);
  const db = database(env);
  let account = await accountForIdentity(env, identity);
  if (account && account.email.toLowerCase() !== identity.email)
    throw new RequestError("Identity email does not match its account", 403);
  if (row.accepted_at) {
    if (!account || row.accepted_account_id !== account.id)
      throw new RequestError("This invitation has already been accepted", 403);
    const principal = principalForIdentity(env, identity, account.id, row.id);
    await activeMember(env, principal);
    return principal;
  }
  if (!account && (await db.prepare("SELECT id FROM accounts WHERE lower(email) = ?").bind(identity.email).first()))
    throw new RequestError("This email is already linked to another identity", 403);
  if (account) {
    const membership = await directoryMembership(env, account.id);
    if (membership && membership.removed_at === null) {
      const current = await targetedInvitation(env, identity, token);
      if (current.accepted_account_id === account.id && membership.admission_id === row.id) {
        const principal = principalForIdentity(env, identity, account.id, row.id);
        await activeMember(env, principal);
        return principal;
      }
      throw new RequestError("This account already has a workspace membership", 409);
    }
  }
  const accountId = account?.id ?? uuidv7();
  const now = new Date().toISOString();
  const eligible =
    "EXISTS (SELECT 1 FROM invites i JOIN workspaces w ON w.id = i.workspace_id WHERE i.id = ? AND i.workspace_id = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND (i.expires_at IS NULL OR i.expires_at > ?) AND w.deletion_requested_at IS NULL)";
  const statements: D1PreparedStatement[] = [];
  if (!account) {
    statements.push(
      db
        .prepare(
          `INSERT INTO accounts (id, email, name, created_at, updated_at) SELECT ?, ?, ?, ?, ? WHERE ${eligible}`,
        )
        .bind(accountId, identity.email, identity.name, now, now, row.id, row.workspace_id, now),
    );
    statements.push(
      db
        .prepare(
          `INSERT INTO auth_identities (id, account_id, provider, provider_user_id, created_at) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM accounts WHERE id = ?) AND ${eligible}`,
        )
        .bind(
          uuidv7(),
          accountId,
          identityProvider(identity),
          providerKey(identity),
          now,
          accountId,
          row.id,
          row.workspace_id,
          now,
        ),
    );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO workspace_members (workspace_id, account_id, role, created_at, admission_id) SELECT ?, ?, 'user', ?, ? WHERE EXISTS (SELECT 1 FROM auth_identities WHERE provider = ? AND provider_user_id = ? AND account_id = ?) AND ${eligible} ON CONFLICT(workspace_id, account_id) DO UPDATE SET removed_at = NULL, admission_id = excluded.admission_id WHERE workspace_members.removed_at IS NOT NULL`,
      )
      .bind(
        row.workspace_id,
        accountId,
        now,
        row.id,
        identityProvider(identity),
        providerKey(identity),
        accountId,
        row.id,
        row.workspace_id,
        now,
      ),
  );
  statements.push(
    db
      .prepare(
        `UPDATE invites SET accepted_at = ?, accepted_account_id = ? WHERE id = ? AND workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) AND EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = ? AND account_id = ? AND removed_at IS NULL AND role = 'user' AND admission_id = ?)`,
      )
      .bind(now, accountId, row.id, row.workspace_id, now, row.workspace_id, accountId, row.id),
  );
  try {
    await db.batch(statements);
  } catch (failure) {
    // A same-identity concurrent acceptance may win the transaction; never join by email alone.
    account = await accountForIdentity(env, identity);
    if (!account) {
      if (await db.prepare("SELECT id FROM accounts WHERE lower(email) = ?").bind(identity.email).first())
        throw new RequestError("This email is already linked to another identity", 403);
      throw failure;
    }
  }
  account = await accountForIdentity(env, identity);
  const accepted = await targetedInvitation(env, identity, token);
  if (!account || !accepted.accepted_at || accepted.accepted_account_id !== account.id)
    throw new RequestError("Invitation acceptance did not complete", 403);
  const principal = principalForIdentity(env, identity, account.id, row.id);
  await activeMember(env, principal);
  return principal;
}
