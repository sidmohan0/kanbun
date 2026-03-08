import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRight, GitMerge } from "lucide-react";
import { createFollowUpTaskAction } from "@/app/actions/workflows";
import { DashboardPanel, SectionHeading } from "@/components/app/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getPersistentOwnerUserId } from "@/lib/auth";
import { listConnectedAccountsForUser } from "@/lib/connected-accounts";
import { getContactBySlug } from "@/lib/contacts";

export const metadata: Metadata = {
  title: "Contact Workspace | Kanbun",
  description:
    "Review the unified contact workspace, notes, relationship state, and next actions.",
};

function formatDueAt(value: Date | null) {
  if (!value) {
    return "No due date";
  }

  return value.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function ContactDetailPage({
  params,
  searchParams,
}: PageProps<"/contacts/[slug]">) {
  const { slug } = await params;
  const query = await searchParams;
  const followUpCreated = query.followup === "created";
  const [contact, ownerUserId] = await Promise.all([
    getContactBySlug(slug),
    getPersistentOwnerUserId(),
  ]);

  if (!contact) {
    notFound();
  }

  const accounts = await listConnectedAccountsForUser(ownerUserId);
  const todoistConnected = accounts.some(
    (account) => account.provider === "todoist" && account.status === "connected",
  );

  return (
    <div className="space-y-6">
      <DashboardPanel className="bg-[linear-gradient(140deg,color-mix(in_oklab,var(--card)_92%,white),color-mix(in_oklab,var(--accent)_20%,white))]">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <Badge
              variant="outline"
              className="border-primary/20 bg-background/70 text-muted-foreground"
            >
              Contact workspace
            </Badge>
            <div className="space-y-2">
              <h1 className="text-foreground font-serif text-5xl leading-none tracking-tight">
                {contact.displayName}
              </h1>
              <p className="text-muted-foreground text-base">
                {[contact.title, contact.company].filter(Boolean).join(" · ") ||
                  "No title or company yet"}
              </p>
              <p className="text-muted-foreground text-sm tracking-[0.22em] uppercase">
                {contact.primaryEmail ?? "No primary email on record"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <form action={createFollowUpTaskAction}>
              <input type="hidden" name="contactId" value={contact.id} />
              <Button type="submit">Create follow-up</Button>
            </form>
            {todoistConnected ? (
              <form action={createFollowUpTaskAction}>
                <input type="hidden" name="contactId" value={contact.id} />
                <input type="hidden" name="mirrorToTodoist" value="1" />
                <Button type="submit" variant="outline">
                  Create + mirror to Todoist
                </Button>
              </form>
            ) : null}
            <Button variant="outline" disabled>
              Enroll in sequence
            </Button>
          </div>
        </div>
      </DashboardPanel>

      {followUpCreated ? (
        <div className="border-border/80 bg-primary/8 text-foreground rounded-2xl border px-4 py-3 text-sm">
          Follow-up created and added to the Kanbun task queue.
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <DashboardPanel>
          <SectionHeading
            eyebrow="Relationship"
            title="Current narrative"
            description="The contact page now reflects real imports, identities, and follow-up tasks from the database."
          />
          <div className="space-y-3">
            {contact.sources.length === 0 ? (
              <div className="border-border/85 bg-background/75 text-muted-foreground rounded-2xl border px-4 py-4 text-sm">
                No source records yet.
              </div>
            ) : (
              contact.sources.map((source) => (
                <div
                  key={source.id}
                  className="border-border/85 bg-background/75 rounded-2xl border px-4 py-4"
                >
                  <p className="text-foreground text-sm font-semibold">
                    {source.sourceLabel ?? "Imported source"}
                  </p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {source.sourceType.toUpperCase()} · {source.sourceRef}
                  </p>
                  <p className="text-muted-foreground mt-2 text-sm">
                    Added {source.importedAt.toLocaleString()}
                  </p>
                </div>
              ))
            )}
          </div>
        </DashboardPanel>

        <div className="space-y-6">
          <DashboardPanel>
            <SectionHeading eyebrow="Status" title="Current state" />
            <div className="text-muted-foreground space-y-3 text-sm">
              <div className="bg-secondary/70 flex items-center justify-between rounded-xl px-3 py-3">
                <span>Open follow-ups</span>
                <Badge variant="secondary">{contact.followUps.length}</Badge>
              </div>
              <div className="bg-secondary/70 flex items-center justify-between rounded-xl px-3 py-3">
                <span>Primary source</span>
                <span className="text-foreground font-medium">
                  {contact.sources[0]?.sourceType.toUpperCase() ?? "None"}
                </span>
              </div>
              <div className="bg-secondary/70 flex items-center justify-between rounded-xl px-3 py-3">
                <span>Identity records</span>
                <span className="text-foreground font-medium">
                  {contact.identities.length}
                </span>
              </div>
              <div className="bg-secondary/70 flex items-center justify-between rounded-xl px-3 py-3">
                <span>Open merge reviews</span>
                <span className="text-foreground font-medium">
                  {contact.mergeReviews.length}
                </span>
              </div>
            </div>
          </DashboardPanel>

          <DashboardPanel>
            <SectionHeading
              eyebrow="Merge reviews"
              title="Provider conflicts"
              description="Google and Microsoft only overwrite populated canonical fields after explicit operator review."
            />
            <div className="space-y-3">
              {contact.mergeReviews.length === 0 ? (
                <p className="text-muted-foreground text-sm leading-7">
                  No open merge reviews for this contact.
                </p>
              ) : (
                contact.mergeReviews.map((review) => (
                  <div
                    key={review.id}
                    className="border-border/85 bg-background/75 space-y-3 rounded-2xl border px-4 py-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="gap-1">
                          <GitMerge className="size-3.5" />
                          {review.provider === "google" ? "Google" : "Microsoft"}
                        </Badge>
                        <Badge variant="outline">
                          {review.conflictFields.length} field
                          {review.conflictFields.length === 1 ? "" : "s"}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground text-sm">
                        Last seen {review.lastSeenAt.toLocaleString()}
                      </p>
                    </div>
                    <div className="space-y-2">
                      {review.conflictFields.map((field) => (
                        <div
                          key={field}
                          className="bg-secondary/65 flex items-start justify-between gap-4 rounded-xl px-3 py-3 text-sm"
                        >
                          <span className="text-muted-foreground">
                            {field === "displayName"
                              ? "Display name"
                              : field === "primaryEmail"
                                ? "Primary email"
                                : field === "company"
                                  ? "Company"
                                  : "Title"}
                          </span>
                          <span className="text-right text-foreground">
                            {review.currentValues[field] ?? "Empty"}
                            {" -> "}
                            {review.proposedValues[field] ?? "Empty"}
                          </span>
                        </div>
                      ))}
                    </div>
                    <Button
                      render={<Link href={`/reviews?contact=${contact.id}`} />}
                      variant="outline"
                      className="w-full justify-between"
                    >
                      Review conflicts
                      <ArrowRight className="size-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </DashboardPanel>

          <DashboardPanel>
            <SectionHeading
              eyebrow="Open tasks"
              title="Follow-up queue"
              description="Ad hoc follow-ups created here immediately land in Tasks."
            />
            <div className="space-y-3">
              {contact.followUps.length === 0 ? (
                <p className="text-muted-foreground text-sm leading-7">
                  No open follow-ups for this contact yet.
                </p>
              ) : (
                contact.followUps.map((task) => (
                  <div
                    key={task.id}
                    className="border-border/85 bg-background/75 rounded-2xl border px-4 py-4"
                  >
                    <p className="text-foreground text-sm font-semibold">
                      {task.title}
                    </p>
                    <p className="text-muted-foreground mt-1 text-sm">
                      Due {formatDueAt(task.dueAt)}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {task.todoistSyncStatus === "synced" ? (
                        <Badge variant="outline">Todoist mirrored</Badge>
                      ) : null}
                      {task.todoistSyncStatus === "queued" ? (
                        <Badge variant="secondary">Todoist queued</Badge>
                      ) : null}
                      {task.todoistSyncStatus === "degraded" ? (
                        <Badge variant="destructive">Todoist retry needed</Badge>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </DashboardPanel>

          <DashboardPanel>
            <SectionHeading
              eyebrow="Identities"
              title="Merge anchors"
              description="Email identities are the first conservative dedup key for CSV imports."
            />
            <div className="space-y-3">
              {contact.identities.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No identity records yet.
                </p>
              ) : (
                contact.identities.map((identity) => (
                  <div
                    key={identity.id}
                    className="bg-secondary/70 flex items-center justify-between rounded-xl px-3 py-3 text-sm"
                  >
                    <span>{identity.kind}</span>
                    <span className="text-foreground font-medium">
                      {identity.value}
                    </span>
                  </div>
                ))
              )}
            </div>
          </DashboardPanel>
        </div>
      </div>
    </div>
  );
}
