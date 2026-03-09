import type { Metadata } from "next";
import { SequencesPageView } from "@/components/app/sequences/sequences-page-view";

export const metadata: Metadata = {
  title: "Sequences | Kanbun",
  description: "Manage reusable outreach sequences and review due steps.",
};

export default async function SequencesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return <SequencesPageView searchParams={params} />;
}
