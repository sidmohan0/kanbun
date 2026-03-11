import Link from "next/link";
import type { Metadata } from "next";
import {
  completeTaskAction,
  reopenTaskAction,
  snoozeTaskAction,
} from "@/app/actions/tasks";
import { mirrorTaskToTodoistAction } from "@/app/actions/integrations";
import { DashboardPanel, SectionHeading } from "@/components/app/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listTaskBuckets } from "@/lib/contacts";
import { isTodoistApiTokenConfigured } from "@/lib/todoist";

export const metadata: Metadata = {
  title: "Tasks | Kanbun",
  description: "Review follow-ups, reminders, and task state inside Kanbun.",
};

type TaskBuckets = Awaited<ReturnType<typeof listTaskBuckets>>;
type TaskRow = TaskBuckets[keyof TaskBuckets][number];

function dueLabel(value: Date | null, status: TaskRow["status"]) {
  if (!value) {
    return status === "done" ? "Completed without a due date" : "No due date";
  }

  const formatted = value.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  if (status === "done") {
    return `Completed after ${formatted}`;
  }

  if (value.getTime() < Date.now()) {
    return `Overdue · ${formatted}`;
  }

  return formatted;
}

function todoistStatusBadge(task: TaskRow) {
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

function feedbackMessage(
  params: Record<string, string | string[] | undefined>,
): string | null {
  if (params.task === "completed") {
    return "Task completed. Todoist mirror will close on the next worker pass if it exists.";
  }

  if (params.task === "snoozed") {
    return "Task snoozed. The due date and Todoist mirror were queued for update.";
  }

  if (params.task === "reopened") {
    return "Task reopened and added back to the working queue.";
  }

  if (params.mirrored === "queued") {
    return "Todoist mirror queued for the worker.";
  }

  return null;
}

function TaskSection(props: {
  description: string;
  emptyState: string;
  tasks: TaskRow[];
  title: string;
  todoistConnected: boolean;
}) {
  return (
    <DashboardPanel>
      <SectionHeading
        eyebrow="Task queue"
        title={props.title}
        description={props.description}
      />

      {props.tasks.length === 0 ? (
        <div className="rounded-2xl border border-border/85 bg-background/75 px-4 py-4 text-sm text-muted-foreground">
          {props.emptyState}
        </div>
      ) : (
        <div className="space-y-3">
          {props.tasks.map((task) => (
            <div
              key={task.id}
              data-task-title={task.title}
              className="flex flex-col gap-4 rounded-2xl border border-border/85 bg-background/75 px-4 py-4 lg:flex-row lg:items-center lg:justify-between"
            >
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">{task.title}</p>
                <p className="text-sm text-muted-foreground">
                  {task.contact ? (
                    <Link
                      href={`/contacts/${task.contact.slug}`}
                      className="transition-colors hover:text-foreground"
                    >
                      {task.contact.displayName}
                    </Link>
                  ) : (
                    "No linked contact"
                  )}
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Badge variant="secondary">{dueLabel(task.dueAt, task.status)}</Badge>
                  <Badge variant="outline">{task.status}</Badge>
                  {todoistStatusBadge(task)}
                </div>
                {task.todoistLastError ? (
                  <p className="text-sm text-destructive">{task.todoistLastError}</p>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {task.status !== "done" ? (
                  <form action={completeTaskAction}>
                    <input type="hidden" name="returnTo" value="/tasks" />
                    <input type="hidden" name="taskId" value={task.id} />
                    <Button type="submit" variant="outline">
                      Complete
                    </Button>
                  </form>
                ) : (
                  <form action={reopenTaskAction}>
                    <input type="hidden" name="returnTo" value="/tasks" />
                    <input type="hidden" name="taskId" value={task.id} />
                    <Button type="submit" variant="outline">
                      Reopen
                    </Button>
                  </form>
                )}

                {task.status !== "done" ? (
                  <form action={snoozeTaskAction}>
                    <input type="hidden" name="returnTo" value="/tasks" />
                    <input type="hidden" name="taskId" value={task.id} />
                    <input type="hidden" name="days" value="2" />
                    <Button type="submit" variant="outline">
                      Snooze 2 days
                    </Button>
                  </form>
                ) : null}

                {props.todoistConnected && task.todoistSyncStatus !== "synced" ? (
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
  );
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, buckets] = await Promise.all([searchParams, listTaskBuckets()]);
  const todoistConnected = isTodoistApiTokenConfigured();
  const feedback = feedbackMessage(params);
  const error =
    typeof params.error === "string" ? decodeURIComponent(params.error) : null;

  return (
    <div className="space-y-6">
      <DashboardPanel>
        <SectionHeading
          eyebrow="Tasks"
          title="A real follow-up operating queue"
          description="Kanbun tasks now support open, snoozed, and done states with Todoist-aware state transitions instead of a single open-only list."
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ["Open", buckets.open.length, "Immediate work and overdue follow-ups."],
            ["Snoozed", buckets.snoozed.length, "Deferred work still kept in view."],
            ["Done", buckets.done.length, "Closed work with reopen support."],
          ].map(([label, value, note]) => (
            <div key={label} className="rounded-2xl border border-border/80 bg-background/75 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                {label}
              </p>
              <p className="mt-3 text-4xl font-semibold tracking-tight text-foreground">
                {value}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">{note}</p>
            </div>
          ))}
        </div>
      </DashboardPanel>

      {error ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {feedback ? (
        <div className="rounded-2xl border border-border/80 bg-primary/8 px-4 py-3 text-sm text-foreground">
          {feedback}
        </div>
      ) : null}

      <TaskSection
        description="Open tasks are the active queue and should be the default place you work from."
        emptyState="No open tasks yet. Create a follow-up from a contact to populate this queue."
        tasks={buckets.open}
        title="Open follow-ups"
        todoistConnected={todoistConnected}
      />
      <TaskSection
        description="Snoozed tasks stay inside Kanbun with a fresh due date and can still mirror into Todoist."
        emptyState="No snoozed tasks right now."
        tasks={buckets.snoozed}
        title="Snoozed tasks"
        todoistConnected={todoistConnected}
      />
      <TaskSection
        description="Done tasks remain visible for audit and can be reopened when a thread becomes active again."
        emptyState="No completed tasks yet."
        tasks={buckets.done}
        title="Completed tasks"
        todoistConnected={todoistConnected}
      />
    </div>
  );
}
