import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, FileUp, Search, Tags } from "lucide-react";
import { DashboardPanel, SectionHeading } from "@/components/app/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listContacts } from "@/lib/contacts";

export const metadata: Metadata = {
  title: "Contacts | Kanbun",
  description: "Browse and review canonical contacts inside Kanbun.",
};

function dueLabel(dueAt: Date | null) {
  if (!dueAt) {
    return "No scheduled task";
  }

  const dueDate = dueAt.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  if (dueAt.getTime() < Date.now()) {
    return `Overdue since ${dueDate}`;
  }

  return `Next follow-up ${dueDate}`;
}

export default async function ContactsPage() {
  const contacts = await listContacts();

  return (
    <div className="grid gap-6 xl:grid-cols-[0.82fr_1.18fr]">
      <DashboardPanel className="bg-[color-mix(in_oklab,var(--card)_92%,var(--secondary))]">
        <SectionHeading
          eyebrow="Contacts"
          title="A canonical working list"
          description="The contact list is now backed by the database and reflects the first CSV-driven slice."
        />
        <div className="space-y-4">
          <div className="border-border/80 bg-background/70 rounded-2xl border p-4">
            <div className="text-muted-foreground flex items-center gap-3 text-sm">
              <Search className="size-4" />
              Search and filters are next. The list below is already DB-backed.
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="border-border/80 bg-background/70 rounded-2xl border p-4">
              <p className="text-muted-foreground text-xs tracking-[0.2em] uppercase">
                Total contacts
              </p>
              <p className="text-foreground mt-3 text-4xl font-semibold tracking-tight">
                {contacts.length}
              </p>
              <p className="text-muted-foreground mt-2 text-sm">
                Canonical records created from CSV imports.
              </p>
            </div>
            <div className="border-border/80 bg-background/70 rounded-2xl border p-4">
              <p className="text-muted-foreground text-xs tracking-[0.2em] uppercase">
                Needs attention
              </p>
              <p className="text-foreground mt-3 text-4xl font-semibold tracking-tight">
                {
                  contacts.filter(
                    (contact) =>
                      contact.openTaskCount > 0 ||
                      contact.openMergeReviewCount > 0,
                  ).length
                }
              </p>
              <p className="text-muted-foreground mt-2 text-sm">
                Contacts tied to follow-up work or merge review decisions.
              </p>
            </div>
          </div>
          <Button
            render={<Link href="/imports" />}
            variant="outline"
            className="w-full justify-between"
          >
            Import contacts
            <FileUp className="size-4" />
          </Button>
        </div>
      </DashboardPanel>

      <DashboardPanel>
        <SectionHeading
          eyebrow="List view"
          title="Canonical contacts"
          description="Every row here comes from the database. Upload a CSV to create the first records."
        />
        {contacts.length === 0 ? (
          <div className="border-border/85 bg-background/75 space-y-4 rounded-2xl border p-6">
            <p className="text-foreground text-base font-medium">
              No contacts yet.
            </p>
            <p className="text-muted-foreground text-sm leading-6">
              Start with a CSV import and Kanbun will create canonical contacts,
              identities, and source records.
            </p>
            <Button render={<Link href="/imports" />}>
              Open imports
              <ArrowRight className="size-4" />
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {contacts.map((contact) => (
              <Link
                key={contact.id}
                href={`/contacts/${contact.slug}`}
                className="group border-border/90 bg-background/75 hover:border-primary/35 hover:bg-background flex items-center justify-between rounded-2xl border px-4 py-4 transition-colors"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-foreground text-sm font-semibold">
                      {contact.displayName}
                    </p>
                    {contact.primaryEmail ? (
                      <Badge variant="outline">{contact.primaryEmail}</Badge>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {[contact.title, contact.company]
                      .filter(Boolean)
                      .join(" · ") || "No company or title yet"}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {dueLabel(contact.nextDueAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {contact.openMergeReviewCount > 0 ? (
                    <Badge variant="outline">
                      {contact.openMergeReviewCount} review
                      {contact.openMergeReviewCount === 1 ? "" : "s"}
                    </Badge>
                  ) : null}
                  <Badge
                    variant={
                      contact.openTaskCount > 0 ? "secondary" : "outline"
                    }
                  >
                    {contact.openTaskCount > 0
                      ? `${contact.openTaskCount} open task${
                          contact.openTaskCount > 1 ? "s" : ""
                        }`
                      : "No open tasks"}
                  </Badge>
                  <ArrowRight className="text-muted-foreground size-4 transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            ))}
          </div>
        )}
        <div className="mt-5 flex items-center gap-2 text-xs tracking-[0.2em] uppercase">
          <Tags className="text-muted-foreground size-4" />
          <span className="text-muted-foreground">
            Search, filters, and saved views are next
          </span>
        </div>
      </DashboardPanel>
    </div>
  );
}
