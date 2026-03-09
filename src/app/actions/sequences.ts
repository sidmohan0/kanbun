"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser, getPersistentOwnerUserId } from "@/lib/auth";
import { findContactById } from "@/lib/contacts";
import {
  approveOutboundDraft,
  createSequence,
  enrollContactInSequence,
} from "@/lib/sequences";

async function getAuditActorUserId() {
  const user = await getCurrentUser();

  if (!user || user.id === "local-owner-bypass") {
    return null;
  }

  return user.id;
}

export async function createSequenceAction(formData: FormData) {
  try {
    await createSequence({
      actorUserId: await getAuditActorUserId(),
      bodyTemplate: String(formData.get("bodyTemplate") ?? ""),
      delayDays: Number(String(formData.get("delayDays") ?? "0")),
      description: String(formData.get("description") ?? ""),
      name: String(formData.get("name") ?? ""),
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

  if (!messageId) {
    redirect("/sequences?error=missing-message");
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
    redirect(`/sequences?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/sequences");
  revalidatePath("/contacts");
  redirect("/sequences?queued=1");
}
