export function appUrl(value = "https://kanbun.ai"): URL {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) {
    throw new Error("KANBUN_DESKTOP_URL must use HTTPS (HTTP is allowed for loopback development).");
  }
  return url;
}

export function linkAction(value: string, application: URL): "internal" | "external" | "deny" {
  try {
    const url = new URL(value);
    if (url.username || url.password) return "deny";
    if (url.origin === application.origin) return "internal";
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? "external" : "deny";
  } catch {
    return "deny";
  }
}

/** Only an explicit integrations-settings link may open our origin in the system browser. */
export function browserSettingsDestination(value: string, application: URL): string | null {
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.origin !== application.origin ||
      url.pathname !== "/" ||
      url.search !== "?kanbun-browser=integrations" ||
      url.hash !== "#settings/integrations"
    )
      return null;
    return new URL("/#settings/integrations", application).href;
  } catch {
    return null;
  }
}

/** Callback URLs only select a route; the server still checks the requesting session's cookie. */
export function signInDestination(value: string, application: URL): string | null {
  try {
    const url = new URL(value.trim());
    if (url.username || url.password || url.search) return null;
    let hash: string;
    if (url.protocol === "kanbun:") {
      if (url.hostname !== "signin" || url.port || url.hash) return null;
      hash = `#signin${url.pathname}`;
    } else {
      if (url.origin !== application.origin || url.pathname !== "/") return null;
      hash = url.hash;
    }
    const match = /^#signin\/([A-Za-z0-9_-]{43})\/([^/]+)$/u.exec(hash);
    if (!match) return null;
    const returnTo = decodeURIComponent(match[2]!);
    if (
      !["#issues", "#my-issues", "#inbox", "#settings", "#settings/integrations", "#members"].includes(returnTo) &&
      !/^#issues\/[A-Za-z0-9_-]+$/u.test(returnTo) &&
      !/^#invite\/[A-Za-z0-9_-]{43}$/u.test(returnTo)
    )
      return null;
    return `${application.origin}/#signin/${match[1]}/${encodeURIComponent(returnTo)}`;
  } catch {
    return null;
  }
}
