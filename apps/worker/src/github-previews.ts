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

export type GitHubDeploymentPreviewSource = {
  id: number;
  sha: string;
  createdAt: string;
  transientEnvironment: boolean;
  statuses: readonly { state: string; environmentUrl: string | null; updatedAt: string }[];
};

function providerPreview(url: string): Pick<GitHubPreviewLink, "label" | "icon"> | null {
  const host = new URL(url).hostname.toLowerCase();
  if (host === "vercel.app" || host.endsWith(".vercel.app")) return { label: "Vercel Preview", icon: "triangle" };
  if (host === "netlify.app" || host.endsWith(".netlify.app")) return { label: "Netlify Preview", icon: "network" };
  if (host === "pages.dev" || host.endsWith(".pages.dev") || host === "workers.dev" || host.endsWith(".workers.dev"))
    return { label: "Cloudflare Preview", icon: "cloud" };
  if (host === "amplifyapp.com" || host.endsWith(".amplifyapp.com"))
    return { label: "AWS Amplify Preview", icon: "server" };
  return null;
}

/** Read only current-head transient deployments with a successful, fresh provider environment URL. */
export function githubDeploymentPreviewLinks(
  deployments: readonly GitHubDeploymentPreviewSource[],
  headSha: string,
  now = new Date(),
): GitHubPreviewLink[] {
  const cutoff = now.getTime() - GITHUB_PREVIEW_MAX_AGE_MS;
  const links: GitHubPreviewLink[] = [];
  const seen = new Set<string>();
  const recentFirst = [...deployments].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  for (const deployment of recentFirst) {
    const createdAt = Date.parse(deployment.createdAt);
    if (
      deployment.sha.toLowerCase() !== headSha.toLowerCase() ||
      !deployment.transientEnvironment ||
      !Number.isFinite(createdAt) ||
      createdAt > now.getTime() + 5 * 60 * 1000
    )
      continue;
    const status = [...deployment.statuses].sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    )[0];
    if (!status || status.state !== "success") continue;
    const updatedAt = Date.parse(status.updatedAt);
    const url = status.environmentUrl ? safePreviewUrl(status.environmentUrl) : null;
    const provider = url ? providerPreview(url) : null;
    if (
      !url ||
      !provider ||
      !Number.isFinite(updatedAt) ||
      updatedAt < cutoff ||
      updatedAt > now.getTime() + 5 * 60 * 1000 ||
      seen.has(url)
    )
      continue;
    seen.add(url);
    links.push({ ...provider, url, updatedAt: new Date(updatedAt).toISOString() });
    if (links.length === maximumLinks) break;
  }
  return links;
}

export function mergeGitHubPreviewLinks(...groups: readonly (readonly GitHubPreviewLink[])[]): GitHubPreviewLink[] {
  const sorted = groups.flat().sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  const seen = new Set<string>();
  return sorted
    .filter((preview) => {
      if (seen.has(preview.url)) return false;
      seen.add(preview.url);
      return true;
    })
    .slice(0, maximumLinks);
}

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
