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
  createTodoistOAuthUrl,
  disconnectTodoistAccount,
  queueTaskTodoistSync,
  requestTodoistAccountSync,
} from "@/lib/todoist";

async function getCurrentOperatorId() {
  return getPersistentOwnerUserId();
}

export async function startGoogleConnectAction() {
  await requireUser();

  try {
    const url = await createGoogleOAuthUrl();
    redirect(url);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to start Google connect.";
    redirect(`/settings?error=${encodeURIComponent(message)}`);
  }
}

export async function startMicrosoftConnectAction() {
  await requireUser();

  try {
    const url = await createMicrosoftOAuthUrl();
    redirect(url);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to start Microsoft connect.";
    redirect(`/settings?error=${encodeURIComponent(message)}`);
  }
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

export async function startTodoistConnectAction() {
  await requireUser();

  try {
    const url = await createTodoistOAuthUrl();
    redirect(url);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to start Todoist connect.";
    redirect(`/settings?error=${encodeURIComponent(message)}`);
  }
}

export async function requestTodoistSyncAction() {
  try {
    await requestTodoistAccountSync(await getCurrentOperatorId());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to queue Todoist sync.";
    redirect(`/settings?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/settings");
  redirect("/settings?synced=todoist");
}

export async function disconnectTodoistAccountAction() {
  try {
    await disconnectTodoistAccount(await getCurrentOperatorId());
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to disconnect Todoist account.";
    redirect(`/settings?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/settings");
  redirect("/settings?disconnected=todoist");
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
