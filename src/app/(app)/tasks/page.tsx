import Link from "next/link";
import type { Metadata } from "next";
import { mirrorTaskToTodoistAction } from "@/app/actions/integrations";
import { DashboardPanel, SectionHeading } from "@/components/app/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getPersistentOwnerUserId } from "@/lib/auth";
import { listConnectedAccountsForUser } from "@/lib/connected-accounts";
import { listOpenTasks } from "@/lib/contacts";

export const metadata: Metadata = {
  title: "Tasks | Kanbun",
  description: "Review follow-ups, reminders, and task state inside Kanbun.",
};

function dueLabel(value: Date | null) {
  if (!value) {
    return "No due date";
  }

  const formatted = value.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return value.getTime() < Date.now() ? `Overdue · ${formatted}` : formatted;
}

function todoistStatusBadge(task: Awaited<ReturnType<typeof listOpenTasks>>[number]) {
  if (task.todoistSyncStatus === "synced") {
    return <Badge variant="outline">Todoist mirrored</Badge>;
  }

  if (task.todoistSyncStatus === "queued") {
    return <Badge variant="secondary">Todoist queued</Badge>;
  }

  if (task.todoistSyncStatus === "degraded") {
    return <Badge variant="destructive">Todoist retry needed</Badge>;
  }

  return null;
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, openTasks, ownerUserId] = await Promise.all([
    searchParams,
    listOpenTasks(),
    getPersistentOwnerUserId(),
  ]);
  const accounts = await listConnectedAccountsForUser(ownerUserId);
  const todoistConnected = accounts.some(
    (account) => account.provider === "todoist" && account.status === "connected",
  );
  const mirrored = params.mirrored === "queued";
  const error =
    typeof params.error === "string" ? decodeURIComponent(params.error) : null;

  return (
    <div className="space-y-6">
      <DashboardPanel>
        <SectionHeading
          eyebrow="Tasks"
          title="A reliable queue for follow-up work"
          description="This queue is now database-backed and updates when follow-ups are created from a contact workspace."
        />
      </DashboardPanel>

      {error ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {mirrored ? (
        <div className="rounded-2xl border border-border/80 bg-primary/8 px-4 py-3 text-sm text-foreground">
          Todoist mirror queued for the worker.
        </div>
      ) : null}

      <DashboardPanel>
        {openTasks.length === 0 ? (
          <div className="border-border/85 bg-background/75 text-muted-foreground rounded-2xl border px-4 py-4 text-sm">
            No open tasks yet. Create a follow-up from a contact to populate
            this queue.
          </div>
        ) : (
          <div className="space-y-3">
            {openTasks.map((task) => (
              <div
                key={task.id}
                className="border-border/85 bg-background/75 flex flex-col gap-4 rounded-2xl border px-4 py-4 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="space-y-1">
                  <p className="text-foreground text-sm font-semibold">
                    {task.title}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {task.contact ? (
                      <Link
                        href={`/contacts/${task.contact.slug}`}
                        className="hover:text-foreground transition-colors"
                      >
                        {task.contact.displayName}
                      </Link>
                    ) : (
                      "No linked contact"
                    )}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Badge variant="secondary">{dueLabel(task.dueAt)}</Badge>
                    {todoistStatusBadge(task)}
                  </div>
                  {task.todoistLastError ? (
                    <p className="text-sm text-destructive">{task.todoistLastError}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {todoistConnected &&
                  task.todoistSyncStatus !== "synced" ? (
                    <form action={mirrorTaskToTodoistAction}>
                      <input type="hidden" name="taskId" value={task.id} />
                      <Button type="submit" variant="outline">
                        {task.todoistSyncStatus === "degraded"
                          ? "Retry Todoist"
                          : "Mirror to Todoist"}
                      </Button>
                    </form>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </DashboardPanel>
    </div>
  );
}
