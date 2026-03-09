import { NextResponse } from "next/server";
import {
  createSessionForUserId,
  getPersistentOwnerUserId,
  resolveOrCreateOwnerFromGoogleProfile,
  requireUser,
} from "@/lib/auth";
import {
  consumeGoogleOAuthCallback,
  consumeGoogleSignInCallback,
  identifyGoogleCallbackIntent,
} from "@/lib/google";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const intent =
    typeof state === "string"
      ? await identifyGoogleCallbackIntent(state)
      : "unknown";
  const failureBasePath = intent === "signin" ? "/signin" : "/settings";

  if (oauthError) {
    return NextResponse.redirect(
      new URL(
        `${failureBasePath}?error=${encodeURIComponent(`Google returned ${oauthError}.`)}`,
        url,
      ),
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL(
        `${failureBasePath}?error=Missing Google OAuth callback parameters.`,
        url,
      ),
    );
  }

  if (intent === "signin") {
    try {
      const result = await consumeGoogleSignInCallback({
        code,
        state,
      });
      const userId = await resolveOrCreateOwnerFromGoogleProfile({
        email: result.profile.email,
        name: result.profile.name,
        providerAccountId: result.profile.sub,
      });
      await createSessionForUserId(userId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to sign in with Google.";
      return NextResponse.redirect(
        new URL(`/signin?error=${encodeURIComponent(message)}`, url),
      );
    }

    return NextResponse.redirect(new URL("/", url));
  }

  await requireUser();

  try {
    await consumeGoogleOAuthCallback({
      code,
      state,
      userId: await getPersistentOwnerUserId(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to connect Google.";
    return NextResponse.redirect(
      new URL(`/settings?error=${encodeURIComponent(message)}`, url),
    );
  }

  return NextResponse.redirect(new URL("/settings?connected=google", url));
}
