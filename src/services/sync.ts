import type Database from "better-sqlite3";
import { DraftService } from "./draft.js";
import { ContactService } from "./contact.js";
import { EmailAccountService } from "./email-account.js";
import { GmailService } from "./gmail.js";
import { OutlookService } from "./outlook.js";

interface SentDraftRow {
  id: number;
  project_id: number;
  contact_id: number;
  send_account_id: number;
  subject: string;
  body: string;
  sent_at: string | null;
  email: string;
  provider: "gmail" | "outlook";
  account_id: number;
}

export class SyncService {
  private draftService: DraftService;
  private contactService: ContactService;
  private accountService: EmailAccountService;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(private db: Database.Database) {
    this.draftService = new DraftService(db);
    this.contactService = new ContactService(db);
    this.accountService = new EmailAccountService(db);
  }

  start(intervalMs: number = 5 * 60 * 1000): void {
    this.intervalId = setInterval(() => this.pollReplies(), intervalMs);
    console.log(`Sync service started (polling every ${intervalMs / 1000}s)`);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async pollReplies(): Promise<void> {
    // Find all sent drafts that haven't been replied to
    const sentDrafts = this.db
      .prepare(
        `SELECT d.*, c.email, ea.provider, ea.id as account_id
         FROM drafts d
         JOIN contacts c ON d.contact_id = c.id
         JOIN email_accounts ea ON d.send_account_id = ea.id
         WHERE d.status = 'sent'
         AND NOT EXISTS (
           SELECT 1 FROM project_contacts pc
           WHERE pc.contact_id = d.contact_id
           AND pc.project_id = d.project_id
           AND pc.current_stage = 'Replied'
         )`
      )
      .all() as SentDraftRow[];

    for (const draft of sentDrafts) {
      try {
        const hasReply = await this.checkForReply(draft);
        if (hasReply) {
          this.contactService.moveStage(
            draft.contact_id,
            draft.project_id,
            "Replied"
          );
          console.log(
            `Contact ${draft.contact_id} moved to Replied (draft ${draft.id})`
          );
        }
      } catch (err) {
        console.error(
          `Error checking replies for draft ${draft.id}:`,
          err
        );
      }
    }
  }

  private async checkForReply(draft: SentDraftRow): Promise<boolean> {
    // Check for replies via the appropriate email provider.
    // Full implementation depends on storing thread/message IDs from send results.
    // Once thread IDs are persisted on drafts, this will use GmailService.checkReplies()
    // or OutlookService.checkReplies() to detect incoming replies.
    const creds = this.accountService.getCredentials(draft.account_id);

    if (draft.provider === "gmail") {
      const gmail = new GmailService(creds as any);
      // Requires threadId to be stored on the draft after sending
      // return gmail.checkReplies(draft.threadId);
      return false;
    } else {
      const outlook = new OutlookService(creds.access_token as string);
      // Requires conversationId to be stored on the draft after sending
      // return outlook.checkReplies(draft.conversationId);
      return false;
    }
  }
}
