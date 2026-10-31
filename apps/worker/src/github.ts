import { importPKCS8, SignJWT } from "jose";
import { z } from "zod";
import type { GitHubPullRequestSnapshot, GitHubRepositorySource } from "@kanbun/events";
import type { Env } from "./index";
import { configuration, requireHostedOrigin, type HostedPrincipal } from "./auth";
import { activeMember } from "./directory";
import { authTokenHash } from "./email-auth";
import { body, query, RequestError } from "./requests";
import { githubRpcValue } from "./github-rpc";

export interface GithubEnvironment {
  GITHUB_APP_ID?: string;
  GITHUB_APP_CLIENT_ID?: string;
  GITHUB_APP_SLUG?: string;
  GITHUB_APP_CLIENT_SECRET?: string;
  /** PKCS8 PEM; convert GitHub's downloaded RSA key before storing the Worker secret. */
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  /** Optional private provider transport, never configured on the public deployment. */
  GITHUB_TRANSPORT?: Fetcher;
}
const API = "https://api.github.com";
const COOKIE = "__Host-kanbun-github";
const callbackPath = "/api/integrations/github/callback";
const prefix = "/api/integrations/github";
const number = z.number().int().positive().safe();
const name = z.string().regex(/^[A-Za-z0-9_.-]+$/);
const sourceSchema = z.object({
  installationId: number,
  repositoryId: number,
  owner: name,
  name,
  url: z.string().url(),
  private: z.boolean(),
});
const catalogSchema = z.array(sourceSchema);
type Setup = { account_id: string; session_id: string; expires_at: string; catalog: string; error: string | null };
const unavailable = () => new RequestError("GitHub is unavailable. Try connecting or refreshing again.", 503);
function configured(env: GithubEnvironment) {
  return !!(
    env.GITHUB_APP_ID &&
    env.GITHUB_APP_CLIENT_ID &&
    env.GITHUB_APP_SLUG &&
    env.GITHUB_APP_CLIENT_SECRET &&
    env.GITHUB_APP_PRIVATE_KEY &&
    env.GITHUB_WEBHOOK_SECRET
  );
}
function requireConfiguration(env: GithubEnvironment) {
  if (!configured(env)) throw new RequestError("The GitHub App is not configured yet.", 503);
}
function response(value: unknown, status = 200, cookie?: string) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      ...(cookie ? { "Set-Cookie": cookie } : {}),
    },
  });
}
function redirect(env: Env) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: configuration(env).appOrigin + "/#settings",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`,
    },
  });
}
const bytes64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const random = () => bytes64(crypto.getRandomValues(new Uint8Array(32)));
async function transport(env: GithubEnvironment, input: Request): Promise<Response> {
  try {
    return await (env.GITHUB_TRANSPORT ? env.GITHUB_TRANSPORT.fetch(input) : fetch(input));
  } catch {
    throw unavailable();
  }
}
async function github<T = unknown>(
  env: GithubEnvironment,
  token: string,
  path: string,
  options: { method?: string; input?: object } = {},
): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//")) throw unavailable();
  const result = await transport(
    env,
    new Request(API + path, {
      method: options.method ?? "GET",
      redirect: "manual",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": "kanbun",
        ...(options.input ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.input ? { body: JSON.stringify(options.input) } : {}),
    }),
  );
  if (!result.ok) throw unavailable();
  try {
    return (await result.json()) as T;
  } catch {
    throw unavailable();
  }
}
/** GitHub's REST pagination contract permits 100 items/page. Never truncate a catalog or evidence rollup. */
async function pages(env: GithubEnvironment, token: string, path: string, property?: string): Promise<unknown[]> {
  const values: unknown[] = [];
  for (let page = 1; ; page++) {
    const data = await github<unknown>(env, token, `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    const rows = property && data && typeof data === "object" ? (data as Record<string, unknown>)[property] : data;
    if (!Array.isArray(rows)) throw unavailable();
    values.push(...rows);
    if (rows.length < 100) return values;
  }
}
async function installationToken(env: GithubEnvironment, source: GitHubRepositorySource) {
  requireConfiguration(env);
  try {
    const key = await importPKCS8(env.GITHUB_APP_PRIVATE_KEY!, "RS256");
    const now = Math.floor(Date.now() / 1000);
    // GitHub requires RS256, permits at most 10 minutes, and recommends 60s of clock-skew allowance.
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(env.GITHUB_APP_CLIENT_ID!)
      .setIssuedAt(now - 60)
      .setExpirationTime(now + 600)
      .sign(key);
    const result = await github<unknown>(env, jwt, `/app/installations/${source.installationId}/access_tokens`, {
      method: "POST",
      input: {
        repository_ids: [source.repositoryId],
        permissions: { pull_requests: "read", checks: "read", statuses: "read" },
      },
    });
    return z.object({ token: z.string().min(1) }).parse(result).token;
  } catch {
    throw unavailable();
  }
}
const pullSchema = z.object({
  number,
  title: z.string(),
  state: z.enum(["open", "closed"]),
  draft: z.boolean().optional(),
  merged: z.boolean(),
  updated_at: z.iso.datetime({ offset: true }),
  head: z.object({ ref: z.string(), sha: z.string().regex(/^[a-f0-9]{40,64}$/i) }),
  base: z.object({ ref: z.string(), repo: z.object({ id: number }) }),
});

/** Canonical reads, never webhook payloads, supply visible evidence. All evidence is tied to the captured head. */
export async function readGitHubPullRequest(
  env: GithubEnvironment,
  source: GitHubRepositorySource,
  pullNumber: number,
): Promise<GitHubPullRequestSnapshot> {
  const observedAt = new Date().toISOString();
  sourceSchema.parse(source);
  number.parse(pullNumber);
  const token = await installationToken(env, source);
  const repo = `/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.name)}`;
  const pullPath = `${repo}/pulls/${pullNumber}`;
  const pull = pullSchema.parse(await github(env, token, pullPath));
  if (pull.number !== pullNumber || pull.base.repo.id !== source.repositoryId) throw unavailable();
  const [reviewValues, checkValues, statusValues] = await Promise.all([
    pages(env, token, pullPath + "/reviews"),
    pages(env, token, `${repo}/commits/${pull.head.sha}/check-runs`, "check_runs"),
    pages(env, token, `${repo}/commits/${pull.head.sha}/status`, "statuses"),
  ]);
  const latest = new Map<number, { state: string; commit_id: string }>();
  const reviewSchema = z.object({
    id: number,
    state: z.string(),
    commit_id: z.string(),
    user: z.object({ id: number }),
  });
  const reviews = reviewValues.map((value) => reviewSchema.parse(value)).sort((a, b) => a.id - b.id);
  for (const review of reviews)
    if (["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state)) latest.set(review.user.id, review);
  const votes = [...latest.values()].filter((review) => review.commit_id === pull.head.sha);
  const reviewStatus = votes.some((r) => r.state === "CHANGES_REQUESTED")
    ? "changes_requested"
    : votes.some((r) => r.state === "APPROVED")
      ? "approved"
      : "pending";
  const checks = checkValues.map((value) =>
    z.object({ status: z.string(), conclusion: z.string().nullable(), head_sha: z.string() }).parse(value),
  );
  const statuses = statusValues.map((value) => z.object({ state: z.string() }).parse(value));
  const currentChecks = checks.filter((c) => c.head_sha === pull.head.sha);
  const failing =
    currentChecks.some(
      (c) => c.status === "completed" && !["success", "neutral", "skipped"].includes(c.conclusion ?? ""),
    ) || statuses.some((s) => ["failure", "error"].includes(s.state));
  const pending = currentChecks.some((c) => c.status !== "completed") || statuses.some((s) => s.state === "pending");
  const checksStatus = failing
    ? "failing"
    : pending
      ? "pending"
      : currentChecks.length + statuses.length
        ? "passing"
        : "unknown";
  // A push while the independent review/check requests ran must not label a new commit with old evidence.
  const after = pullSchema.parse(await github(env, token, pullPath));
  if (
    after.head.sha !== pull.head.sha ||
    after.updated_at !== pull.updated_at ||
    after.merged !== pull.merged ||
    after.state !== pull.state ||
    after.draft !== pull.draft
  )
    throw new RequestError("The pull request changed during refresh. Refresh it again.", 409);
  const url = `https://github.com/${source.owner}/${source.name}/pull/${pullNumber}`;
  return {
    number: pullNumber,
    title: pull.title,
    url,
    state: pull.merged ? "merged" : pull.state === "closed" ? "closed" : pull.draft ? "draft" : "open",
    headRef: pull.head.ref,
    baseRef: pull.base.ref,
    headSha: pull.head.sha,
    reviewStatus,
    reviewHeadSha: pull.head.sha,
    checksStatus,
    checksHeadSha: pull.head.sha,
    checksUrl: url + "/checks",
    providerUpdatedAt: pull.updated_at,
    observedAt,
  };
}

async function owner(env: Env, principal: HostedPrincipal) {
  const context = await activeMember(env, principal);
  if (context.role !== "owner") throw new RequestError("Workspace ownership is required", 403);
  return context;
}
function db(env: Env) {
  if (!env.ACCOUNTS) throw unavailable();
  return env.ACCOUNTS;
}
async function setup(env: Env, principal: HostedPrincipal): Promise<Setup | null> {
  const result = await db(env)
    .prepare("SELECT account_id,session_id,expires_at,catalog,error FROM github_setups WHERE workspace_id = ?")
    .bind(principal.workspaceId)
    .first<Setup>();
  return result &&
    result.account_id === principal.actor.id &&
    result.session_id === principal.sessionId &&
    Date.parse(result.expires_at) > Date.now()
    ? result
    : null;
}
async function saveSetup(
  env: Env,
  principal: HostedPrincipal,
  catalog: GitHubRepositorySource[],
  error: string | null = null,
) {
  await db(env)
    .prepare(
      "INSERT INTO github_setups(workspace_id,account_id,session_id,expires_at,catalog,error) VALUES (?,?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET account_id=excluded.account_id,session_id=excluded.session_id,expires_at=excluded.expires_at,catalog=excluded.catalog,error=excluded.error",
    )
    .bind(
      principal.workspaceId,
      principal.actor.id,
      principal.sessionId!,
      new Date(principal.expiresAt).toISOString(),
      JSON.stringify(catalog),
      error,
    )
    .run();
}
async function connect(env: Env, principal: HostedPrincipal) {
  requireConfiguration(env);
  if (!principal.sessionId) throw new RequestError("Native email sign-in is required to connect GitHub", 401);
  const state = random(),
    verifier = random();
  const binding = JSON.stringify({
    workspaceId: principal.workspaceId,
    accountId: principal.actor.id,
    sessionId: principal.sessionId,
  });
  await db(env)
    .prepare(
      "INSERT INTO oauth_states(state,provider,redirect_to,code_verifier,expires_at) VALUES (?,'github-integration',?,NULL,?)",
    )
    .bind(await authTokenHash(state), binding, new Date(principal.expiresAt).toISOString())
    .run();
  const url = new URL("https://github.com/login/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: env.GITHUB_APP_CLIENT_ID!,
    redirect_uri: configuration(env).appOrigin + callbackPath,
    state,
    code_challenge: bytes64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))),
    code_challenge_method: "S256",
  }).toString();
  const cookie = `${COOKIE}=${state}.${verifier}; Path=/; Secure; HttpOnly; SameSite=Lax; Expires=${new Date(principal.expiresAt).toUTCString()}; Max-Age=${Math.max(0, Math.floor((principal.expiresAt - Date.now()) / 1000))}`;
  return response({ url: url.href }, 200, cookie);
}
async function callback(request: Request, env: Env, principal: HostedPrincipal) {
  const input = query(
    z.strictObject({
      code: z.string().min(1).optional(),
      state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      error: z.string().optional(),
      error_description: z.string().optional(),
      error_uri: z.string().optional(),
    }),
    new URL(request.url),
  );
  const cookie = request.headers
    .get("Cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(COOKIE + "="))
    ?.slice(COOKIE.length + 1);
  const [state, verifier, extra] = cookie?.split(".") ?? [];
  if (extra || state !== input.state || !verifier || !/^[A-Za-z0-9_-]{43}$/.test(verifier))
    throw new RequestError("GitHub authorization does not match this browser. Connect again.", 403);
  const stateHash = await authTokenHash(state);
  const row = await db(env)
    .prepare("SELECT redirect_to,expires_at FROM oauth_states WHERE state = ? AND provider = 'github-integration'")
    .bind(stateHash)
    .first<{ redirect_to: string; expires_at: string }>();
  const expected = JSON.stringify({
    workspaceId: principal.workspaceId,
    accountId: principal.actor.id,
    sessionId: principal.sessionId,
  });
  if (!row || row.redirect_to !== expected || Date.parse(row.expires_at) <= Date.now())
    throw new RequestError("GitHub authorization expired or belongs to another session. Connect again.", 403);
  const claimed = await db(env)
    .prepare("DELETE FROM oauth_states WHERE state = ? AND provider = 'github-integration' RETURNING state")
    .bind(stateHash)
    .first();
  if (!claimed) throw new RequestError("This GitHub authorization was already used. Connect again.", 403);
  try {
    requireConfiguration(env);
    if (input.error || !input.code) throw unavailable();
    const result = await transport(
      env,
      new Request("https://github.com/login/oauth/access_token", {
        method: "POST",
        redirect: "manual",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: env.GITHUB_APP_CLIENT_ID,
          client_secret: env.GITHUB_APP_CLIENT_SECRET,
          code: input.code,
          redirect_uri: configuration(env).appOrigin + callbackPath,
          code_verifier: verifier,
        }),
      }),
    );
    if (!result.ok) throw unavailable();
    const { access_token: token } = z.object({ access_token: z.string().min(1) }).parse(await result.json());
    z.object({ id: number }).parse(await github(env, token, "/user"));
    const installations = await pages(env, token, "/user/installations", "installations");
    const catalog: GitHubRepositorySource[] = [];
    for (const value of installations) {
      const installation = z
        .object({ id: number, app_id: number, suspended_at: z.string().nullable().optional() })
        .parse(value);
      if (String(installation.app_id) !== env.GITHUB_APP_ID || installation.suspended_at) continue;
      const repositories = await pages(
        env,
        token,
        `/user/installations/${installation.id}/repositories`,
        "repositories",
      );
      for (const value of repositories) {
        const repo = z
          .object({ id: number, name, owner: z.object({ login: name }), private: z.boolean() })
          .parse(value);
        catalog.push({
          installationId: installation.id,
          repositoryId: repo.id,
          owner: repo.owner.login,
          name: repo.name,
          url: `https://github.com/${repo.owner.login}/${repo.name}`,
          private: repo.private,
        });
      }
    }
    await saveSetup(env, principal, catalog);
  } catch {
    console.error({ event: "kanbun.github.authorization_failed", errorId: crypto.randomUUID() });
    await saveSetup(env, principal, [], "GitHub authorization could not be completed. Connect again.");
  }
  return redirect(env);
}

/** Authenticated integration management; GitHub authorization is separate from Kanbun sign-in. */
export async function githubRoute(request: Request, env: Env, principal: HostedPrincipal): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(prefix)) return null;
  if (env.BACKUP_RESTORE_ISOLATED === "true")
    throw new RequestError("GitHub integration is disabled on isolated recovery targets", 503);
  const authority = env.WORKSPACES.getByName(principal.workspaceId);
  if (url.pathname === callbackPath) {
    if (request.method !== "GET") return response({ error: "Method not allowed" }, 405);
    await owner(env, principal);
    return callback(request, env, principal);
  }
  query(z.strictObject({}), url);
  if (url.pathname === prefix && request.method === "GET") {
    await owner(env, principal);
    const grant = await setup(env, principal);
    return response({
      configured: configured(env),
      appName: env.GITHUB_APP_SLUG ?? null,
      installUrl: env.GITHUB_APP_SLUG ? `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new` : null,
      repositories: await githubRpcValue(authority.githubRepositories(principal)),
      catalog: grant ? catalogSchema.parse(JSON.parse(grant.catalog)) : [],
      authorizationRequired: !grant,
      error: grant?.error ?? null,
    });
  }
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);
  requireHostedOrigin(request, env);
  if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json")
    throw new RequestError("Expected a JSON request body");
  if (url.pathname === prefix + "/connect") {
    await owner(env, principal);
    await body(z.strictObject({}), request);
    return connect(env, principal);
  }
  if (url.pathname === prefix + "/repositories") {
    await owner(env, principal);
    const input = await body(
      z.strictObject({ teamId: z.string().min(1), installationId: number, repositoryId: number }),
      request,
    );
    const grant = await setup(env, principal);
    const source =
      grant &&
      catalogSchema
        .parse(JSON.parse(grant.catalog))
        .find((r) => r.installationId === input.installationId && r.repositoryId === input.repositoryId);
    if (!source)
      throw new RequestError("Authorize access to this repository with GitHub before mapping it to a team.", 403);
    return response(
      await githubRpcValue(authority.configureGitHubRepository(principal, { teamId: input.teamId, source })),
    );
  }
  if (url.pathname === prefix + "/repositories/disconnect") {
    await owner(env, principal);
    const { bindingId } = await body(z.strictObject({ bindingId: z.uuidv7() }), request);
    return response(await githubRpcValue(authority.disconnectGitHubRepository(principal, bindingId)));
  }
  if (url.pathname === prefix + "/pull-requests/link") {
    const input = await body(
      z.strictObject({
        issueId: z.string().min(1),
        issueIncarnation: z.string().min(1),
        repositoryBindingId: z.uuidv7(),
        url: z.string().url(),
      }),
      request,
    );
    const lookup = {
      issueId: input.issueId,
      issueIncarnation: input.issueIncarnation,
      repositoryBindingId: input.repositoryBindingId,
    };
    const { source, revision } = await githubRpcValue(authority.githubRepositoryForIssue(principal, lookup));
    const parsed = new URL(input.url);
    const match = /^\/([^/]+)\/([^/]+)\/pull\/([1-9][0-9]*)\/?$/.exec(parsed.pathname);
    if (
      parsed.origin !== "https://github.com" ||
      parsed.username ||
      parsed.password ||
      !match ||
      match[1]!.toLowerCase() !== source.owner.toLowerCase() ||
      match[2]!.toLowerCase() !== source.name.toLowerCase()
    )
      throw new RequestError("Use a pull request URL from the selected repository.");
    const snapshot = await readGitHubPullRequest(env, source, number.parse(Number(match[3])));
    return response(
      await githubRpcValue(authority.linkGitHubPullRequest(principal, { ...lookup, snapshot, revision })),
    );
  }
  if (url.pathname === prefix + "/pull-requests/refresh") {
    const { linkId } = await body(z.strictObject({ linkId: z.uuidv7() }), request);
    const link = await githubRpcValue(authority.refreshGitHubPullRequest(principal, linkId));
    const snapshot = await readGitHubPullRequest(env, link.source, link.number);
    return response(
      await githubRpcValue(
        authority.linkGitHubPullRequest(principal, {
          issueId: link.issueId,
          issueIncarnation: link.issueIncarnation,
          repositoryBindingId: link.bindingId,
          snapshot,
          revision: link.revision,
          expectedLinkId: link.linkId,
        }),
      ),
    );
  }
  return response({ error: "Not found" }, 404);
}

/** This is the only public integration endpoint. Authenticate exact bytes before parsing or invoking a DO. */
export async function githubWebhookRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== prefix + "/webhook") return null;
  if (env.BACKUP_RESTORE_ISOLATED === "true")
    throw new RequestError("GitHub integration is disabled on isolated recovery targets", 503);
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);
  if (url.search) throw new RequestError("Unexpected query parameters");
  if (!env.GITHUB_WEBHOOK_SECRET) throw new RequestError("GitHub webhook is not configured", 503);
  const signature = request.headers.get("X-Hub-Signature-256");
  if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) throw new RequestError("Invalid GitHub signature", 401);
  const raw = await request.arrayBuffer();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.GITHUB_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = Uint8Array.from(signature.slice(7).match(/../g)!, (v) => parseInt(v, 16));
  if (!(await crypto.subtle.verify("HMAC", key, signed, raw))) throw new RequestError("Invalid GitHub signature", 401);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new RequestError("Invalid GitHub delivery");
  }
  const event = request.headers.get("X-GitHub-Event");
  const deliveryId = z.string().min(1).parse(request.headers.get("X-GitHub-Delivery"));
  if (event === "ping") return response({ ok: true }, 202);
  const parsed = z
    .object({
      action: z.string().optional(),
      installation: z.object({ id: number }),
      repository: z.object({ id: number }).optional(),
      repositories_removed: z.array(z.object({ id: number })).optional(),
      pull_request: z.object({ number }).optional(),
      check_run: z.object({ head_sha: z.string() }).optional(),
      check_suite: z.object({ head_sha: z.string() }).optional(),
      sha: z.string().optional(),
    })
    .safeParse(value);
  if (!parsed.success) return response({ ok: true }, 202);
  const item = parsed.data;
  const workspaceId = configuration(env).workspaceId;
  const authority = env.WORKSPACES.getByName(workspaceId);
  const base = { deliveryId, installationId: item.installation.id };
  if (event === "installation" && ["deleted", "suspend"].includes(item.action ?? ""))
    await githubRpcValue(authority.githubWebhook(workspaceId, { ...base, kind: "revoke" }));
  else if (event === "installation_repositories" && item.repositories_removed?.length)
    await githubRpcValue(
      authority.githubWebhook(workspaceId, {
        ...base,
        kind: "revoke",
        repositoryIds: item.repositories_removed.map((r) => r.id),
      }),
    );
  else if (["pull_request", "pull_request_review"].includes(event ?? "") && item.repository && item.pull_request)
    await githubRpcValue(
      authority.githubWebhook(workspaceId, {
        ...base,
        kind: "pull_request",
        repositoryId: item.repository.id,
        number: item.pull_request.number,
      }),
    );
  else if (["check_run", "check_suite", "status"].includes(event ?? "") && item.repository) {
    const headSha = item.check_run?.head_sha ?? item.check_suite?.head_sha ?? item.sha;
    if (headSha && /^[a-f0-9]{40,64}$/i.test(headSha))
      await githubRpcValue(
        authority.githubWebhook(workspaceId, {
          ...base,
          kind: "checks",
          repositoryId: item.repository.id,
          headSha,
        }),
      );
  }
  return response({ ok: true }, 202);
}
