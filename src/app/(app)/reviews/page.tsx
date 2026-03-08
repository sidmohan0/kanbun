import Link from "next/link";
import type { Metadata } from "next";
import { dismissMergeReviewAction, resolveMergeReviewAction } from "@/app/actions/reviews";
import { DashboardPanel, SectionHeading } from "@/components/app/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listOpenMergeReviews } from "@/lib/merge-reviews";

export const metadata: Metadata = {
  title: "Reviews | Kanbun",
  description:
    "Resolve provider merge conflicts before Kanbun updates canonical contacts.",
};

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

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const contactId =
    typeof params.contact === "string" ? params.contact : undefined;
  const resolved = params.resolved === "1";
  const dismissed = params.dismissed === "1";
  const errorKey = typeof params.error === "string" ? params.error : undefined;
  const reviews = await listOpenMergeReviews(contactId);
  const errorMessage = errorKey
    ? (errorMessages[errorKey] ?? decodeURIComponent(errorKey))
    : null;

  return (
    <div className="space-y-6">
      <DashboardPanel>
        <SectionHeading
          eyebrow="Merge reviews"
          title="Provider conflicts waiting on judgment"
          description="Kanbun auto-fills empty canonical fields, but when Google or Microsoft disagree with an already populated field it opens a review instead of silently overwriting the contact."
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-secondary/65 px-3 py-3">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Open reviews
            </p>
            <p className="mt-2 text-3xl font-semibold text-foreground">
              {reviews.length}
            </p>
          </div>
          <div className="rounded-xl bg-secondary/65 px-3 py-3">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Providers
            </p>
            <p className="mt-2 text-3xl font-semibold text-foreground">
              {new Set(reviews.map((review) => review.provider)).size}
            </p>
          </div>
          <div className="rounded-xl bg-secondary/65 px-3 py-3">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Contacts affected
            </p>
            <p className="mt-2 text-3xl font-semibold text-foreground">
              {new Set(reviews.map((review) => review.contactId)).size}
            </p>
          </div>
        </div>
        {errorMessage ? (
          <div className="mt-4 rounded-2xl border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive">
            {errorMessage}
          </div>
        ) : null}
        {resolved ? (
          <div className="mt-4 rounded-2xl border border-border/80 bg-primary/8 px-4 py-3 text-sm text-foreground">
            Merge review resolved and canonical contact updated.
          </div>
        ) : null}
        {dismissed ? (
          <div className="mt-4 rounded-2xl border border-border/80 bg-secondary/80 px-4 py-3 text-sm text-foreground">
            Merge review dismissed. Kanbun kept the current canonical values.
          </div>
        ) : null}
      </DashboardPanel>

      {reviews.length === 0 ? (
        <DashboardPanel>
          <p className="text-base font-medium text-foreground">
            No open merge reviews.
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Provider syncs are currently either clean or only filling empty
            fields automatically.
          </p>
        </DashboardPanel>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => (
            <DashboardPanel key={review.id}>
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{providerLabel(review.provider)}</Badge>
                    <Badge variant="outline">
                      {review.conflictFields.length} field
                      {review.conflictFields.length === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <p className="text-lg font-semibold text-foreground">
                      {review.contact?.displayName ?? "Unknown contact"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {review.contact?.primaryEmail ?? "No primary email"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Source {review.sourceLabel ?? review.sourceRef}
                    </p>
                  </div>
                  {review.contact?.slug ? (
                    <Button
                      render={<Link href={`/contacts/${review.contact.slug}`} />}
                      variant="outline"
                      size="sm"
                    >
                      Open contact
                    </Button>
                  ) : null}
                </div>

                <div className="rounded-xl bg-secondary/65 px-3 py-3 text-sm text-muted-foreground">
                  Last seen {review.lastSeenAt.toLocaleString()}
                </div>
              </div>

              <form action={resolveMergeReviewAction} className="mt-5 space-y-4">
                <input type="hidden" name="reviewId" value={review.id} />
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
                </div>
              </form>

              <form action={dismissMergeReviewAction} className="mt-3">
                <input type="hidden" name="reviewId" value={review.id} />
                <Button type="submit" variant="outline">
                  Dismiss and keep current values
                </Button>
              </form>
            </DashboardPanel>
          ))}
        </div>
      )}
    </div>
  );
}
