import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRight, GitMerge } from "lucide-react";
import { updateContactAction } from "@/app/actions/contacts";
import { createFollowUpTaskAction } from "@/app/actions/workflows";
import {
  enrollContactInSequenceAction,
  recordReplySignalAction,
} from "@/app/actions/sequences";
import { DashboardPanel, SectionHeading } from "@/components/app/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getContactBySlug } from "@/lib/contacts";
import {
  listActiveSequencesForContact,
  listContactSequenceEnrollments,
  listReplySignalsForContact,
} from "@/lib/sequences";
import { isTodoistApiTokenConfigured } from "@/lib/todoist";

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
  const contactCreated = query.created === "1";
  const followUpCreated = query.followup === "created";
  const replyRecorded = query.reply === "recorded";
  const sequenceEnrolled = query.sequence === "enrolled";
  const contactUpdated = query.updated === "1";
  const error =
    typeof query.error === "string" ? decodeURIComponent(query.error) : null;
  const contact = await getContactBySlug(slug);

  if (!contact) {
    notFound();
  }

  const todoistConnected = isTodoistApiTokenConfigured();
  const [availableSequences, enrollments, replyHistory] = await Promise.all([
    listActiveSequencesForContact(contact.id),
    listContactSequenceEnrollments(contact.id),
    listReplySignalsForContact(contact.id),
  ]);

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
            <form action={enrollContactInSequenceAction} className="flex gap-3">
              <input type="hidden" name="contactId" value={contact.id} />
              <select
                name="sequenceId"
                className="border-border/80 bg-background rounded-2xl border px-3 py-2 text-sm outline-none"
                defaultValue=""
                disabled={availableSequences.length === 0}
                required
              >
                <option value="" disabled>
                  {availableSequences.length === 0
                    ? "No active sequences"
                    : "Choose sequence"}
                </option>
                {availableSequences
                  .filter((sequence) => sequence.enrollmentStatus !== "active")
                  .map((sequence) => (
                    <option key={sequence.id} value={sequence.id}>
                      {sequence.name}
                    </option>
                  ))}
              </select>
              <Button
                type="submit"
                variant="outline"
                disabled={
                  availableSequences.filter(
                    (sequence) => sequence.enrollmentStatus !== "active",
                  ).length === 0
                }
              >
                Enroll in sequence
              </Button>
            </form>
            <form action={recordReplySignalAction}>
              <input type="hidden" name="contactId" value={contact.id} />
              <input
                type="hidden"
                name="summary"
                value="Manual reply recorded from the contact workspace."
              />
              <Button type="submit" variant="outline">
                Record reply signal
              </Button>
            </form>
          </div>
        </div>
      </DashboardPanel>

      {followUpCreated ? (
        <div className="border-border/80 bg-primary/8 text-foreground rounded-2xl border px-4 py-3 text-sm">
          Follow-up created and added to the Kanbun task queue.
        </div>
      ) : null}

      {contactCreated ? (
        <div className="rounded-2xl border border-border/80 bg-primary/8 px-4 py-3 text-sm text-foreground">
          Contact created and ready for follow-up, sequence enrollment, or provider merge review.
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {sequenceEnrolled ? (
        <div className="border-border/80 bg-primary/8 text-foreground rounded-2xl border px-4 py-3 text-sm">
          Contact enrolled in sequence. The worker will generate the first draft
          when it becomes due.
        </div>
      ) : null}

      {replyRecorded ? (
        <div className="border-border/80 bg-primary/8 text-foreground rounded-2xl border px-4 py-3 text-sm">
          Reply signal recorded. Active sequence follow-up for this contact has
          been stopped and pending drafts were cancelled.
        </div>
      ) : null}

      {contactUpdated ? (
        <div className="rounded-2xl border border-border/80 bg-primary/8 px-4 py-3 text-sm text-foreground">
          Contact details updated.
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <DashboardPanel>
          <SectionHeading
            eyebrow="Relationship"
            title="Current narrative"
            description="The contact page now reflects real imports, identities, follow-up tasks, and manual edits from the database."
          />
          <form action={updateContactAction} className="mb-5 space-y-4">
            <input type="hidden" name="contactId" value={contact.id} />
            <input type="hidden" name="returnTo" value={`/contacts/${contact.slug}`} />
            <div className="grid gap-4 lg:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-foreground">Full name</span>
                <input
                  aria-label="Full name"
                  name="displayName"
                  defaultValue={contact.displayName}
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
                  defaultValue={contact.primaryEmail ?? ""}
                  className="h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm text-foreground outline-none"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-foreground">Company</span>
                <input
                  aria-label="Company"
                  name="company"
                  defaultValue={contact.company ?? ""}
                  className="h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm text-foreground outline-none"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-foreground">Title</span>
                <input
                  aria-label="Title"
                  name="title"
                  defaultValue={contact.title ?? ""}
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
                defaultValue={contact.relationshipSummary ?? ""}
                className="w-full rounded-2xl border border-border bg-background px-3 py-3 text-sm text-foreground outline-none"
              />
            </label>
            <Button type="submit" variant="outline">
              Save contact details
            </Button>
          </form>
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
              <div className="bg-secondary/70 flex items-center justify-between rounded-xl px-3 py-3">
                <span>Sequence enrollments</span>
                <span className="text-foreground font-medium">
                  {enrollments.length}
                </span>
              </div>
              <div className="bg-secondary/70 flex items-center justify-between rounded-xl px-3 py-3">
                <span>Reply signals</span>
                <span className="text-foreground font-medium">
                  {replyHistory.length}
                </span>
              </div>
            </div>
          </DashboardPanel>

          <DashboardPanel>
            <SectionHeading
              eyebrow="Sequences"
              title="Enrollment state"
              description="Sequence progress is now durable and moves through the worker-driven draft/send pipeline."
            />
            <div className="space-y-3">
              {enrollments.length === 0 ? (
                <p className="text-muted-foreground text-sm leading-7">
                  This contact is not enrolled in any sequence yet.
                </p>
              ) : (
                enrollments.map((enrollment) => (
                  <div
                    key={enrollment.id}
                    className="border-border/85 bg-background/75 rounded-2xl border px-4 py-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-foreground">
                        {enrollment.sequence?.name ?? "Sequence"}
                      </p>
                      <Badge
                        variant={
                          enrollment.status === "active"
                            ? "secondary"
                            : enrollment.status === "completed"
                              ? "outline"
                              : "destructive"
                        }
                      >
                        {enrollment.status}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Next due {formatDueAt(enrollment.nextDueAt)}
                    </p>
                    {enrollment.stopReason ? (
                      <p className="mt-2 text-sm text-destructive">
                        {enrollment.stopReason}
                      </p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </DashboardPanel>

          <DashboardPanel>
            <SectionHeading
              eyebrow="Replies"
              title="Stop-on-reply history"
              description="Reply signals stop active sequence progression for this contact and cancel pending drafts that have not been sent yet. Automatic provider detection now writes into the same history."
            />
            <div className="space-y-3">
              {replyHistory.length === 0 ? (
                <p className="text-muted-foreground text-sm leading-7">
                  No reply signals recorded yet.
                </p>
              ) : (
                replyHistory.map((signal) => (
                  <div
                    key={signal.id}
                    className="border-border/85 bg-background/75 rounded-2xl border px-4 py-4"
                  >
                    <p className="text-sm font-semibold text-foreground">
                      {signal.summary || "Reply signal recorded"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {signal.sourceType} · {signal.createdAt.toLocaleString()}
                    </p>
                  </div>
                ))
              )}
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
