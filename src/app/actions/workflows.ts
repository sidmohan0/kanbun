"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createFollowUpTask } from "@/lib/contacts";
import {
  confirmImport,
  createImportPreviewFromCsv,
  updateImportDraftMapping,
  updateImportDraftRow,
} from "@/lib/imports";

async function getAuditActorUserId() {
  const user = await getCurrentUser();

  if (!user || user.id === "local-owner-bypass") {
    return null;
  }

  return user.id;
}

export async function uploadCsvImportAction(formData: FormData) {
  const file = formData.get("file");
  const label = String(formData.get("label") ?? "");

  if (!(file instanceof File) || file.size === 0) {
    redirect("/imports?error=missing-file");
  }

  let importId: string;

  try {
    importId = await createImportPreviewFromCsv(
      file,
      label,
      await getAuditActorUserId(),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to import CSV.";
    redirect(`/imports?error=${encodeURIComponent(message)}`);
  }

  redirect(`/imports?import=${importId}`);
}

export async function confirmCsvImportAction(formData: FormData) {
  const importId = String(formData.get("importId") ?? "");

  if (!importId) {
    redirect("/imports?error=missing-import");
  }

  try {
    await confirmImport(importId, await getAuditActorUserId());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to confirm import.";
    redirect(`/imports?error=${encodeURIComponent(message)}`);
  }

  redirect(`/imports?import=${importId}&queued=1`);
}

export async function updateCsvImportMappingAction(formData: FormData) {
  const importId = String(formData.get("importId") ?? "");

  if (!importId) {
    redirect("/imports?error=missing-import");
  }

  const overrides = Object.fromEntries(
    Array.from(formData.entries())
      .filter(([key]) => key.startsWith("mapping:"))
      .map(([key, value]) => [key.replace("mapping:", ""), String(value)]),
  );

  try {
    await updateImportDraftMapping(
      importId,
      overrides,
      await getAuditActorUserId(),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update mapping.";
    redirect(
      `/imports?import=${importId}&error=${encodeURIComponent(message)}`,
    );
  }

  revalidatePath("/imports");
  redirect(`/imports?import=${importId}&updated=1`);
}

export async function updateCsvImportRowAction(formData: FormData) {
  const importId = String(formData.get("importId") ?? "");
  const rowId = String(formData.get("rowId") ?? "");
  const page = Number(String(formData.get("page") ?? "1"));

  if (!importId || !rowId) {
    redirect("/imports?error=missing-import");
  }

  try {
    await updateImportDraftRow(
      importId,
      rowId,
      {
        action: String(formData.get("action") ?? "__auto__") as
          | "create"
          | "flag"
          | "skip"
          | "update"
          | "__auto__",
        company: String(formData.get("company") ?? ""),
        email: String(formData.get("email") ?? ""),
        name: String(formData.get("name") ?? ""),
        title: String(formData.get("title") ?? ""),
      },
      await getAuditActorUserId(),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update import row.";
    redirect(
      `/imports?import=${importId}&error=${encodeURIComponent(message)}`,
    );
  }

  revalidatePath("/imports");
  redirect(`/imports?import=${importId}&page=${page}&updated=1`);
}

export async function createFollowUpTaskAction(formData: FormData) {
  const contactId = String(formData.get("contactId") ?? "");
  const mirrorToTodoist = String(formData.get("mirrorToTodoist") ?? "") === "1";

  if (!contactId) {
    redirect("/contacts?error=missing-contact");
  }

  const slug = await createFollowUpTask(contactId, {
    mirrorToTodoist,
  });

  if (!slug) {
    redirect("/contacts?error=contact-not-found");
  }

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${slug}`);
  revalidatePath("/tasks");
  redirect(`/contacts/${slug}?followup=created`);
}
