export function githubLinkbackBody(input: {
  issueId: string;
  incarnation: string;
  title: string;
  description: string | null;
  privateTeam: boolean;
  attachments: { title: string; url: string }[];
  issueUrl: string;
}) {
  const marker = `<!-- kanbun-issue-linkback:${input.issueId}:${input.incarnation} -->`;
  const sections = [
    "Issue context from Kanbun",
    ...(input.privateTeam ? [] : [`**${input.title.replace(/\s+/g, " ").trim()}**`]),
    input.description?.trim().slice(0, 48_000) || "",
    ...input.attachments.slice(0, 100).map((attachment) => {
      let url: URL;
      try {
        url = new URL(attachment.url);
      } catch {
        return "";
      }
      if (url.protocol !== "https:" || url.username || url.password) return "";
      const title = attachment.title
        .replaceAll("[", " ")
        .replaceAll("]", " ")
        .replaceAll("\\", " ")
        .replaceAll("\r", " ")
        .replaceAll("\n", " ");
      return `- [${title}](${url.href})`;
    }),
    `[Open issue in Kanbun](${input.issueUrl})`,
    marker,
  ].filter(Boolean);
  const footer = sections.splice(-2).join("\n\n");
  const body = sections.join("\n\n");
  const available = Math.max(0, 60_000 - footer.length - 40);
  return {
    body: `${body.slice(0, available)}${body.length > available ? "\n\n[Issue context truncated]" : ""}\n\n${footer}`,
    marker,
  };
}
