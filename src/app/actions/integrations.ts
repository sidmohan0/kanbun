"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getPersistentOwnerUserId, requireUser } from "@/lib/auth";
import {
  createGoogleOAuthUrl,
  disconnectGoogleAccount,
  requestGoogleAccountSync,
} from "@/lib/google";
import {
  createMicrosoftOAuthUrl,
  disconnectMicrosoftAccount,
  requestMicrosoftAccountSync,
} from "@/lib/microsoft";
import {
  queueTaskTodoistSync,
  requestTodoistAccountSync,
} from "@/lib/todoist";

async function getCurrentOperatorId() {
  return getPersistentOwnerUserId();
}

export async function startGoogleConnectAction() {
  await requireUser();

  let url: string;

  try {
    url = await createGoogleOAuthUrl();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to start Google connect.";
    redirect(`/settings?error=${encodeURIComponent(message)}`);
  }

  redirect(url);
}

export async function startMicrosoftConnectAction() {
  await requireUser();

  let url: string;

  try {
    url = await createMicrosoftOAuthUrl();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to start Microsoft connect.";
    redirect(`/settings?error=${encodeURIComponent(message)}`);
  }

  redirect(url);
}

export async function requestGoogleSyncAction() {
  try {
    await requestGoogleAccountSync(await getCurrentOperatorId());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to queue Google sync.";
    redirect(`/settings?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/settings");
  redirect("/settings?synced=google");
}

export async function disconnectGoogleAccountAction() {
  try {
    await disconnectGoogleAccount(await getCurrentOperatorId());
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to disconnect Google account.";
    redirect(`/settings?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/settings");
  redirect("/settings?disconnected=google");
}

export async function requestMicrosoftSyncAction() {
  try {
    await requestMicrosoftAccountSync(await getCurrentOperatorId());
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to queue Microsoft sync.";
    redirect(`/settings?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/settings");
  redirect("/settings?synced=microsoft");
}

export async function disconnectMicrosoftAccountAction() {
  try {
    await disconnectMicrosoftAccount(await getCurrentOperatorId());
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to disconnect Microsoft account.";
    redirect(`/settings?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/settings");
  redirect("/settings?disconnected=microsoft");
}

export async function requestTodoistSyncAction() {
  await requireUser();

  try {
    await requestTodoistAccountSync(await getCurrentOperatorId());
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to queue Todoist reconciliation.";
    redirect(`/settings?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/settings");
  redirect("/settings?synced=todoist");
}

export async function mirrorTaskToTodoistAction(formData: FormData) {
  const taskId = String(formData.get("taskId") ?? "");

  if (!taskId) {
    redirect("/tasks?error=missing-task");
  }

  try {
    await queueTaskTodoistSync(taskId);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to queue Todoist mirror.";
    redirect(`/tasks?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/tasks");
  redirect("/tasks?mirrored=queued");
}
