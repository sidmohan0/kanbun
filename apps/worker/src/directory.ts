import { uuidv7 } from "@kanbun/model";
import type { WorkspaceContext } from "@kanbun/sync";
import { configuration, type AccessIdentity, type AuthEnvironment, type HostedPrincipal } from "./auth";
import { RequestError } from "./requests";

export type DirectoryEnvironment = AuthEnvironment & { ACCOUNTS?: D1Database };
type Account = { id: string; email: string; name: string };

const provider = "cloudflare-access";
const providerKey = (identity: Pick<AccessIdentity, "issuer" | "subject">) =>
  JSON.stringify([identity.issuer, identity.subject]);

function database(env: DirectoryEnvironment): D1Database {
  if (!env.ACCOUNTS) throw new RequestError("Preview account directory is not configured", 503);
  return env.ACCOUNTS;
}

async function accountForIdentity(env: DirectoryEnvironment, identity: Pick<AccessIdentity, "issuer" | "subject">) {
  return database(env)
    .prepare(
      "SELECT a.id, a.email, a.name FROM auth_identities i JOIN accounts a ON a.id = i.account_id WHERE i.provider = ? AND i.provider_user_id = ?",
    )
    .bind(provider, providerKey(identity))
    .first<Account>();
}

/** First owner admission is one D1 batch; later admission never resurrects membership. */
export async function admitOwner(env: DirectoryEnvironment, identity: AccessIdentity): Promise<HostedPrincipal> {
  const config = configuration(env);
  const db = database(env);
  let account = await accountForIdentity(env, identity);
  if (!account) {
    const existing = await db.prepare("SELECT id FROM accounts WHERE email = ?").bind(identity.email).first();
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
            .bind(uuidv7(), accountId, provider, providerKey(identity), now),
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
  const principal: HostedPrincipal = {
    mode: "hosted",
    workspaceId: config.workspaceId,
    actor: { id: account.id, type: "user" },
    issuer: identity.issuer,
    subject: identity.subject,
    expiresAt: identity.expiresAt,
  };
  await activeOwner(env, principal);
  return principal;
}

/** Re-read directory authority for every request and every outbound socket notification. */
export async function activeOwner(env: DirectoryEnvironment, principal: HostedPrincipal): Promise<WorkspaceContext> {
  const config = configuration(env);
  if (
    principal.workspaceId !== config.workspaceId ||
    principal.issuer !== config.issuer ||
    principal.expiresAt <= Date.now()
  )
    throw new RequestError("Workspace identity has expired or is unavailable", 403);
  const row = await database(env)
    .prepare(
      "SELECT a.id, a.email, a.name, w.name AS workspace_name FROM accounts a JOIN auth_identities i ON i.account_id = a.id JOIN workspace_members m ON m.account_id = a.id JOIN workspaces w ON w.id = m.workspace_id WHERE a.id = ? AND a.email = ? AND i.provider = ? AND i.provider_user_id = ? AND w.id = ? AND w.deletion_requested_at IS NULL AND m.removed_at IS NULL AND m.role = 'owner'",
    )
    .bind(principal.actor.id, config.ownerEmail, provider, providerKey(principal), config.workspaceId)
    .first<Account & { workspace_name: string }>();
  if (!row) throw new RequestError("Active owner membership is required", 403);
  if (principal.expiresAt <= Date.now()) throw new RequestError("Workspace identity has expired", 403);
  return {
    mode: "hosted",
    workspaceId: config.workspaceId,
    workspaceName: row.workspace_name,
    actor: { id: row.id, type: "user" },
    name: row.name,
    email: row.email,
  };
}
