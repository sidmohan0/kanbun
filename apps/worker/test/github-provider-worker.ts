export type GithubFixtureResponse = {
  method: string;
  path: string;
  host?: "api.github.com" | "github.com";
  status?: number;
  body: unknown;
  authorization?: string;
  once?: boolean;
  gate?: string;
};
export type GithubFixtureRequest = {
  method: string;
  url: string;
  authorization: string | null;
  body: string;
};

let responses: GithubFixtureResponse[] = [];
const requests: GithubFixtureRequest[] = [];
const gates = new Map<string, { promise: Promise<void>; release: () => void }>();
function gate(name: string) {
  let value = gates.get(name);
  if (!value) {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    value = { promise, release };
    gates.set(name, value);
  }
  return value;
}

/** Test-only private service. Provider calls are actual Worker fetches; nothing reaches GitHub. */
export default {
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.hostname === "fixture") {
      if (url.pathname === "/responses" && request.method === "POST") {
        responses = (await request.json()) as GithubFixtureResponse[];
        return Response.json({ ok: true });
      }
      if (url.pathname === "/requests") return Response.json(requests);
      if (url.pathname.startsWith("/release/") && request.method === "POST") {
        gate(decodeURIComponent(url.pathname.slice("/release/".length))).release();
        return Response.json({ ok: true });
      }
      return new Response("Not found", { status: 404 });
    }
    if (url.protocol !== "https:" || !["api.github.com", "github.com"].includes(url.hostname)) {
      return new Response("Unexpected provider origin", { status: 502 });
    }
    const authorization = request.headers.get("Authorization");
    requests.push({ method: request.method, url: request.url, authorization, body: await request.text() });
    const response = responses.find(
      (candidate) =>
        candidate.method === request.method &&
        candidate.path === `${url.pathname}${url.search}` &&
        (candidate.host ?? "api.github.com") === url.hostname &&
        (candidate.authorization === undefined || candidate.authorization === authorization),
    );
    if (!response) return new Response("Unconfigured provider request", { status: 404 });
    if (response.once) responses.splice(responses.indexOf(response), 1);
    if (response.gate) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          gate(response.gate).promise,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error("Fixture response gate timed out")), 15000);
          }),
        ]);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    }
    return Response.json(response.body, { status: response.status ?? 200 });
  },
};
