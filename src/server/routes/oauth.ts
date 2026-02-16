import { Hono } from "hono";
import type Database from "better-sqlite3";
import { EmailAccountService } from "../../services/email-account.js";
import { GmailService } from "../../services/gmail.js";
import { OutlookService } from "../../services/outlook.js";

export function oauthRoutes(db: Database.Database) {
  const router = new Hono();
  const svc = new EmailAccountService(db);

  // Gmail OAuth callback
  router.get("/gmail/callback", async (c) => {
    const code = c.req.query("code");
    if (!code) return c.json({ error: "Missing code parameter" }, 400);

    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI!;

    try {
      const tokens = await GmailService.exchangeCode(
        clientId,
        clientSecret,
        redirectUri,
        code
      );

      // Get the user's email address using Gmail API (no userinfo scope needed)
      const { google } = await import("googleapis");
      const auth = new google.auth.OAuth2(clientId, clientSecret);
      auth.setCredentials({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      });
      const gmail = google.gmail({ version: "v1", auth });
      const profile = await gmail.users.getProfile({ userId: "me" });
      const email = profile.data.emailAddress ?? "unknown@gmail.com";
      const name = email;

      const account = svc.add("gmail", email, name, {
        client_id: clientId,
        client_secret: clientSecret,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      });

      return c.html(
        `<h2>Gmail account connected!</h2><p>${email} added as account #${account.id}.</p><p>You can close this window.</p>`
      );
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  // Outlook OAuth callback
  router.get("/outlook/callback", async (c) => {
    const code = c.req.query("code");
    if (!code) return c.json({ error: "Missing code parameter" }, 400);

    const clientId = process.env.OUTLOOK_CLIENT_ID!;
    const clientSecret = process.env.OUTLOOK_CLIENT_SECRET!;
    const tenantId = process.env.OUTLOOK_TENANT_ID!;
    const redirectUri = process.env.OUTLOOK_REDIRECT_URI!;

    try {
      const { accessToken, refreshToken, expiresAt } = await OutlookService.getTokenFromCode(
        clientId,
        clientSecret,
        tenantId,
        redirectUri,
        code
      );

      // Get user profile from Graph API
      const { Client } = await import("@microsoft/microsoft-graph-client");
      const client = Client.init({
        authProvider: (done) => done(null, accessToken),
      });
      const me = await client.api("/me").select("mail,displayName").get();
      const email = me.mail ?? "unknown@outlook.com";
      const name = me.displayName ?? email;

      const account = svc.add("outlook", email, name, {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt,
      });

      return c.html(
        `<h2>Outlook account connected!</h2><p>${email} added as account #${account.id}.</p><p>You can close this window.</p>`
      );
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  return router;
}
