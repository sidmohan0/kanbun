import { test } from "node:test";
import assert from "node:assert/strict";
import { createPreviewChecks, PreviewCheckError } from "./preview-checks.mjs";

const active = "48c38362-b311-49d2-a658-959d38289a70";
const config = {
  account_id: "account",
  name: "preview",
  vars: {
    APP_ORIGIN: "https://app.example",
    ACCESS_ISSUER: "https://login.example",
  },
  d1_databases: [{ binding: "ACCOUNTS", database_id: "accounts" }],
};
function fixture({ apiStatus = 200, httpStatus = 302, alternative = false, d1 = true, socket = true } = {}) {
  const requests = [];
  return {
    requests,
    checks: createPreviewChecks(config, "secret-token", {
      async fetchImpl(url, options = {}) {
        requests.push({ url, options });
        if (url.startsWith("https://api.cloudflare.com/")) {
          if (apiStatus !== 200)
            return Response.json({ success: false, errors: ["private-provider-details"] }, { status: apiStatus });
          let result;
          if (url.endsWith("/deployments"))
            result = { deployments: [{ versions: [{ version_id: active, percentage: 100 }] }] };
          else if (url.endsWith("/subdomain")) result = { enabled: alternative, previews_enabled: false };
          else if (url.includes("/d1/")) result = [{ success: d1, results: [{ healthy: d1 ? 1 : 0 }] }];
          else throw new Error("Unexpected API route");
          return Response.json({ success: true, result });
        }
        if (url.endsWith("/certs")) return Response.json({ keys: [{ kty: "RSA" }] });
        return new Response(null, {
          status: httpStatus,
          headers: { location: "https://login.example/login?private=marker" },
        });
      },
      async checkWebSocket(origin, issuer) {
        assert.equal(origin, config.vars.APP_ORIGIN);
        assert.equal(issuer, config.vars.ACCESS_ISSUER);
        if (!socket) throw new Error("private-socket-details");
      },
    }),
  };
}

test("shared probes read the Access boundary and D1 without writes, public credentials, or redirect URLs in results", async () => {
  const { checks, requests } = fixture();
  assert.equal(await checks.version(), active);
  const result = await checks.smoke(active);
  assert.equal(result.length, 5);
  assert.deepEqual(result.at(-1), { path: "/sync/connect", transport: "websocket", status: 302 });
  assert.deepEqual(await checks.d1Ping(), { query: "SELECT 1 AS healthy", pass: true });
  assert(!JSON.stringify(result).includes("private"));
  const query = requests.filter((entry) => entry.options.method === "POST");
  assert.equal(query.length, 1);
  assert.deepEqual(JSON.parse(query[0].options.body), { sql: "SELECT 1 AS healthy" });
  for (const entry of requests.filter((entry) => !entry.url.startsWith("https://api.cloudflare.com/")))
    assert.equal(entry.options.headers, undefined);
});

test("unexpected anonymous app access, alternative URLs and socket upgrades fail the same shared gate", async () => {
  for (const options of [{ httpStatus: 200 }, { alternative: true }, { socket: false }]) {
    const { checks } = fixture(options);
    await assert.rejects(
      checks.smoke(active),
      (error) => error instanceof PreviewCheckError && !error.message.includes("private"),
    );
  }
});

test("D1 query errors and Cloudflare authentication failures fail without provider response bodies", async () => {
  await assert.rejects(fixture({ d1: false }).checks.d1Ping(), /Accounts database query failed/);
  await assert.rejects(fixture({ apiStatus: 403 }).checks.version(), (error) => {
    assert.equal(error.status, 403);
    assert(!error.message.includes("private"));
    return true;
  });
});

function nativeFixture({ exposed = false, wrongMethod = false, leakedIdentity = false, socket = true } = {}) {
  const nativeConfig = { ...config, vars: { APP_ORIGIN: config.vars.APP_ORIGIN, AUTH_MODE: "email" } };
  const requests = [];
  const checks = createPreviewChecks(nativeConfig, "secret-token", {
    async fetchImpl(url, options = {}) {
      requests.push({ url, options });
      if (url.startsWith("https://api.cloudflare.com/")) {
        const result = url.endsWith("/deployments")
          ? { deployments: [{ versions: [{ version_id: active, percentage: 100 }] }] }
          : { enabled: false, previews_enabled: false };
        return Response.json({ success: true, result });
      }
      const path = new URL(url).pathname;
      if (path === "/")
        return new Response("<!doctype html><div id='root'></div>", { headers: { "content-type": "text/html" } });
      if (path === "/api/auth/config")
        return Response.json({
          method: wrongMethod ? "access" : "email",
          authenticated: false,
          siteKey: "public-site-key",
          ...(leakedIdentity ? { email: "private@example.com" } : {}),
        });
      return Response.json({ error: "Sign in required", authentication: "email" }, { status: exposed ? 200 : 401 });
    },
    async checkWebSocket(origin, issuer, method) {
      assert.equal(origin, config.vars.APP_ORIGIN);
      assert.equal(issuer, undefined);
      assert.equal(method, "email");
      if (!socket) throw new Error("private-socket-body");
    },
  });
  return { checks, requests };
}

test("native session probes allow the public login shell and require anonymous API and WebSocket denial", async () => {
  const { checks, requests } = nativeFixture();
  const result = await checks.smoke(active);
  assert.deepEqual(
    result.find((row) => row.path === "/"),
    { path: "/", status: 200 },
  );
  assert.equal(result.find((row) => row.path === "/api/auth/config").status, 200);
  assert.equal(result.find((row) => row.path === "/sync/document").status, 401);
  assert.deepEqual(result.at(-1), { path: "/sync/connect", transport: "websocket", status: 401 });
  assert(requests.every((request) => request.options.method === undefined));
  assert(!requests.some((request) => request.url.includes("/certs")));
  assert(!JSON.stringify(result).includes("private"));
});

test("native probes fail open data routes, identity leaks, wrong login methods and anonymous socket admission", async () => {
  for (const options of [{ exposed: true }, { wrongMethod: true }, { leakedIdentity: true }, { socket: false }]) {
    await assert.rejects(nativeFixture(options).checks.smoke(active), (error) => {
      assert(error instanceof PreviewCheckError);
      assert(!error.message.includes("private"));
      return true;
    });
  }
});
