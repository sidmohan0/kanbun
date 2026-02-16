import { google, type gmail_v1 } from "googleapis";

export class GmailService {
  private gmail: gmail_v1.Gmail;
  private auth;

  constructor(credentials: {
    client_id: string;
    client_secret: string;
    access_token: string;
    refresh_token: string;
  }) {
    this.auth = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret
    );
    this.auth.setCredentials({
      access_token: credentials.access_token,
      refresh_token: credentials.refresh_token,
    });
    this.gmail = google.gmail({ version: "v1", auth: this.auth });
  }

  async send(to: string, subject: string, body: string, from: string): Promise<{ messageId: string; threadId: string }> {
    const raw = Buffer.from(
      `From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${body}`
    ).toString("base64url");

    const res = await this.gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });
    return {
      messageId: res.data.id ?? "",
      threadId: res.data.threadId ?? "",
    };
  }

  async checkReplies(threadId: string): Promise<boolean> {
    const thread = await this.gmail.users.threads.get({
      userId: "me",
      id: threadId,
    });
    return (thread.data.messages?.length ?? 0) > 1;
  }

  static getAuthUrl(clientId: string, clientSecret: string, redirectUri: string): string {
    const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    return auth.generateAuthUrl({
      access_type: "offline",
      scope: [
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/calendar",
      ],
    });
  }

  static async exchangeCode(
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    code: string
  ): Promise<{ access_token: string; refresh_token: string }> {
    const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const { tokens } = await auth.getToken(code);
    return {
      access_token: tokens.access_token!,
      refresh_token: tokens.refresh_token!,
    };
  }
}
