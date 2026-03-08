import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { auditEvents, importRows, imports } from "@/db/schema";
import { normalizeEmail, parseCsv } from "@/lib/csv";
import {
  analyzeImportDataset,
  analyzeImportMapping,
  buildImportFileHash,
  detectImportMapping,
  type ImportMapping,
  isImportMappingField,
  isValidEmail,
  mapImportRow,
  sanitizeImportMapping,
  summarizeWarnings,
} from "@/lib/import-utils";
import { findContactIdentityByEmail } from "./contacts";

type ProposedAction = "create" | "flag" | "skip" | "update";
type RowStatus =
  | "created"
  | "flagged"
  | "pending"
  | "processing"
  | "skipped"
  | "updated";
type DraftOverrides = {
  overrideAction: ProposedAction | null;
  overrideCompany: string | null;
  overrideEmail: string | null;
  overrideName: string | null;
  overrideTitle: string | null;
};
type DraftRowInput = DraftOverrides & {
  id?: string;
  rawData: Record<string, unknown>;
  rowNumber: number;
};

function shouldFlagRow(warnings: string[]) {
  return warnings.some(
    (warning) =>
      warning.startsWith("Duplicate email appears") ||
      warning.startsWith("Invalid email format") ||
      warning.startsWith("Manual ") ||
      warning === "Missing both name and email.",
  );
}

function cleanEditableValue(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function hydrateRawRow(headers: string[], rawData: Record<string, unknown>) {
  return headers.map((header) => String(rawData[header] ?? ""));
}

function applyOverridesToMappedRow(
  headers: string[],
  rawData: Record<string, unknown>,
  mapping: ImportMapping,
  overrides: DraftOverrides,
) {
  const mapped = mapImportRow(headers, hydrateRawRow(headers, rawData), mapping);
  const rawEmail = overrides.overrideEmail ?? mapped.rawEmail;
  const displayName = overrides.overrideName ?? mapped.displayName;

  return {
    company: overrides.overrideCompany ?? mapped.company,
    displayName: displayName ?? "",
    email: rawEmail && isValidEmail(rawEmail) ? normalizeEmail(rawEmail) : null,
    rawEmail,
    title: overrides.overrideTitle ?? mapped.title,
  };
}

function applyActionOverride({
  autoAction,
  existingContactId,
  overrideAction,
  warnings,
}: {
  autoAction: Exclude<ProposedAction, "skip">;
  existingContactId: string | null;
  overrideAction: ProposedAction | null;
  warnings: string[];
}) {
  if (!overrideAction) {
    return autoAction;
  }

  if (overrideAction === "skip" || overrideAction === "flag") {
    return overrideAction;
  }

  if (overrideAction === "update") {
    if (existingContactId) {
      return "update";
    }

    warnings.push(
      "Manual update was selected but no matching existing contact was found for this row.",
    );
    return "flag";
  }

  if (existingContactId) {
    warnings.push(
      "Manual create was selected but this row already matches an existing contact. Resolve it as update, flag, or skip.",
    );
    return "flag";
  }

  return "create";
}

function statusForProposedAction(action: ProposedAction): RowStatus {
  if (action === "flag") {
    return "flagged";
  }

  if (action === "skip") {
    return "skipped";
  }

  return "pending";
}

async function recordAuditEvent({
  actorUserId,
  entityId,
  entityType,
  eventName,
  metadata,
}: {
  actorUserId?: string | null;
  entityId: string;
  entityType: string;
  eventName: string;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(auditEvents).values({
    actorUserId: actorUserId ?? null,
    entityId,
    entityType,
    eventName,
    metadata: metadata ?? {},
  });
}

async function buildDraftPreviewRows(
  importRecord: {
    headers: string[];
    id: string;
    label: string | null;
  },
  rows: DraftRowInput[],
  mapping: ImportMapping,
) {
  let createdCount = 0;
  let flaggedCount = 0;
  let skippedCount = 0;
  let updatedCount = 0;
  let warningCount = 0;
  const seenEmails = new Set<string>();
  const identityCache = new Map<
    string,
    Awaited<ReturnType<typeof findContactIdentityByEmail>>
  >();
  const previewRows: Array<{
    rowId?: string;
    values: {
      contactId: string | null;
      normalizedCompany: string | null;
      normalizedEmail: string | null;
      normalizedName: string | null;
      normalizedTitle: string | null;
      proposedAction: ProposedAction;
      status: RowStatus;
      warning: string | null;
      warnings: string[];
    };
  }> = [];

  for (const row of rows) {
    const mapped = applyOverridesToMappedRow(
      importRecord.headers,
      row.rawData,
      mapping,
      row,
    );
    const warnings: string[] = [];

    if (mapped.rawEmail && !mapped.email) {
      warnings.push(`Invalid email format: ${mapped.rawEmail}`);
    }

    if (!mapped.displayName && !mapped.email) {
      warnings.push("Missing both name and email.");
    }

    if (!mapped.displayName && mapped.email) {
      warnings.push("Missing name. Email will be used as the contact label.");
    }

    if (!mapped.email && mapped.displayName) {
      warnings.push(
        "No email provided. Future deduplication for this contact will require review.",
      );
    }

    if (mapped.email && seenEmails.has(mapped.email)) {
      warnings.push(
        "Duplicate email appears multiple times in this CSV. This row was flagged to avoid conflicting updates.",
      );
    }

    if (mapped.email) {
      seenEmails.add(mapped.email);
    }

    let existingIdentity:
      | Awaited<ReturnType<typeof findContactIdentityByEmail>>
      | undefined;

    if (mapped.email) {
      const cachedIdentity = identityCache.get(mapped.email);

      if (cachedIdentity !== undefined) {
        existingIdentity = cachedIdentity;
      } else {
        existingIdentity = await findContactIdentityByEmail(mapped.email);
        identityCache.set(mapped.email, existingIdentity);
      }
    }

    const autoAction: Exclude<ProposedAction, "skip"> = shouldFlagRow(warnings)
      ? "flag"
      : existingIdentity
        ? "update"
        : "create";
    const proposedAction = applyActionOverride({
      autoAction,
      existingContactId: existingIdentity?.contactId ?? null,
      overrideAction: row.overrideAction,
      warnings,
    });

    if (proposedAction === "create") {
      createdCount += 1;
    } else if (proposedAction === "update") {
      updatedCount += 1;
    } else if (proposedAction === "flag") {
      flaggedCount += 1;
    } else {
      skippedCount += 1;
    }

    if (warnings.length > 0) {
      warningCount += 1;
    }

    previewRows.push({
      rowId: row.id,
      values: {
        contactId: existingIdentity?.contactId ?? null,
        normalizedCompany: mapped.company,
        normalizedEmail: mapped.email,
        normalizedName: mapped.displayName || null,
        normalizedTitle: mapped.title,
        proposedAction,
        status: statusForProposedAction(proposedAction),
        warning: summarizeWarnings(warnings),
        warnings,
      },
    });
  }

  return {
    createdCount,
    flaggedCount,
    previewRows,
    skippedCount,
    updatedCount,
    warningCount,
  };
}

async function recomputeImportDraft(
  importRecord: {
    detectedMapping: Record<string, string | null>;
    headers: string[];
    id: string;
    label: string | null;
    status: string;
  },
  actorUserId?: string | null,
  auditMetadata?: Record<string, unknown>,
) {
  if (importRecord.status !== "draft") {
    throw new Error("Only draft imports can be updated.");
  }

  const mapping = sanitizeImportMapping(importRecord.headers, {
    ...importRecord.detectedMapping,
  });
  const mappingAnalysis = analyzeImportMapping(importRecord.headers, mapping);
  const rows = await db.query.importRows.findMany({
    where: eq(importRows.importId, importRecord.id),
    orderBy: [asc(importRows.rowNumber)],
  });
  const datasetAnalysis = analyzeImportDataset(
    importRecord.headers,
    rows.map((row) =>
      hydrateRawRow(importRecord.headers, row.rawData as Record<string, unknown>),
    ),
  );
  const mappingWarnings = [
    ...mappingAnalysis.warnings,
    ...datasetAnalysis.warnings,
  ];
  const preview = await buildDraftPreviewRows(
    {
      headers: importRecord.headers,
      id: importRecord.id,
      label: importRecord.label,
    },
    rows.map((row) => ({
      id: row.id,
      rawData: row.rawData as Record<string, unknown>,
      rowNumber: row.rowNumber,
      overrideAction: row.overrideAction,
      overrideCompany: row.overrideCompany,
      overrideEmail: row.overrideEmail,
      overrideName: row.overrideName,
      overrideTitle: row.overrideTitle,
    })),
    mapping,
  );

  for (const previewRow of preview.previewRows) {
    if (!previewRow.rowId) {
      continue;
    }

    await db
      .update(importRows)
      .set({
        ...previewRow.values,
        updatedAt: new Date(),
      })
      .where(eq(importRows.id, previewRow.rowId));
  }

  await db
    .update(imports)
    .set({
      createdCount: preview.createdCount,
      flaggedCount: preview.flaggedCount,
      mappingWarnings,
      skippedCount: preview.skippedCount,
      unmappedHeaders: mappingAnalysis.unmappedHeaders,
      updatedAt: new Date(),
      updatedCount: preview.updatedCount,
      warningCount: preview.warningCount,
    })
    .where(eq(imports.id, importRecord.id));

  await recordAuditEvent({
    actorUserId,
    entityId: importRecord.id,
    entityType: "import",
    eventName: "import.draft_recomputed",
    metadata: auditMetadata,
  });

  return importRecord.id;
}

export async function listImports() {
  return db.query.imports.findMany({
    limit: 10,
    orderBy: [desc(imports.createdAt)],
  });
}

export async function getImportById(importId: string) {
  return db.query.imports.findFirst({
    where: eq(imports.id, importId),
  });
}

export async function listRowsForImport(
  importId: string,
  page = 1,
  pageSize = 20,
) {
  const totalRecord = await db.query.imports.findFirst({
    columns: {
      totalRows: true,
    },
    where: eq(imports.id, importId),
  });
  const totalRows = totalRecord?.totalRows ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const rows = await db.query.importRows.findMany({
    where: eq(importRows.importId, importId),
    orderBy: [asc(importRows.rowNumber)],
    limit: pageSize,
    offset: (safePage - 1) * pageSize,
  });

  return {
    page: safePage,
    pageSize,
    rows,
    totalPages,
    totalRows,
  };
}

export async function getImportReport(importId: string) {
  const importRecord = await db.query.imports.findFirst({
    where: eq(imports.id, importId),
  });

  if (!importRecord) {
    throw new Error("Import not found.");
  }

  const rows = await db.query.importRows.findMany({
    where: eq(importRows.importId, importId),
    orderBy: [asc(importRows.rowNumber)],
  });

  return {
    importRecord,
    rows: rows.filter(
      (row) =>
        row.warnings.length > 0 ||
        row.status === "flagged" ||
        row.status === "processing",
    ),
  };
}

export async function createImportPreviewFromCsv(
  file: File,
  label?: string | null,
  actorUserId?: string | null,
) {
  const csvText = await file.text();
  const parsed = parseCsv(csvText);

  if (parsed.length <= 1) {
    throw new Error(
      "The CSV must include a header row and at least one data row.",
    );
  }

  const fileHash = buildImportFileHash(csvText);
  const existingImport = await db.query.imports.findFirst({
    where: eq(imports.fileHash, fileHash),
  });

  if (existingImport) {
    return existingImport.id;
  }

  const [headers, ...rows] = parsed;
  const {
    mapping,
    unmappedHeaders,
    warnings: detectedMappingWarnings,
  } = detectImportMapping(headers);
  const datasetWarnings = analyzeImportDataset(headers, rows);
  const mappingWarnings = [
    ...detectedMappingWarnings,
    ...datasetWarnings.warnings,
  ];

  const [importRecord] = await db
    .insert(imports)
    .values({
      detectedMapping: mapping,
      fileHash,
      fileName: file.name || "contacts.csv",
      headers,
      label: label?.trim() || file.name || "CSV import",
      mappingWarnings,
      status: "draft",
      totalRows: rows.length,
      unmappedHeaders,
    })
    .returning();

  const previewSeedRows = rows.map((row, index) => ({
    overrideAction: null,
    overrideCompany: null,
    overrideEmail: null,
    overrideName: null,
    overrideTitle: null,
    rawData: Object.fromEntries(
      headers.map((header, headerIndex) => [header, row[headerIndex] ?? ""]),
    ),
    rowNumber: index + 2,
  }));
  const preview = await buildDraftPreviewRows(
    {
      headers,
      id: importRecord.id,
      label: importRecord.label,
    },
    previewSeedRows,
    mapping,
  );

  for (const [index, row] of previewSeedRows.entries()) {
    const previewRow = preview.previewRows[index];

    await db.insert(importRows).values({
      ...previewRow.values,
      importId: importRecord.id,
      overrideAction: row.overrideAction,
      overrideCompany: row.overrideCompany,
      overrideEmail: row.overrideEmail,
      overrideName: row.overrideName,
      overrideTitle: row.overrideTitle,
      rawData: row.rawData,
      rowNumber: row.rowNumber,
    });
  }

  await db
    .update(imports)
    .set({
      createdCount: preview.createdCount,
      flaggedCount: preview.flaggedCount,
      skippedCount: preview.skippedCount,
      updatedAt: new Date(),
      updatedCount: preview.updatedCount,
      warningCount: preview.warningCount,
    })
    .where(eq(imports.id, importRecord.id));

  await recordAuditEvent({
    actorUserId,
    entityId: importRecord.id,
    entityType: "import",
    eventName: "import.preview_created",
    metadata: {
      fileName: importRecord.fileName,
      totalRows: importRecord.totalRows,
    },
  });

  revalidatePath("/");
  revalidatePath("/imports");

  return importRecord.id;
}

export async function updateImportDraftMapping(
  importId: string,
  overrides: Partial<Record<string, string>>,
  actorUserId?: string | null,
) {
  const importRecord = await db.query.imports.findFirst({
    where: eq(imports.id, importId),
  });

  if (!importRecord) {
    throw new Error("Import not found.");
  }

  if (importRecord.status !== "draft") {
    throw new Error("Only draft imports can be remapped.");
  }

  const nextOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([field]) => isImportMappingField(field)),
  );
  const mapping = sanitizeImportMapping(importRecord.headers, nextOverrides);

  await db
    .update(imports)
    .set({
      detectedMapping: mapping,
      updatedAt: new Date(),
    })
    .where(eq(imports.id, importId));

  await recomputeImportDraft(
    {
      ...importRecord,
      detectedMapping: mapping,
    },
    actorUserId,
    {
      operation: "mapping_update",
    },
  );

  revalidatePath("/imports");
  return importRecord.id;
}

export async function updateImportDraftRow(
  importId: string,
  rowId: string,
  input: Partial<{
    action: ProposedAction | "__auto__";
    company: string;
    email: string;
    name: string;
    title: string;
  }>,
  actorUserId?: string | null,
) {
  const importRecord = await db.query.imports.findFirst({
    where: eq(imports.id, importId),
  });

  if (!importRecord) {
    throw new Error("Import not found.");
  }

  if (importRecord.status !== "draft") {
    throw new Error("Only draft imports can be edited.");
  }

  const row = await db.query.importRows.findFirst({
    where: and(eq(importRows.id, rowId), eq(importRows.importId, importId)),
  });

  if (!row) {
    throw new Error("Import row not found.");
  }

  await db
    .update(importRows)
    .set({
      overrideAction:
        input.action && input.action !== "__auto__" ? input.action : null,
      overrideCompany: cleanEditableValue(input.company),
      overrideEmail: cleanEditableValue(input.email),
      overrideName: cleanEditableValue(input.name),
      overrideTitle: cleanEditableValue(input.title),
      updatedAt: new Date(),
    })
    .where(eq(importRows.id, row.id));

  await recomputeImportDraft(importRecord, actorUserId, {
    operation: "row_update",
    rowId,
    rowNumber: row.rowNumber,
  });

  revalidatePath("/imports");
  return importRecord.id;
}

export async function confirmImport(
  importId: string,
  actorUserId?: string | null,
) {
  const importRecord = await db.query.imports.findFirst({
    where: eq(imports.id, importId),
  });

  if (!importRecord) {
    throw new Error("Import not found.");
  }

  if (
    importRecord.status === "completed" ||
    importRecord.status === "completed_with_warnings" ||
    importRecord.status === "queued" ||
    importRecord.status === "processing"
  ) {
    return importRecord.id;
  }

  await db
    .update(imports)
    .set({
      errorMessage: null,
      status: "queued",
      updatedAt: new Date(),
    })
    .where(eq(imports.id, importId));

  await recordAuditEvent({
    actorUserId,
    entityId: importId,
    entityType: "import",
    eventName: "import.processing_queued",
  });

  revalidatePath("/imports");

  return importId;
}
