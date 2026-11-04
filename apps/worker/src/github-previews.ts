import { GITHUB_PREVIEW_MAX_AGE_MS, type GitHubPreviewLink } from "@kanbun/events";

const maximumLinks = 12;
const markdownLinkPattern = String.raw`(?<!!)\[([^\]\r\n]{1,120})\]\(\s*(https:\/\/[^\s)<>]+)(?:\s+[^)]*)?\)`;

function safePreviewUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function iconFor(url: string): GitHubPreviewLink["icon"] {
  const host = new URL(url).hostname.toLowerCase();
  if (host === "vercel.app" || host.endsWith(".vercel.app") || host === "vercel.com" || host.endsWith(".vercel.com"))
    return "triangle";
  if (
    host === "netlify.app" ||
    host.endsWith(".netlify.app") ||
    host === "netlify.com" ||
    host.endsWith(".netlify.com")
  )
    return "network";
  if (
    host === "pages.dev" ||
    host.endsWith(".pages.dev") ||
    host === "workers.dev" ||
    host.endsWith(".workers.dev") ||
    host.includes("cloudflare")
  )
    return "cloud";
  if (
    host === "amplifyapp.com" ||
    host.endsWith(".amplifyapp.com") ||
    host === "amazonaws.com" ||
    host.endsWith(".amazonaws.com")
  )
    return "server";
  return "external";
}

type PreviewSource = { body: string | null; updatedAt: string };

/** Parse only HTTPS Markdown links labeled as previews from an eligible author/bot source. */
export function githubPreviewLinks(sources: readonly PreviewSource[], now = new Date()): GitHubPreviewLink[] {
  const cutoff = now.getTime() - GITHUB_PREVIEW_MAX_AGE_MS;
  const results: GitHubPreviewLink[] = [];
  const seen = new Set<string>();
  const recentFirst = [...sources].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  for (const source of recentFirst) {
    const updatedAt = Date.parse(source.updatedAt);
    if (!Number.isFinite(updatedAt) || updatedAt < cutoff || updatedAt > now.getTime() + 5 * 60 * 1000) continue;
    for (const match of source.body?.matchAll(new RegExp(markdownLinkPattern, "giu")) ?? []) {
      const label = match[1]?.trim();
      const url = safePreviewUrl(match[2] ?? "");
      if (!label || !/preview$/i.test(label) || !url || seen.has(url)) continue;
      seen.add(url);
      results.push({ label, url, icon: iconFor(url), updatedAt: new Date(updatedAt).toISOString() });
      if (results.length === maximumLinks) return results;
    }
  }
  return results;
}
