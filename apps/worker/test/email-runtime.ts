import { startPreviewRuntime } from "./preview-runtime";

export type CapturedAuthEmail = { from: string; to: string[]; subject: string; text: string };
export const LOGIN_COOKIE = "__Host-kanbun-login";
export const SESSION_COOKIE = "__Host-kanbun-session";
export const HUMAN_TOKEN = "fixture-human-token";

export function emailLink(email: CapturedAuthEmail): URL {
  const value = email.text.match(/https:\/\/[^\s]+/u)?.[0];
  if (!value) throw new Error("Captured sign-in email has no link");
  return new URL(value);
}
export function linkToken(link: URL): string {
  const token = link.hash.split("/")[1];
  if (!token) throw new Error("Captured sign-in link has no token");
  return decodeURIComponent(token);
}

/** Actual HTTP requests with an explicit cookie jar; browser tests separately enforce cookie flags. */
export function nativeAgent(runtime: Awaited<ReturnType<typeof startPreviewRuntime>>) {
  const cookies = new Map<string, string>();
  const header = () => [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  async function request(path: string, init: RequestInit = {}, withOrigin = true) {
    const headers = new Headers(init.headers);
    if (withOrigin && !headers.has("Origin")) headers.set("Origin", runtime.appOrigin);
    if (!headers.has("Cookie") && cookies.size) headers.set("Cookie", header());
    const response = await fetch(new URL(path, runtime.origin), { ...init, headers });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0]!;
      const equal = pair.indexOf("=");
      const name = pair.slice(0, equal), value = pair.slice(equal + 1);
      if (/max-age=0(?:;|$)/iu.test(cookie) || !value) cookies.delete(name);
      else cookies.set(name, value);
    }
    return response;
  }
  const json = (path: string, body: unknown, init: RequestInit = {}, withOrigin = true) => request(path, {
    ...init, method: "POST", headers: { "content-type": "application/json", ...Object.fromEntries(new Headers(init.headers)) }, body: JSON.stringify(body),
  }, withOrigin);
  return {
    cookies, cookieHeader: header, fetch: request, json,
    requestLink: (email: string, returnTo = "#issues", turnstileToken = HUMAN_TOKEN) => json("/api/auth/request", { email, returnTo, turnstileToken }),
    inspect: (token: string) => json("/api/auth/inspect", { token }),
    consume: (token: string) => json("/api/auth/consume", { token }),
    logout: () => json("/api/auth/logout", {}),
  };
}

export function startEmailRuntime(options: { initialAuthMode?: "preview" | "email" } = {}) {
  return startPreviewRuntime({ ownerEmail: "owner@datafog.ai", emailAuth: true, ...options });
}
