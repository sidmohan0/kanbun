import type { Metadata } from "next";
import { ImportDetailPanel } from "@/components/app/imports/import-detail-panel";
import { ImportHistoryPanel } from "@/components/app/imports/import-history-panel";
import { ImportUploadPanel } from "@/components/app/imports/import-upload-panel";
import { getImportById, listImports, listRowsForImport } from "@/lib/imports";

export const metadata: Metadata = {
  title: "Imports | Kanbun",
  description:
    "Monitor CSV imports, import warnings, and contact ingestion state.",
};

const errorMessages: Record<string, string> = {
  "missing-file": "Choose a CSV file before submitting the import.",
  "missing-import": "Choose an import before confirming it.",
};

export default async function ImportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const importId =
    typeof params.import === "string" ? params.import : undefined;
  const pageParam =
    typeof params.page === "string" ? Number.parseInt(params.page, 10) : 1;
  const selectedPage = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const errorKey = typeof params.error === "string" ? params.error : undefined;
  const queued = params.queued === "1";
  const updated = params.updated === "1";

  const imports = await listImports();
  const selectedImport =
    (importId ? await getImportById(importId) : null) ?? imports[0] ?? null;
  const rowPage = selectedImport
    ? await listRowsForImport(selectedImport.id, selectedPage)
    : null;
  const errorMessage = errorKey
    ? (errorMessages[errorKey] ?? decodeURIComponent(errorKey))
    : null;

  return (
    <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
      <ImportUploadPanel
        errorMessage={errorMessage}
        queued={queued}
        updated={updated}
      />

      <div className="space-y-6">
        <ImportHistoryPanel imports={imports} />
        <ImportDetailPanel rowPage={rowPage} selectedImport={selectedImport} />
      </div>
    </div>
  );
}
