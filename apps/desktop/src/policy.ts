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
