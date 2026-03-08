import { asc, eq } from "drizzle-orm";
import { db, sql as pg } from "@/db/client";
import {
  auditEvents,
  contactIdentities,
  contactSources,
  contacts,
  importRows,
  imports,
} from "@/db/schema";
import {
  buildUniqueSlug,
  findContactById,
  findContactIdentityByEmail,
  mergeContactFields,
} from "@/lib/contacts";
import { env } from "@/lib/env";
import { summarizeWarnings } from "@/lib/import-utils";

type ClaimedImportRow = {
  contactId: string | null;
  id: string;
  importId: string;
  normalizedCompany: string | null;
  normalizedEmail: string | null;
  normalizedName: string | null;
  normalizedTitle: string | null;
  proposedAction: "create" | "flag" | "skip" | "update";
  rowNumber: number;
  status: "processing";
  warnings: string[];
};

type WorkerLogger = Pick<Console, "error" | "info">;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeImportStatus({
  flaggedCount,
  inFlightCount,
  mappingWarnings,
  warningCount,
}: {
  flaggedCount: number;
  inFlightCount: number;
  mappingWarnings: string[];
  warningCount: number;
}) {
  if (inFlightCount > 0) {
    return "processing" as const;
  }

  return flaggedCount > 0 || warningCount > 0 || mappingWarnings.length > 0
    ? "completed_with_warnings"
    : "completed";
}

async function recordAuditEvent({
  entityId,
  entityType,
  eventName,
  metadata,
}: {
  entityId: string;
  entityType: string;
  eventName: string;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(auditEvents).values({
    entityId,
    entityType,
    eventName,
    metadata: metadata ?? {},
  });
}

async function ensureContactSource(
  contactId: string,
  sourceRef: string,
  sourceLabel: string | null,
) {
  const existingSource = await db.query.contactSources.findFirst({
    where: eq(contactSources.sourceRef, sourceRef),
  });

  if (existingSource) {
    return;
  }

  await db.insert(contactSources).values({
    contactId,
    sourceLabel,
    sourceRef,
    sourceType: "csv",
  });
}

async function claimQueuedImportId() {
  const claimed = await pg<{ id: string }[]>`
    update imports
    set status = 'processing', updated_at = now()
    where id = (
      select id
      from imports
      where status = 'queued'
      order by updated_at asc
      limit 1
      for update skip locked
    )
    returning id
  `;

  return claimed[0]?.id ?? null;
}

async function findProcessingImportId() {
  const [importRecord] = await db
    .select({ id: imports.id })
    .from(imports)
    .where(eq(imports.status, "processing"))
    .orderBy(asc(imports.updatedAt))
    .limit(1);

  return importRecord?.id ?? null;
}

async function claimRowsForImport(importId: string, batchSize: number) {
  const staleBefore = new Date(Date.now() - env.IMPORT_WORKER_STALE_ROW_MS);

  return pg<ClaimedImportRow[]>`
    update import_rows
    set status = 'processing', updated_at = now()
    where id in (
      select id
      from import_rows
      where import_id = ${importId}
        and (
          status = 'pending'
          or (status = 'processing' and updated_at < ${staleBefore})
        )
      order by row_number asc
      limit ${batchSize}
      for update skip locked
    )
    returning
      id,
      import_id as "importId",
      row_number as "rowNumber",
      normalized_name as "normalizedName",
      normalized_email as "normalizedEmail",
      normalized_company as "normalizedCompany",
      normalized_title as "normalizedTitle",
      proposed_action as "proposedAction",
      warnings,
      contact_id as "contactId",
      status
  `;
}

async function refreshImportSummary(importId: string, errorMessage?: string | null) {
  const importRecord = await db.query.imports.findFirst({
    where: eq(imports.id, importId),
  });

  if (!importRecord) {
    return null;
  }

  const rows = await db.query.importRows.findMany({
    where: eq(importRows.importId, importId),
    orderBy: [asc(importRows.rowNumber)],
  });
  const createdCount = rows.filter((row) => row.status === "created").length;
  const updatedCount = rows.filter((row) => row.status === "updated").length;
  const flaggedCount = rows.filter((row) => row.status === "flagged").length;
  const skippedCount = rows.filter((row) => row.status === "skipped").length;
  const warningCount = rows.filter((row) => row.warnings.length > 0).length;
  const inFlightCount = rows.filter(
    (row) => row.status === "pending" || row.status === "processing",
  ).length;
  const status =
    errorMessage === undefined
      ? computeImportStatus({
          flaggedCount,
          inFlightCount,
          mappingWarnings: importRecord.mappingWarnings,
          warningCount,
        })
      : "failed";

  await db
    .update(imports)
    .set({
      createdCount,
      errorMessage: errorMessage ?? null,
      flaggedCount,
      skippedCount,
      status,
      updatedAt: new Date(),
      updatedCount,
      warningCount,
    })
    .where(eq(imports.id, importId));

  return {
    status,
  };
}

async function applyImportRow(
  importRecord: Awaited<ReturnType<typeof db.query.imports.findFirst>>,
  row: ClaimedImportRow,
) {
  if (!importRecord) {
    return;
  }

  if (row.proposedAction === "skip") {
    await db
      .update(importRows)
      .set({
        status: "skipped",
        updatedAt: new Date(),
      })
      .where(eq(importRows.id, row.id));
    return;
  }

  if (row.proposedAction === "flag") {
    await db
      .update(importRows)
      .set({
        status: "flagged",
        updatedAt: new Date(),
      })
      .where(eq(importRows.id, row.id));
    return;
  }

  if (row.proposedAction === "update" && row.contactId) {
    const existingContact = await findContactById(row.contactId);

    if (existingContact) {
      const merged = mergeContactFields(existingContact, {
        company: row.normalizedCompany,
        displayName: row.normalizedName || existingContact.displayName,
        primaryEmail: row.normalizedEmail,
        title: row.normalizedTitle,
      });

      await db
        .update(contacts)
        .set({
          company: merged.company,
          displayName: merged.displayName,
          primaryEmail: merged.primaryEmail,
          title: merged.title,
          updatedAt: new Date(),
        })
        .where(eq(contacts.id, existingContact.id));

      if (
        row.normalizedEmail &&
        row.normalizedEmail !== existingContact.primaryEmail
      ) {
        const existingIdentity = await findContactIdentityByEmail(
          row.normalizedEmail,
        );

        if (!existingIdentity) {
          await db.insert(contactIdentities).values({
            contactId: existingContact.id,
            kind: "email",
            normalizedValue: row.normalizedEmail,
            sourceType: "csv",
            value: row.normalizedEmail,
          });
        }
      }

      await ensureContactSource(
        existingContact.id,
        `${importRecord.id}:${row.rowNumber}`,
        importRecord.label,
      );

      await db
        .update(importRows)
        .set({
          status: "updated",
          updatedAt: new Date(),
        })
        .where(eq(importRows.id, row.id));

      return;
    }
  }

  if (row.normalizedEmail) {
    const existingIdentity = await findContactIdentityByEmail(row.normalizedEmail);

    if (existingIdentity) {
      const nextWarnings = Array.from(
        new Set([
          ...row.warnings,
          "An existing contact claimed this email while the import was processing. The row was re-flagged for review.",
        ]),
      );

      await db
        .update(importRows)
        .set({
          contactId: existingIdentity.contactId,
          proposedAction: "flag",
          status: "flagged",
          warning: summarizeWarnings(nextWarnings),
          warnings: nextWarnings,
          updatedAt: new Date(),
        })
        .where(eq(importRows.id, row.id));

      return;
    }
  }

  const slug = await buildUniqueSlug(
    row.normalizedName || row.normalizedEmail || "contact",
  );
  const [createdContact] = await db
    .insert(contacts)
    .values({
      company: row.normalizedCompany,
      displayName: row.normalizedName || row.normalizedEmail || "Unnamed contact",
      primaryEmail: row.normalizedEmail,
      slug,
      title: row.normalizedTitle,
    })
    .returning();

  if (row.normalizedEmail) {
    await db.insert(contactIdentities).values({
      contactId: createdContact.id,
      kind: "email",
      normalizedValue: row.normalizedEmail,
      sourceType: "csv",
      value: row.normalizedEmail,
    });
  }

  await ensureContactSource(
    createdContact.id,
    `${importRecord.id}:${row.rowNumber}`,
    importRecord.label,
  );

  await db
    .update(importRows)
    .set({
      contactId: createdContact.id,
      status: "created",
      updatedAt: new Date(),
    })
    .where(eq(importRows.id, row.id));
}

async function processImportBatch(importId: string, batchSize = 25) {
  const importRecord = await db.query.imports.findFirst({
    where: eq(imports.id, importId),
  });

  if (!importRecord || !["queued", "processing"].includes(importRecord.status)) {
    return false;
  }

  if (importRecord.status === "queued") {
    await db
      .update(imports)
      .set({
        status: "processing",
        updatedAt: new Date(),
      })
      .where(eq(imports.id, importId));
  }

  const claimedRows = await claimRowsForImport(importId, batchSize);

  if (claimedRows.length === 0) {
    const summary = await refreshImportSummary(importId);

    if (
      summary &&
      (summary.status === "completed" ||
        summary.status === "completed_with_warnings")
    ) {
      await recordAuditEvent({
        entityId: importId,
        entityType: "import",
        eventName: "import.processing_completed",
      });
    }

    return false;
  }

  try {
    const processingImport = await db.query.imports.findFirst({
      where: eq(imports.id, importId),
    });

    for (const row of claimedRows) {
      await applyImportRow(processingImport, row);
    }

    await refreshImportSummary(importId);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Import processing failed.";
    await refreshImportSummary(importId, message);
    await recordAuditEvent({
      entityId: importId,
      entityType: "import",
      eventName: "import.processing_failed",
      metadata: {
        message,
      },
    });
  }

  return true;
}

export async function processNextImportBatch(batchSize = 25) {
  const queuedImportId = await claimQueuedImportId();

  if (queuedImportId) {
    await processImportBatch(queuedImportId, batchSize);
    return true;
  }

  const processingImportId = await findProcessingImportId();

  if (!processingImportId) {
    return false;
  }

  await processImportBatch(processingImportId, batchSize);
  return true;
}

export async function runImportWorker(options?: {
  batchSize?: number;
  logger?: WorkerLogger;
  once?: boolean;
  pollIntervalMs?: number;
}) {
  const batchSize = options?.batchSize ?? 25;
  const logger = options?.logger ?? console;
  const once = options?.once ?? false;
  const pollIntervalMs =
    options?.pollIntervalMs ?? env.IMPORT_WORKER_POLL_INTERVAL_MS;

  logger.info(
    `[kanbun-import-worker] starting (poll=${pollIntervalMs}ms, batch=${batchSize})`,
  );

  for (;;) {
    try {
      const processed = await processNextImportBatch(batchSize);

      if (once) {
        return;
      }

      if (!processed) {
        await sleep(pollIntervalMs);
      }
    } catch (error) {
      logger.error("[kanbun-import-worker] cycle failed", error);

      if (once) {
        throw error;
      }

      await sleep(pollIntervalMs);
    }
  }
}
