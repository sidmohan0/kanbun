import { and, asc, eq, isNotNull, ne, or } from "drizzle-orm";
import { db } from "@/db/client";
import { connectedAccounts, tasks } from "@/db/schema";
import {
  reconcileTodoistAccount,
  syncTodoistTaskForTaskId,
} from "@/lib/todoist";

type WorkerLogger = Pick<Console, "error" | "info">;

async function claimNextTodoistAccountSyncId() {
  const account = await db.query.connectedAccounts.findFirst({
    where: and(
      eq(connectedAccounts.provider, "todoist"),
      isNotNull(connectedAccounts.syncRequestedAt),
      or(
        eq(connectedAccounts.status, "connected"),
        eq(connectedAccounts.status, "degraded"),
        eq(connectedAccounts.status, "reconnect_required"),
      ),
    ),
    orderBy: [asc(connectedAccounts.syncRequestedAt)],
  });

  if (!account) {
    return null;
  }

  await db
    .update(connectedAccounts)
    .set({
      lastError: null,
      syncRequestedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(connectedAccounts.id, account.id));

  return account.id;
}

async function claimNextTodoistTaskSyncId() {
  const task = await db.query.tasks.findFirst({
    where: and(
      isNotNull(tasks.todoistSyncRequestedAt),
      ne(tasks.todoistSyncStatus, "not_mirrored"),
    ),
    orderBy: [asc(tasks.todoistSyncRequestedAt)],
  });

  if (!task) {
    return null;
  }

  await db
    .update(tasks)
    .set({
      todoistLastError: null,
      todoistSyncRequestedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, task.id));

  return task.id;
}

export async function processNextTodoistAccountSync(
  logger: WorkerLogger = console,
) {
  const accountId = await claimNextTodoistAccountSyncId();

  if (!accountId) {
    return false;
  }

  try {
    const result = await reconcileTodoistAccount(accountId);
    logger.info(
      `[kanbun-worker] reconciled ${result.mirroredCount} Todoist mirrors for account ${accountId}`,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Todoist reconciliation failed.";

    await db
      .update(connectedAccounts)
      .set({
        lastError: message,
        status: "degraded",
        updatedAt: new Date(),
      })
      .where(eq(connectedAccounts.id, accountId));

    logger.error(
      `[kanbun-worker] Todoist reconciliation failed for ${accountId}`,
      error,
    );
  }

  return true;
}

export async function processNextTodoistTaskSync(
  logger: WorkerLogger = console,
) {
  const taskId = await claimNextTodoistTaskSyncId();

  if (!taskId) {
    return false;
  }

  try {
    const result = await syncTodoistTaskForTaskId(taskId);
    logger.info(
      `[kanbun-worker] ${result.mode} Todoist mirror for task ${result.taskId}`,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Todoist task sync failed.";

    await db
      .update(tasks)
      .set({
        todoistLastError: message,
        todoistSyncStatus: "degraded",
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId));

    logger.error(`[kanbun-worker] Todoist task sync failed for ${taskId}`, error);
  }

  return true;
}
