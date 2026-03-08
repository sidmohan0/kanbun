"use server";

import { redirect } from "next/navigation";
import {
  clearCurrentSession,
  createSessionForPasswordLogin,
  isOwnerModeEnabled,
} from "@/lib/auth";

export async function signInWithPasswordAction(formData: FormData) {
  if (!isOwnerModeEnabled()) {
    redirect("/");
  }

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!email.trim() || !password) {
    redirect("/signin?error=missing-fields");
  }

  const result = await createSessionForPasswordLogin(email, password);

  if (!result.ok) {
    redirect(`/signin?error=${result.error}`);
  }

  redirect("/");
}

export async function signOutAction() {
  if (!isOwnerModeEnabled()) {
    redirect("/");
  }

  await clearCurrentSession();
  redirect("/signin");
}
