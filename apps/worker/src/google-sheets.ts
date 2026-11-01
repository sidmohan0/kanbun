import { z } from "zod";
import type { Store } from "@kanbun/sync";
import type { Env } from "./index";
import { configuration, requireHostedOrigin, type HostedPrincipal } from "./auth";
import { activeMember } from "./directory";
import { authTokenHash } from "./email-auth";
import { body, query, RequestError } from "./requests";
import { sheetsExport, sheetsWriteRequests } from "./sheets-export";

export interface GoogleSheetsEnvironment {
  GOOGLE_SHEETS_CLIENT_ID?: string;
  GOOGLE_SHEETS_CLIENT_SECRET?: string;
  /** Base64-encoded 32-byte AES key stored as a Worker secret. */
  GOOGLE_SHEETS_TOKEN_KEY?: string;
  GOOGLE_SHEETS_TRANSPORT?: Fetcher;
}
export const SHEETS_JOB = "google-sheets-sync";
/** Hourly refresh is part of the integration's requested behavior. */
export const SHEETS_INTERVAL = 60 * 60 * 1000;
const prefix = "/api/integrations/google-sheets";
const callbackPath = prefix + "/callback";
const cookieName = "__Host-kanbun-google-sheets";
const scope = "https://www.googleapis.com/auth/drive.file";
type Connection = {
  refresh_token: string;
  spreadsheet_id: string | null;
  projects_enabled: number;
  last_synced_seq: string | null;
  last_synced_at: string | null;
  error: string | null;
};
const configured = (env: Env) =>
  !!(env.ACCOUNTS && env.GOOGLE_SHEETS_CLIENT_ID && env.GOOGLE_SHEETS_CLIENT_SECRET && env.GOOGLE_SHEETS_TOKEN_KEY);
const unavailable = () => new RequestError("Google Sheets could not be updated. Try again or reconnect Google.", 503);
function database(env: Env) {
  if (!env.ACCOUNTS) throw unavailable();
  return env.ACCOUNTS;
}
function response(value: unknown, status = 200, cookie?: string) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      ...(cookie ? { "Set-Cookie": cookie } : {}),
    },
  });
}
const base64 = (value: Uint8Array) => btoa(String.fromCharCode(...value));
const random = () =>
  base64(crypto.getRandomValues(new Uint8Array(32)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
async function tokenKey(env: Env) {
  const bytes = Uint8Array.from(atob(env.GOOGLE_SHEETS_TOKEN_KEY ?? ""), (c) => c.charCodeAt(0));
  if (bytes.length !== 32) throw unavailable();
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encryptToken(env: Env, workspaceId: string, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(workspaceId) },
    await tokenKey(env),
    new TextEncoder().encode(value),
  );
  return base64(iv) + "." + base64(new Uint8Array(encrypted));
}
async function decryptToken(env: Env, workspaceId: string, value: string) {
  const [iv, data] = value.split(".");
  if (!iv || !data) throw unavailable();
  const bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes(iv), additionalData: new TextEncoder().encode(workspaceId) },
      await tokenKey(env),
      bytes(data),
    ),
  );
}
async function transport(env: Env, url: string, init: RequestInit) {
  const request = new Request(url, { ...init, redirect: "manual" });
  const result = await (env.GOOGLE_SHEETS_TRANSPORT ? env.GOOGLE_SHEETS_TRANSPORT.fetch(request) : fetch(request));
  if (!result.ok) throw unavailable();
  return result;
}
async function tokenRequest(env: Env, input: Record<string, string>) {
  const result = await transport(env, "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_SHEETS_CLIENT_ID!,
      client_secret: env.GOOGLE_SHEETS_CLIENT_SECRET!,
      ...input,
    }),
  });
  return z
    .object({
      access_token: z.string().min(1),
      refresh_token: z.string().min(1).optional(),
      scope: z.string().optional(),
    })
    .parse(await result.json());
}
async function google(env: Env, token: string, path: string, input: object) {
  const result = await transport(env, "https://sheets.googleapis.com/v4/spreadsheets" + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return result.json();
}
export async function sheetsConnection(env: Env, workspaceId: string) {
  return database(env)
    .prepare("SELECT * FROM google_sheets_connections WHERE workspace_id = ?")
    .bind(workspaceId)
    .first<Connection>();
}
export async function sheetsStatus(env: Env, workspaceId: string) {
  const row = env.ACCOUNTS ? await sheetsConnection(env, workspaceId) : null;
  return {
    configured: configured(env),
    connected: !!row,
    spreadsheetUrl: row?.spreadsheet_id ? `https://docs.google.com/spreadsheets/d/${row.spreadsheet_id}/edit` : null,
    projectsEnabled: !!row?.projects_enabled,
    lastSyncedAt: row?.last_synced_at ?? null,
    error: row?.error ?? null,
  };
}
export const sheetsCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("connect"), token: z.string().min(1) }),
  z.strictObject({ kind: z.literal("configure"), projectsEnabled: z.boolean() }),
  z.strictObject({ kind: z.literal("sync") }),
  z.strictObject({ kind: z.literal("disconnect") }),
]);
/** Called only within the DO's serialized integration command queue. */
export async function sheetsCommand(env: Env, workspaceId: string, input: z.infer<typeof sheetsCommandSchema>) {
  if (input.kind === "connect") {
    // Reauthorization preserves the file and configured object types.
    await database(env)
      .prepare(
        "INSERT INTO google_sheets_connections (workspace_id,refresh_token) VALUES (?,?) ON CONFLICT(workspace_id) DO UPDATE SET refresh_token=excluded.refresh_token,error=NULL,last_synced_seq=NULL",
      )
      .bind(workspaceId, await encryptToken(env, workspaceId, input.token))
      .run();
  } else if (input.kind === "configure") {
    await database(env)
      .prepare("UPDATE google_sheets_connections SET projects_enabled=?,last_synced_seq=NULL WHERE workspace_id=?")
      .bind(input.projectsEnabled ? 1 : 0, workspaceId)
      .run();
  } else if (input.kind === "disconnect") {
    await database(env).prepare("DELETE FROM google_sheets_connections WHERE workspace_id=?").bind(workspaceId).run();
  }
}

/** Export only when data changed; a manual refresh deliberately overwrites sheet edits. */
export async function syncSheets(env: Env, workspaceId: string, store: Store, seq: () => number, force: boolean) {
  const row = await sheetsConnection(env, workspaceId);
  if (!row) return false;
  if (!force && row.last_synced_seq === String(seq())) return true;
  try {
    const token = await tokenRequest(env, {
      grant_type: "refresh_token",
      refresh_token: await decryptToken(env, workspaceId, row.refresh_token),
    });
    let spreadsheetId = row.spreadsheet_id;
    if (!spreadsheetId) {
      const file = z.object({ spreadsheetId: z.string().regex(/^[A-Za-z0-9_-]+$/) }).parse(
        await google(env, token.access_token, "", {
          properties: { title: "Kanbun Issues", timeZone: "Etc/UTC" },
          sheets: [{ properties: { sheetId: 0, title: "Issues" } }, { properties: { sheetId: 1, title: "Projects" } }],
        }),
      );
      spreadsheetId = file.spreadsheetId;
      // Retain the ID before export so a failed update never creates duplicate files on retry.
      await database(env)
        .prepare("UPDATE google_sheets_connections SET spreadsheet_id=? WHERE workspace_id=?")
        .bind(spreadsheetId, workspaceId)
        .run();
    }
    const snapshotSeq = seq();
    const data = sheetsExport(store, !!row.projects_enabled);
    await google(env, token.access_token, `/${spreadsheetId}:batchUpdate`, { requests: sheetsWriteRequests(data) });
    await database(env)
      .prepare(
        "UPDATE google_sheets_connections SET last_synced_seq=?,last_synced_at=?,error=NULL WHERE workspace_id=?",
      )
      .bind(String(snapshotSeq), new Date().toISOString(), workspaceId)
      .run();
    return true;
  } catch {
    await database(env)
      .prepare("UPDATE google_sheets_connections SET error=? WHERE workspace_id=?")
      .bind("Google Sheets could not be updated. Try again or reconnect Google.", workspaceId)
      .run();
    throw unavailable();
  }
}

async function connect(env: Env, principal: HostedPrincipal) {
  if (!configured(env)) throw new RequestError("Google Sheets is not configured yet.", 503);
  if (!principal.sessionId) throw new RequestError("Native email sign-in is required to connect Google Sheets", 401);
  await tokenKey(env);
  const state = random(),
    verifier = random();
  const binding = JSON.stringify({
    workspaceId: principal.workspaceId,
    accountId: principal.actor.id,
    sessionId: principal.sessionId,
  });
  await database(env)
    .prepare(
      "INSERT INTO oauth_states(state,provider,redirect_to,code_verifier,expires_at) VALUES (?,'google-sheets',?,NULL,?)",
    )
    .bind(await authTokenHash(state), binding, new Date(principal.expiresAt).toISOString())
    .run();
  const digest = base64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_SHEETS_CLIENT_ID!,
    redirect_uri: configuration(env).appOrigin + callbackPath,
    response_type: "code",
    scope,
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: digest,
    code_challenge_method: "S256",
  }).toString();
  return response(
    { url: url.href },
    200,
    `${cookieName}=${state}.${verifier}; Path=/; Secure; HttpOnly; SameSite=Lax; Expires=${new Date(principal.expiresAt).toUTCString()}`,
  );
}
async function callback(request: Request, env: Env, principal: HostedPrincipal) {
  const input = query(
    z.object({ state: z.string(), code: z.string().optional(), error: z.string().optional() }),
    new URL(request.url),
  );
  const cookie = request.headers
    .get("Cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1);
  const [state, verifier, extra] = cookie?.split(".") ?? [];
  if (
    extra ||
    state !== input.state ||
    !verifier ||
    !/^[A-Za-z0-9_-]{43}$/.test(state) ||
    !/^[A-Za-z0-9_-]{43}$/.test(verifier)
  )
    throw new RequestError("Google authorization does not match this browser. Connect again.", 403);
  const binding = JSON.stringify({
    workspaceId: principal.workspaceId,
    accountId: principal.actor.id,
    sessionId: principal.sessionId,
  });
  const claimed = await database(env)
    .prepare(
      "DELETE FROM oauth_states WHERE state=? AND provider='google-sheets' AND redirect_to=? AND expires_at>? RETURNING state",
    )
    .bind(await authTokenHash(state), binding, new Date().toISOString())
    .first();
  if (!claimed) throw new RequestError("Google authorization expired or was already used. Connect again.", 403);
  if (input.error || !input.code) throw new RequestError("Google authorization was declined. Connect again.");
  let token: Awaited<ReturnType<typeof tokenRequest>>;
  try {
    token = await tokenRequest(env, {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: configuration(env).appOrigin + callbackPath,
      code_verifier: verifier,
    });
    if (!token.refresh_token || (token.scope && !token.scope.split(" ").includes(scope))) throw unavailable();
  } catch {
    throw unavailable();
  }
  await sheetsRpcValue(
    env.WORKSPACES.getByName(principal.workspaceId).googleSheetsCommand(principal, {
      kind: "connect",
      token: token.refresh_token,
    }),
  );
  return new Response(null, {
    status: 303,
    headers: {
      Location: configuration(env).appOrigin + "/#settings/integrations",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": `${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`,
    },
  });
}

async function sheetsRpcValue(
  result: ReturnType<Env["WORKSPACES"]["getByName"]>["googleSheetsCommand"] extends (...args: never[]) => infer R
    ? R
    : never,
) {
  const value = await result;
  if (!value.ok) throw new RequestError(value.error, value.status);
  return value.value;
}

export async function googleSheetsRoute(
  request: Request,
  env: Env,
  principal: HostedPrincipal,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(prefix)) return null;
  if (env.BACKUP_RESTORE_ISOLATED === "true")
    throw new RequestError("Google Sheets is disabled on isolated recovery targets", 503);
  if ((await activeMember(env, principal)).role !== "owner")
    throw new RequestError("Workspace owner access required", 403);
  if (url.pathname === callbackPath && request.method === "GET") return callback(request, env, principal);
  query(z.strictObject({}), url);
  if (url.pathname === prefix && request.method === "GET")
    return response(await sheetsStatus(env, principal.workspaceId));
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);
  requireHostedOrigin(request, env);
  if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json")
    throw new RequestError("Expected a JSON request body");
  if (url.pathname === prefix + "/connect") {
    await body(z.strictObject({}), request);
    return connect(env, principal);
  }
  const authority = env.WORKSPACES.getByName(principal.workspaceId);
  if (url.pathname === prefix + "/configure") {
    const input = await body(z.strictObject({ projectsEnabled: z.boolean() }), request);
    return response(await sheetsRpcValue(authority.googleSheetsCommand(principal, { kind: "configure", ...input })));
  }
  if (url.pathname === prefix + "/sync" || url.pathname === prefix + "/disconnect") {
    await body(z.strictObject({}), request);
    return response(
      await sheetsRpcValue(
        authority.googleSheetsCommand(principal, { kind: url.pathname.endsWith("/sync") ? "sync" : "disconnect" }),
      ),
    );
  }
  return response({ error: "Not found" }, 404);
}
