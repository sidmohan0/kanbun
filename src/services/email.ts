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
  ): Promise<string> {
    const account = this.accountService.getById(accountId);
    if (!account) throw new Error(`Account ${accountId} not found`);
    const creds = this.accountService.getCredentials(accountId);

    if (account.provider === "gmail") {
      const gmail = new GmailService(creds as any);
      return gmail.send(to, subject, body, account.email_address);
    } else {
      const outlook = new OutlookService(creds.access_token as string);
      return outlook.send(to, subject, body);
    }
  }
}
