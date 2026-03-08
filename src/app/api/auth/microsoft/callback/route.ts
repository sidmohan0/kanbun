import { NextResponse } from "next/server";
import { getPersistentOwnerUserId, requireUser } from "@/lib/auth";
import { consumeMicrosoftOAuthCallback } from "@/lib/microsoft";

export async function GET(request: Request) {
  await requireUser();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(
      new URL(
        `/settings?error=${encodeURIComponent(`Microsoft returned ${oauthError}.`)}`,
        url,
      ),
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL(
        "/settings?error=Missing Microsoft OAuth callback parameters.",
        url,
      ),
    );
  }

  try {
    await consumeMicrosoftOAuthCallback({
      code,
      state,
      userId: await getPersistentOwnerUserId(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to connect Microsoft.";
    return NextResponse.redirect(
      new URL(`/settings?error=${encodeURIComponent(message)}`, url),
    );
  }

  return NextResponse.redirect(new URL("/settings?connected=microsoft", url));
}
