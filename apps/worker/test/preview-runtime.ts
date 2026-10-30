import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createTestHarness, type Unstable_RawConfig } from "wrangler";
import type { D1Database } from "@cloudflare/workers-types";
import type { BootstrapResponse, WorkspaceContext } from "@kanbun/sync";

export type PreviewConnection = {
  messages: unknown[];
  closed: Promise<{ code: number }>;
  send(message: string): void;
  close(): void;
};
export type PreviewSnapshot = BootstrapResponse & {
  clients: Record<string, unknown>[];
  events: Record<string, unknown>[];
  directory: {
    accounts: Record<string, unknown>[];
    identities: Record<string, unknown>[];
    members: Record<string, unknown>[];
  };
};

export async function startPreviewRuntime({
  ownerEmail = "owner@example.com",
  subject = "access-owner-subject",
  name = "Preview owner",
  workspaceId = "019a0000-0000-7000-8000-000000009000",
  localDev = false,
}: { ownerEmail?: string; subject?: string; name?: string; workspaceId?: string; localDev?: boolean } = {}) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const instance = randomUUID().slice(0, 8);
  const certWorker = `preview-test-certs-${instance}`;
  const assetWorker = `preview-test-assets-${instance}`;
  const local = JSON.parse(await readFile(new URL("../wrangler.json", import.meta.url), "utf8")) as Unstable_RawConfig;
  const issuer = "https://test-access.cloudflareaccess.com";
  const audience = "protected-preview-test-audience";
  const appOrigin = "https://preview.example.test";
  const pair = await generateKeyPair("RS256", { extractable: true });
  const publicKey = await exportJWK(pair.publicKey);
  const token = (overrides: Record<string, unknown> = {}) =>
    new SignJWT({
      iss: issuer,
      aud: audience,
      sub: subject,
      email: ownerEmail,
      name,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...overrides,
    })
      .setProtectedHeader({ alg: "RS256", kid: "preview-test-key" })
      .sign(pair.privateKey);
  const harness = createTestHarness({
    root,
    workers: [
      {
        config: {
          ...local,
          name: `kanbun-preview-test-${instance}`,
          vars: {
            LOCAL_DEV: localDev ? "true" : "false",
            AUTH_MODE: "preview",
            ACCESS_ISSUER: issuer,
            ACCESS_AUDIENCE: audience,
            PREVIEW_OWNER_EMAIL: ownerEmail,
            PREVIEW_WORKSPACE_ID: workspaceId,
            PREVIEW_WORKSPACE_NAME: "Private preview",
            APP_ORIGIN: appOrigin,
          },
          d1_databases: [
            {
              binding: "ACCOUNTS",
              database_name: "preview-test-accounts",
              database_id: "00000000-0000-4000-8000-000000000000",
              migrations_dir: "../../packages/model/migrations/accounts",
            },
          ],
          services: [
            { binding: "ACCESS_JWKS", service: certWorker },
            { binding: "ASSETS", service: assetWorker },
          ],
        },
      },
      {
        config: {
          name: certWorker,
          main: "test/certs-worker.ts",
          compatibility_date: "2026-10-29",
          vars: {
            JWKS: JSON.stringify({ keys: [{ ...publicKey, kid: "preview-test-key", alg: "RS256", use: "sig" }] }),
          },
        },
      },
      { config: { name: assetWorker, main: "test/assets-worker.ts", compatibility_date: "2026-10-29" } },
    ],
  });
  try {
    const { url } = await harness.listen();
    await harness.getWorker().applyD1Migrations("ACCOUNTS");
    const environment = await harness.getWorker<{ ACCOUNTS: D1Database }>().getEnv();
    const request = async (path: string, init: RequestInit = {}, assertion?: string | null) => {
      const headers = new Headers(init.headers);
      if (assertion !== null) headers.set("Cf-Access-Jwt-Assertion", assertion ?? (await token()));
      if (!headers.has("Origin")) headers.set("Origin", appOrigin);
      return fetch(new URL(path, url), { ...init, headers });
    };
    return {
      origin: url.origin,
      appOrigin,
      ownerEmail,
      workspaceId,
      token,
      fetch: request,
      async context(assertion?: string) {
        const response = await request("/api/context", {}, assertion);
        if (!response.ok) throw new Error(`Preview context failed (${response.status}): ${await response.text()}`);
        return response.json() as Promise<WorkspaceContext>;
      },
      async inspect(): Promise<PreviewSnapshot> {
        const response = await request("/sync/bootstrap?clientId=preview-inspector");
        if (!response.ok) throw new Error(`Preview bootstrap failed (${response.status}): ${await response.text()}`);
        const bootstrap = (await response.json()) as BootstrapResponse;
        const storage = await harness.getWorker().getDurableObjectStorage("WORKSPACES", { name: workspaceId });
        return {
          ...bootstrap,
          clients: await storage.exec(
            "SELECT client_id, user_id, branch_id, last_mutation_id FROM sync_client ORDER BY client_id",
          ),
          events: await storage.exec("SELECT * FROM event_log ORDER BY seq"),
          directory: {
            accounts: (await environment.ACCOUNTS.prepare("SELECT * FROM accounts ORDER BY id").all()).results,
            identities: (await environment.ACCOUNTS.prepare("SELECT * FROM auth_identities ORDER BY id").all()).results,
            members: (await environment.ACCOUNTS.prepare("SELECT * FROM workspace_members ORDER BY account_id").all())
              .results,
          },
        };
      },
      async connect(
        clientId: string,
        assertion?: string,
        origin: string | null = appOrigin,
      ): Promise<PreviewConnection> {
        const response = await harness.getWorker().fetch(`/sync/connect?clientId=${encodeURIComponent(clientId)}`, {
          headers: {
            Upgrade: "websocket",
            ...(origin === null ? {} : { Origin: origin }),
            "Cf-Access-Jwt-Assertion": assertion ?? (await token()),
          },
        });
        if (response.status !== 101 || !response.webSocket)
          throw new Error(`Preview socket failed (${response.status}): ${await response.text()}`);
        const socket = response.webSocket;
        const messages: unknown[] = [];
        let finished = false;
        const closed = new Promise<{ code: number }>((resolve) =>
          socket.addEventListener(
            "close",
            (event) => {
              finished = true;
              resolve({ code: event.code });
            },
            { once: true },
          ),
        );
        socket.addEventListener("message", (event) => {
          try {
            messages.push(JSON.parse(String(event.data)));
          } catch {
            messages.push(event.data);
          }
        });
        socket.accept();
        return {
          messages,
          closed,
          send: (value) => socket.send(value),
          close: () => {
            if (!finished) socket.close();
          },
        };
      },
      async revokeMember() {
        await environment.ACCOUNTS.prepare("UPDATE workspace_members SET removed_at = ? WHERE workspace_id = ?")
          .bind(new Date().toISOString(), workspaceId)
          .run();
      },
      async setOwnerState(state: "active" | "inactive" | "archived" | "downgraded") {
        const account = await environment.ACCOUNTS.prepare("SELECT id FROM accounts WHERE email = ?")
          .bind(ownerEmail)
          .first<{ id: string }>();
        if (!account) throw new Error("Initialize the preview before changing its owner fixture");
        const storage = await harness.getWorker().getDurableObjectStorage("WORKSPACES", { name: workspaceId });
        await storage.exec(
          'UPDATE "user" SET active = ?, archived_at = ?, role = ? WHERE id = ?',
          state === "inactive" ? 0 : 1,
          state === "archived" ? new Date().toISOString() : null,
          state === "downgraded" ? "user" : "owner",
          account.id,
        );
      },
      async expireInvitation(id: string) {
        await environment.ACCOUNTS.prepare("UPDATE invites SET expires_at = ? WHERE id = ?")
          .bind("2020-01-01T00:00:00.000Z", id)
          .run();
      },
      async setMemberState(userId: string, active: boolean) {
        const storage = await harness.getWorker().getDurableObjectStorage("WORKSPACES", { name: workspaceId });
        await storage.exec('UPDATE "user" SET active = ? WHERE id = ?', active ? 1 : 0, userId);
      },
      async failMemberAdmission(enabled: boolean) {
        const storage = await harness.getWorker().getDurableObjectStorage("WORKSPACES", { name: workspaceId });
        await storage.exec(
          enabled
            ? "CREATE TRIGGER test_member_admission BEFORE INSERT ON user WHEN NEW.role = 'user' BEGIN SELECT RAISE(ABORT, 'fixture member projection failure'); END"
            : "DROP TRIGGER test_member_admission",
        );
      },
      async wake() {
        const storage = await harness.getWorker().getDurableObjectStorage("WORKSPACES", { name: workspaceId });
        await storage.exec("SELECT 1");
      },
      async directoryCounts() {
        return {
          accounts: await environment.ACCOUNTS.prepare("SELECT COUNT(*) AS count FROM accounts").first<number>("count"),
          workspaces: await environment.ACCOUNTS.prepare("SELECT COUNT(*) AS count FROM workspaces").first<number>(
            "count",
          ),
          members: await environment.ACCOUNTS.prepare("SELECT COUNT(*) AS count FROM workspace_members").first<number>(
            "count",
          ),
        };
      },
      async certificateRequests() {
        return (await (await harness.getWorker(certWorker).fetch("/__counts")).json()) as { requests: number };
      },
      restart: () => harness.getWorker().evictDurableObject("WORKSPACES", { name: workspaceId, webSockets: "close" }),
      hibernate: () =>
        harness.getWorker().evictDurableObject("WORKSPACES", { name: workspaceId, webSockets: "hibernate" }),
      close: () => harness.close(),
    };
  } catch (failure) {
    await harness.close();
    throw failure;
  }
}
