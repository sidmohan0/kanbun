import { z } from "zod";
import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "./index";
import { activeMember } from "./directory";
import { configuration, requireHostedOrigin, type HostedPrincipal } from "./auth";
import { query, RequestError } from "./requests";

export type IntegrationProvider = "github" | "slack" | "google-sheets";
export type IntegrationAppConfig = Record<string, string>;
export type IntegrationAppsEnvironment = {
  ACCOUNTS?: D1Database;
  INTEGRATION_CREDENTIALS_MODE?: string;
  INTEGRATION_CREDENTIALS_ENCRYPTION_KEY?: string;
};
type StoredCredentials = {
  workspace_id: string;
  provider: IntegrationProvider;
  credentials_ciphertext: string;
  configured_at: string;
  updated_at: string;
  verified_at: string | null;
  revision: string;
};

const providers: Record<
  IntegrationProvider,
  { callback: string; scopes: string[]; fields: Record<string, "public" | "secret"> }
> = {
  github: {
    callback: "/api/integrations/github/callback",
    scopes: ["GitHub App: account access and repository installation permissions"],
    fields: {
      appId: "public",
      appSlug: "public",
      clientId: "public",
      clientSecret: "secret",
      privateKey: "secret",
      webhookSecret: "secret",
    },
  },
  slack: {
    callback: "/api/integrations/slack/callback",
    scopes: ["chat:write", "links:read", "links:write", "channels:history (optional for issue replies)"],
    fields: { appId: "public", clientId: "public", clientSecret: "secret", signingSecret: "secret" },
  },
  "google-sheets": {
    callback: "/api/integrations/google-sheets/callback",
    scopes: ["https://www.googleapis.com/auth/drive.file"],
    fields: { clientId: "public", clientSecret: "secret" },
  },
};

const cleanText = (max: number) => z.string().trim().min(1).max(max);
const configSchemas: Record<IntegrationProvider, z.ZodType<IntegrationAppConfig>> = {
  github: z.strictObject({
    appId: z.string().regex(/^[0-9]{1,20}$/),
    appSlug: z.string().regex(/^[A-Za-z0-9-]{1,100}$/),
    clientId: cleanText(200),
    clientSecret: cleanText(500),
    privateKey: z
      .string()
      .trim()
      .min(100)
      .max(12000)
      .refine((v) => /-----BEGIN PRIVATE KEY-----/.test(v)),
    webhookSecret: cleanText(500),
  }),
  slack: z.strictObject({
    appId: z.string().regex(/^A[A-Z0-9]{2,31}$/),
    clientId: z.string().regex(/^[0-9]+\.[A-Za-z0-9]+$/),
    clientSecret: cleanText(500),
    signingSecret: cleanText(500),
  }),
  "google-sheets": z.strictObject({
    clientId: z
      .string()
      .trim()
      .min(12)
      .max(300)
      .refine((v) => v.endsWith(".apps.googleusercontent.com")),
    clientSecret: cleanText(500),
  }),
};

const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });

export function workspaceCredentialsMode(env: IntegrationAppsEnvironment) {
  return env.INTEGRATION_CREDENTIALS_MODE === "workspace";
}

function database(env: IntegrationAppsEnvironment) {
  if (!env.ACCOUNTS) throw new RequestError("Provider app setup is unavailable on this installation.", 503);
  return env.ACCOUNTS;
}

function decodeBase64(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function encryptionKey(env: IntegrationAppsEnvironment) {
  try {
    const bytes = decodeBase64(env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY ?? "");
    if (bytes.length !== 32) throw new Error("invalid key");
    return await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  } catch {
    throw new RequestError("Workspace provider settings need a valid deployment encryption key.", 503);
  }
}

async function seal(
  env: IntegrationAppsEnvironment,
  workspaceId: string,
  provider: IntegrationProvider,
  value: string,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(`${workspaceId}:${provider}:1`) },
    await encryptionKey(env),
    new TextEncoder().encode(value),
  );
  return `${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...new Uint8Array(ciphertext)))}`;
}

async function open(env: IntegrationAppsEnvironment, row: StoredCredentials): Promise<IntegrationAppConfig> {
  try {
    const [ivText, encrypted, extra] = row.credentials_ciphertext.split(".");
    if (!ivText || !encrypted || extra) throw new Error("invalid ciphertext");
    const iv = decodeBase64(ivText);
    const ciphertext = decodeBase64(encrypted);
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(`${row.workspace_id}:${row.provider}:1`),
      },
      await encryptionKey(env),
      ciphertext,
    );
    return z.record(z.string(), z.string()).parse(JSON.parse(new TextDecoder().decode(plain)));
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError("Saved provider settings cannot be decrypted; check the deployment encryption key.", 503);
  }
}

export async function storedIntegrationCredentials(
  env: IntegrationAppsEnvironment,
  workspaceId: string,
  provider: IntegrationProvider,
) {
  if (!workspaceCredentialsMode(env)) return null;
  const row = await database(env)
    .prepare("SELECT * FROM integration_app_credentials WHERE workspace_id=? AND provider=?")
    .bind(workspaceId, provider)
    .first<StoredCredentials>();
  return row ? open(env, row) : null;
}

/** Resolve a self-hosted workspace's app; hosted deployments continue using platform bindings. */
export async function integrationCredentials<T extends IntegrationAppConfig>(
  env: IntegrationAppsEnvironment,
  workspaceId: string,
  provider: IntegrationProvider,
  platform: T,
): Promise<T | null> {
  if (!workspaceCredentialsMode(env)) return platform;
  return (await storedIntegrationCredentials(env, workspaceId, provider)) as T | null;
}

export async function markIntegrationCredentialsVerified(
  env: IntegrationAppsEnvironment,
  workspaceId: string,
  provider: IntegrationProvider,
  expected: IntegrationAppConfig,
) {
  if (!workspaceCredentialsMode(env)) return;
  const current = await storedIntegrationCredentials(env, workspaceId, provider);
  if (!current || JSON.stringify(current) !== JSON.stringify(expected)) return;
  await database(env)
    .prepare("UPDATE integration_app_credentials SET verified_at=? WHERE workspace_id=? AND provider=?")
    .bind(new Date().toISOString(), workspaceId, provider)
    .run();
}

async function listStatus(env: Env, workspaceId: string) {
  await encryptionKey(env);
  const rows = await database(env)
    .prepare(
      "SELECT provider,configured_at,updated_at,verified_at,revision FROM integration_app_credentials WHERE workspace_id=?",
    )
    .bind(workspaceId)
    .all<Pick<StoredCredentials, "provider" | "configured_at" | "updated_at" | "verified_at" | "revision">>();
  const byProvider = new Map(rows.results.map((row) => [row.provider, row]));
  const appOrigin = configuration(env).appOrigin;
  return {
    enabled: true,
    providers: (Object.keys(providers) as IntegrationProvider[]).map((provider) => {
      const row = byProvider.get(provider);
      return {
        provider,
        configured: !!row,
        configuredAt: row?.configured_at ?? null,
        updatedAt: row?.updated_at ?? null,
        verifiedAt: row?.verified_at ?? null,
        revision: row?.revision ?? null,
        callbackUrl: appOrigin + providers[provider].callback,
        scopes: providers[provider].scopes,
        ...(provider === "github" ? { webhookUrl: `${appOrigin}/api/integrations/github/webhook/${workspaceId}` } : {}),
        ...(provider === "slack"
          ? {
              eventsUrl: `${appOrigin}/api/integrations/slack/events/${workspaceId}`,
              interactionsUrl: `${appOrigin}/api/integrations/slack/interactions/${workspaceId}`,
            }
          : {}),
      };
    }),
  };
}

export async function integrationAppsRoute(
  request: Request,
  env: Env,
  principal: HostedPrincipal,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/integration-apps")) return null;
  if ((await activeMember(env, principal)).role !== "owner")
    throw new RequestError("Workspace owner access required", 403);
  if (!workspaceCredentialsMode(env))
    return url.pathname === "/api/integration-apps" && request.method === "GET"
      ? json({ enabled: false })
      : json({ error: "Not found" }, 404);
  if (env.BACKUP_RESTORE_ISOLATED === "true") throw new RequestError("Provider setup is disabled during restore.", 503);
  if (url.pathname === "/api/integration-apps" && request.method === "GET") {
    query(z.strictObject({}), url);
    return json(await listStatus(env, principal.workspaceId));
  }
  const match = /^\/api\/integration-apps\/(github|slack|google-sheets)$/.exec(url.pathname);
  if (!match) return json({ error: "Not found" }, 404);
  const provider = match[1] as IntegrationProvider;
  if (request.method === "DELETE") {
    requireHostedOrigin(request, env);
    query(z.strictObject({}), url);
    await database(env)
      .prepare("DELETE FROM integration_app_credentials WHERE workspace_id=? AND provider=?")
      .bind(principal.workspaceId, provider)
      .run();
    return json(await listStatus(env, principal.workspaceId));
  }
  if (request.method !== "PUT") return json({ error: "Method not allowed" }, 405);
  requireHostedOrigin(request, env);
  if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json")
    throw new RequestError("Expected a JSON request body");
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 32 * 1024)
    throw new RequestError("Provider app settings are too large.", 413);
  let input: unknown;
  try {
    input = JSON.parse(rawBody);
  } catch {
    throw new RequestError("Expected a valid JSON request body.");
  }
  const submitted = z.record(z.string(), z.string()).parse(input);
  if (Object.keys(submitted).some((field) => !Object.hasOwn(providers[provider].fields, field)))
    throw new RequestError("Unknown provider app setting.");
  const currentRow = await database(env)
    .prepare("SELECT * FROM integration_app_credentials WHERE workspace_id=? AND provider=?")
    .bind(principal.workspaceId, provider)
    .first<StoredCredentials>();
  const current = currentRow ? await open(env, currentRow) : {};
  const merged = Object.fromEntries(
    Object.entries(providers[provider].fields).map(([field, kind]) => {
      const entered = submitted[field]?.trim();
      const value = entered || current[field] || "";
      if (kind === "secret" && !entered && current[field]) return [field, current[field]];
      return [field, value];
    }),
  );
  const parsed = configSchemas[provider].safeParse(merged);
  if (!parsed.success) throw new RequestError("Enter valid values for each required provider app field.", 400);
  const timestamp = new Date().toISOString();
  const ciphertext = await seal(env, principal.workspaceId, provider, JSON.stringify(parsed.data));
  const revision = crypto.randomUUID();
  await database(env)
    .prepare(
      "INSERT INTO integration_app_credentials(workspace_id,provider,credentials_ciphertext,configured_at,updated_at,verified_at,revision) VALUES (?,?,?,?,?,NULL,?) ON CONFLICT(workspace_id,provider) DO UPDATE SET credentials_ciphertext=excluded.credentials_ciphertext,updated_at=excluded.updated_at,verified_at=NULL,revision=excluded.revision",
    )
    .bind(principal.workspaceId, provider, ciphertext, currentRow?.configured_at ?? timestamp, timestamp, revision)
    .run();
  return json(await listStatus(env, principal.workspaceId));
}
