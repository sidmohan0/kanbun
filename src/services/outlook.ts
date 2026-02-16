import { Client } from "@microsoft/microsoft-graph-client";
import { ConfidentialClientApplication } from "@azure/msal-node";

interface OutlookCredentials {
  access_token: string;
  refresh_token?: string;
  expires_at?: string;
}

export class OutlookService {
  private client: Client;

  constructor(accessToken: string) {
    this.client = Client.init({
      authProvider: (done) => done(null, accessToken),
    });
  }

  async send(to: string, subject: string, body: string): Promise<{ messageId: string; threadId: string }> {
    const message = {
      subject,
      body: { contentType: "HTML", content: body },
      toRecipients: [{ emailAddress: { address: to } }],
    };
    await this.client.api("/me/sendMail").post({ message });

    // Fetch the most recent sent message to get its conversationId
    const sent = await this.client
      .api("/me/mailFolders/SentItems/messages")
      .top(1)
      .orderby("sentDateTime desc")
      .select("id,conversationId")
      .get();

    const msg = sent.value?.[0];
    return {
      messageId: msg?.id ?? "",
      threadId: msg?.conversationId ?? "",
    };
  }

  async checkReplies(conversationId: string): Promise<boolean> {
    const messages = await this.client
      .api(`/me/messages?$filter=conversationId eq '${conversationId}'`)
      .get();
    return (messages.value?.length ?? 0) > 1;
  }

  static async getTokenFromCode(
    clientId: string,
    clientSecret: string,
    tenantId: string,
    redirectUri: string,
    code: string
  ): Promise<{ accessToken: string; refreshToken: string; expiresAt: string }> {
    const cca = OutlookService.createMsalClient(clientId, clientSecret, tenantId);
    const result = await cca.acquireTokenByCode({
      code,
      scopes: ["Mail.Send", "Mail.Read", "offline_access"],
      redirectUri,
    });
    const expiresAt = result?.expiresOn
      ? result.expiresOn.toISOString()
      : new Date(Date.now() + 3600 * 1000).toISOString();
    return {
      accessToken: result?.accessToken ?? "",
      refreshToken: (result as any)?.refreshToken ?? "",
      expiresAt,
    };
  }

  static async refreshAccessToken(
    clientId: string,
    clientSecret: string,
    tenantId: string,
    refreshToken: string
  ): Promise<{ accessToken: string; refreshToken: string; expiresAt: string }> {
    const cca = OutlookService.createMsalClient(clientId, clientSecret, tenantId);
    const result = await cca.acquireTokenByRefreshToken({
      refreshToken,
      scopes: ["Mail.Send", "Mail.Read"],
    });
    const expiresAt = result?.expiresOn
      ? result.expiresOn.toISOString()
      : new Date(Date.now() + 3600 * 1000).toISOString();
    return {
      accessToken: result?.accessToken ?? "",
      refreshToken: (result as any)?.refreshToken ?? refreshToken,
      expiresAt,
    };
  }

  static isTokenExpired(creds: OutlookCredentials): boolean {
    if (!creds.expires_at) return true;
    // Refresh 5 minutes before expiry
    return new Date(creds.expires_at).getTime() - 5 * 60 * 1000 < Date.now();
  }

  static getAuthUrl(clientId: string, tenantId: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: "Mail.Send Mail.Read offline_access",
      response_mode: "query",
    });
    return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`;
  }

  private static createMsalClient(clientId: string, clientSecret: string, tenantId: string) {
    return new ConfidentialClientApplication({
      auth: {
        clientId,
        clientSecret,
        authority: `https://login.microsoftonline.com/${tenantId}`,
      },
    });
  }
}
