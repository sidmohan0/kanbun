"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  createManualContact,
  mergeContacts,
  splitContact,
  updateContact,
} from "@/lib/contacts";

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

export async function createContactAction(formData: FormData) {
  const returnTo = getReturnTo(formData, "/contacts");
  let contact: Awaited<ReturnType<typeof createManualContact>>;

  try {
    contact = await createManualContact({
      actorUserId: await getAuditActorUserId(),
      company: String(formData.get("company") ?? ""),
      displayName: String(formData.get("displayName") ?? ""),
      primaryEmail: String(formData.get("primaryEmail") ?? ""),
      relationshipSummary: String(formData.get("relationshipSummary") ?? ""),
      title: String(formData.get("title") ?? ""),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to create contact.";
    redirect(`${returnTo}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/contacts");
  redirect(`/contacts/${contact.slug}?created=1`);
}

export async function updateContactAction(formData: FormData) {
  const contactId = String(formData.get("contactId") ?? "");
  const returnTo = getReturnTo(formData, "/contacts");

  if (!contactId) {
    redirect(`${returnTo}?error=missing-contact`);
  }

  let slug = "";

  try {
    slug = await updateContact({
      actorUserId: await getAuditActorUserId(),
      company: String(formData.get("company") ?? ""),
      contactId,
      displayName: String(formData.get("displayName") ?? ""),
      primaryEmail: String(formData.get("primaryEmail") ?? ""),
      relationshipSummary: String(formData.get("relationshipSummary") ?? ""),
      title: String(formData.get("title") ?? ""),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update contact.";
    redirect(`${returnTo}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${slug}`);
  redirect(`/contacts/${slug}?updated=1`);
}

export async function mergeContactsAction(formData: FormData) {
  const sourceContactId = String(formData.get("sourceContactId") ?? "");
  const targetContactId = String(formData.get("targetContactId") ?? "");
  const confirmed = String(formData.get("confirmMerge") ?? "") === "yes";
  const returnTo = getReturnTo(formData, "/contacts");

  if (!sourceContactId || !targetContactId) {
    redirect(`${returnTo}?error=missing-contact`);
  }

  let slug = "";

  try {
    slug = await mergeContacts({
      actorUserId: await getAuditActorUserId(),
      confirmed,
      sourceContactId,
      targetContactId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to merge contacts.";
    redirect(`${returnTo}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${slug}`);
  redirect(`/contacts/${slug}?updated=1`);
}

export async function splitContactAction(formData: FormData) {
  const sourceContactId = String(formData.get("sourceContactId") ?? "");
  const confirmed = String(formData.get("confirmSplit") ?? "") === "yes";
  const returnTo = getReturnTo(formData, "/contacts");
  const identityIds = formData
    .getAll("identityIds")
    .map((value) => String(value))
    .filter(Boolean);
  const sourceIds = formData
    .getAll("sourceIds")
    .map((value) => String(value))
    .filter(Boolean);

  if (!sourceContactId) {
    redirect(`${returnTo}?error=missing-contact`);
  }

  let createdSlug = "";

  try {
    const created = await splitContact({
      actorUserId: await getAuditActorUserId(),
      company: String(formData.get("company") ?? ""),
      confirmed,
      displayName: String(formData.get("displayName") ?? ""),
      identityIds,
      primaryEmail: String(formData.get("primaryEmail") ?? ""),
      relationshipSummary: String(formData.get("relationshipSummary") ?? ""),
      sourceContactId,
      sourceIds,
      title: String(formData.get("title") ?? ""),
    });
    createdSlug = created.slug;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to split contact.";
    redirect(`${returnTo}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/contacts");
  revalidatePath(returnTo);
  redirect(`/contacts/${createdSlug}?created=1`);
}
