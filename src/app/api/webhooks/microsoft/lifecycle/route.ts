import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import {
  getMicrosoftWebhookClientState,
  handleMicrosoftGraphLifecycleEvent,
} from "@/lib/microsoft";
import {
  getMicrosoftValidationToken,
  parseMicrosoftNotifications,
} from "@/lib/provider-webhooks";

async function handleLifecycleSubscription(subscriptionId: string) {
  const handledContact = await handleMicrosoftGraphLifecycleEvent({
    kind: "contactSync",
    subscriptionId,
  });

  if (handledContact) {
    return;
  }

  await handleMicrosoftGraphLifecycleEvent({
    kind: "replySync",
    subscriptionId,
  });
}

export async function GET(request: Request) {
  const validationToken = getMicrosoftValidationToken(request.url);

  if (!validationToken) {
    return NextResponse.json({ error: "Missing validation token." }, { status: 400 });
  }

  return new NextResponse(validationToken, {
    headers: {
      "Content-Type": "text/plain",
    },
  });
}

export async function POST(request: Request) {
  const validationToken = getMicrosoftValidationToken(request.url);

  if (validationToken) {
    return new NextResponse(validationToken, {
      headers: {
        "Content-Type": "text/plain",
      },
    });
  }

  const body = await request.json().catch(() => null);
  const notifications = parseMicrosoftNotifications(
    body,
    getMicrosoftWebhookClientState(),
  );

  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) {
    return NextResponse.json({ ok: true, ignored: true }, { status: 202 });
  }

  for (const notification of notifications) {
    await handleLifecycleSubscription(notification.subscriptionId!);
  }

  return NextResponse.json({ ok: true });
}
