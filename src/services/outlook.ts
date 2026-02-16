import { Client } from "@microsoft/microsoft-graph-client";
import { ConfidentialClientApplication } from "@azure/msal-node";

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
  ): Promise<{ accessToken: string }> {
    const msalConfig = {
      auth: {
        clientId,
        clientSecret,
        authority: `https://login.microsoftonline.com/${tenantId}`,
      },
    };
    const cca = new ConfidentialClientApplication(msalConfig);
    const result = await cca.acquireTokenByCode({
      code,
      scopes: ["Mail.Send", "Mail.Read"],
      redirectUri,
    });
    return { accessToken: result?.accessToken ?? "" };
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
}
