"use server";

import { redirect } from "next/navigation";
import {
  clearCurrentSession,
  isOwnerModeEnabled,
} from "@/lib/auth";
import { createGoogleSignInUrl } from "@/lib/google";

export async function startGoogleSignInAction() {
  if (!isOwnerModeEnabled()) {
    redirect("/");
  }

  let url: string;

  try {
    url = await createGoogleSignInUrl();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to start Google sign-in.";
    redirect(`/signin?error=${encodeURIComponent(message)}`);
  }

  redirect(url);
}

export async function signOutAction() {
  if (!isOwnerModeEnabled()) {
    redirect("/");
  }

  await clearCurrentSession();
  redirect("/signin");
}
