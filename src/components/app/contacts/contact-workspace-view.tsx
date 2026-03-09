import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, GitMerge } from "lucide-react";
import {
  mergeContactsAction,
  splitContactAction,
  updateContactAction,
} from "@/app/actions/contacts";
import {
  enrollContactInSequenceAction,
  pauseEnrollmentAction,
  recordReplySignalAction,
  resumeEnrollmentAction,
} from "@/app/actions/sequences";
import { createFollowUpTaskAction } from "@/app/actions/workflows";
import { DashboardPanel, SectionHeading } from "@/components/app/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getContactBySlug,
  listContactTimeline,
  listPotentialDuplicateContacts,
} from "@/lib/contacts";
import {
  listActiveSequencesForContact,
  listContactSequenceEnrollments,
  listReplySignalsForContact,
} from "@/lib/sequences";
import { isTodoistApiTokenConfigured } from "@/lib/todoist";

type ContactWorkspaceContact = NonNullable<
  Awaited<ReturnType<typeof getContactBySlug>>
>;
type AvailableSequence = Awaited<
  ReturnType<typeof listActiveSequencesForContact>
>[number];
type DuplicateCandidate = Awaited<
  ReturnType<typeof listPotentialDuplicateContacts>
>[number];
type Enrollment = Awaited<
  ReturnType<typeof listContactSequenceEnrollments>
>[number];
type ReplySignal = Awaited<ReturnType<typeof listReplySignalsForContact>>[number];
type TimelineEntry = Awaited<ReturnType<typeof listContactTimeline>>[number];

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

function feedbackItems(searchParams: Record<string, string | string[] | undefined>) {
  const items: Array<{
    tone: "danger" | "info";
    value: string;
  }> = [];

  if (searchParams.followup === "created") {
    items.push({
      tone: "info",
      value: "Follow-up created and added to the Kanbun task queue.",
    });
  }

  if (searchParams.created === "1") {
    items.push({
      tone: "info",
      value:
        "Contact created and ready for follow-up, sequence enrollment, or provider merge review.",
    });
  }

  if (typeof searchParams.error === "string") {
    items.push({
      tone: "danger",
      value: decodeURIComponent(searchParams.error),
    });
  }

  if (searchParams.sequence === "enrolled") {
    items.push({
      tone: "info",
      value:
        "Contact enrolled in sequence. The worker will generate the first draft when it becomes due.",
    });
  }

  if (searchParams.reply === "recorded") {
    items.push({
      tone: "info",
      value:
        "Reply signal recorded. Active sequence follow-up for this contact has been stopped and pending drafts were cancelled.",
    });
  }

  if (searchParams.updated === "1") {
    items.push({
      tone: "info",
      value: "Contact details updated.",
    });
  }

  return items;
}

function ContactWorkspaceHero(props: {
  availableSequences: AvailableSequence[];
  contact: ContactWorkspaceContact;
  todoistConnected: boolean;
}) {
  const enrollableSequences = props.availableSequences.filter(
    (sequence) => sequence.enrollmentStatus !== "active",
  );

  return (
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
              {props.contact.displayName}
            </h1>
            <p className="text-muted-foreground text-base">
              {[props.contact.title, props.contact.company].filter(Boolean).join(" · ") ||
                "No title or company yet"}
            </p>
            <p className="text-muted-foreground text-sm tracking-[0.22em] uppercase">
              {props.contact.primaryEmail ?? "No primary email on record"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <form action={createFollowUpTaskAction}>
            <input type="hidden" name="contactId" value={props.contact.id} />
            <Button type="submit">Create follow-up</Button>
          </form>

          {props.todoistConnected ? (
            <form action={createFollowUpTaskAction}>
              <input type="hidden" name="contactId" value={props.contact.id} />
              <input type="hidden" name="mirrorToTodoist" value="1" />
              <Button type="submit" variant="outline">
                Create + mirror to Todoist
              </Button>
            </form>
          ) : null}

          <form action={enrollContactInSequenceAction} className="flex gap-3">
            <input type="hidden" name="contactId" value={props.contact.id} />
            <select
              name="sequenceId"
              className="border-border/80 bg-background rounded-2xl border px-3 py-2 text-sm outline-none"
              defaultValue=""
              disabled={props.availableSequences.length === 0}
              required
            >
              <option value="" disabled>
                {props.availableSequences.length === 0
                  ? "No active sequences"
                  : "Choose sequence"}
              </option>
              {enrollableSequences.map((sequence) => (
                <option key={sequence.id} value={sequence.id}>
                  {sequence.name}
                </option>
              ))}
            </select>
            <Button
              type="submit"
              variant="outline"
              disabled={enrollableSequences.length === 0}
            >
              Enroll in sequence
            </Button>
          </form>

          <form action={recordReplySignalAction}>
            <input type="hidden" name="contactId" value={props.contact.id} />
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
  );
}

function ContactFeedbackStack(props: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const items = feedbackItems(props.searchParams);

  if (items.length === 0) {
    return null;
  }

  return (
    <>
      {items.map((item) => (
        <div
          key={`${item.tone}-${item.value}`}
          className={
            item.tone === "danger"
              ? "rounded-2xl border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive"
              : "rounded-2xl border border-border/80 bg-primary/8 px-4 py-3 text-sm text-foreground"
          }
        >
          {item.value}
        </div>
      ))}
    </>
  );
}

function ContactNarrativePanel(props: { contact: ContactWorkspaceContact }) {
  return (
    <DashboardPanel>
      <SectionHeading
        eyebrow="Relationship"
        title="Current narrative"
        description="The contact page now reflects real imports, identities, follow-up tasks, and manual edits from the database."
      />
      <form action={updateContactAction} className="mb-5 space-y-4">
        <input type="hidden" name="contactId" value={props.contact.id} />
        <input
          type="hidden"
          name="returnTo"
          value={`/contacts/${props.contact.slug}`}
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">Full name</span>
            <input
              aria-label="Full name"
              name="displayName"
              defaultValue={props.contact.displayName}
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
              defaultValue={props.contact.primaryEmail ?? ""}
              className="h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm text-foreground outline-none"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">Company</span>
            <input
              aria-label="Company"
              name="company"
              defaultValue={props.contact.company ?? ""}
              className="h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm text-foreground outline-none"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">Title</span>
            <input
              aria-label="Title"
              name="title"
              defaultValue={props.contact.title ?? ""}
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
            defaultValue={props.contact.relationshipSummary ?? ""}
            className="w-full rounded-2xl border border-border bg-background px-3 py-3 text-sm text-foreground outline-none"
          />
        </label>
        <Button type="submit" variant="outline">
          Save contact details
        </Button>
      </form>

      <div className="space-y-3">
        {props.contact.sources.length === 0 ? (
          <div className="border-border/85 bg-background/75 text-muted-foreground rounded-2xl border px-4 py-4 text-sm">
            No source records yet.
          </div>
        ) : (
          props.contact.sources.map((source) => (
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
  );
}

function ContactStatusPanel(props: {
  contact: ContactWorkspaceContact;
  enrollments: Enrollment[];
  replyHistory: ReplySignal[];
}) {
  return (
    <DashboardPanel>
      <SectionHeading eyebrow="Status" title="Current state" />
      <div className="text-muted-foreground space-y-3 text-sm">
        <div className="bg-secondary/70 flex items-center justify-between rounded-xl px-3 py-3">
          <span>Open follow-ups</span>
          <Badge variant="secondary">{props.contact.followUps.length}</Badge>
        </div>
        <div className="bg-secondary/70 flex items-center justify-between rounded-xl px-3 py-3">
          <span>Primary source</span>
          <span className="text-foreground font-medium">
            {props.contact.sources[0]?.sourceType.toUpperCase() ?? "None"}
          </span>
        </div>
        <div className="bg-secondary/70 flex items-center justify-between rounded-xl px-3 py-3">
          <span>Identity records</span>
          <span className="text-foreground font-medium">
            {props.contact.identities.length}
          </span>
        </div>
        <div className="bg-secondary/70 flex items-center justify-between rounded-xl px-3 py-3">
          <span>Open merge reviews</span>
          <span className="text-foreground font-medium">
            {props.contact.mergeReviews.length}
          </span>
        </div>
        <div className="bg-secondary/70 flex items-center justify-between rounded-xl px-3 py-3">
          <span>Sequence enrollments</span>
          <span className="text-foreground font-medium">
            {props.enrollments.length}
          </span>
        </div>
        <div className="bg-secondary/70 flex items-center justify-between rounded-xl px-3 py-3">
          <span>Reply signals</span>
          <span className="text-foreground font-medium">
            {props.replyHistory.length}
          </span>
        </div>
      </div>
    </DashboardPanel>
  );
}

function ContactEnrollmentsPanel(props: {
  contactSlug: string;
  enrollments: Enrollment[];
}) {
  return (
    <DashboardPanel>
      <SectionHeading
        eyebrow="Sequences"
        title="Enrollment state"
        description="Sequence progress is now durable and moves through the worker-driven draft/send pipeline."
      />
      <div className="space-y-3">
        {props.enrollments.length === 0 ? (
          <p className="text-muted-foreground text-sm leading-7">
            This contact is not enrolled in any sequence yet.
          </p>
        ) : (
          props.enrollments.map((enrollment) => (
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
              <div className="mt-3 flex flex-wrap gap-3">
                {enrollment.status === "active" ? (
                  <form action={pauseEnrollmentAction}>
                    <input
                      type="hidden"
                      name="contactSlug"
                      value={props.contactSlug}
                    />
                    <input
                      type="hidden"
                      name="enrollmentId"
                      value={enrollment.id}
                    />
                    <Button type="submit" variant="outline">
                      Pause enrollment
                    </Button>
                  </form>
                ) : null}
                {enrollment.status === "paused" ? (
                  <form action={resumeEnrollmentAction}>
                    <input
                      type="hidden"
                      name="contactSlug"
                      value={props.contactSlug}
                    />
                    <input
                      type="hidden"
                      name="enrollmentId"
                      value={enrollment.id}
                    />
                    <Button type="submit" variant="outline">
                      Resume enrollment
                    </Button>
                  </form>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </DashboardPanel>
  );
}

function DuplicateCandidatesPanel(props: {
  contact: ContactWorkspaceContact;
  duplicateCandidates: DuplicateCandidate[];
}) {
  return (
    <DashboardPanel>
      <SectionHeading
        eyebrow="Duplicates"
        title="Potential duplicate contacts"
        description="Kanbun now flags stronger duplicate candidates beyond exact-email matching, but leaves the final merge decision to the operator."
      />
      <div className="space-y-4">
        {props.duplicateCandidates.length === 0 ? (
          <p className="text-sm leading-7 text-muted-foreground">
            No duplicate candidates detected for this contact right now.
          </p>
        ) : (
          props.duplicateCandidates.map((candidate) => (
            <div
              key={candidate.id}
              className="rounded-2xl border border-border/85 bg-background/75 px-4 py-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">
                    {candidate.displayName}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {[candidate.title, candidate.company].filter(Boolean).join(" · ") ||
                      "No company or title"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {candidate.primaryEmail ?? "No primary email"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {candidate.reasons.map((reason) => (
                    <Badge key={`${candidate.id}-${reason}`} variant="outline">
                      {reason}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-3">
                <form action={mergeContactsAction}>
                  <input
                    type="hidden"
                    name="returnTo"
                    value={`/contacts/${props.contact.slug}`}
                  />
                  <input
                    type="hidden"
                    name="sourceContactId"
                    value={candidate.id}
                  />
                  <input
                    type="hidden"
                    name="targetContactId"
                    value={props.contact.id}
                  />
                  <Button type="submit" variant="outline">
                    Merge into this contact
                  </Button>
                </form>
                <Button
                  render={<Link href={`/contacts/${candidate.slug}`} />}
                  variant="outline"
                >
                  Open candidate
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </DashboardPanel>
  );
}

function ReplyHistoryPanel(props: { replyHistory: ReplySignal[] }) {
  return (
    <DashboardPanel>
      <SectionHeading
        eyebrow="Replies"
        title="Stop-on-reply history"
        description="Reply signals stop active sequence progression for this contact and cancel pending drafts that have not been sent yet. Automatic provider detection now writes into the same history."
      />
      <div className="space-y-3">
        {props.replyHistory.length === 0 ? (
          <p className="text-muted-foreground text-sm leading-7">
            No reply signals recorded yet.
          </p>
        ) : (
          props.replyHistory.map((signal) => (
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
  );
}

function MergeReviewsPanel(props: { contact: ContactWorkspaceContact }) {
  return (
    <DashboardPanel>
      <SectionHeading
        eyebrow="Merge reviews"
        title="Provider conflicts"
        description="Google and Microsoft only overwrite populated canonical fields after explicit operator review."
      />
      <div className="space-y-3">
        {props.contact.mergeReviews.length === 0 ? (
          <p className="text-muted-foreground text-sm leading-7">
            No open merge reviews for this contact.
          </p>
        ) : (
          props.contact.mergeReviews.map((review) => (
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
                render={<Link href={`/reviews?contact=${props.contact.id}`} />}
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
  );
}

function FollowUpTasksPanel(props: { contact: ContactWorkspaceContact }) {
  return (
    <DashboardPanel>
      <SectionHeading
        eyebrow="Open tasks"
        title="Follow-up queue"
        description="Ad hoc follow-ups created here immediately land in Tasks."
      />
      <div className="space-y-3">
        {props.contact.followUps.length === 0 ? (
          <p className="text-muted-foreground text-sm leading-7">
            No open follow-ups for this contact yet.
          </p>
        ) : (
          props.contact.followUps.map((task) => (
            <div
              key={task.id}
              className="border-border/85 bg-background/75 rounded-2xl border px-4 py-4"
            >
              <p className="text-foreground text-sm font-semibold">{task.title}</p>
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
  );
}

function IdentityAnchorsPanel(props: { contact: ContactWorkspaceContact }) {
  return (
    <DashboardPanel>
      <SectionHeading
        eyebrow="Identities"
        title="Merge anchors"
        description="Email identities are the first conservative dedup key for CSV imports."
      />
      <div className="space-y-3">
        {props.contact.identities.length === 0 ? (
          <p className="text-muted-foreground text-sm">No identity records yet.</p>
        ) : (
          props.contact.identities.map((identity) => (
            <div
              key={identity.id}
              className="bg-secondary/70 flex items-center justify-between rounded-xl px-3 py-3 text-sm"
            >
              <span>{identity.kind}</span>
              <span className="text-foreground font-medium">{identity.value}</span>
            </div>
          ))
        )}
      </div>
    </DashboardPanel>
  );
}

function ContactSplitPanel(props: { contact: ContactWorkspaceContact }) {
  return (
    <DashboardPanel>
      <SectionHeading
        eyebrow="Split"
        title="Split this canonical contact"
        description="Use this when a conservative merge still combined two different people. Identities and source records selected below will move to a new contact."
      />
      <form action={splitContactAction} className="space-y-4">
        <input type="hidden" name="returnTo" value={`/contacts/${props.contact.slug}`} />
        <input type="hidden" name="sourceContactId" value={props.contact.id} />
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">New full name</span>
            <input
              name="displayName"
              placeholder="New contact name"
              className="h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm text-foreground outline-none"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">
              New primary email
            </span>
            <input
              name="primaryEmail"
              type="email"
              placeholder="new@example.com"
              className="h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm text-foreground outline-none"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">New company</span>
            <input
              aria-label="New company"
              name="company"
              placeholder="Optional"
              className="h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm text-foreground outline-none"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">New title</span>
            <input
              aria-label="New title"
              name="title"
              placeholder="Optional"
              className="h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm text-foreground outline-none"
            />
          </label>
        </div>

        <label className="space-y-2">
          <span className="text-sm font-medium text-foreground">
            New relationship summary
          </span>
          <textarea
            aria-label="New relationship summary"
            name="relationshipSummary"
            rows={3}
            placeholder="Optional summary for the new split contact"
            className="w-full rounded-2xl border border-border bg-background px-3 py-3 text-sm text-foreground outline-none"
          />
        </label>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded-2xl border border-border/85 bg-background/75 p-4">
            <p className="text-sm font-medium text-foreground">Move identities</p>
            {props.contact.identities.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No identities available.
              </p>
            ) : (
              props.contact.identities.map((identity) => (
                <label
                  key={identity.id}
                  className="flex items-center gap-3 text-sm text-foreground"
                >
                  <input type="checkbox" name="identityIds" value={identity.id} />
                  <span>{identity.kind}</span>
                  <span className="text-muted-foreground">{identity.value}</span>
                </label>
              ))
            )}
          </div>

          <div className="space-y-3 rounded-2xl border border-border/85 bg-background/75 p-4">
            <p className="text-sm font-medium text-foreground">Move sources</p>
            {props.contact.sources.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sources available.</p>
            ) : (
              props.contact.sources.map((source) => (
                <label
                  key={source.id}
                  className="flex items-center gap-3 text-sm text-foreground"
                >
                  <input type="checkbox" name="sourceIds" value={source.id} />
                  <span>{source.sourceType.toUpperCase()}</span>
                  <span className="text-muted-foreground">
                    {source.sourceLabel ?? source.sourceRef}
                  </span>
                </label>
              ))
            )}
          </div>
        </div>

        <Button type="submit" variant="outline">
          Create split contact
        </Button>
      </form>
    </DashboardPanel>
  );
}

function ContactTimelinePanel(props: { timeline: TimelineEntry[] }) {
  return (
    <DashboardPanel>
      <SectionHeading
        eyebrow="Timeline"
        title="Unified activity history"
        description="Imports, sync signals, tasks, sends, replies, enrollments, and manual contact actions now render in one contact timeline."
      />
      <div className="space-y-3">
        {props.timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">No timeline entries yet.</p>
        ) : (
          props.timeline.map((entry) => (
            <div
              key={entry.id}
              className="rounded-2xl border border-border/85 bg-background/75 px-4 py-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Badge variant="outline">{entry.kind}</Badge>
                <p className="text-sm text-muted-foreground">
                  {entry.timestamp.toLocaleString()}
                </p>
              </div>
              <p className="mt-2 text-sm font-semibold text-foreground">
                {entry.title}
              </p>
              {entry.detail ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {entry.detail}
                </p>
              ) : null}
            </div>
          ))
        )}
      </div>
    </DashboardPanel>
  );
}

export async function ContactWorkspaceView(props: {
  searchParams: Record<string, string | string[] | undefined>;
  slug: string;
}) {
  const contact = await getContactBySlug(props.slug);

  if (!contact) {
    notFound();
  }

  const todoistConnected = isTodoistApiTokenConfigured();
  const [availableSequences, duplicateCandidates, enrollments, replyHistory, timeline] =
    await Promise.all([
      listActiveSequencesForContact(contact.id),
      listPotentialDuplicateContacts(contact.id),
      listContactSequenceEnrollments(contact.id),
      listReplySignalsForContact(contact.id),
      listContactTimeline(contact.id),
    ]);

  return (
    <div className="space-y-6">
      <ContactWorkspaceHero
        availableSequences={availableSequences}
        contact={contact}
        todoistConnected={todoistConnected}
      />
      <ContactFeedbackStack searchParams={props.searchParams} />
      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <ContactNarrativePanel contact={contact} />
        <div className="space-y-6">
          <ContactStatusPanel
            contact={contact}
            enrollments={enrollments}
            replyHistory={replyHistory}
          />
          <ContactEnrollmentsPanel
            contactSlug={contact.slug}
            enrollments={enrollments}
          />
          <DuplicateCandidatesPanel
            contact={contact}
            duplicateCandidates={duplicateCandidates}
          />
          <ReplyHistoryPanel replyHistory={replyHistory} />
          <MergeReviewsPanel contact={contact} />
          <FollowUpTasksPanel contact={contact} />
          <IdentityAnchorsPanel contact={contact} />
          <ContactSplitPanel contact={contact} />
          <ContactTimelinePanel timeline={timeline} />
        </div>
      </div>
    </div>
  );
}
