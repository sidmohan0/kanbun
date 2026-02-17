import { Hono } from "hono";
import type Database from "better-sqlite3";
import { EmailAccountService } from "../../services/email-account.js";
import { GmailService } from "../../services/gmail.js";
import { OutlookService } from "../../services/outlook.js";

export function accountRoutes(db: Database.Database) {
  const router = new Hono();
  const svc = new EmailAccountService(db);

  router.get("/", (c) => {
    return c.json(svc.list());
  });

  router.get("/:id", (c) => {
    const account = svc.getById(Number(c.req.param("id")));
    if (!account) return c.json({ error: "Not found" }, 404);
    return c.json(account);
  });

  router.post("/", async (c) => {
    const { provider, email_address, display_name, credentials } =
      await c.req.json();
    const account = svc.add(provider, email_address, display_name, credentials);
    return c.json(account, 201);
  });

  router.delete("/:id", (c) => {
    const id = Number(c.req.param("id"));
    const existing = svc.getById(id);
    if (!existing) {
      return c.json({ error: "Not found" }, 404);
    }
    svc.remove(id);
    return c.json({ ok: true });
  });

  // OAuth: initiate
  router.get("/oauth/:provider/start", (c) => {
    const provider = c.req.param("provider");

    if (provider === "gmail") {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const redirectUri = process.env.GOOGLE_REDIRECT_URI;
      if (!clientId || !clientSecret || !redirectUri) {
        return c.json({ error: "Google OAuth env vars not configured" }, 500);
      }
      const url = GmailService.getAuthUrl(clientId, clientSecret, redirectUri);
      return c.redirect(url);
    }

    if (provider === "outlook") {
      const clientId = process.env.OUTLOOK_CLIENT_ID;
      const tenantId = process.env.OUTLOOK_TENANT_ID;
      const redirectUri = process.env.OUTLOOK_REDIRECT_URI;
      if (!clientId || !tenantId || !redirectUri) {
        return c.json({ error: "Outlook OAuth env vars not configured" }, 500);
      }
      const url = OutlookService.getAuthUrl(clientId, tenantId, redirectUri);
      return c.redirect(url);
    }

    return c.json({ error: "Provider must be 'gmail' or 'outlook'" }, 400);
  });

  return router;
}
