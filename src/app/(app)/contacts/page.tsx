import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, FileUp, Filter, Search, UserPlus } from "lucide-react";
import { createContactAction } from "@/app/actions/contacts";
import { DashboardPanel, SectionHeading } from "@/components/app/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listContacts } from "@/lib/contacts";

export const metadata: Metadata = {
  title: "Contacts | Kanbun",
  description: "Browse, search, create, and edit canonical contacts in Kanbun.",
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

function sourceLabel(sourceType: string) {
  switch (sourceType) {
    case "csv":
      return "CSV";
    case "google":
      return "Google";
    case "manual":
      return "Manual";
    case "microsoft":
      return "Microsoft";
    default:
      return sourceType;
  }
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q : "";
  const sourceType =
    typeof params.source === "string" ? params.source : "all";
  const needsAttentionOnly = params.attention === "1";
  const error =
    typeof params.error === "string" ? decodeURIComponent(params.error) : null;
  const contacts = await listContacts({
    needsAttentionOnly,
    query,
    sourceType:
      sourceType === "csv" ||
      sourceType === "google" ||
      sourceType === "manual" ||
      sourceType === "microsoft"
        ? sourceType
        : "all",
  });

  return (
    <div className="grid gap-6 xl:grid-cols-[0.88fr_1.12fr]">
      <div className="space-y-6">
        <DashboardPanel className="bg-[color-mix(in_oklab,var(--card)_92%,var(--secondary))]">
          <SectionHeading
            eyebrow="Contacts"
            title="A canonical working list"
            description="Search, filter, create, and refine canonical contacts without leaving Kanbun."
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-border/80 bg-background/70 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Matching contacts
              </p>
              <p className="mt-3 text-4xl font-semibold tracking-tight text-foreground">
                {contacts.length}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Filtered against name, email, company, title, and relationship notes.
              </p>
            </div>
            <div className="rounded-2xl border border-border/80 bg-background/70 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Needs attention
              </p>
              <p className="mt-3 text-4xl font-semibold tracking-tight text-foreground">
                {
                  contacts.filter(
                    (contact) =>
                      contact.openTaskCount > 0 ||
                      contact.openMergeReviewCount > 0 ||
                      contact.duplicateCandidateCount > 0,
                  ).length
                }
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Contacts tied to follow-up work, merge-review decisions, or duplicate candidates.
              </p>
            </div>
          </div>
          <Button
            render={<Link href="/imports" />}
            variant="outline"
            className="mt-4 w-full justify-between"
          >
            Import contacts
            <FileUp className="size-4" />
          </Button>
        </DashboardPanel>

        <DashboardPanel>
          <SectionHeading
            eyebrow="Search"
            title="Filter the working set"
            description="Use this list like an operator queue instead of a static address book."
          />
          <form className="space-y-4" action="/contacts">
            <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr_0.8fr]">
              <label className="space-y-2">
                <span className="text-sm font-medium text-foreground">
                  Search contacts
                </span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    name="q"
                    defaultValue={query}
                    placeholder="Name, email, company, title, notes"
                    className="h-11 w-full rounded-2xl border border-border bg-background pl-10 pr-3 text-sm text-foreground outline-none"
                  />
                </div>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-foreground">Source</span>
                <select
                  name="source"
                  defaultValue={sourceType}
                  className="h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm text-foreground outline-none"
                >
                  <option value="all">All sources</option>
                  <option value="manual">Manual</option>
                  <option value="csv">CSV</option>
                  <option value="google">Google</option>
                  <option value="microsoft">Microsoft</option>
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-foreground">
                  Attention filter
                </span>
                <select
                  name="attention"
                  defaultValue={needsAttentionOnly ? "1" : "0"}
                  className="h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm text-foreground outline-none"
                >
                  <option value="0">All contacts</option>
                  <option value="1">Needs attention</option>
                </select>
              </label>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" variant="outline">
                <Filter className="size-4" />
                Apply filters
              </Button>
              <Button render={<Link href="/contacts" />} variant="ghost">
                Reset
              </Button>
            </div>
          </form>
        </DashboardPanel>

        <DashboardPanel>
          <SectionHeading
            eyebrow="Manual create"
            title="Add a contact directly"
            description="Manual contacts use the same canonical model, source tracking, and sequence/task primitives as imported ones."
          />
          {error ? (
            <div className="rounded-2xl border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          <form action={createContactAction} className="space-y-4">
            <input type="hidden" name="returnTo" value="/contacts" />
            <div className="grid gap-4 lg:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-foreground">Full name</span>
                <input
                  aria-label="Full name"
                  name="displayName"
                  placeholder="Rohan Mehta"
                  className="h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm text-foreground outline-none"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-foreground">
                  Primary email
                </span>
                <input
                  aria-label="Primary email"
                  name="primaryEmail"
                  type="email"
                  placeholder="rohan@example.com"
                  className="h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm text-foreground outline-none"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-foreground">Company</span>
                <input
                  aria-label="Company"
                  name="company"
                  placeholder="Acme Ventures"
                  className="h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm text-foreground outline-none"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-foreground">Title</span>
                <input
                  aria-label="Title"
                  name="title"
                  placeholder="Founder"
                  className="h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm text-foreground outline-none"
                />
              </label>
            </div>
            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">
                Relationship summary
              </span>
              <textarea
                aria-label="Relationship summary"
                name="relationshipSummary"
                rows={4}
                placeholder="Warm intro through a mutual operator. Interested in design-led CRM tooling."
                className="w-full rounded-2xl border border-border bg-background px-3 py-3 text-sm text-foreground outline-none"
              />
            </label>
            <Button type="submit">
              <UserPlus className="size-4" />
              Create contact
            </Button>
          </form>
        </DashboardPanel>
      </div>

      <DashboardPanel>
        <SectionHeading
          eyebrow="List view"
          title="Canonical contacts"
          description="Every row here comes from the database and can be filtered down to the exact operating slice you need."
        />
        {contacts.length === 0 ? (
          <div className="space-y-4 rounded-2xl border border-border/85 bg-background/75 p-6">
            <p className="text-base font-medium text-foreground">
              No contacts match the current filters.
            </p>
            <p className="text-sm leading-6 text-muted-foreground">
              Try clearing the filters, importing a CSV, or adding a manual contact.
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
                className="group flex items-center justify-between rounded-2xl border border-border/90 bg-background/75 px-4 py-4 transition-colors hover:border-primary/35 hover:bg-background"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">
                      {contact.displayName}
                    </p>
                    {contact.primaryEmail ? (
                      <Badge variant="outline">{contact.primaryEmail}</Badge>
                    ) : null}
                    {contact.sourceTypes.map((item) => (
                      <Badge key={`${contact.id}-${item}`} variant="secondary">
                        {sourceLabel(item)}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {[contact.title, contact.company]
                      .filter(Boolean)
                      .join(" · ") || "No company or title yet"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {contact.relationshipSummary?.trim() || dueLabel(contact.nextDueAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {contact.duplicateCandidateCount > 0 ? (
                    <Badge
                      variant={
                        contact.highConfidenceDuplicateCount > 0
                          ? "destructive"
                          : "outline"
                      }
                    >
                      {contact.duplicateCandidateCount} duplicate
                      {contact.duplicateCandidateCount === 1 ? "" : "s"}
                    </Badge>
                  ) : null}
                  {contact.openMergeReviewCount > 0 ? (
                    <Badge variant="outline">
                      {contact.openMergeReviewCount} review
                      {contact.openMergeReviewCount === 1 ? "" : "s"}
                    </Badge>
                  ) : null}
                  <Badge
                    variant={contact.openTaskCount > 0 ? "secondary" : "outline"}
                  >
                    {contact.openTaskCount > 0
                      ? `${contact.openTaskCount} open task${
                          contact.openTaskCount > 1 ? "s" : ""
                        }`
                      : "No open tasks"}
                  </Badge>
                  <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </DashboardPanel>
    </div>
  );
}
