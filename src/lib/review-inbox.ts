import { desc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  connectedAccounts,
  contacts,
  imports,
  tasks,
} from "@/db/schema";
import { listOpenMergeReviews } from "@/lib/merge-reviews";
import { listPendingOutboundApprovals } from "@/lib/sequences";
import {
  GOOGLE_REPLY_READ_SCOPE,
  MICROSOFT_REPLY_READ_SCOPE,
} from "@/lib/provider-scopes";

function getReplyScopeWarning(
  account: typeof connectedAccounts.$inferSelect,
) {
  if (account.provider === "google") {
    return account.grantedScopes.includes(GOOGLE_REPLY_READ_SCOPE)
      ? null
      : "Reconnect Google to enable automatic reply detection.";
  }

  if (account.provider === "microsoft") {
    return account.grantedScopes.includes(MICROSOFT_REPLY_READ_SCOPE)
      ? null
      : "Reconnect Microsoft to enable automatic reply detection.";
  }

  return null;
}

export async function listReviewInbox() {
  const [mergeReviews, outboundApprovals, degradedAccounts, degradedTasks, importIssues] =
    await Promise.all([
      listOpenMergeReviews(),
      listPendingOutboundApprovals(),
      db.query.connectedAccounts.findMany({
        where: or(
          eq(connectedAccounts.status, "degraded"),
          eq(connectedAccounts.status, "reconnect_required"),
        ),
        orderBy: [desc(connectedAccounts.updatedAt)],
      }),
      db.query.tasks.findMany({
        where: eq(tasks.todoistSyncStatus, "degraded"),
        orderBy: [desc(tasks.updatedAt)],
      }),
      db.query.imports.findMany({
        where: or(
          eq(imports.status, "failed"),
          eq(imports.status, "completed_with_warnings"),
        ),
        orderBy: [desc(imports.updatedAt)],
        limit: 10,
      }),
    ]);

  const degradedTaskContactIds = Array.from(
    new Set(
      degradedTasks
        .map((task) => task.contactId)
        .filter((contactId): contactId is string => Boolean(contactId)),
    ),
  );
  const taskContacts = degradedTaskContactIds.length
    ? await db.query.contacts.findMany({
        where: inArray(contacts.id, degradedTaskContactIds),
        columns: {
          displayName: true,
          id: true,
          slug: true,
        },
      })
    : [];
  const taskContactMap = new Map(
    taskContacts.map((contact) => [contact.id, contact]),
  );

  const accountsWithWarnings = degradedAccounts.map((account) => ({
    ...account,
    replyScopeWarning: getReplyScopeWarning(account),
  }));

  return {
    counts: {
      connectorIssues: accountsWithWarnings.length,
      importIssues: importIssues.length,
      mergeReviews: mergeReviews.length,
      outboundApprovals: outboundApprovals.length,
      taskExceptions: degradedTasks.length,
    },
    connectorIssues: accountsWithWarnings,
    importIssues,
    mergeReviews,
    outboundApprovals,
    taskExceptions: degradedTasks.map((task) => ({
      ...task,
      contact: task.contactId ? (taskContactMap.get(task.contactId) ?? null) : null,
    })),
  };
}
