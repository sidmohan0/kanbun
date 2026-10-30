import { request as httpsRequest } from "node:https";

/** Fixed check names and messages keep provider bodies, headers, URLs, and private rows out of evidence. */
export class PreviewCheckError extends Error {
  constructor(check, message, status = null) {
    super(message);
    this.check = check;
    this.status = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
  }
}

export function accessRedirect(status, location, issuer) {
  try {
    return status === 302 && new URL(location).origin === issuer;
  } catch {
    return false;
  }
}

function websocketGate(origin, issuer) {
  return new Promise((resolve, reject) => {
    const failure = () => reject(new PreviewCheckError("access-websocket", "Anonymous WebSocket gate failed"));
    const socket = httpsRequest(
      origin + "/sync/connect",
      {
        headers: {
          Upgrade: "websocket",
          Connection: "Upgrade",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
          Origin: origin,
        },
      },
      (response) => {
        response.resume();
        if (accessRedirect(response.statusCode, response.headers.location, issuer)) resolve();
        else failure();
      },
    );
    socket.on("upgrade", (_response, connection) => {
      connection.destroy();
      failure();
    });
    socket.on("error", failure);
    socket.setTimeout(15000, () => socket.destroy(new Error("WebSocket probe timed out")));
    socket.end();
  });
}

/** Read-only probes shared by releases and scheduled health checks. No deploy or rollback entry point. */
export function createPreviewChecks(config, token, { fetchImpl = fetch, checkWebSocket = websocketGate } = {}) {
  const prefix = `https://api.cloudflare.com/client/v4/accounts/${config.account_id}/workers/scripts/${config.name}`;
  async function request(url, options = {}) {
    let response;
    try {
      response = await fetchImpl(url, {
        ...options,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new PreviewCheckError("cloudflare-api", "Cloudflare API unavailable");
    }
    let body;
    try {
      body = await response.json();
    } catch {
      throw new PreviewCheckError("cloudflare-api", "Invalid Cloudflare API response", response.status);
    }
    if (!response.ok || body?.success !== true)
      throw new PreviewCheckError("cloudflare-api", "Cloudflare API request failed", response.status);
    return body.result;
  }
  const api = (path) => request(prefix + path);
  async function version() {
    const result = await api("/deployments");
    const versions = result?.deployments?.[0]?.versions;
    if (
      versions?.length !== 1 ||
      versions[0].percentage !== 100 ||
      !/^[a-f0-9-]{36}$/i.test(versions[0].version_id ?? "")
    )
      throw new PreviewCheckError("active-version", "Expected a single fully deployed version");
    return versions[0].version_id;
  }
  async function smoke(expected) {
    if ((await version()) !== expected)
      throw new PreviewCheckError("active-version", "Active version changed unexpectedly");
    const domains = await api("/subdomain");
    if (domains?.enabled !== false || domains?.previews_enabled !== false)
      throw new PreviewCheckError("alternative-urls", "Alternative Worker URLs are enabled");
    const results = [];
    for (const path of ["/", "/api/context", "/sync/bootstrap?clientId=release-probe", "/sync/connect"]) {
      let response;
      try {
        response = await fetchImpl(config.vars.APP_ORIGIN + path, {
          redirect: "manual",
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        throw new PreviewCheckError("access-http", "Application HTTPS unavailable");
      }
      if (!accessRedirect(response.status, response.headers.get("location"), config.vars.ACCESS_ISSUER))
        throw new PreviewCheckError("access-http", "Anonymous HTTP Access gate failed", response.status);
      results.push({ path, status: response.status });
    }
    let certificates;
    try {
      const response = await fetchImpl(config.vars.ACCESS_ISSUER + "/cdn-cgi/access/certs", {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error();
      certificates = await response.json();
    } catch {
      throw new PreviewCheckError("access-keys", "Access verification keys unavailable");
    }
    if (!certificates?.keys?.some((key) => key.kty === "RSA"))
      throw new PreviewCheckError("access-keys", "Access verification keys unavailable");
    try {
      await checkWebSocket(config.vars.APP_ORIGIN, config.vars.ACCESS_ISSUER);
    } catch {
      throw new PreviewCheckError("access-websocket", "Anonymous WebSocket gate failed");
    }
    if ((await version()) !== expected)
      throw new PreviewCheckError("active-version", "Active version changed during checks");
    results.push({ path: "/sync/connect", transport: "websocket", status: 302 });
    return results;
  }
  async function d1Ping() {
    const database = config.d1_databases.find((entry) => entry.binding === "ACCOUNTS");
    if (!database) throw new PreviewCheckError("d1-connectivity", "Accounts database binding is unavailable");
    const rows = await request(
      `https://api.cloudflare.com/client/v4/accounts/${config.account_id}/d1/database/${database.database_id}/query`,
      { method: "POST", body: JSON.stringify({ sql: "SELECT 1 AS healthy" }) },
    );
    if (rows?.[0]?.success !== true || rows[0].results?.[0]?.healthy !== 1)
      throw new PreviewCheckError("d1-connectivity", "Accounts database query failed");
    return { query: "SELECT 1 AS healthy", pass: true };
  }
  return { request, api, version, smoke, d1Ping };
}
