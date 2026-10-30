import { createRemoteJWKSet, customFetch, jwtVerify, type RemoteJWKSet } from "jose";
import { z } from "zod";
import { RequestError } from "./requests";

export type AuthEnvironment = {
  LOCAL_DEV?: string;
  AUTH_MODE?: string;
  ACCESS_ISSUER?: string;
  ACCESS_AUDIENCE?: string;
  PREVIEW_OWNER_EMAIL?: string;
  PREVIEW_WORKSPACE_ID?: string;
  PREVIEW_WORKSPACE_NAME?: string;
  APP_ORIGIN?: string;
  /** Optional service transport for fetching the configured issuer's public certificates. */
  ACCESS_JWKS?: Fetcher;
};

const origin = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.origin === value;
    } catch {
      return false;
    }
  }, "Expected an HTTPS origin without a path");
const previewConfig = z.strictObject({
  issuer: origin,
  audience: z.string().min(1),
  ownerEmail: z.email(),
  workspaceId: z.uuidv7(),
  workspaceName: z.string().trim().min(1).max(160),
  appOrigin: origin,
});
export type PreviewConfig = z.infer<typeof previewConfig>;

export type AccessIdentity = {
  issuer: string;
  subject: string;
  email: string;
  name: string;
  expiresAt: number;
};

export const hostedPrincipalSchema = z.strictObject({
  mode: z.literal("hosted"),
  workspaceId: z.uuidv7(),
  actor: z.strictObject({ id: z.string().min(1), type: z.literal("user") }),
  issuer: z.string().url(),
  subject: z.string().min(1).max(512),
  expiresAt: z.number().int().positive().safe(),
  admissionId: z.string().nullable(),
});
export type HostedPrincipal = z.infer<typeof hostedPrincipalSchema>;
export const principalHeader = "X-Kanbun-Principal";

export function mode(env: AuthEnvironment): "local" | "hosted" | "disabled" {
  if (env.AUTH_MODE === "preview") return env.LOCAL_DEV === "true" ? "disabled" : "hosted";
  if (env.AUTH_MODE === undefined && env.LOCAL_DEV === "true") return "local";
  return "disabled";
}

export function configuration(env: AuthEnvironment): PreviewConfig {
  const parsed = previewConfig.safeParse({
    issuer: env.ACCESS_ISSUER,
    audience: env.ACCESS_AUDIENCE,
    ownerEmail: env.PREVIEW_OWNER_EMAIL,
    workspaceId: env.PREVIEW_WORKSPACE_ID,
    workspaceName: env.PREVIEW_WORKSPACE_NAME,
    appOrigin: env.APP_ORIGIN,
  });
  if (!parsed.success) throw new RequestError("Protected preview configuration is incomplete", 503);
  return parsed.data;
}

const keySets = new Map<string, RemoteJWKSet>();

/** Verify Access itself; the authenticated-email header and request bodies carry no authority. */
export async function verifyAccess(request: Request, env: AuthEnvironment): Promise<AccessIdentity> {
  const config = configuration(env);
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw new RequestError("Cloudflare Access authentication is required", 401);
  let keys = keySets.get(config.issuer);
  if (!keys) {
    const certs = new URL("/cdn-cgi/access/certs", config.issuer);
    keys = createRemoteJWKSet(certs, {
      ...(env.ACCESS_JWKS
        ? { [customFetch]: (url: string, init: RequestInit) => env.ACCESS_JWKS!.fetch(new Request(url, init)) }
        : {}),
    });
    keySets.set(config.issuer, keys);
  }
  let identity: AccessIdentity;
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ["RS256"],
      requiredClaims: ["iss", "aud", "sub", "exp", "email"],
    });
    const claims = z
      .object({
        iss: z.string(),
        sub: z.string().min(1).max(512),
        email: z.email(),
        name: z.string().trim().min(1).max(160).optional(),
        exp: z.number().int().positive().safe(),
      })
      .parse(payload);
    identity = {
      issuer: claims.iss,
      subject: claims.sub,
      email: claims.email,
      name: claims.name ?? claims.email,
      expiresAt: claims.exp * 1000,
    };
  } catch {
    throw new RequestError("Cloudflare Access token is invalid or expired", 401);
  }
  identity.email = identity.email.toLowerCase();
  return identity;
}

export function requireHostedOrigin(request: Request, env: AuthEnvironment) {
  if (request.headers.get("Origin") !== configuration(env).appOrigin)
    throw new RequestError("Request origin is not allowed", 403);
}

/** The edge overwrites this internal header before using its private DO binding. */
export function forwardedRequest(request: Request, principal: HostedPrincipal): Request {
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) if (name.toLowerCase().startsWith("x-kanbun-")) headers.delete(name);
  headers.delete("Cf-Access-Authenticated-User-Email");
  headers.delete("Cf-Access-Jwt-Assertion");
  headers.set(principalHeader, encodeURIComponent(JSON.stringify(principal)));
  return new Request(request, { headers });
}

export function readPrincipal(request: Request): HostedPrincipal {
  try {
    return hostedPrincipalSchema.parse(JSON.parse(decodeURIComponent(request.headers.get(principalHeader) ?? "")));
  } catch {
    throw new RequestError("Verified workspace identity is required", 403);
  }
}
