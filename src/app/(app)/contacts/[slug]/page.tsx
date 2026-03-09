import type { Metadata } from "next";
import { ContactWorkspaceView } from "@/components/app/contacts/contact-workspace-view";

export const metadata: Metadata = {
  title: "Contact Workspace | Kanbun",
  description:
    "Review the unified contact workspace, notes, relationship state, and next actions.",
};

export default async function ContactDetailPage({
  params,
  searchParams,
}: PageProps<"/contacts/[slug]">) {
  const { slug } = await params;
  const query = await searchParams;
  return <ContactWorkspaceView slug={slug} searchParams={query} />;
}
