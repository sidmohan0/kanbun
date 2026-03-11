import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { handleGoogleGmailPushNotification } from "@/lib/google";
import { parseGoogleGmailPushEnvelope } from "@/lib/provider-webhooks";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (
    env.GOOGLE_GMAIL_WEBHOOK_TOKEN &&
    token !== env.GOOGLE_GMAIL_WEBHOOK_TOKEN
  ) {
    return NextResponse.json({ error: "Invalid webhook token." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const payload = parseGoogleGmailPushEnvelope(body);

  if (!payload) {
    return NextResponse.json({ ok: true, ignored: true }, { status: 202 });
  }

  await handleGoogleGmailPushNotification(payload);

  return NextResponse.json({ ok: true });
}
