import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  Clock3,
  GitMerge,
  MailCheck,
  Upload,
} from "lucide-react";
import {
  DashboardPanel,
  MetricTile,
  SectionHeading,
} from "@/components/app/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listContacts, listOpenTasks } from "@/lib/contacts";
import { listImports } from "@/lib/imports";
import { countOpenMergeReviews } from "@/lib/merge-reviews";

export const metadata: Metadata = {
  title: "Home | Kanbun",
  description:
    "Review approvals, follow-ups, imports, and relationship signals from the Kanbun home view.",
};

export default async function Home() {
  const [contacts, openTasks, recentImports, openMergeReviews] =
    await Promise.all([
      listContacts(),
      listOpenTasks(),
      listImports(),
      countOpenMergeReviews(),
    ]);

  return (
    <div className="space-y-10">
      <section className="grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
        <DashboardPanel className="border-primary/15 overflow-hidden bg-[linear-gradient(140deg,color-mix(in_oklab,var(--card)_85%,white),color-mix(in_oklab,var(--accent)_28%,white))]">
          <div className="space-y-6">
            <Badge
              variant="outline"
              className="border-primary/20 bg-background/65 text-muted-foreground text-[11px] tracking-[0.22em] uppercase"
            >
              Operator view
            </Badge>
            <div className="space-y-4">
              <p className="text-foreground font-serif text-4xl leading-none tracking-tight sm:text-5xl">
                Relationship work should feel deliberate, not scattered.
              </p>
              <p className="text-muted-foreground max-w-2xl text-base leading-7">
                The first vertical slice is now live: import contacts from CSV,
                inspect canonical records, and create follow-ups that land in
                the task queue.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button render={<Link href="/contacts" />} size="lg">
                Open contacts
                <ArrowRight className="size-4" />
              </Button>
              <Button
                render={<Link href="/imports" />}
                variant="outline"
                size="lg"
              >
                Import a CSV
              </Button>
            </div>
          </div>
        </DashboardPanel>

        <DashboardPanel className="bg-[color-mix(in_oklab,var(--card)_94%,var(--secondary))]">
          <SectionHeading
            eyebrow="Today"
            title="Current pressure points"
            description="These metrics are now derived from the database rather than seeded placeholders."
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <MetricTile
              label="Open tasks"
              value={String(openTasks.length).padStart(2, "0")}
              note="Follow-ups currently waiting in the Kanbun queue"
              icon={<MailCheck className="size-4" />}
            />
            <MetricTile
              label="Imports"
              value={String(recentImports.length).padStart(2, "0")}
              note="Recent CSV runs recorded in the import audit trail"
              icon={<Upload className="size-4" />}
            />
            <MetricTile
              label="Contacts"
              value={String(contacts.length).padStart(2, "0")}
              note="Canonical contacts currently available in the workspace"
              icon={<Clock3 className="size-4" />}
            />
            <MetricTile
              label="Merge reviews"
              value={String(openMergeReviews).padStart(2, "0")}
              note="Provider conflicts waiting on operator judgment"
              icon={<GitMerge className="size-4" />}
            />
          </div>
        </DashboardPanel>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <DashboardPanel>
          <SectionHeading
            eyebrow="Task queue"
            title="Recent follow-up work"
            description="Follow-ups created from a contact workspace show up here immediately."
          />
          {openTasks.length === 0 ? (
            <div className="border-border/90 bg-background/75 text-muted-foreground rounded-2xl border px-4 py-4 text-sm">
              No follow-up tasks yet. Import contacts, open one, and create the
              first follow-up.
            </div>
          ) : (
            <div className="space-y-3">
              {openTasks.slice(0, 3).map((task) => (
                <Link
                  key={task.id}
                  href={
                    task.contact ? `/contacts/${task.contact.slug}` : "/tasks"
                  }
                  className="group border-border/90 bg-background/75 hover:border-primary/35 hover:bg-background flex items-start justify-between rounded-2xl border px-4 py-4 transition-colors"
                >
                  <div className="space-y-1">
                    <p className="text-foreground text-sm font-semibold">
                      {task.title}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {task.contact?.displayName ?? "No linked contact"}
                    </p>
                  </div>
                  <div className="text-muted-foreground flex items-center gap-2 text-sm">
                    <span>
                      {task.dueAt
                        ? task.dueAt.toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })
                        : "No due date"}
                    </span>
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </DashboardPanel>

        <DashboardPanel>
          <SectionHeading
            eyebrow="Review queue"
            title="Current operator reviews"
            description="Provider conflicts and import warnings should stay visible from the home view."
          />
          {openMergeReviews > 0 ? (
            <div className="border-border/90 bg-background/80 space-y-4 rounded-[calc(var(--radius)*1.15)] border p-4">
              <div className="flex items-baseline justify-between">
                <div>
                  <p className="text-sm font-semibold">Merge review queue</p>
                  <p className="text-muted-foreground text-sm">
                    {openMergeReviews} provider conflict
                    {openMergeReviews === 1 ? "" : "s"} waiting for review
                  </p>
                </div>
                <Badge variant="outline">Needs review</Badge>
              </div>
              <Button
                render={<Link href="/reviews" />}
                variant="outline"
                className="w-full justify-between"
              >
                Open review queue
                <ArrowRight className="size-4" />
              </Button>
            </div>
          ) : recentImports[0] ? (
            <div className="border-border/90 bg-background/80 space-y-4 rounded-[calc(var(--radius)*1.15)] border p-4">
              <div className="flex items-baseline justify-between">
                <div>
                  <p className="text-sm font-semibold">
                    {recentImports[0].label ?? recentImports[0].fileName}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    Imported {recentImports[0].totalRows} rows
                  </p>
                </div>
                <Badge variant="secondary">
                  {recentImports[0].status.replaceAll("_", " ")}
                </Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["Created", String(recentImports[0].createdCount)],
                  ["Updated", String(recentImports[0].updatedCount)],
                  ["Flagged", String(recentImports[0].flaggedCount)],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="bg-secondary/65 rounded-xl px-3 py-3"
                  >
                    <p className="text-muted-foreground text-xs tracking-[0.18em] uppercase">
                      {label}
                    </p>
                    <p className="text-foreground mt-2 text-2xl font-semibold">
                      {value}
                    </p>
                  </div>
                ))}
              </div>
              <Button
                render={<Link href={`/imports?import=${recentImports[0].id}`} />}
                variant="outline"
                className="w-full justify-between"
              >
                Open import review
                <ArrowRight className="size-4" />
              </Button>
            </div>
          ) : (
            <div className="border-border/90 bg-background/80 text-muted-foreground rounded-[calc(var(--radius)*1.15)] border p-4 text-sm">
              No imports yet. Use the Imports screen to load your first CSV.
            </div>
          )}
        </DashboardPanel>
      </section>
    </div>
  );
}
