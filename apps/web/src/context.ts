import { workspaceContextSchema, type WorkspaceContext } from "@kanbun/sync";

const localDescriptorKey = "kanbun:local-context:v1";

export class WorkspaceContextError extends Error {
  constructor(
    message: string,
    readonly authenticationRequired = false,
    readonly accessDenied = false,
  ) {
    super(message);
  }
}

export function workspacePersistenceKey(context: WorkspaceContext): string {
  // Keep the existing local outbox and its lease; hosted scopes always include actual identity.
  return context.mode === "local" && context.workspaceId === "local"
    ? `local:${context.actor.id}:main`
    : JSON.stringify([
        "v1",
        context.mode,
        context.workspaceId,
        context.actor.type,
        context.actor.id,
        "main",
        ...(context.admissionId ? [context.admissionId] : []),
      ]);
}

function cachedLocalContext(): WorkspaceContext | null {
  if (!import.meta.env.DEV || !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) return null;
  try {
    const saved = workspaceContextSchema.safeParse(JSON.parse(localStorage.getItem(localDescriptorKey) ?? "null"));
    return saved.success && saved.data.mode === "local" ? saved.data : null;
  } catch {
    return null;
  }
}

function forgetLocalContext() {
  try {
    localStorage.removeItem(localDescriptorKey);
  } catch {
    /* No cached fallback is available. */
  }
}

export async function resolveWorkspaceContext(): Promise<WorkspaceContext> {
  let response: Response;
  try {
    response = await fetch("/api/context", { credentials: "include", cache: "no-store", redirect: "manual" });
  } catch (failure) {
    // Only a network failure in explicit local development may use a previously verified descriptor.
    const cached = cachedLocalContext();
    if (cached) return cached;
    throw failure;
  }
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    forgetLocalContext();
    throw new WorkspaceContextError("Sign in again to open this workspace.", true);
  }
  if (!response.ok) {
    forgetLocalContext();
    throw new WorkspaceContextError(
      `/api/context: HTTP ${response.status}`,
      response.status === 401 || response.status === 403,
      response.status === 403,
    );
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    forgetLocalContext();
    throw new WorkspaceContextError("The server returned an invalid workspace context.");
  }
  const parsed = workspaceContextSchema.safeParse(value);
  if (!parsed.success) {
    forgetLocalContext();
    throw new WorkspaceContextError("The server returned an invalid workspace context.");
  }
  try {
    if (parsed.data.mode === "local") localStorage.setItem(localDescriptorKey, JSON.stringify(parsed.data));
    else localStorage.removeItem(localDescriptorKey);
  } catch {
    // Context is authenticated by the current response; an unavailable optional descriptor cannot replace it.
  }
  return parsed.data;
}
