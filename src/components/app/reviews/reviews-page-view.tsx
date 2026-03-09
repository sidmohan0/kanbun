import Link from "next/link";
import {
  dismissMergeReviewAction,
  resolveMergeReviewAction,
} from "@/app/actions/reviews";
import {
  approveOutboundDraftAction,
  cancelOutboundMessageAction,
  retryOutboundMessageAction,
} from "@/app/actions/sequences";
import { DashboardPanel, SectionHeading } from "@/components/app/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listReviewInbox } from "@/lib/review-inbox";

const fieldLabels: Record<string, string> = {
  company: "Company",
  displayName: "Display name",
  primaryEmail: "Primary email",
  title: "Title",
};

const errorMessages: Record<string, string> = {
  "missing-review": "Choose a review before submitting a decision.",
};

function providerLabel(provider: string) {
  return provider === "google" ? "Google" : "Microsoft";
}

function humanizeCategory(value: string | null | undefined) {
  return value ? value.replaceAll("_", " ") : null;
}

function ReviewInboxHeader(props: {
  cancelled: boolean;
  dismissed: boolean;
  errorMessage: string | null;
  queued: boolean;
  resolved: boolean;
  summary: Awaited<ReturnType<typeof listReviewInbox>>["counts"];
}) {
  return (
    <DashboardPanel>
      <SectionHeading
        eyebrow="Review inbox"
        title="Everything waiting on judgment"
        description="This queue now centralizes outbound approvals, merge conflicts, connector issues, import exceptions, and Todoist task failures."
      />
      <div className="grid gap-3 sm:grid-cols-5">
        <div className="rounded-xl bg-secondary/65 px-3 py-3">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Approvals
          </p>
          <p className="mt-2 text-3xl font-semibold text-foreground">
            {props.summary.outboundApprovals}
          </p>
        </div>
        <div className="rounded-xl bg-secondary/65 px-3 py-3">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Merge reviews
          </p>
          <p className="mt-2 text-3xl font-semibold text-foreground">
            {props.summary.mergeReviews}
          </p>
        </div>
        <div className="rounded-xl bg-secondary/65 px-3 py-3">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Connector issues
          </p>
          <p className="mt-2 text-3xl font-semibold text-foreground">
            {props.summary.connectorIssues}
          </p>
        </div>
        <div className="rounded-xl bg-secondary/65 px-3 py-3">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Task exceptions
          </p>
          <p className="mt-2 text-3xl font-semibold text-foreground">
            {props.summary.taskExceptions}
          </p>
        </div>
        <div className="rounded-xl bg-secondary/65 px-3 py-3">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Import issues
          </p>
          <p className="mt-2 text-3xl font-semibold text-foreground">
            {props.summary.importIssues}
          </p>
        </div>
      </div>
      {props.errorMessage ? (
        <div className="mt-4 rounded-2xl border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive">
          {props.errorMessage}
        </div>
      ) : null}
      {props.resolved ? (
        <div className="mt-4 rounded-2xl border border-border/80 bg-primary/8 px-4 py-3 text-sm text-foreground">
          Merge review resolved and canonical contact updated.
        </div>
      ) : null}
      {props.dismissed ? (
        <div className="mt-4 rounded-2xl border border-border/80 bg-secondary/80 px-4 py-3 text-sm text-foreground">
          Merge review dismissed. Kanbun kept the current canonical values.
        </div>
      ) : null}
      {props.queued ? (
        <div className="mt-4 rounded-2xl border border-border/80 bg-primary/8 px-4 py-3 text-sm text-foreground">
          Outbound item queued for the worker.
        </div>
      ) : null}
      {props.cancelled ? (
        <div className="mt-4 rounded-2xl border border-border/80 bg-secondary/80 px-4 py-3 text-sm text-foreground">
          Outbound item cancelled.
        </div>
      ) : null}
    </DashboardPanel>
  );
}

function OutboundApprovalsPanel(props: {
  approvals: Awaited<ReturnType<typeof listReviewInbox>>["outboundApprovals"];
}) {
  return (
    <DashboardPanel>
      <SectionHeading
        eyebrow="Outbound"
        title="Pending approvals and retries"
        description="Every sequence send still goes through manual review by default."
      />
      {props.approvals.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No outbound approvals are waiting right now.
        </p>
      ) : (
        <div className="space-y-4">
          {props.approvals.map((draft) => (
            <div
              key={draft.id}
              className="rounded-2xl border border-border/85 bg-background/75 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{draft.status}</Badge>
                {draft.connectedAccount ? (
                  <Badge variant="outline">
                    {providerLabel(draft.connectedAccount.provider)}
                  </Badge>
                ) : null}
                {draft.sequence ? (
                  <Badge variant="secondary">{draft.sequence.name}</Badge>
                ) : null}
              </div>
              <div className="mt-3 space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  {draft.contact?.displayName ?? "Unknown contact"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {draft.contact?.primaryEmail ?? "No primary email"}
                </p>
                <p className="text-sm text-foreground">{draft.finalSubject}</p>
                {draft.lastError ? (
                  <p className="text-sm text-destructive">{draft.lastError}</p>
                ) : null}
              </div>
              <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
                <form action={approveOutboundDraftAction} className="space-y-3">
                  <input type="hidden" name="messageId" value={draft.id} />
                  <input type="hidden" name="returnTo" value="/reviews" />
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-foreground">
                      Subject
                    </span>
                    <input
                      name="subject"
                      defaultValue={draft.finalSubject}
                      className="h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm text-foreground outline-none"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-foreground">
                      Body
                    </span>
                    <textarea
                      name="body"
                      defaultValue={draft.finalBody}
                      rows={7}
                      className="w-full rounded-2xl border border-border bg-background px-3 py-3 text-sm text-foreground outline-none"
                    />
                  </label>
                  <div className="flex flex-wrap gap-3">
                    <Button type="submit">Approve and queue</Button>
                  </div>
                </form>

                <div className="space-y-3 rounded-2xl border border-border/80 bg-secondary/50 p-4">
                  <p className="text-sm font-medium text-foreground">
                    Review context
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Due {draft.dueAt?.toLocaleString() ?? "as soon as approved"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Sending account{" "}
                    {draft.connectedAccount?.email ??
                      draft.connectedAccount?.provider ??
                      "not selected"}
                  </p>
                  {draft.contact?.slug ? (
                    <Button
                      render={<Link href={`/contacts/${draft.contact.slug}`} />}
                      variant="outline"
                      size="sm"
                    >
                      Open contact
                    </Button>
                  ) : null}
                  {draft.status === "failed" ? (
                    <form action={retryOutboundMessageAction}>
                      <input type="hidden" name="messageId" value={draft.id} />
                      <input type="hidden" name="returnTo" value="/reviews" />
                      <Button type="submit" variant="outline">
                        Retry with current draft
                      </Button>
                    </form>
                  ) : null}
                  <form action={cancelOutboundMessageAction}>
                    <input type="hidden" name="messageId" value={draft.id} />
                    <input type="hidden" name="returnTo" value="/reviews" />
                    <Button type="submit" variant="outline">
                      Cancel outbound item
                    </Button>
                  </form>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </DashboardPanel>
  );
}

function MergeReviewsPanel(props: {
  mergeReviews: Awaited<ReturnType<typeof listReviewInbox>>["mergeReviews"];
}) {
  return (
    <DashboardPanel>
      <SectionHeading
        eyebrow="Merge reviews"
        title="Provider conflicts"
        description="Google and Microsoft can fill empty canonical fields automatically, but conflicting populated values stay supervised."
      />
      {props.mergeReviews.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open merge reviews.</p>
      ) : (
        <div className="space-y-4">
          {props.mergeReviews.map((review) => (
            <div
              key={review.id}
              className="rounded-2xl border border-border/85 bg-background/75 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">
                      {providerLabel(review.provider)}
                    </Badge>
                    <Badge variant="outline">
                      {review.conflictFields.length} field
                      {review.conflictFields.length === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  <p className="text-sm font-semibold text-foreground">
                    {review.contact?.displayName ?? "Unknown contact"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {review.contact?.primaryEmail ?? "No primary email"}
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">
                  Last seen {review.lastSeenAt.toLocaleString()}
                </p>
              </div>

              <form action={resolveMergeReviewAction} className="mt-5 space-y-4">
                <input type="hidden" name="reviewId" value={review.id} />
                <input type="hidden" name="returnTo" value="/reviews" />
                <div className="grid gap-4">
                  {review.conflictFields.map((field) => (
                    <div
                      key={field}
                      className="grid gap-3 rounded-2xl border border-border/85 bg-background/75 p-4 lg:grid-cols-[0.18fr_0.36fr_0.36fr_0.1fr]"
                    >
                      <div className="space-y-1">
                        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                          Field
                        </p>
                        <p className="text-sm font-medium text-foreground">
                          {fieldLabels[field] ?? field}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                          Current
                        </p>
                        <p className="text-sm text-foreground">
                          {review.currentValues[field] ?? "Empty"}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                          Proposed
                        </p>
                        <p className="text-sm text-foreground">
                          {review.proposedValues[field] ?? "Empty"}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <label
                          className="text-sm font-medium text-foreground"
                          htmlFor={`${review.id}-${field}`}
                        >
                          Keep
                        </label>
                        <select
                          id={`${review.id}-${field}`}
                          name={`decision:${field}`}
                          defaultValue="current"
                          className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground"
                        >
                          <option value="current">Current</option>
                          <option value="proposed">Proposed</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button type="submit">Resolve review</Button>
                  {review.contact?.slug ? (
                    <Button
                      render={<Link href={`/contacts/${review.contact.slug}`} />}
                      variant="outline"
                    >
                      Open contact
                    </Button>
                  ) : null}
                </div>
              </form>

              <form action={dismissMergeReviewAction} className="mt-3">
                <input type="hidden" name="reviewId" value={review.id} />
                <input type="hidden" name="returnTo" value="/reviews" />
                <Button type="submit" variant="outline">
                  Dismiss and keep current values
                </Button>
              </form>
            </div>
          ))}
        </div>
      )}
    </DashboardPanel>
  );
}

function ConnectorIssuesPanel(props: {
  connectorIssues: Awaited<ReturnType<typeof listReviewInbox>>["connectorIssues"];
}) {
  return (
    <DashboardPanel>
      <SectionHeading
        eyebrow="Connector issues"
        title="Reconnects and degraded sync"
        description="Provider account health and capability gaps that need operator attention."
      />
      {props.connectorIssues.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No connector issues right now.
        </p>
      ) : (
        <div className="space-y-3">
          {props.connectorIssues.map((account) => (
            <div
              key={account.id}
              className="rounded-2xl border border-border/85 bg-background/75 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{providerLabel(account.provider)}</Badge>
                <Badge variant="destructive">{account.status}</Badge>
              </div>
              <p className="mt-3 text-sm font-semibold text-foreground">
                {account.email ?? account.displayName ?? "Connected account"}
              </p>
              {account.lastError ? (
                <p className="mt-1 text-sm text-destructive">{account.lastError}</p>
              ) : null}
              {account.missingScopes?.length ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Missing scopes: {account.missingScopes.join(", ")}
                </p>
              ) : null}
              {account.contactSyncFailureCategory ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Contact sync: {humanizeCategory(account.contactSyncFailureCategory)}
                </p>
              ) : null}
              {account.replySyncFailureCategory ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Reply sync: {humanizeCategory(account.replySyncFailureCategory)}
                </p>
              ) : null}
              {account.contactSyncRetryAt ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Contact retry at {account.contactSyncRetryAt.toLocaleString()}
                </p>
              ) : null}
              {account.replySyncRetryAt ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Reply retry at {account.replySyncRetryAt.toLocaleString()}
                </p>
              ) : null}
              {account.contactSyncOperatorAction ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {account.contactSyncOperatorAction}
                </p>
              ) : null}
              {account.replySyncOperatorAction ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {account.replySyncOperatorAction}
                </p>
              ) : null}
              <div className="mt-3">
                <Button render={<Link href="/settings" />} variant="outline" size="sm">
                  Open settings
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </DashboardPanel>
  );
}

function TaskAndImportExceptionsPanel(props: {
  importIssues: Awaited<ReturnType<typeof listReviewInbox>>["importIssues"];
  taskExceptions: Awaited<ReturnType<typeof listReviewInbox>>["taskExceptions"];
}) {
  return (
    <DashboardPanel>
      <SectionHeading
        eyebrow="Task and import exceptions"
        title="Worker results that need cleanup"
        description="Failed Todoist mirrors and import runs stay visible here until handled."
      />
      <div className="space-y-4">
        {props.taskExceptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No Todoist task exceptions.
          </p>
        ) : (
          props.taskExceptions.map((task) => (
            <div
              key={task.id}
              className="rounded-2xl border border-border/85 bg-background/75 p-4"
            >
              <p className="text-sm font-semibold text-foreground">{task.title}</p>
              <p className="mt-1 text-sm text-destructive">
                {task.todoistLastError ?? "Todoist sync degraded."}
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <Button render={<Link href="/tasks" />} variant="outline" size="sm">
                  Open tasks
                </Button>
                {task.contact?.slug ? (
                  <Button
                    render={<Link href={`/contacts/${task.contact.slug}`} />}
                    variant="outline"
                    size="sm"
                  >
                    Open contact
                  </Button>
                ) : null}
              </div>
            </div>
          ))
        )}

        {props.importIssues.length === 0 ? (
          <p className="text-sm text-muted-foreground">No import issues.</p>
        ) : (
          props.importIssues.map((entry) => (
            <div
              key={entry.id}
              className="rounded-2xl border border-border/85 bg-background/75 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{entry.status}</Badge>
                <Badge variant="secondary">{entry.fileName}</Badge>
              </div>
              {entry.errorMessage ? (
                <p className="mt-2 text-sm text-destructive">{entry.errorMessage}</p>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  {entry.warningCount} warning
                  {entry.warningCount === 1 ? "" : "s"} across this import.
                </p>
              )}
              <div className="mt-3">
                <Button render={<Link href="/imports" />} variant="outline" size="sm">
                  Open imports
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </DashboardPanel>
  );
}

export async function ReviewsPageView({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const dismissed = searchParams.dismissed === "1";
  const queued = searchParams.queued === "1";
  const resolved = searchParams.resolved === "1";
  const cancelled = searchParams.cancelled === "1";
  const errorKey =
    typeof searchParams.error === "string" ? searchParams.error : undefined;
  const inbox = await listReviewInbox();
  const errorMessage = errorKey
    ? (errorMessages[errorKey] ?? decodeURIComponent(errorKey))
    : null;

  return (
    <div className="space-y-6">
      <ReviewInboxHeader
        cancelled={cancelled}
        dismissed={dismissed}
        errorMessage={errorMessage}
        queued={queued}
        resolved={resolved}
        summary={inbox.counts}
      />
      <OutboundApprovalsPanel approvals={inbox.outboundApprovals} />
      <MergeReviewsPanel mergeReviews={inbox.mergeReviews} />
      <div className="grid gap-6 xl:grid-cols-2">
        <ConnectorIssuesPanel connectorIssues={inbox.connectorIssues} />
        <TaskAndImportExceptionsPanel
          importIssues={inbox.importIssues}
          taskExceptions={inbox.taskExceptions}
        />
      </div>
    </div>
  );
}
