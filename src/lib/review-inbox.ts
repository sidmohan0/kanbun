import { desc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  connectedAccounts,
  contacts,
  imports,
  tasks,
} from "@/db/schema";
import { decorateConnectedAccount } from "@/lib/connected-accounts";
import { listOpenMergeReviews } from "@/lib/merge-reviews";
import { listPendingOutboundApprovals } from "@/lib/sequences";

export async function listReviewInbox() {
  const [mergeReviews, outboundApprovals, degradedAccounts, degradedTasks, importIssues] =
    await Promise.all([
      listOpenMergeReviews(),
      listPendingOutboundApprovals(),
      db.query.connectedAccounts.findMany({
        where: or(
          eq(connectedAccounts.provider, "google"),
          eq(connectedAccounts.provider, "microsoft"),
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

  const accountsWithWarnings = degradedAccounts
    .map(decorateConnectedAccount)
    .filter(
      (account) =>
        account.status === "degraded" ||
        account.status === "reconnect_required" ||
        account.missingScopes.length > 0 ||
        Boolean(account.lastError) ||
        Boolean(account.contactSyncLastError) ||
        Boolean(account.replySyncLastError),
    );

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
