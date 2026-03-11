"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { completeTask, reopenTask, snoozeTask } from "@/lib/contacts";

function getReturnTo(formData: FormData, fallback: string) {
  const value = String(formData.get("returnTo") ?? "").trim();
  return value.startsWith("/") ? value : fallback;
}

async function getAuditActorUserId() {
  const user = await getCurrentUser();

  if (!user || user.id === "local-owner-bypass") {
    return null;
  }

  return user.id;
}

export async function completeTaskAction(formData: FormData) {
  const taskId = String(formData.get("taskId") ?? "");
  const returnTo = getReturnTo(formData, "/tasks");

  if (!taskId) {
    redirect(`${returnTo}?error=missing-task`);
  }

  try {
    await completeTask({
      actorUserId: await getAuditActorUserId(),
      taskId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to complete task.";
    redirect(`${returnTo}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/tasks");
  redirect(`${returnTo}?task=completed`);
}

export async function snoozeTaskAction(formData: FormData) {
  const taskId = String(formData.get("taskId") ?? "");
  const returnTo = getReturnTo(formData, "/tasks");
  const days = Number.parseInt(String(formData.get("days") ?? "1"), 10);

  if (!taskId) {
    redirect(`${returnTo}?error=missing-task`);
  }

  try {
    await snoozeTask({
      actorUserId: await getAuditActorUserId(),
      days: Number.isFinite(days) ? days : 1,
      taskId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to snooze task.";
    redirect(`${returnTo}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/tasks");
  redirect(`${returnTo}?task=snoozed`);
}

export async function reopenTaskAction(formData: FormData) {
  const taskId = String(formData.get("taskId") ?? "");
  const returnTo = getReturnTo(formData, "/tasks");

  if (!taskId) {
    redirect(`${returnTo}?error=missing-task`);
  }

  try {
    await reopenTask({
      actorUserId: await getAuditActorUserId(),
      taskId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to reopen task.";
    redirect(`${returnTo}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/tasks");
  redirect(`${returnTo}?task=reopened`);
}
