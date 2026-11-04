import { expect, it } from "vitest";
import { githubPreviewLinks } from "../src/github-previews";

const now = new Date("2026-11-03T12:00:00.000Z");

it("parses unique HTTPS Markdown preview links and selects an icon from the host", () => {
  expect(
    githubPreviewLinks(
      [
        {
          updatedAt: "2026-11-02T12:00:00.000Z",
          body: [
            "[Vercel Preview](https://kanbun-pr.vercel.app)",
            "[Netlify Preview](https://review--kanbun.netlify.app)",
            "[Cloudflare Preview](https://kanbun.pages.dev)",
            "[AWS Preview](https://main.d123.amplifyapp.com)",
            "[Custom Preview](https://preview.example.org/path?mode=light)",
            "[Readme](https://example.org/readme)",
            "![Image Preview](https://example.org/image.png)",
            "[Insecure Preview](http://example.org)",
            "[Credential Preview](https://user:secret@example.org)",
          ].join("\n"),
        },
      ],
      now,
    ),
  ).toEqual([
    {
      label: "Vercel Preview",
      url: "https://kanbun-pr.vercel.app/",
      icon: "triangle",
      updatedAt: "2026-11-02T12:00:00.000Z",
    },
    {
      label: "Netlify Preview",
      url: "https://review--kanbun.netlify.app/",
      icon: "network",
      updatedAt: "2026-11-02T12:00:00.000Z",
    },
    {
      label: "Cloudflare Preview",
      url: "https://kanbun.pages.dev/",
      icon: "cloud",
      updatedAt: "2026-11-02T12:00:00.000Z",
    },
    {
      label: "AWS Preview",
      url: "https://main.d123.amplifyapp.com/",
      icon: "server",
      updatedAt: "2026-11-02T12:00:00.000Z",
    },
    {
      label: "Custom Preview",
      url: "https://preview.example.org/path?mode=light",
      icon: "external",
      updatedAt: "2026-11-02T12:00:00.000Z",
    },
  ]);
});

it("drops inactive and future-dated links, prefers the most recently edited copy, and caps previews", () => {
  const sources = [
    { updatedAt: "2026-10-01T11:59:59.000Z", body: "[Expired Preview](https://old.example.org)" },
    { updatedAt: "2026-11-04T12:00:00.000Z", body: "[Future Preview](https://future.example.org)" },
    { updatedAt: "2026-11-01T12:00:00.000Z", body: "[Earlier Preview](https://same.example.org)" },
    { updatedAt: "2026-11-02T12:00:00.000Z", body: "[Latest Preview](https://same.example.org)" },
    {
      updatedAt: "2026-11-03T11:00:00.000Z",
      body: Array.from(
        { length: 5 },
        (_, index) => `[Staging ${index} Preview](https://preview-${index}.example.org)`,
      ).join("\n"),
    },
  ];
  const links = githubPreviewLinks(sources, now);
  expect(links).toHaveLength(6);
  expect(links.some((link) => link.label === "Expired Preview" || link.label === "Future Preview")).toBe(false);
  expect(links.find((link) => link.url === "https://same.example.org/")?.label).toBe("Latest Preview");
  expect(
    githubPreviewLinks(
      [
        {
          updatedAt: "2026-11-03T11:00:00.000Z",
          body: Array.from(
            { length: 15 },
            (_, index) => `[Staging ${index} Preview](https://preview-${index}.example.org)`,
          ).join("\n"),
        },
      ],
      now,
    ),
  ).toHaveLength(12);
});
