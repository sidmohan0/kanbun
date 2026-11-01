import { z } from "zod";
import type { Env } from "./index";
import { activeMember } from "./directory";
import { configuration, requireHostedOrigin, type HostedPrincipal } from "./auth";
import { authTokenHash } from "./email-auth";
import { body, query, RequestError } from "./requests";

export interface SlackEnvironment {
  SLACK_CLIENT_ID?: string;
  SLACK_CLIENT_SECRET?: string;
  SLACK_SIGNING_SECRET?: string;
  SLACK_APP_ID?: string;
  /** Base64-encoded, independently generated 32-byte AES key. */
  SLACK_TOKEN_ENCRYPTION_KEY?: string;
  SLACK_TRANSPORT?: Fetcher;
}
const prefix = "/api/integrations/slack";
const cookieName = "__Host-kanbun-slack";
const callbackPath = prefix + "/callback";
const scopes = ["chat:write"];
const unavailable = () => new RequestError("Slack connection could not be completed. Try again.", 503);
const json = (value: unknown, status = 200, cookie?: string) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      ...(cookie ? { "set-cookie": cookie } : {}),
    },
  });
function configured(env: SlackEnvironment) {
  return !!(
    env.SLACK_CLIENT_ID &&
    env.SLACK_CLIENT_SECRET &&
    env.SLACK_APP_ID &&
    env.SLACK_SIGNING_SECRET &&
    env.SLACK_TOKEN_ENCRYPTION_KEY
  );
}
function database(env: Env) {
  if (!env.ACCOUNTS) throw unavailable();
  return env.ACCOUNTS;
}
async function api(env: SlackEnvironment, method: string, values: Record<string, string>) {
  try {
    const request = new Request(`https://slack.com/api/${method}`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(values),
    });
    const result = await (env.SLACK_TRANSPORT ? env.SLACK_TRANSPORT.fetch(request) : fetch(request));
    if (!result.ok) throw unavailable();
    const value: unknown = await result.json();
    if (
      (method === "auth.revoke" || method === "auth.test") &&
      z.object({ ok: z.literal(false), error: z.enum(["invalid_auth", "token_revoked"]) }).safeParse(value).success
    )
      return method === "auth.revoke" ? { ok: true } : { ok: false };
    if (!z.object({ ok: z.literal(true) }).safeParse(value).success) throw unavailable();
    return value;
  } catch {
    throw unavailable();
  }
}
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
async function encryptionKey(env: SlackEnvironment) {
  try {
    const bytes = decode(env.SLACK_TOKEN_ENCRYPTION_KEY!);
    if (bytes.length !== 32) throw unavailable();
    return await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  } catch {
    throw unavailable();
  }
}
export async function sealSlackToken(env: SlackEnvironment, workspaceId: string, token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const value = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(workspaceId) },
    await encryptionKey(env),
    new TextEncoder().encode(token),
  );
  return `${encode(iv)}.${encode(new Uint8Array(value))}`;
}
export async function openSlackToken(env: SlackEnvironment, workspaceId: string, sealed: string) {
  try {
    const [iv, value, extra] = sealed.split(".");
    if (!iv || !value || extra) throw unavailable();
    return new TextDecoder().decode(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: decode(iv), additionalData: new TextEncoder().encode(workspaceId) },
        await encryptionKey(env),
        decode(value),
      ),
    );
  } catch {
    throw unavailable();
  }
}
const binding = (principal: HostedPrincipal) =>
  JSON.stringify({ workspaceId: principal.workspaceId, accountId: principal.actor.id, sessionId: principal.sessionId });
async function connect(env: Env, principal: HostedPrincipal) {
  if (!configured(env)) throw unavailable();
  if (!principal.sessionId) throw new RequestError("Native email sign-in is required to connect Slack", 401);
  await encryptionKey(env);
  const state = encode(crypto.getRandomValues(new Uint8Array(32)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  await database(env)
    .prepare("INSERT INTO oauth_states(state,provider,redirect_to,expires_at) VALUES (?,'slack-integration',?,?)")
    .bind(await authTokenHash(state), binding(principal), new Date(principal.expiresAt).toISOString())
    .run();
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.search = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID!,
    scope: scopes.join(","),
    state,
    redirect_uri: configuration(env).appOrigin + callbackPath,
  }).toString();
  return json(
    { url: url.href },
    200,
    `${cookieName}=${state}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor((principal.expiresAt - Date.now()) / 1000))}`,
  );
}
async function callback(request: Request, env: Env, principal: HostedPrincipal) {
  const input = query(
    z.strictObject({
      state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      code: z.string().min(1).optional(),
      error: z.string().optional(),
    }),
    new URL(request.url),
  );
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1);
  if (cookie !== input.state)
    throw new RequestError("Slack authorization does not match this browser. Connect again.", 403);
  const stateHash = await authTokenHash(input.state);
  const row = await database(env)
    .prepare(
      "DELETE FROM oauth_states WHERE state=? AND provider='slack-integration' AND redirect_to=? AND expires_at>? RETURNING state",
    )
    .bind(stateHash, binding(principal), new Date().toISOString())
    .first();
  if (!row) throw new RequestError("Slack authorization expired or belongs to another session. Connect again.", 403);
  if (input.error)
    return new Response(null, {
      status: 303,
      headers: {
        location: configuration(env).appOrigin + "/#settings",
        "cache-control": "no-store",
        "set-cookie": `${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`,
      },
    });
  if (!configured(env) || !input.code) throw unavailable();
  const result = z
    .object({
      access_token: z.string().min(1),
      token_type: z.literal("bot"),
      app_id: z.string(),
      scope: z.string(),
      team: z.object({ id: z.string().regex(/^T[A-Z0-9]+$/), name: z.string().min(1) }),
      bot_user_id: z.string().min(1),
      is_enterprise_install: z.literal(false),
      refresh_token: z.never().optional(),
    })
    .parse(
      await api(env, "oauth.v2.access", {
        client_id: env.SLACK_CLIENT_ID!,
        client_secret: env.SLACK_CLIENT_SECRET!,
        code: input.code,
        redirect_uri: configuration(env).appOrigin + callbackPath,
      }),
    );
  if (result.app_id !== env.SLACK_APP_ID || !scopes.every((scope) => result.scope.split(",").includes(scope)))
    throw unavailable();
  const existing = await database(env)
    .prepare("SELECT team_id FROM slack_connections WHERE workspace_id=?")
    .bind(principal.workspaceId)
    .first<{ team_id: string }>();
  if (existing && existing.team_id !== result.team.id)
    throw new RequestError("Disconnect the current Slack workspace before connecting another.", 409);
  const sealed = await sealSlackToken(env, principal.workspaceId, result.access_token);
  if ((await activeMember(env, principal)).role !== "owner")
    throw new RequestError("Workspace ownership is required", 403);
  const saved = await database(env)
    .prepare(
      "INSERT INTO slack_connections(workspace_id,team_id,team_name,bot_user_id,token_ciphertext,scopes,connected_by,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET team_name=excluded.team_name,bot_user_id=excluded.bot_user_id,token_ciphertext=excluded.token_ciphertext,scopes=excluded.scopes,connected_by=excluded.connected_by,updated_at=excluded.updated_at WHERE slack_connections.team_id=excluded.team_id",
    )
    .bind(
      principal.workspaceId,
      result.team.id,
      result.team.name,
      result.bot_user_id,
      sealed,
      result.scope,
      principal.actor.id,
      new Date().toISOString(),
    )
    .run();
  if (saved.meta.changes !== 1)
    throw new RequestError("Disconnect the current Slack workspace before connecting another.", 409);
  return new Response(null, {
    status: 303,
    headers: {
      location: configuration(env).appOrigin + "/#settings",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "set-cookie": `${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`,
    },
  });
}
export async function slackRoute(request: Request, env: Env, principal: HostedPrincipal): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(prefix)) return null;
  if (env.BACKUP_RESTORE_ISOLATED === "true")
    throw new RequestError("Slack is disabled on isolated recovery targets", 503);
  if ((await activeMember(env, principal)).role !== "owner")
    throw new RequestError("Workspace ownership is required", 403);
  if (url.pathname === callbackPath && request.method === "GET") return callback(request, env, principal);
  query(z.strictObject({}), url);
  if (url.pathname === prefix && request.method === "GET") {
    const connection = await database(env)
      .prepare(
        "SELECT team_id AS teamId,team_name AS teamName,updated_at AS updatedAt FROM slack_connections WHERE workspace_id=?",
      )
      .bind(principal.workspaceId)
      .first();
    return json({ configured: configured(env), connection });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  requireHostedOrigin(request, env);
  await body(z.strictObject({}), request);
  if (url.pathname === prefix + "/connect") return connect(env, principal);
  if (url.pathname === prefix + "/disconnect") {
    const row = await database(env)
      .prepare("SELECT token_ciphertext FROM slack_connections WHERE workspace_id=?")
      .bind(principal.workspaceId)
      .first<{ token_ciphertext: string }>();
    if (row) {
      await api(env, "auth.revoke", { token: await openSlackToken(env, principal.workspaceId, row.token_ciphertext) });
      await database(env)
        .prepare("DELETE FROM slack_connections WHERE workspace_id=? AND token_ciphertext=?")
        .bind(principal.workspaceId, row.token_ciphertext)
        .run();
    }
    return json({ ok: true });
  }
  return json({ error: "Not found" }, 404);
}
/** Authenticate the raw bytes before parsing even URL-verification requests. */
export async function slackEventRoute(request: Request, env: Env): Promise<Response | null> {
  if (new URL(request.url).pathname !== prefix + "/events") return null;
  if (env.BACKUP_RESTORE_ISOLATED === "true" || !env.SLACK_SIGNING_SECRET) throw unavailable();
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";
  const signature = request.headers.get("x-slack-signature") ?? "";
  // Slack's signing contract permits five minutes of clock skew.
  if (
    !/^\d+$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
    !/^v0=[a-f0-9]{64}$/.test(signature)
  )
    throw new RequestError("Invalid Slack signature", 403);
  const raw = await request.text();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SLACK_SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const bytes = Uint8Array.from(signature.slice(3).match(/../g)!, (v) => parseInt(v, 16));
  if (!(await crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(`v0:${timestamp}:${raw}`))))
    throw new RequestError("Invalid Slack signature", 403);
  const input = z
    .object({
      type: z.string(),
      challenge: z.string().optional(),
      api_app_id: z.string().optional(),
      team_id: z.string().optional(),
      event_time: z.number().int().positive().optional(),
      event: z.object({ type: z.string() }).optional(),
    })
    .parse(JSON.parse(raw));
  if (input.type === "url_verification" && input.challenge) return json({ challenge: input.challenge });
  if (input.api_app_id !== env.SLACK_APP_ID) throw new RequestError("Slack app does not match", 403);
  if (input.type === "event_callback" && input.event?.type === "app_uninstalled" && input.team_id && input.event_time) {
    const connection = await database(env)
      .prepare("SELECT workspace_id,token_ciphertext,updated_at FROM slack_connections WHERE team_id=?")
      .bind(input.team_id)
      .first<{ workspace_id: string; token_ciphertext: string; updated_at: string }>();
    if (connection && Date.parse(connection.updated_at) <= input.event_time * 1000 + 999) {
      // Slack event timestamps have second precision. Probe the stored token so an old
      // uninstall cannot remove a valid reconnection from the same second.
      const token = await openSlackToken(env, connection.workspace_id, connection.token_ciphertext);
      const status = z.object({ ok: z.boolean() }).parse(await api(env, "auth.test", { token }));
      if (!status.ok)
        await database(env)
          .prepare("DELETE FROM slack_connections WHERE workspace_id=? AND token_ciphertext=?")
          .bind(connection.workspace_id, connection.token_ciphertext)
          .run();
    }
  }
  return json({ ok: true });
}
