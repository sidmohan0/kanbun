import { uuidv7 } from "@kanbun/model";
import { z } from "zod";
import {
  configuration,
  emailDomain,
  mode,
  requireHostedOrigin,
  type AccessIdentity,
  type AuthEnvironment,
  type HostedPrincipal,
} from "./auth";
import { body, RequestError } from "./requests";

type Environment = AuthEnvironment & { ACCOUNTS?: D1Database };
const SESSION_COOKIE = "__Host-kanbun-session";
const LOGIN_COOKIE = "__Host-kanbun-login";
const LINK_LIFETIME_MS = 30 * 60 * 1000;
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_INACTIVITY_MS = 14 * 24 * 60 * 60 * 1000;
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const returnToSchema = z
  .string()
  .regex(
    /^#(?:issues(?:\/[A-Za-z0-9_-]+)?|invite\/[A-Za-z0-9_-]{43}|settings(?:\/integrations)?|members|inbox|my-issues)$/,
  );
const signInUnavailable = () =>
  new RequestError("This sign-in link is unavailable. Request a new one in this browser.", 401);

function database(env: Environment) {
  if (!env.ACCOUNTS) throw new RequestError("Account directory is not configured", 503);
  return env.ACCOUNTS;
}
export async function authTokenHash(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function cookie(request: Request, name: string): string | null {
  const value = request.headers
    .get("Cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  return value && tokenSchema.safeParse(value).success ? value : null;
}
function setCookie(name: string, value: string, expiresAt: number): string {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}; Max-Age=${Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))}`;
}
function clearCookie(name: string) {
  return `${name}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
}
function json(value: unknown, status = 200, cookies: string[] = []) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(JSON.stringify(value), { status, headers });
}

/** Email ownership is authentication; active membership or a targeted invitation is admission. */
async function eligible(env: Environment, email: string): Promise<boolean> {
  const config = configuration(env);
  const db = database(env);
  const workspace = await db
    .prepare("SELECT deletion_requested_at FROM workspaces WHERE id = ?")
    .bind(config.workspaceId)
    .first<{ deletion_requested_at: string | null }>();
  if (workspace?.deletion_requested_at) return false;
  if (email === config.ownerEmail.toLowerCase() && !workspace) return true;
  if (email !== config.ownerEmail.toLowerCase() && !email.endsWith(`@${emailDomain(env)}`)) return false;
  const member = await db
    .prepare(
      "SELECT m.role FROM workspace_members m JOIN accounts a ON a.id = m.account_id WHERE m.workspace_id = ? AND lower(a.email) = ? AND m.removed_at IS NULL AND m.role IN ('owner', 'user')",
    )
    .bind(config.workspaceId, email)
    .first<{ role: string }>();
  if (email === config.ownerEmail.toLowerCase()) return member?.role === "owner";
  if (member) return true;
  const invite = await db
    .prepare(
      "SELECT id FROM invites WHERE workspace_id = ? AND lower(email) = ? AND accepted_at IS NULL AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)",
    )
    .bind(config.workspaceId, email, new Date().toISOString())
    .first();
  return !!workspace && !!invite;
}

async function verifyChallenge(request: Request, env: Environment, response: string) {
  if (!env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_SITE_KEY)
    throw new RequestError("Email sign-in is not configured", 503);
  const input = new Request("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response }),
  });
  let verified: unknown;
  try {
    const result = await (env.AUTH_TURNSTILE_TRANSPORT ? env.AUTH_TURNSTILE_TRANSPORT.fetch(input) : fetch(input));
    if (!result.ok) throw new Error("Challenge provider unavailable");
    verified = await result.json();
  } catch {
    throw new RequestError("Sign-in verification is temporarily unavailable. Try again.", 503);
  }
  const challenge = z
    .object({
      success: z.literal(true),
      hostname: z.literal(new URL(configuration(env).appOrigin).hostname),
      action: z.literal("magic_link"),
    })
    .safeParse(verified);
  if (!challenge.success) throw new RequestError("Complete the sign-in verification and try again.", 400);
}

async function sendLink(env: Environment, email: string, token: string, returnTo: string) {
  if (!env.RESEND_API_KEY || !env.AUTH_FROM_EMAIL) throw new RequestError("Email sign-in is not configured", 503);
  const url = `${configuration(env).appOrigin}/#signin/${token}/${encodeURIComponent(returnTo)}`;
  const input = new Request("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.AUTH_FROM_EMAIL,
      to: [email],
      subject: "Sign in to Kanbun",
      text: `Use this link to sign in to Kanbun in the browser where you requested it:\n\n${url}\n\nThe link expires 30 minutes after your request and can be used once. If you did not request this email, you can ignore it.`,
    }),
  });
  try {
    const result = await (env.AUTH_EMAIL_TRANSPORT ? env.AUTH_EMAIL_TRANSPORT.fetch(input) : fetch(input));
    if (!result.ok) throw new Error("Email provider unavailable");
  } catch {
    throw new RequestError("Sign-in email could not be sent. Try again.", 503);
  }
}

type SessionIdentity = { id: string; account_id: string; email: string; name: string; expires_at: string };
async function sessionRow(env: Environment, sessionId: string): Promise<SessionIdentity | null> {
  return database(env)
    .prepare(
      "SELECT s.id, s.account_id, a.email, a.name, s.expires_at FROM sessions s JOIN accounts a ON a.id = s.account_id JOIN auth_identities i ON i.account_id = a.id AND i.provider = 'email' AND i.provider_user_id = lower(a.email) WHERE s.id = ? AND s.expires_at > ? AND s.last_seen_at > ?",
    )
    .bind(sessionId, new Date().toISOString(), new Date(Date.now() - SESSION_INACTIVITY_MS).toISOString())
    .first<SessionIdentity>();
}
export async function verifyEmailSession(request: Request, env: Environment): Promise<AccessIdentity> {
  const raw = cookie(request, SESSION_COOKIE);
  if (!raw) throw new RequestError("Sign in to Kanbun with your invited email.", 401);
  const row = await sessionRow(env, await authTokenHash(raw));
  if (!row) throw new RequestError("Your Kanbun sign-in has expired. Sign in again.", 401);
  return {
    issuer: configuration(env).appOrigin,
    subject: row.email.toLowerCase(),
    email: row.email.toLowerCase(),
    name: row.name,
    expiresAt: Date.parse(row.expires_at),
    provider: "email",
    sessionId: row.id,
  };
}
/** A forwarded identity or an open socket never substitutes for a live directory session. */
export async function requireEmailSession(env: Environment, principal: HostedPrincipal) {
  if (principal.provider !== "email" || !principal.sessionId)
    throw new RequestError("Native email sign-in is required", 401);
  const row = await sessionRow(env, principal.sessionId);
  if (
    !row ||
    row.account_id !== principal.actor.id ||
    row.email.toLowerCase() !== principal.subject ||
    Date.parse(row.expires_at) !== principal.expiresAt
  )
    throw new RequestError("Your Kanbun sign-in has expired. Sign in again.", 401);
}

type Link = {
  token_hash: string;
  email: string;
  expires_at: string;
  nonce_hash: string | null;
  consumed_at: string | null;
};
async function inspect(request: Request, env: Environment, token: string): Promise<Link> {
  const nonce = cookie(request, LOGIN_COOKIE);
  if (!nonce) throw signInUnavailable();
  const row = await database(env)
    .prepare("SELECT token_hash, email, expires_at, nonce_hash, consumed_at FROM magic_links WHERE token_hash = ?")
    .bind(await authTokenHash(token))
    .first<Link>();
  if (
    !row ||
    row.consumed_at ||
    Date.parse(row.expires_at) <= Date.now() ||
    row.nonce_hash !== (await authTokenHash(nonce)) ||
    !(await eligible(env, row.email))
  )
    throw signInUnavailable();
  return row;
}
async function consume(request: Request, env: Environment, token: string) {
  const link = await inspect(request, env, token);
  const rawSession = randomToken();
  const sessionId = await authTokenHash(rawSession);
  const accountId = uuidv7();
  const now = new Date().toISOString();
  const sessionExpiresAt = new Date(Date.parse(now) + SESSION_LIFETIME_MS).toISOString();
  const db = database(env);
  // D1 batches are atomic. Only the random winning claim can create its session;
  // concurrent claims cannot authenticate merely because another request consumed the link.
  const claim = "EXISTS (SELECT 1 FROM magic_links WHERE token_hash = ? AND claim_hash = ?)";
  await db.batch([
    db
      .prepare(
        "UPDATE magic_links SET consumed_at = ?, claim_hash = ? WHERE token_hash = ? AND nonce_hash = ? AND consumed_at IS NULL AND expires_at > ?",
      )
      .bind(now, sessionId, link.token_hash, link.nonce_hash, now),
    db
      .prepare(
        `INSERT INTO accounts (id,email,name,created_at,updated_at) SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE lower(email) = ?) AND ${claim}`,
      )
      .bind(accountId, link.email, link.email, now, now, link.email, link.token_hash, sessionId),
    // Deliberate migration: verified ownership of this email binds the native provider
    // to the existing account, preserving all owner/member/admission and browser queue IDs.
    db
      .prepare(
        `INSERT INTO auth_identities (id,account_id,provider,provider_user_id,created_at) SELECT ?,a.id,'email',?,? FROM accounts a WHERE lower(a.email) = ? AND ${claim} ON CONFLICT(provider,provider_user_id) DO NOTHING`,
      )
      .bind(uuidv7(), link.email, now, link.email, link.token_hash, sessionId),
    db
      .prepare(
        `INSERT INTO sessions (id,account_id,expires_at,created_at,last_seen_at) SELECT ?,a.id,?,?,? FROM accounts a JOIN auth_identities i ON i.account_id = a.id AND i.provider = 'email' AND i.provider_user_id = ? WHERE lower(a.email) = ? AND ${claim}`,
      )
      .bind(sessionId, sessionExpiresAt, now, now, link.email, link.email, link.token_hash, sessionId),
  ]);
  const session = await sessionRow(env, sessionId);
  if (!session) throw signInUnavailable();
  return json({ ok: true }, 200, [
    setCookie(SESSION_COOKIE, rawSession, Date.parse(sessionExpiresAt)),
    clearCookie(LOGIN_COOKIE),
  ]);
}

/** Native auth is public; workspace data still passes through directory admission. */
export async function authenticationRoute(request: Request, env: Environment): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/auth/")) return null;
  if (url.search) throw new RequestError("Unexpected query parameters");
  if (url.pathname === "/api/auth/config") {
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
    if (mode(env) === "local") return json({ method: "local" });
    if (env.AUTH_MODE !== "email") return json({ method: "access" });
    configuration(env);
    if (!env.TURNSTILE_SITE_KEY) throw new RequestError("Email sign-in is not configured", 503);
    const identity = await verifyEmailSession(request, env).catch((error: unknown) => {
      if (error instanceof RequestError && error.status === 401) return null;
      throw error;
    });
    return json({
      method: "email",
      authenticated: !!identity,
      ...(identity ? { email: identity.email } : {}),
      siteKey: env.TURNSTILE_SITE_KEY,
    });
  }
  if (env.AUTH_MODE !== "email") return json({ error: "Not found" }, 404);
  if (
    !["/api/auth/request", "/api/auth/inspect", "/api/auth/consume", "/api/auth/logout", "/api/auth/activity"].includes(
      url.pathname,
    )
  )
    return json({ error: "Not found" }, 404);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  requireHostedOrigin(request, env);
  if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json")
    throw new RequestError("Expected a JSON request body");
  if (url.pathname === "/api/auth/request") {
    const requestedAt = Date.now();
    const input = await body(
      z.strictObject({
        email: z
          .string()
          .trim()
          .pipe(z.email())
          .transform((email) => email.toLowerCase()),
        returnTo: returnToSchema,
        turnstileToken: z.string().min(1),
      }),
      request,
    );
    await verifyChallenge(request, env, input.turnstileToken);
    if (!env.RESEND_API_KEY || !env.AUTH_FROM_EMAIL) throw new RequestError("Email sign-in is not configured", 503);
    const token = randomToken(),
      nonce = randomToken();
    const expiresAt = requestedAt + LINK_LIFETIME_MS;
    const tokenHash = await authTokenHash(token);
    const nonceHash = await authTokenHash(nonce);
    try {
      if (await eligible(env, input.email)) {
        await database(env)
          .prepare("INSERT INTO magic_links (token_hash,email,expires_at,nonce_hash,created_at) VALUES (?,?,?,?,?)")
          .bind(
            tokenHash,
            input.email,
            new Date(expiresAt).toISOString(),
            nonceHash,
            new Date(requestedAt).toISOString(),
          )
          .run();
        await sendLink(env, input.email, token, input.returnTo);
      }
    } catch {
      // The public response must not reveal whether this address was eligible,
      // including during a provider/directory failure. Never log provider bodies or recipients.
      console.error({ event: "kanbun.auth.delivery_failed", errorId: crypto.randomUUID() });
      try {
        await database(env)
          .prepare("DELETE FROM magic_links WHERE token_hash = ? AND nonce_hash = ? AND consumed_at IS NULL")
          .bind(tokenHash, nonceHash)
          .run();
      } catch {
        console.error({ event: "kanbun.auth.delivery_cleanup_failed", errorId: crypto.randomUUID() });
      }
    }
    return json({ ok: true }, 202, [setCookie(LOGIN_COOKIE, nonce, expiresAt)]);
  }
  if (url.pathname === "/api/auth/logout") {
    await body(z.strictObject({}), request);
    const raw = cookie(request, SESSION_COOKIE);
    if (raw)
      await database(env)
        .prepare("DELETE FROM sessions WHERE id = ?")
        .bind(await authTokenHash(raw))
        .run();
    return json({ ok: true }, 200, [clearCookie(SESSION_COOKIE), clearCookie(LOGIN_COOKIE)]);
  }
  if (url.pathname === "/api/auth/activity") {
    await body(z.strictObject({}), request);
    const identity = await verifyEmailSession(request, env);
    const now = new Date().toISOString();
    const updated = await database(env)
      .prepare(
        "UPDATE sessions SET last_seen_at = CASE WHEN last_seen_at < ? THEN ? ELSE last_seen_at END WHERE id = ? AND expires_at > ? AND last_seen_at > ?",
      )
      .bind(now, now, identity.sessionId, now, new Date(Date.now() - SESSION_INACTIVITY_MS).toISOString())
      .run();
    if (!updated.meta.changes) throw new RequestError("Your Kanbun sign-in has expired. Sign in again.", 401);
    return json({ ok: true });
  }
  const { token } = await body(z.strictObject({ token: tokenSchema }), request);
  if (url.pathname === "/api/auth/inspect") {
    const row = await inspect(request, env, token);
    return json({ email: row.email, expiresAt: row.expires_at });
  }
  return consume(request, env, token);
}
