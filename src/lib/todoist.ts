import crypto from "node:crypto";
import { and, asc, eq, isNotNull, ne, or } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, connectedAccounts, contacts, tasks, users } from "@/db/schema";
import { env } from "@/lib/env";

const TODOIST_MANAGED_PROVIDER_ACCOUNT_ID = "env-token-managed";
const TODOIST_SCOPES = ["api_token"];

type TodoistTask = {
  content?: string | null;
  description?: string | null;
  due?: {
    datetime?: string | null;
    string?: string | null;
  } | null;
  id: string | number;
};

type TodoistTaskListResponse = {
  next_cursor?: string | null;
  results?: TodoistTask[];
};

function ensureTodoistConfigured() {
  if (!env.TODOIST_API_TOKEN) {
    throw new Error("Todoist API token is not configured.");
  }
}

function todoistAuthHeaders() {
  ensureTodoistConfigured();

  return {
    Authorization: `Bearer ${env.TODOIST_API_TOKEN}`,
  };
}

function normalizeTaskTitle(value: string) {
  return value.trim().slice(0, 500) || "Kanbun task";
}

function buildDuePayload(dueAt: Date | null) {
  if (!dueAt) {
    return {};
  }

  return {
    due_datetime: dueAt.toISOString(),
  };
}

function parseTaskListResponse(payload: TodoistTaskListResponse | TodoistTask[]) {
  if (Array.isArray(payload)) {
    return {
      nextCursor: null,
      tasks: payload,
    };
  }

  return {
    nextCursor: payload.next_cursor ?? null,
    tasks: payload.results ?? [],
  };
}

async function todoistFetch<T>(
  url: string,
  init: RequestInit,
  errorMessage: string,
) {
  const response = await fetch(url, init);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${errorMessage} (${response.status}): ${body}`);
  }

  if (response.status === 204) {
    return null as T;
  }

  return (await response.json()) as T;
}

async function recordAuditEvent(params: {
  entityId: string;
  entityType: string;
  eventName: string;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(auditEvents).values({
    entityId: params.entityId,
    entityType: params.entityType,
    eventName: params.eventName,
    metadata: params.metadata ?? {},
  });
}

function buildTaskDescription(params: {
  contactName?: string | null;
  taskId: string;
}) {
  const lines = [`Managed by Kanbun`, `Task ID: ${params.taskId}`];

  if (params.contactName) {
    lines.push(`Contact: ${params.contactName}`);
  }

  lines.push(`Open in Kanbun: ${env.KANBUN_URL}/tasks`);

  return lines.join("\n");
}

async function getDefaultTodoistUserId() {
  const existing = await db.query.connectedAccounts.findFirst({
    where: eq(connectedAccounts.provider, "todoist"),
    columns: {
      userId: true,
    },
    orderBy: [asc(connectedAccounts.createdAt)],
  });

  if (existing?.userId) {
    return existing.userId;
  }

  const owner = await db.query.users.findFirst({
    where: and(eq(users.role, "owner"), eq(users.status, "active")),
    columns: {
      id: true,
    },
  });

  if (!owner) {
    throw new Error(
      "No persistent owner user exists. Sign in with Google once before enabling Todoist.",
    );
  }

  return owner.id;
}

async function getTodoistManagedAccount(userId?: string) {
  ensureTodoistConfigured();

  const resolvedUserId = userId ?? (await getDefaultTodoistUserId());
  const existing = await db.query.connectedAccounts.findFirst({
    where: and(
      eq(connectedAccounts.userId, resolvedUserId),
      eq(connectedAccounts.provider, "todoist"),
    ),
  });
  const metadataBase =
    typeof existing?.metadata === "object" && existing.metadata
      ? existing.metadata
      : {};
  const metadata = {
    ...metadataBase,
    authMode: "api_token",
    tokenFingerprint: crypto
      .createHash("sha256")
      .update(env.TODOIST_API_TOKEN!)
      .digest("hex")
      .slice(0, 12),
  };

  if (existing) {
    const [account] = await db
      .update(connectedAccounts)
      .set({
        displayName: "Managed via TODOIST_API_TOKEN",
        email: existing.email,
        encryptedAccessToken: null,
        encryptedRefreshToken: null,
        grantedScopes: TODOIST_SCOPES,
        metadata,
        providerAccountId: TODOIST_MANAGED_PROVIDER_ACCOUNT_ID,
        status: "connected",
        updatedAt: new Date(),
      })
      .where(eq(connectedAccounts.id, existing.id))
      .returning();

    return account;
  }

  const [account] = await db
    .insert(connectedAccounts)
    .values({
      displayName: "Managed via TODOIST_API_TOKEN",
      email: null,
      encryptedAccessToken: null,
      encryptedRefreshToken: null,
      grantedScopes: TODOIST_SCOPES,
      metadata,
      provider: "todoist",
      providerAccountId: TODOIST_MANAGED_PROVIDER_ACCOUNT_ID,
      status: "connected",
      userId: resolvedUserId,
    })
    .returning();

  return account;
}

async function getTodoistAccessToken(accountId: string) {
  const account = await db.query.connectedAccounts.findFirst({
    where: and(
      eq(connectedAccounts.id, accountId),
      eq(connectedAccounts.provider, "todoist"),
    ),
  });

  if (!account) {
    throw new Error("Connected Todoist account not found.");
  }

  ensureTodoistConfigured();

  return {
    accessToken: env.TODOIST_API_TOKEN!,
    account,
  };
}

async function getActiveTodoistAccount() {
  const existing = await db.query.connectedAccounts.findFirst({
    where: and(
      eq(connectedAccounts.provider, "todoist"),
      or(
        eq(connectedAccounts.status, "connected"),
        eq(connectedAccounts.status, "degraded"),
        eq(connectedAccounts.status, "reconnect_required"),
      ),
    ),
    orderBy: [asc(connectedAccounts.createdAt)],
  });

  if (existing) {
    return getTodoistManagedAccount(existing.userId);
  }

  return getTodoistManagedAccount();
}

async function updateTodoistAccountHealth(params: {
  accountId: string;
  lastError?: string | null;
  metadata?: Record<string, unknown>;
  status?: "connected" | "degraded" | "reconnect_required";
}) {
  const existing = await db.query.connectedAccounts.findFirst({
    where: eq(connectedAccounts.id, params.accountId),
    columns: {
      metadata: true,
    },
  });

  await db
    .update(connectedAccounts)
    .set({
      lastError: params.lastError ?? null,
      lastSuccessfulSyncAt: params.status === "connected" ? new Date() : undefined,
      metadata: params.metadata
        ? {
            ...(typeof existing?.metadata === "object" && existing.metadata
              ? existing.metadata
              : {}),
            ...params.metadata,
          }
        : existing?.metadata ?? {},
      status: params.status ?? "connected",
      updatedAt: new Date(),
    })
    .where(eq(connectedAccounts.id, params.accountId));
}

export function isTodoistApiTokenConfigured() {
  return Boolean(env.TODOIST_API_TOKEN);
}

export async function getTodoistManagedAccountForUser(userId: string) {
  if (!isTodoistApiTokenConfigured()) {
    return null;
  }

  return getTodoistManagedAccount(userId);
}

export async function requestTodoistAccountSync(userId: string) {
  const account = await getTodoistManagedAccount(userId);

  await db
    .update(connectedAccounts)
    .set({
      lastError: null,
      syncRequestedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(connectedAccounts.id, account.id));

  return account.id;
}

export async function hasConnectedTodoistAccount(userId: string) {
  if (!isTodoistApiTokenConfigured()) {
    return false;
  }

  const account = await db.query.connectedAccounts.findFirst({
    where: and(
      eq(connectedAccounts.userId, userId),
      eq(connectedAccounts.provider, "todoist"),
      eq(connectedAccounts.status, "connected"),
    ),
    columns: {
      id: true,
    },
  });

  return Boolean(account);
}

export async function queueTaskTodoistSync(taskId: string) {
  const task = await db.query.tasks.findFirst({
    where: eq(tasks.id, taskId),
  });

  if (!task) {
    throw new Error("Task not found.");
  }

  await getActiveTodoistAccount();

  await db
    .update(tasks)
    .set({
      todoistLastError: null,
      todoistSyncRequestedAt: new Date(),
      todoistSyncStatus: "queued",
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, task.id));

  return task.id;
}

export async function syncTodoistTaskForTaskId(taskId: string) {
  const task = await db.query.tasks.findFirst({
    where: eq(tasks.id, taskId),
  });

  if (!task) {
    throw new Error("Task not found.");
  }

  const account = await getActiveTodoistAccount();
  const { accessToken } = await getTodoistAccessToken(account.id);
  const linkedContact = task.contactId
    ? await db.query.contacts.findFirst({
        where: eq(contacts.id, task.contactId),
        columns: {
          displayName: true,
        },
      })
    : null;

  if (task.status === "done") {
    if (task.todoistItemId) {
      await todoistFetch<null>(
        `https://api.todoist.com/api/v1/tasks/${task.todoistItemId}/close`,
        {
          headers: {
            ...todoistAuthHeaders(),
            Authorization: `Bearer ${accessToken}`,
          },
          method: "POST",
        },
        "Unable to close Todoist task",
      );
    }

    await db
      .update(tasks)
      .set({
        todoistLastError: null,
        todoistSyncRequestedAt: null,
        todoistSyncStatus: task.todoistItemId ? "synced" : "not_mirrored",
        todoistSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, task.id));

    return {
      mode: "closed" as const,
      taskId: task.id,
    };
  }

  const payload = {
    content: normalizeTaskTitle(task.title),
    description: buildTaskDescription({
      contactName: linkedContact?.displayName,
      taskId: task.id,
    }),
    ...buildDuePayload(task.dueAt),
  };
  const requestId = crypto.randomUUID();
  let remoteTask: TodoistTask;

  if (task.todoistItemId) {
    try {
      remoteTask = await todoistFetch<TodoistTask>(
        `https://api.todoist.com/api/v1/tasks/${task.todoistItemId}`,
        {
          body: JSON.stringify(payload),
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "X-Request-Id": requestId,
          },
          method: "POST",
        },
        "Unable to update Todoist task",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";

      if (!message.includes("(404)")) {
        throw error;
      }

      remoteTask = await todoistFetch<TodoistTask>(
        "https://api.todoist.com/api/v1/tasks",
        {
          body: JSON.stringify(payload),
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "X-Request-Id": requestId,
          },
          method: "POST",
        },
        "Unable to create Todoist task",
      );
    }
  } else {
    remoteTask = await todoistFetch<TodoistTask>(
      "https://api.todoist.com/api/v1/tasks",
      {
        body: JSON.stringify(payload),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Request-Id": requestId,
        },
        method: "POST",
      },
      "Unable to create Todoist task",
    );
  }

  await db
    .update(tasks)
    .set({
      todoistCompletedAt: null,
      todoistItemId: String(remoteTask.id),
      todoistLastError: null,
      todoistSyncRequestedAt: null,
      todoistSyncStatus: "synced",
      todoistSyncedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, task.id));

  await updateTodoistAccountHealth({
    accountId: account.id,
    metadata: {
      lastMirroredTaskId: task.id,
    },
    status: "connected",
  });

  await recordAuditEvent({
    entityId: task.id,
    entityType: "task",
    eventName: "task.todoist_mirrored",
    metadata: {
      todoistItemId: String(remoteTask.id),
    },
  });

  return {
    mode: task.todoistItemId ? ("updated" as const) : ("created" as const),
    taskId: task.id,
    todoistItemId: String(remoteTask.id),
  };
}

export async function reconcileTodoistAccount(accountId: string) {
  const { accessToken, account } = await getTodoistAccessToken(accountId);
  const activeTaskIds = new Set<string>();
  let cursor: string | null = null;

  do {
    const url = new URL("https://api.todoist.com/api/v1/tasks");

    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }

    const response = await todoistFetch<TodoistTaskListResponse | TodoistTask[]>(
      url.toString(),
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      "Unable to fetch Todoist tasks",
    );
    const parsed = parseTaskListResponse(response);

    for (const item of parsed.tasks) {
      activeTaskIds.add(String(item.id));
    }

    cursor = parsed.nextCursor;
  } while (cursor);

  let mirroredCount = 0;

  const mirroredTasks = await db.query.tasks.findMany({
    where: and(
      isNotNull(tasks.todoistItemId),
      ne(tasks.todoistSyncStatus, "not_mirrored"),
    ),
    orderBy: [asc(tasks.createdAt)],
  });

  for (const task of mirroredTasks) {
    mirroredCount += 1;

    if (task.todoistItemId && activeTaskIds.has(task.todoistItemId)) {
      if (task.status === "done") {
        await todoistFetch<null>(
          `https://api.todoist.com/api/v1/tasks/${task.todoistItemId}/close`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            method: "POST",
          },
          "Unable to close Todoist task during reconciliation",
        );
      }

      await db
        .update(tasks)
        .set({
          todoistLastError: null,
          todoistSyncStatus: "synced",
          todoistSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, task.id));

      continue;
    }

    if (task.status === "open") {
      await db
        .update(tasks)
        .set({
          status: "done",
          todoistCompletedAt: new Date(),
          todoistLastError: null,
          todoistSyncStatus: "synced",
          todoistSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, task.id));

      await recordAuditEvent({
        entityId: task.id,
        entityType: "task",
        eventName: "task.todoist_reconciled_done",
        metadata: {
          todoistItemId: task.todoistItemId,
        },
      });

      continue;
    }

    await db
      .update(tasks)
      .set({
        todoistLastError: null,
        todoistSyncStatus: "synced",
        todoistSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, task.id));
  }

  await updateTodoistAccountHealth({
    accountId: account.id,
    metadata: {
      lastReconciledTaskCount: mirroredCount,
    },
    status: "connected",
  });

  return {
    mirroredCount,
  };
}
