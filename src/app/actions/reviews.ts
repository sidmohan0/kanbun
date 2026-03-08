"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { dismissMergeReview, resolveMergeReview } from "@/lib/merge-reviews";

async function getAuditActorUserId() {
  const user = await getCurrentUser();

  if (!user || user.id === "local-owner-bypass") {
    return null;
  }

  return user.id;
}

export async function resolveMergeReviewAction(formData: FormData) {
  const reviewId = String(formData.get("reviewId") ?? "");

  if (!reviewId) {
    redirect("/reviews?error=missing-review");
  }

  const decisions = Object.fromEntries(
    Array.from(formData.entries())
      .filter(([key]) => key.startsWith("decision:"))
      .map(([key, value]) => [key.replace("decision:", ""), String(value)]),
  ) as Partial<
    Record<"company" | "displayName" | "primaryEmail" | "title", "current" | "proposed">
  >;

  try {
    await resolveMergeReview({
      actorUserId: await getAuditActorUserId(),
      decisions,
      reviewId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to resolve merge review.";
    redirect(`/reviews?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/");
  revalidatePath("/contacts");
  revalidatePath("/reviews");
  redirect("/reviews?resolved=1");
}

export async function dismissMergeReviewAction(formData: FormData) {
  const reviewId = String(formData.get("reviewId") ?? "");

  if (!reviewId) {
    redirect("/reviews?error=missing-review");
  }

  try {
    await dismissMergeReview({
      actorUserId: await getAuditActorUserId(),
      reviewId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to dismiss merge review.";
    redirect(`/reviews?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/");
  revalidatePath("/contacts");
  revalidatePath("/reviews");
  redirect("/reviews?dismissed=1");
}
