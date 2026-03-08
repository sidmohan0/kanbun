import crypto from "node:crypto";
import { cookies } from "next/headers";
import { and, asc, eq, isNotNull, ne, or } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, connectedAccounts, contacts, tasks } from "@/db/schema";
import { env } from "@/lib/env";
import { decryptSecret, encryptSecret } from "@/lib/secrets";

const TODOIST_OAUTH_STATE_COOKIE = "kanbun_todoist_oauth_state";
const TODOIST_SCOPES = ["data:read_write"];

type TodoistTokenResponse = {
  access_token: string;
  token_type?: string;
};

type TodoistUser = {
  email?: string | null;
  full_name?: string | null;
  id: string | number;
};

type TodoistTask = {
  content?: string | null;
  description?: string | null;
  due?: {
    datetime?: string | null;
    string?: string | null;
  } | null;
  id: string | number;
};

type TodoistTaskListResponse =
  | TodoistTask[]
  | {
      next_cursor?: string | null;
      results?: TodoistTask[];
    };

function todoistRedirectUri() {
  return `${env.KANBUN_URL}/api/auth/todoist/callback`;
}

function buildStateCookieValue() {
  return crypto.randomBytes(24).toString("hex");
}

function ensureTodoistConfigured() {
  if (!env.TODOIST_CLIENT_ID || !env.TODOIST_CLIENT_SECRET) {
    throw new Error("Todoist OAuth is not configured.");
  }
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

function parseTaskListResponse(payload: TodoistTaskListResponse) {
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

  const accessToken = decryptSecret(account.encryptedAccessToken);

  if (!accessToken) {
    throw new Error("Todoist access token is missing.");
  }

  return {
    accessToken,
    account,
  };
}

async function getActiveTodoistAccount() {
  return db.query.connectedAccounts.findFirst({
    where: and(
      eq(connectedAccounts.provider, "todoist"),
      or(
        eq(connectedAccounts.status, "connected"),
        eq(connectedAccounts.status, "degraded"),
        eq(connectedAccounts.status, "reconnect_required"),
      ),
      isNotNull(connectedAccounts.encryptedAccessToken),
    ),
    orderBy: [asc(connectedAccounts.createdAt)],
  });
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

export function isTodoistOAuthConfigured() {
  return Boolean(env.TODOIST_CLIENT_ID && env.TODOIST_CLIENT_SECRET);
}

export async function createTodoistOAuthUrl() {
  ensureTodoistConfigured();

  const state = buildStateCookieValue();
  const cookieStore = await cookies();
  cookieStore.set(TODOIST_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    maxAge: 60 * 10,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  const params = new URLSearchParams({
    client_id: env.TODOIST_CLIENT_ID!,
    redirect_uri: todoistRedirectUri(),
    scope: TODOIST_SCOPES.join(","),
    state,
  });

  return `https://todoist.com/oauth/authorize?${params.toString()}`;
}

export async function consumeTodoistOAuthCallback(input: {
  code: string;
  state: string;
  userId: string;
}) {
  ensureTodoistConfigured();

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(TODOIST_OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(TODOIST_OAUTH_STATE_COOKIE);

  if (!expectedState || input.state !== expectedState) {
    throw new Error("Todoist OAuth state validation failed.");
  }

  const token = await todoistFetch<TodoistTokenResponse>(
    "https://todoist.com/oauth/access_token",
    {
      body: new URLSearchParams({
        client_id: env.TODOIST_CLIENT_ID!,
        client_secret: env.TODOIST_CLIENT_SECRET!,
        code: input.code,
        redirect_uri: todoistRedirectUri(),
      }),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    },
    "Unable to exchange Todoist authorization code",
  );

  const profile = await todoistFetch<TodoistUser>(
    "https://api.todoist.com/api/v1/user/",
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
      },
    },
    "Unable to fetch Todoist profile",
  );

  const providerAccountId = String(profile.id);
  const existing = await db.query.connectedAccounts.findFirst({
    where: and(
      eq(connectedAccounts.provider, "todoist"),
      eq(connectedAccounts.providerAccountId, providerAccountId),
    ),
  });

  const metadata = {
    oauthConnectedAt: new Date().toISOString(),
    todoistSyncMode: "tasks",
  };

  if (existing) {
    await db
      .update(connectedAccounts)
      .set({
        displayName: profile.full_name ?? existing.displayName,
        email: profile.email ?? existing.email,
        encryptedAccessToken: encryptSecret(token.access_token),
        encryptedRefreshToken: null,
        grantedScopes: TODOIST_SCOPES,
        lastError: null,
        metadata,
        status: "connected",
        syncRequestedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(connectedAccounts.id, existing.id));

    return existing.id;
  }

  const [account] = await db
    .insert(connectedAccounts)
    .values({
      displayName: profile.full_name ?? null,
      email: profile.email ?? null,
      encryptedAccessToken: encryptSecret(token.access_token),
      encryptedRefreshToken: null,
      grantedScopes: TODOIST_SCOPES,
      metadata,
      provider: "todoist",
      providerAccountId,
      status: "connected",
      syncRequestedAt: new Date(),
      userId: input.userId,
    })
    .returning();

  return account.id;
}

export async function requestTodoistAccountSync(userId: string) {
  const account = await db.query.connectedAccounts.findFirst({
    where: and(
      eq(connectedAccounts.userId, userId),
      eq(connectedAccounts.provider, "todoist"),
    ),
  });

  if (!account) {
    throw new Error("Todoist account is not connected.");
  }

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

export async function disconnectTodoistAccount(userId: string) {
  const account = await db.query.connectedAccounts.findFirst({
    where: and(
      eq(connectedAccounts.userId, userId),
      eq(connectedAccounts.provider, "todoist"),
    ),
  });

  if (!account) {
    return null;
  }

  await db
    .update(connectedAccounts)
    .set({
      encryptedAccessToken: null,
      encryptedRefreshToken: null,
      grantedScopes: [],
      lastError: null,
      status: "disconnected",
      syncRequestedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(connectedAccounts.id, account.id));

  return account.id;
}

export async function hasConnectedTodoistAccount(userId: string) {
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

  const account = await getActiveTodoistAccount();

  if (!account) {
    throw new Error("Todoist account is not connected.");
  }

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

  if (!account) {
    throw new Error("Todoist account is not connected.");
  }

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
    mode: task.todoistItemId ? "updated" as const : "created" as const,
    taskId: task.id,
    todoistItemId: String(remoteTask.id),
  };
}

export async function reconcileTodoistAccount(accountId: string) {
  const { accessToken, account } = await getTodoistAccessToken(accountId);
  let nextCursor: string | null = null;
  const activeTaskIds = new Set<string>();
  let mirroredCount = 0;

  do {
    const url = new URL("https://api.todoist.com/api/v1/tasks");

    if (nextCursor) {
      url.searchParams.set("cursor", nextCursor);
    }

    const response = await todoistFetch<TodoistTaskListResponse>(
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

    nextCursor = parsed.nextCursor;
  } while (nextCursor);

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
