import { expect, it } from "vitest";
import { githubDeploymentPreviewLinks, githubPreviewLinks, mergeGitHubPreviewLinks } from "../src/github-previews";

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

it("detects fresh successful transient deployments for the supported preview providers on the current head", () => {
  const sha = "a".repeat(40);
  const deployments = [
    {
      id: 1,
      sha,
      createdAt: "2026-11-02T12:00:00.000Z",
      transientEnvironment: true,
      statuses: [
        {
          state: "success",
          environmentUrl: "https://kanbun-pr.vercel.app",
          updatedAt: "2026-11-02T13:00:00.000Z",
        },
      ],
    },
    {
      id: 2,
      sha,
      createdAt: "2026-11-02T12:00:00.000Z",
      transientEnvironment: true,
      statuses: [
        {
          state: "success",
          environmentUrl: "https://review--kanbun.netlify.app",
          updatedAt: "2026-11-02T13:00:00.000Z",
        },
      ],
    },
    {
      id: 3,
      sha,
      createdAt: "2026-11-02T12:00:00.000Z",
      transientEnvironment: true,
      statuses: [
        {
          state: "success",
          environmentUrl: "https://kanbun.pages.dev",
          updatedAt: "2026-11-02T13:00:00.000Z",
        },
      ],
    },
    {
      id: 4,
      sha,
      createdAt: "2026-11-02T12:00:00.000Z",
      transientEnvironment: true,
      statuses: [
        {
          state: "success",
          environmentUrl: "https://main.d123.amplifyapp.com",
          updatedAt: "2026-11-02T13:00:00.000Z",
        },
      ],
    },
    {
      id: 5,
      sha,
      createdAt: "2026-11-02T12:00:00.000Z",
      transientEnvironment: false,
      statuses: [
        {
          state: "success",
          environmentUrl: "https://production.vercel.app",
          updatedAt: "2026-11-02T13:00:00.000Z",
        },
      ],
    },
    {
      id: 6,
      sha: "b".repeat(40),
      createdAt: "2026-11-02T12:00:00.000Z",
      transientEnvironment: true,
      statuses: [
        {
          state: "success",
          environmentUrl: "https://other-head.netlify.app",
          updatedAt: "2026-11-02T13:00:00.000Z",
        },
      ],
    },
  ];
  expect(githubDeploymentPreviewLinks(deployments, sha, now)).toEqual([
    {
      label: "Vercel Preview",
      url: "https://kanbun-pr.vercel.app/",
      icon: "triangle",
      updatedAt: "2026-11-02T13:00:00.000Z",
    },
    {
      label: "Netlify Preview",
      url: "https://review--kanbun.netlify.app/",
      icon: "network",
      updatedAt: "2026-11-02T13:00:00.000Z",
    },
    {
      label: "Cloudflare Preview",
      url: "https://kanbun.pages.dev/",
      icon: "cloud",
      updatedAt: "2026-11-02T13:00:00.000Z",
    },
    {
      label: "AWS Amplify Preview",
      url: "https://main.d123.amplifyapp.com/",
      icon: "server",
      updatedAt: "2026-11-02T13:00:00.000Z",
    },
  ]);
});

it("ignores stale, unsafe, failing, non-preview, and non-provider deployment status URLs", () => {
  const sha = "a".repeat(40);
  const base = {
    sha,
    createdAt: "2026-11-02T12:00:00.000Z",
    transientEnvironment: true,
    statuses: [] as { state: string; environmentUrl: string | null; updatedAt: string }[],
  };
  const links = githubDeploymentPreviewLinks(
    [
      {
        ...base,
        id: 1,
        statuses: [
          {
            state: "success",
            environmentUrl: "https://kanbun.vercel.app",
            updatedAt: "2026-10-01T11:59:59.000Z",
          },
        ],
      },
      {
        ...base,
        id: 2,
        statuses: [
          { state: "failure", environmentUrl: "https://broken.vercel.app", updatedAt: "2026-11-02T13:00:00.000Z" },
        ],
      },
      {
        ...base,
        id: 3,
        statuses: [
          {
            state: "success",
            environmentUrl: "https://user:password@safe.netlify.app",
            updatedAt: "2026-11-02T13:00:00.000Z",
          },
        ],
      },
      {
        ...base,
        id: 4,
        statuses: [
          {
            state: "success",
            environmentUrl: "https://preview.evil-vercel.app",
            updatedAt: "2026-11-02T13:00:00.000Z",
          },
        ],
      },
      {
        ...base,
        id: 5,
        statuses: [
          {
            state: "success",
            environmentUrl: "https://previously-live.vercel.app",
            updatedAt: "2026-11-02T10:00:00.000Z",
          },
          {
            state: "failure",
            environmentUrl: "https://previously-live.vercel.app",
            updatedAt: "2026-11-03T11:00:00.000Z",
          },
        ],
      },
    ],
    sha,
    now,
  );
  expect(links).toEqual([]);
  const markdown = githubPreviewLinks(
    [{ body: "[Custom Preview](https://manual.example.org)", updatedAt: "2026-11-02T12:00:00.000Z" }],
    now,
  );
  expect(mergeGitHubPreviewLinks(markdown, markdown)).toHaveLength(1);
});
