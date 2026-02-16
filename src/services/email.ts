import type Database from "better-sqlite3";
import { GmailService } from "./gmail.js";
import { OutlookService } from "./outlook.js";
import { EmailAccountService } from "./email-account.js";

export class EmailService {
  private accountService: EmailAccountService;

  constructor(private db: Database.Database) {
    this.accountService = new EmailAccountService(db);
  }

  async send(
    accountId: number,
    to: string,
    subject: string,
    body: string
  ): Promise<{ messageId: string; threadId: string }> {
    const account = this.accountService.getById(accountId);
    if (!account) throw new Error(`Account ${accountId} not found`);
    let creds = this.accountService.getCredentials(accountId);

    if (account.provider === "gmail") {
      const gmail = new GmailService(creds as any);
      return gmail.send(to, subject, body, account.email_address);
    } else {
      // Refresh Outlook token if expired
      if (OutlookService.isTokenExpired(creds as any) && creds.refresh_token) {
        const clientId = process.env.OUTLOOK_CLIENT_ID!;
        const clientSecret = process.env.OUTLOOK_CLIENT_SECRET!;
        const tenantId = process.env.OUTLOOK_TENANT_ID!;
        const refreshed = await OutlookService.refreshAccessToken(
          clientId,
          clientSecret,
          tenantId,
          creds.refresh_token as string
        );
        creds = {
          ...creds,
          access_token: refreshed.accessToken,
          refresh_token: refreshed.refreshToken,
          expires_at: refreshed.expiresAt,
        };
        this.accountService.updateCredentials(accountId, creds);
      }
      const outlook = new OutlookService(creds.access_token as string);
      return outlook.send(to, subject, body);
    }
  }
}
