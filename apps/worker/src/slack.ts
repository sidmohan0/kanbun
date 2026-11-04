import { z } from "zod";
import type { Env } from "./index";
import { activeMember } from "./directory";
import { configuration, requireHostedOrigin, type HostedPrincipal } from "./auth";
import { authTokenHash } from "./email-auth";
import { body, query, RequestError } from "./requests";
import { slackDestinationSchema, type SlackUnfurls } from "./slack-unfurls";
import { slackIssueIdentifiers } from "./slack-replies";
import { canonicalSlackMessageUrl } from "@kanbun/mutators";
import {
  integrationCredentials,
  markIntegrationCredentialsVerified,
  workspaceCredentialsMode,
  type IntegrationAppConfig,
} from "./integration-apps";

export interface SlackEnvironment {
  SLACK_CLIENT_ID?: string;
  SLACK_CLIENT_SECRET?: string;
  SLACK_SIGNING_SECRET?: string;
  SLACK_APP_ID?: string;
  /** Optional dedicated base64-encoded 32-byte token key; self-hosted setup can use its deployment key. */
  SLACK_TOKEN_ENCRYPTION_KEY?: string;
  INTEGRATION_CREDENTIALS_ENCRYPTION_KEY?: string;
  SLACK_TRANSPORT?: Fetcher;
}
const prefix = "/api/integrations/slack";
const cookieName = "__Host-kanbun-slack";
const callbackPath = prefix + "/callback";
const scopes = ["chat:write", "links:read", "links:write"];
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
type SlackAppCredentials = IntegrationAppConfig & {
  clientId: string;
  clientSecret: string;
  appId: string;
  signingSecret: string;
};
async function appCredentials(env: Env, workspaceId: string): Promise<SlackAppCredentials | null> {
  return (await integrationCredentials(env, workspaceId, "slack", {
    clientId: env.SLACK_CLIENT_ID ?? "",
    clientSecret: env.SLACK_CLIENT_SECRET ?? "",
    appId: env.SLACK_APP_ID ?? "",
    signingSecret: env.SLACK_SIGNING_SECRET ?? "",
  })) as SlackAppCredentials | null;
}
function configured(env: SlackEnvironment, app: SlackAppCredentials | null) {
  return !!(
    app?.clientId &&
    app.clientSecret &&
    app.appId &&
    app.signingSecret &&
    (env.SLACK_TOKEN_ENCRYPTION_KEY || env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY)
  );
}
function requireAppCredentials(
  env: SlackEnvironment,
  app: SlackAppCredentials | null,
): asserts app is SlackAppCredentials {
  if (!configured(env, app))
    throw new RequestError("Configure the Slack app for this workspace before connecting.", 503);
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
      (method === "auth.revoke" ||
        method === "auth.test" ||
        method === "chat.unfurl" ||
        method === "chat.postMessage") &&
      z
        .object({ ok: z.literal(false), error: z.enum(["invalid_auth", "token_revoked", "account_inactive"]) })
        .safeParse(value).success
    )
      return method === "auth.revoke" ? { ok: true } : { ok: false };
    if (
      method === "chat.postMessage" &&
      z
        .object({
          ok: z.literal(false),
          error: z.enum(["channel_not_found", "not_in_channel", "is_archived", "thread_not_found"]),
        })
        .safeParse(value).success
    )
      return { ok: false, retired: true };
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
    const bytes = decode(env.SLACK_TOKEN_ENCRYPTION_KEY ?? env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY!);
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

export type SlackConnection = {
  workspace_id: string;
  team_id: string;
  team_name: string;
  bot_user_id: string;
  token_ciphertext: string;
  scopes: string;
  updated_at: string;
  unfurls_enabled: number;
  unfurl_generation: string;
  issue_replies_enabled: number;
  issue_reply_generation: string;
};
export async function slackConnection(env: Env, workspaceId: string) {
  return database(env)
    .prepare("SELECT * FROM slack_connections WHERE workspace_id=?")
    .bind(workspaceId)
    .first<SlackConnection>();
}
function webhookWorkspace(url: URL, suffix: "events" | "interactions", env: Env) {
  const legacy = `${prefix}/${suffix}`;
  if (url.pathname === legacy) return configuration(env).workspaceId;
  const match = new RegExp(`^${prefix}/${suffix}/([0-9a-f-]{36})$`, "i").exec(url.pathname);
  if (match && !workspaceCredentialsMode(env)) return null;
  return match ? z.uuidv7().parse(match[1]) : null;
}
async function connectionForTeam(env: Env, workspaceId: string, teamId: string) {
  return database(env)
    .prepare("SELECT * FROM slack_connections WHERE workspace_id=? AND team_id=?")
    .bind(workspaceId, teamId)
    .first<SlackConnection>();
}
export const slackVersion = (row: SlackConnection) =>
  authTokenHash(JSON.stringify([row.team_id, row.token_ciphertext, row.unfurl_generation]));
export const slackReplyVersion = (row: SlackConnection) =>
  authTokenHash(JSON.stringify([row.team_id, row.token_ciphertext, row.issue_reply_generation]));
export const slackRepliesReady = (row: SlackConnection) =>
  row.scopes.split(",").includes("channels:history") && row.scopes.split(",").includes("chat:write");
export const slackUnfurlsReady = (row: SlackConnection) =>
  ["links:read", "links:write"].every((scope) => row.scopes.split(",").includes(scope));
export async function slackStatus(env: Env, workspaceId: string) {
  const row = await slackConnection(env, workspaceId);
  const app = await appCredentials(env, workspaceId);
  return {
    configured: configured(env, app),
    connection: row
      ? {
          teamId: row.team_id,
          teamName: row.team_name,
          updatedAt: row.updated_at,
          unfurlsEnabled: !!row.unfurls_enabled,
          reauthorizationRequired: !slackUnfurlsReady(row),
          issueRepliesEnabled: !!row.issue_replies_enabled,
          issueRepliesReauthorizationRequired: !!row.issue_replies_enabled && !slackRepliesReady(row),
        }
      : null,
  };
}
export const slackCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("connect"),
    teamId: z.string(),
    teamName: z.string(),
    botUserId: z.string(),
    token: z.string(),
    scopes: z.string(),
  }),
  z.strictObject({ kind: z.literal("disconnect") }),
  z.strictObject({ kind: z.literal("configure"), enabled: z.boolean() }),
  z.strictObject({ kind: z.literal("configureIssueReplies"), enabled: z.boolean() }),
]);
export async function slackCommand(env: Env, principal: HostedPrincipal, command: z.infer<typeof slackCommandSchema>) {
  const row = await slackConnection(env, principal.workspaceId);
  if (command.kind === "connect") {
    if (row && row.team_id !== command.teamId)
      throw new RequestError("Disconnect the current Slack workspace before connecting another.", 409);
    const sealed = await sealSlackToken(env, principal.workspaceId, command.token);
    if ((await activeMember(env, principal)).role !== "owner")
      throw new RequestError("Workspace owner access required", 403);
    const saved = await database(env)
      .prepare(
        "INSERT INTO slack_connections(workspace_id,team_id,team_name,bot_user_id,token_ciphertext,scopes,connected_by,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET team_name=excluded.team_name,bot_user_id=excluded.bot_user_id,token_ciphertext=excluded.token_ciphertext,scopes=excluded.scopes,connected_by=excluded.connected_by,updated_at=excluded.updated_at WHERE slack_connections.team_id=excluded.team_id",
      )
      .bind(
        principal.workspaceId,
        command.teamId,
        command.teamName,
        command.botUserId,
        sealed,
        command.scopes,
        principal.actor.id,
        new Date().toISOString(),
      )
      .run();
    if (saved.meta.changes !== 1)
      throw new RequestError("Disconnect the current Slack workspace before connecting another.", 409);
  } else if (command.kind === "configure") {
    if (!row) throw new RequestError("Connect Slack before configuring link previews", 409);
    await database(env)
      .prepare("UPDATE slack_connections SET unfurls_enabled=?,unfurl_generation=? WHERE workspace_id=?")
      .bind(command.enabled ? 1 : 0, crypto.randomUUID(), principal.workspaceId)
      .run();
  } else if (command.kind === "configureIssueReplies") {
    if (!row) throw new RequestError("Connect Slack before configuring issue replies", 409);
    await database(env)
      .prepare("UPDATE slack_connections SET issue_replies_enabled=?,issue_reply_generation=? WHERE workspace_id=?")
      .bind(command.enabled ? 1 : 0, crypto.randomUUID(), principal.workspaceId)
      .run();
  } else if (row) {
    await api(env, "auth.revoke", { token: await openSlackToken(env, principal.workspaceId, row.token_ciphertext) });
    await database(env)
      .prepare("DELETE FROM slack_connections WHERE workspace_id=? AND token_ciphertext=?")
      .bind(principal.workspaceId, row.token_ciphertext)
      .run();
  }
  return slackStatus(env, principal.workspaceId);
}
type SlackRpcResult<T> = { ok: true; value: T } | { ok: false; error: string; status: number };
export async function slackRpc<T>(action: () => Promise<T>): Promise<SlackRpcResult<T>> {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    return {
      ok: false,
      status: error instanceof RequestError ? error.status : 500,
      error: error instanceof RequestError ? error.message : "Slack operation could not be completed",
    };
  }
}
async function rpcValue<T>(promise: Promise<SlackRpcResult<T>>) {
  const result = await promise;
  if (!result.ok) throw new RequestError(result.error, result.status);
  return result.value;
}
export async function slackUninstall(env: Env, workspaceId: string, teamId: string) {
  const row = await slackConnection(env, workspaceId);
  if (!row || row.team_id !== teamId) return;
  const token = await openSlackToken(env, workspaceId, row.token_ciphertext);
  const status = z.object({ ok: z.boolean() }).parse(await api(env, "auth.test", { token }));
  if (!status.ok)
    await database(env)
      .prepare("DELETE FROM slack_connections WHERE workspace_id=? AND token_ciphertext=?")
      .bind(workspaceId, row.token_ciphertext)
      .run();
}
/** Called in the same DO queue as connection changes. Resolve issue visibility after credential I/O. */
export async function sendSlackUnfurls(
  env: Env,
  workspaceId: string,
  teamId: string,
  version: string,
  destination: z.infer<typeof slackDestinationSchema>,
  resolve: () => SlackUnfurls,
) {
  const row = await slackConnection(env, workspaceId);
  if (
    !row ||
    row.team_id !== teamId ||
    !row.unfurls_enabled ||
    !slackUnfurlsReady(row) ||
    (await slackVersion(row)) !== version
  )
    return;
  const token = await openSlackToken(env, workspaceId, row.token_ciphertext);
  const unfurls = resolve();
  if (!Object.keys(unfurls).length) return;
  const result = z.object({ ok: z.boolean() }).parse(
    await api(env, "chat.unfurl", {
      token,
      unfurls: JSON.stringify(unfurls),
      ...(destination.kind === "message"
        ? { channel: destination.channel, ts: destination.ts }
        : { unfurl_id: destination.id, source: destination.source }),
    }),
  );
  if (!result.ok)
    await database(env)
      .prepare("DELETE FROM slack_connections WHERE workspace_id=? AND token_ciphertext=?")
      .bind(workspaceId, row.token_ciphertext)
      .run();
}
async function connect(env: Env, principal: HostedPrincipal) {
  const app = await appCredentials(env, principal.workspaceId);
  requireAppCredentials(env, app);
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
  const connection = await slackConnection(env, principal.workspaceId);
  url.search = new URLSearchParams({
    client_id: app.clientId,
    scope: [...scopes, ...(connection?.issue_replies_enabled ? ["channels:history"] : [])].join(","),
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
        location: configuration(env).appOrigin + "/#settings/integrations",
        "cache-control": "no-store",
        "set-cookie": `${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`,
      },
    });
  const app = await appCredentials(env, principal.workspaceId);
  requireAppCredentials(env, app);
  if (!input.code) throw unavailable();
  let grant: unknown;
  try {
    grant = await api(env, "oauth.v2.access", {
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code: input.code,
      redirect_uri: configuration(env).appOrigin + callbackPath,
    });
  } catch {
    throw new RequestError(
      "Slack rejected the app credentials or callback URL. Check its OAuth settings and reconnect.",
      503,
    );
  }
  const slackGrantSchema = z.object({
    access_token: z.string().min(1),
    token_type: z.literal("bot"),
    app_id: z.string(),
    scope: z.string(),
    team: z.object({ id: z.string().regex(/^T[A-Z0-9]+$/), name: z.string().min(1) }),
    bot_user_id: z.string().min(1),
    is_enterprise_install: z.literal(false),
    refresh_token: z.never().optional(),
  });
  let result: z.infer<typeof slackGrantSchema>;
  try {
    result = slackGrantSchema.parse(grant);
  } catch {
    throw new RequestError("Slack returned an incomplete authorization. Check the app scopes and reconnect.", 503);
  }
  if (result.app_id !== app.appId || !scopes.every((scope) => result.scope.split(",").includes(scope)))
    throw new RequestError("Slack app identity or scopes do not match. Check its settings and reconnect.", 503);
  await rpcValue(
    env.WORKSPACES.getByName(principal.workspaceId).slackConnectionCommand(principal, {
      kind: "connect",
      teamId: result.team.id,
      teamName: result.team.name,
      botUserId: result.bot_user_id,
      token: result.access_token,
      scopes: result.scope,
    }),
  );
  await markIntegrationCredentialsVerified(env, principal.workspaceId, "slack", app);
  return new Response(null, {
    status: 303,
    headers: {
      location: configuration(env).appOrigin + "/#settings/integrations",
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
    return json(await slackStatus(env, principal.workspaceId));
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  requireHostedOrigin(request, env);
  if (url.pathname === prefix + "/issue-replies") {
    const value = await body(z.strictObject({ enabled: z.boolean() }), request);
    return json(
      await rpcValue(
        env.WORKSPACES.getByName(principal.workspaceId).slackConnectionCommand(principal, {
          kind: "configureIssueReplies",
          ...value,
        }),
      ),
    );
  }
  if (url.pathname === prefix + "/unfurls") {
    const value = await body(z.strictObject({ enabled: z.boolean() }), request);
    return json(
      await rpcValue(
        env.WORKSPACES.getByName(principal.workspaceId).slackConnectionCommand(principal, {
          kind: "configure",
          ...value,
        }),
      ),
    );
  }
  await body(z.strictObject({}), request);
  if (url.pathname === prefix + "/connect") return connect(env, principal);
  if (url.pathname === prefix + "/disconnect") {
    await rpcValue(
      env.WORKSPACES.getByName(principal.workspaceId).slackConnectionCommand(principal, { kind: "disconnect" }),
    );
    return json({ ok: true });
  }
  return json({ error: "Not found" }, 404);
}
/** Authenticate the raw bytes before parsing even URL-verification requests. */
export async function slackEventRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const workspaceId = webhookWorkspace(url, "events", env);
  if (!workspaceId) return null;
  if (env.BACKUP_RESTORE_ISOLATED === "true") throw unavailable();
  const app = await appCredentials(env, workspaceId);
  if (!app?.signingSecret) throw unavailable();
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
    new TextEncoder().encode(app.signingSecret),
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
      event_id: z.string().min(1).optional(),
      event: z.object({ type: z.string() }).optional(),
    })
    .parse(JSON.parse(raw));
  if (input.type === "url_verification" && input.challenge) {
    if (input.api_app_id && input.api_app_id !== app.appId) throw new RequestError("Slack app does not match", 403);
    return json({ challenge: input.challenge });
  }
  if (input.api_app_id !== app.appId) throw new RequestError("Slack app does not match", 403);
  if (input.type === "event_callback" && input.event?.type === "app_uninstalled" && input.team_id) {
    const connection = await connectionForTeam(env, workspaceId, input.team_id);
    if (connection) {
      await rpcValue(
        env.WORKSPACES.getByName(connection.workspace_id).slackUninstalled(connection.workspace_id, connection.team_id),
      );
    }
  }
  if (input.type === "event_callback" && input.event?.type === "link_shared" && input.team_id && input.event_id) {
    const event = z
      .object({
        event: z.object({
          channel: z.string(),
          message_ts: z.string(),
          unfurl_id: z.string().optional(),
          source: z.enum(["composer", "conversations_history"]).optional(),
          links: z.array(z.object({ url: z.string() })),
        }),
      })
      .parse(JSON.parse(raw)).event;
    const destination = slackDestinationSchema.safeParse(
      event.unfurl_id && event.source
        ? { kind: "unfurl", id: event.unfurl_id, source: event.source }
        : { kind: "message", channel: event.channel, ts: event.message_ts },
    );
    if (!destination.success) return json({ ok: true });
    const connection = await connectionForTeam(env, workspaceId, input.team_id);
    if (connection)
      await rpcValue(
        env.WORKSPACES.getByName(connection.workspace_id).slackUnfurl(connection.workspace_id, {
          eventId: input.event_id,
          teamId: input.team_id,
          version: await slackVersion(connection),
          destination: destination.data,
          urls: event.links.map((link) => link.url),
        }),
      );
  }
  if (input.type === "event_callback" && input.event?.type === "message" && input.team_id && input.event_id) {
    const event = z
      .object({
        event: z.object({
          channel_type: z.string().optional(),
          channel: z.string().optional(),
          user: z.string().optional(),
          text: z.string().optional(),
          ts: z.string().optional(),
          thread_ts: z.string().optional(),
          subtype: z.unknown().optional(),
          bot_id: z.unknown().optional(),
          bot_profile: z.unknown().optional(),
          app_id: z.unknown().optional(),
          edited: z.unknown().optional(),
        }),
      })
      .parse(JSON.parse(raw)).event;
    if (
      event.channel_type !== "channel" ||
      !event.channel ||
      !/^C[A-Z0-9]+$/.test(event.channel) ||
      !event.user ||
      !/^U[A-Z0-9]+$/.test(event.user) ||
      event.subtype !== undefined ||
      event.bot_id !== undefined ||
      event.bot_profile !== undefined ||
      event.user === "USLACKBOT" ||
      event.app_id !== undefined ||
      event.edited !== undefined ||
      !event.text ||
      !event.ts ||
      !/^\d+\.\d{6}$/.test(event.ts) ||
      (event.thread_ts !== undefined && !/^\d+\.\d{6}$/.test(event.thread_ts))
    )
      return json({ ok: true });
    const identifiers = slackIssueIdentifiers(event.text);
    if (!identifiers.length) return json({ ok: true });
    const connection = await connectionForTeam(env, workspaceId, input.team_id);
    if (connection && event.user !== connection.bot_user_id)
      await rpcValue(
        env.WORKSPACES.getByName(connection.workspace_id).slackIssueReplies(connection.workspace_id, {
          eventId: input.event_id,
          teamId: input.team_id,
          version: await slackReplyVersion(connection),
          channel: event.channel,
          thread: event.thread_ts ?? event.ts,
          identifiers,
        }),
      );
  }
  return json({ ok: true });
}

/** Signed Slack message shortcut. Linking is completed in Kanbun, where the active member is verified. */
export async function slackInteractionRoute(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response | null> {
  const url = new URL(request.url);
  const workspaceId = webhookWorkspace(url, "interactions", env);
  if (!workspaceId) return null;
  if (env.BACKUP_RESTORE_ISOLATED === "true") throw unavailable();
  const app = await appCredentials(env, workspaceId);
  if (!app?.signingSecret) throw unavailable();
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";
  const signature = request.headers.get("x-slack-signature") ?? "";
  if (
    !/^\d+$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
    !/^v0=[a-f0-9]{64}$/.test(signature)
  )
    throw new RequestError("Invalid Slack signature", 403);
  const raw = await request.text();
  if (raw.length > 64 * 1024) throw new RequestError("Slack action is too large", 413);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(app.signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const bytes = Uint8Array.from(signature.slice(3).match(/../g)!, (v) => parseInt(v, 16));
  if (!(await crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(`v0:${timestamp}:${raw}`))))
    throw new RequestError("Invalid Slack signature", 403);
  const form = new URLSearchParams(raw);
  const encoded = form.get("payload");
  if (!encoded || [...form.keys()].some((field) => field !== "payload"))
    throw new RequestError("Invalid Slack action", 400);
  const payload = z
    .object({
      type: z.enum(["message_action", "message_shortcut"]),
      api_app_id: z.string(),
      team: z.object({ id: z.string().regex(/^T[A-Z0-9]+$/) }),
      user: z.object({ id: z.string().regex(/^U[A-Z0-9]+$/) }),
      channel: z.object({ id: z.string().regex(/^[CGD][A-Z0-9]+$/) }),
      message_ts: z
        .string()
        .regex(/^\d+\.\d{6}$/)
        .optional(),
      message: z.object({ ts: z.string().regex(/^\d+\.\d{6}$/) }).optional(),
      response_url: z.string().url(),
    })
    .parse(JSON.parse(encoded));
  if (payload.api_app_id !== app.appId) throw new RequestError("Slack app does not match", 403);
  const ts = payload.message_ts ?? payload.message?.ts;
  if (!ts) return json({});
  const connection = await connectionForTeam(env, workspaceId, payload.team.id);
  const responseUrl = new URL(payload.response_url);
  if (
    responseUrl.protocol !== "https:" ||
    responseUrl.hostname !== "hooks.slack.com" ||
    responseUrl.port ||
    responseUrl.username ||
    responseUrl.password ||
    responseUrl.hash ||
    responseUrl.search ||
    !responseUrl.pathname.startsWith("/actions/")
  )
    throw new RequestError("Invalid Slack response URL", 400);
  ctx.waitUntil(
    (async () => {
      let message: Record<string, unknown>;
      try {
        if (!connection) throw new Error("not_connected");
        const token = await openSlackToken(env, connection.workspace_id, connection.token_ciphertext);
        const permalink = z
          .object({ ok: z.literal(true), permalink: z.string().url() })
          .parse(await api(env, "chat.getPermalink", { token, channel: payload.channel.id, message_ts: ts })).permalink;
        const safe = canonicalSlackMessageUrl(permalink);
        const url = new URL(configuration(env).appOrigin);
        url.hash = `slack-link?url=${encodeURIComponent(safe)}`;
        const prompt =
          "Choose an existing Kanbun issue. Your Kanbun sign-in and team access are checked before the link is saved.";
        message = {
          response_type: "ephemeral",
          text: prompt,
          blocks: [
            {
              type: "section",
              text: { type: "mrkdwn", text: prompt },
            },
            {
              type: "actions",
              elements: [{ type: "button", text: { type: "plain_text", text: "Choose an issue" }, url: url.href }],
            },
          ],
        };
      } catch {
        message = {
          response_type: "ephemeral",
          text: connection
            ? "Could not open this message link. Paste its Slack URL into Kanbun instead."
            : "Connect this Slack workspace to Kanbun first.",
        };
      }
      try {
        const request = new Request(responseUrl.href, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(message),
        });
        const response = await (env.SLACK_TRANSPORT ? env.SLACK_TRANSPORT.fetch(request) : fetch(request));
        if (!response.ok) console.error("slack_interaction_response_failed");
      } catch {
        console.error("slack_interaction_response_failed");
      }
    })(),
  );
  return json({});
}

/** Serialized with connection mutations; resolve current public issue only after credential I/O. */
export async function sendSlackReply(
  env: Env,
  workspaceId: string,
  teamId: string,
  version: string,
  channel: string,
  thread: string,
  resolve: () => string | null,
): Promise<boolean> {
  const row = await slackConnection(env, workspaceId);
  if (
    !row ||
    row.team_id !== teamId ||
    !row.issue_replies_enabled ||
    !slackRepliesReady(row) ||
    (await slackReplyVersion(row)) !== version
  )
    return false;
  const token = await openSlackToken(env, workspaceId, row.token_ciphertext);
  const text = resolve();
  if (!text) return false;
  const result = z.object({ ok: z.boolean(), retired: z.boolean().optional() }).parse(
    await api(env, "chat.postMessage", {
      token,
      channel,
      thread_ts: thread,
      text,
      mrkdwn: "false",
      unfurl_links: "false",
      unfurl_media: "false",
      reply_broadcast: "false",
    }),
  );
  if (!result.ok && !result.retired)
    await database(env)
      .prepare("DELETE FROM slack_connections WHERE workspace_id=? AND token_ciphertext=?")
      .bind(workspaceId, row.token_ciphertext)
      .run();
  return result.ok;
}
