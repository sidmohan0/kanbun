import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getImportReport } from "@/lib/imports";

function escapeCsvCell(value: string | null | undefined) {
  const normalized = value ?? "";

  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replaceAll('"', '""')}"`;
  }

  return normalized;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ importId: string }> },
) {
  await requireUser();

  const { importId } = await context.params;
  const { importRecord, rows } = await getImportReport(importId);
  const csv = [
    [
      "row_number",
      "status",
      "proposed_action",
      "name",
      "email",
      "company",
      "title",
      "warnings",
    ].join(","),
    ...rows.map((row) =>
      [
        String(row.rowNumber),
        row.status,
        row.proposedAction,
        escapeCsvCell(row.normalizedName),
        escapeCsvCell(row.normalizedEmail),
        escapeCsvCell(row.normalizedCompany),
        escapeCsvCell(row.normalizedTitle),
        escapeCsvCell(row.warnings.join(" | ")),
      ].join(","),
    ),
  ].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Disposition": `attachment; filename="${importRecord.fileName.replace(/[^a-zA-Z0-9_.-]+/g, "-")}-review-report.csv"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}
