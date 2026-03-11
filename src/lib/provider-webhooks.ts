export type GoogleGmailPushPayload = {
  emailAddress: string;
  historyId: string;
};

export type MicrosoftChangeNotification = {
  changeType?: string;
  clientState?: string;
  lifecycleEvent?: string;
  resource?: string;
  subscriptionExpirationDateTime?: string;
  subscriptionId?: string;
};

type GooglePubSubEnvelope = {
  message?: {
    data?: string;
  };
};

export function parseGoogleGmailPushEnvelope(
  body: unknown,
): GoogleGmailPushPayload | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const envelope = body as GooglePubSubEnvelope;
  const encoded = envelope.message?.data;

  if (!encoded) {
    return null;
  }

  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const parsed = JSON.parse(decoded) as {
      emailAddress?: string;
      historyId?: string;
    };

    if (
      typeof parsed.emailAddress !== "string" ||
      typeof parsed.historyId !== "string"
    ) {
      return null;
    }

    return {
      emailAddress: parsed.emailAddress.toLowerCase(),
      historyId: parsed.historyId,
    };
  } catch {
    return null;
  }
}

export function getMicrosoftValidationToken(requestUrl: string) {
  const url = new URL(requestUrl);
  return url.searchParams.get("validationToken");
}

export function parseMicrosoftNotifications(
  body: unknown,
  expectedClientState: string,
) {
  if (!body || typeof body !== "object") {
    return [];
  }

  const value = (body as { value?: unknown[] }).value;

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is MicrosoftChangeNotification => {
    if (!entry || typeof entry !== "object") {
      return false;
    }

    const notification = entry as MicrosoftChangeNotification;

    if (typeof notification.subscriptionId !== "string") {
      return false;
    }

    if (
      typeof notification.clientState === "string" &&
      notification.clientState !== expectedClientState
    ) {
      return false;
    }

    return true;
  });
}
