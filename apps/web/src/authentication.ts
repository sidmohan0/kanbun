export type AuthenticationMethod = "local" | "access" | "email";
export type AuthenticationConfig = {
  method: AuthenticationMethod;
  authenticated: boolean;
  email?: string;
  siteKey?: string;
};
let method: AuthenticationMethod | null = null;
export const signInRequiredEvent = "kanbun:sign-in-required";

export function rememberAuthentication(value: AuthenticationMethod) {
  method = value;
}
export function requireEmailSignIn() {
  if (method === "email") window.dispatchEvent(new Event(signInRequiredEvent));
}
export function authenticationConfig(value: unknown): AuthenticationConfig {
  if (value === null || typeof value !== "object") throw new Error("The sign-in configuration is unavailable.");
  const config = value as Record<string, unknown>;
  if (
    !["local", "access", "email"].includes(String(config.method)) ||
    (config.email !== undefined && typeof config.email !== "string") ||
    (config.method === "email" &&
      (typeof config.authenticated !== "boolean" || typeof config.siteKey !== "string" || !config.siteKey))
  )
    throw new Error("The sign-in configuration is unavailable.");
  return { ...config, authenticated: config.authenticated === true } as AuthenticationConfig;
}

/** Only application hash destinations can survive a sign-in round trip. */
export function validReturnTo(value: string): boolean {
  return (
    ["#issues", "#my-issues", "#inbox", "#settings", "#settings/integrations", "#members"].includes(value) ||
    /^#issues\/[A-Za-z0-9_-]+$/u.test(value) ||
    /^#invite\/[A-Za-z0-9_-]{43}$/u.test(value)
  );
}
export const returnDestination = (hash: string) => (validReturnTo(hash) ? hash : "#issues");
export type SignInRoute = { token: string; returnTo: string } | { invalid: true } | null;
export function signInRoute(hash: string): SignInRoute {
  if (!hash.startsWith("#signin/")) return null;
  const parts = hash.slice("#signin/".length).split("/");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]{43}$/u.test(parts[0]!)) return { invalid: true };
  try {
    const returnTo = decodeURIComponent(parts[1]!);
    return validReturnTo(returnTo) ? { token: parts[0]!, returnTo } : { invalid: true };
  } catch {
    return { invalid: true };
  }
}
export class AuthenticationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function authenticationRequest(path: string, input?: object): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "include",
      cache: "no-store",
      redirect: "manual",
      method: input === undefined ? "GET" : "POST",
      ...(input === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(input) }),
    });
  } catch {
    throw new AuthenticationError("Connection unavailable. Check your connection and try again.", 0);
  }
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400))
    throw new AuthenticationError("Sign-in could not be opened. Reload this page to try again.", response.status);
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new AuthenticationError(
      "The server returned an invalid sign-in response. Please try again.",
      response.status,
    );
  }
  if (!response.ok) {
    const message =
      value !== null && typeof value === "object" && "error" in value && typeof value.error === "string"
        ? value.error
        : "Sign-in could not be completed. Please try again.";
    throw new AuthenticationError(message, response.status);
  }
  return value;
}
