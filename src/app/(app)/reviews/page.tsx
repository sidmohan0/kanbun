import type { Metadata } from "next";
import { ReviewsPageView } from "@/components/app/reviews/reviews-page-view";

export const metadata: Metadata = {
  title: "Reviews | Kanbun",
  description:
    "Resolve outbound approvals, merge conflicts, connector issues, and task exceptions.",
};

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return <ReviewsPageView searchParams={params} />;
}
