"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser, getPersistentOwnerUserId } from "@/lib/auth";
import { findContactById } from "@/lib/contacts";
import {
  addSequenceStep,
  approveOutboundDraft,
  cancelOutboundMessage,
  createSequence,
  deleteSequenceStep,
  enrollContactInSequence,
  recordReplySignal,
  retryOutboundMessage,
  updateSequence,
  updateSequenceStep,
} from "@/lib/sequences";

async function getAuditActorUserId() {
  const user = await getCurrentUser();

  if (!user || user.id === "local-owner-bypass") {
    return null;
  }

  return user.id;
}

function getReturnTo(formData: FormData, fallback: string) {
  const value = String(formData.get("returnTo") ?? "").trim();
  return value.startsWith("/") ? value : fallback;
}

export async function createSequenceAction(formData: FormData) {
  try {
    await createSequence({
      actorUserId: await getAuditActorUserId(),
      bodyTemplate: String(formData.get("bodyTemplate") ?? ""),
      dailySendCap: Number(String(formData.get("dailySendCap") ?? "25")),
      delayDays: Number(String(formData.get("delayDays") ?? "0")),
      description: String(formData.get("description") ?? ""),
      name: String(formData.get("name") ?? ""),
      sendWindowEndHour: Number(String(formData.get("sendWindowEndHour") ?? "17")),
      sendWindowStartHour: Number(
        String(formData.get("sendWindowStartHour") ?? "8"),
      ),
      subjectTemplate: String(formData.get("subjectTemplate") ?? ""),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to create sequence.";
    redirect(`/sequences?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/sequences");
  redirect("/sequences?created=1");
}

export async function updateSequenceAction(formData: FormData) {
  const sequenceId = String(formData.get("sequenceId") ?? "");

  if (!sequenceId) {
    redirect("/sequences?error=missing-sequence");
  }

  try {
    await updateSequence({
      actorUserId: await getAuditActorUserId(),
      dailySendCap: Number(String(formData.get("dailySendCap") ?? "25")),
      description: String(formData.get("description") ?? ""),
      name: String(formData.get("name") ?? ""),
      sendWindowEndHour: Number(String(formData.get("sendWindowEndHour") ?? "17")),
      sendWindowStartHour: Number(
        String(formData.get("sendWindowStartHour") ?? "8"),
      ),
      sequenceId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update sequence.";
    redirect(`/sequences?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/sequences");
  redirect("/sequences?updated=1");
}

export async function addSequenceStepAction(formData: FormData) {
  const sequenceId = String(formData.get("sequenceId") ?? "");

  if (!sequenceId) {
    redirect("/sequences?error=missing-sequence");
  }

  try {
    await addSequenceStep({
      actorUserId: await getAuditActorUserId(),
      bodyTemplate: String(formData.get("bodyTemplate") ?? ""),
      delayDays: Number(String(formData.get("delayDays") ?? "0")),
      sequenceId,
      subjectTemplate: String(formData.get("subjectTemplate") ?? ""),
      title: String(formData.get("title") ?? ""),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to add sequence step.";
    redirect(`/sequences?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/sequences");
  redirect("/sequences?step=added");
}

export async function updateSequenceStepAction(formData: FormData) {
  const stepId = String(formData.get("stepId") ?? "");

  if (!stepId) {
    redirect("/sequences?error=missing-step");
  }

  try {
    await updateSequenceStep({
      actorUserId: await getAuditActorUserId(),
      bodyTemplate: String(formData.get("bodyTemplate") ?? ""),
      delayDays: Number(String(formData.get("delayDays") ?? "0")),
      stepId,
      subjectTemplate: String(formData.get("subjectTemplate") ?? ""),
      title: String(formData.get("title") ?? ""),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update sequence step.";
    redirect(`/sequences?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/sequences");
  redirect("/sequences?step=updated");
}

export async function deleteSequenceStepAction(formData: FormData) {
  const stepId = String(formData.get("stepId") ?? "");

  if (!stepId) {
    redirect("/sequences?error=missing-step");
  }

  try {
    await deleteSequenceStep({
      actorUserId: await getAuditActorUserId(),
      stepId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to delete sequence step.";
    redirect(`/sequences?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/sequences");
  redirect("/sequences?step=deleted");
}

export async function enrollContactInSequenceAction(formData: FormData) {
  const contactId = String(formData.get("contactId") ?? "");
  const sequenceId = String(formData.get("sequenceId") ?? "");

  if (!contactId || !sequenceId) {
    redirect("/contacts?error=missing-sequence");
  }

  const contact = await findContactById(contactId);

  if (!contact) {
    redirect("/contacts?error=contact-not-found");
  }

  let result: Awaited<ReturnType<typeof enrollContactInSequence>>;

  try {
    result = await enrollContactInSequence({
      actorUserId: await getAuditActorUserId(),
      contactId,
      sequenceId,
      userId: await getPersistentOwnerUserId(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to enroll contact.";
    redirect(`/contacts/${contact.slug}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/sequences");
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${result.contactSlug}`);
  redirect(`/contacts/${result.contactSlug}?sequence=enrolled`);
}

export async function approveOutboundDraftAction(formData: FormData) {
  const messageId = String(formData.get("messageId") ?? "");
  const returnTo = getReturnTo(formData, "/sequences");

  if (!messageId) {
    redirect(`${returnTo}?error=missing-message`);
  }

  try {
    await approveOutboundDraft({
      actorUserId: await getAuditActorUserId(),
      body: String(formData.get("body") ?? ""),
      messageId,
      subject: String(formData.get("subject") ?? ""),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to queue send.";
    redirect(`${returnTo}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/sequences");
  revalidatePath("/reviews");
  revalidatePath("/contacts");
  redirect(`${returnTo}?queued=1`);
}

export async function retryOutboundMessageAction(formData: FormData) {
  const messageId = String(formData.get("messageId") ?? "");
  const returnTo = getReturnTo(formData, "/sequences");

  if (!messageId) {
    redirect(`${returnTo}?error=missing-message`);
  }

  try {
    await retryOutboundMessage({
      actorUserId: await getAuditActorUserId(),
      messageId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to retry send.";
    redirect(`${returnTo}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/sequences");
  revalidatePath("/reviews");
  redirect(`${returnTo}?queued=1`);
}

export async function cancelOutboundMessageAction(formData: FormData) {
  const messageId = String(formData.get("messageId") ?? "");
  const returnTo = getReturnTo(formData, "/sequences");

  if (!messageId) {
    redirect(`${returnTo}?error=missing-message`);
  }

  try {
    await cancelOutboundMessage({
      actorUserId: await getAuditActorUserId(),
      messageId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to cancel outbound item.";
    redirect(`${returnTo}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/sequences");
  revalidatePath("/reviews");
  revalidatePath("/contacts");
  redirect(`${returnTo}?cancelled=1`);
}

export async function recordReplySignalAction(formData: FormData) {
  const contactId = String(formData.get("contactId") ?? "");

  if (!contactId) {
    redirect("/contacts?error=missing-contact");
  }

  let contactSlug: string;

  try {
    contactSlug = await recordReplySignal({
      actorUserId: await getAuditActorUserId(),
      contactId,
      summary: String(formData.get("summary") ?? ""),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to record reply signal.";
    const contact = await findContactById(contactId);
    if (contact) {
      redirect(`/contacts/${contact.slug}?error=${encodeURIComponent(message)}`);
    }
    redirect(`/contacts?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/sequences");
  revalidatePath(`/contacts/${contactSlug}`);
  redirect(`/contacts/${contactSlug}?reply=recorded`);
}
