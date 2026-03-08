import {
  confirmCsvImportAction,
  updateCsvImportMappingAction,
} from "@/app/actions/workflows";
import { ImportPagination } from "@/components/app/imports/import-pagination";
import { ImportRowCard } from "@/components/app/imports/import-row-card";
import { DashboardPanel, SectionHeading } from "@/components/app/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  importMappingFieldLabels,
  importMappingFields,
} from "@/lib/import-utils";

type ImportDetailPanelProps = {
  rowPage: {
    page: number;
    pageSize: number;
    rows: Array<{
      contactId: string | null;
      id: string;
      normalizedCompany: string | null;
      normalizedEmail: string | null;
      normalizedName: string | null;
      normalizedTitle: string | null;
      overrideAction: "create" | "flag" | "skip" | "update" | null;
      overrideCompany: string | null;
      overrideEmail: string | null;
      overrideName: string | null;
      overrideTitle: string | null;
      proposedAction: "create" | "flag" | "skip" | "update";
      rowNumber: number;
      status:
        | "created"
        | "flagged"
        | "pending"
        | "processing"
        | "skipped"
        | "updated";
      warnings: string[];
    }>;
    totalPages: number;
    totalRows: number;
  } | null;
  selectedImport: {
    createdCount: number;
    detectedMapping: Record<string, string | null>;
    errorMessage: string | null;
    fileName: string;
    flaggedCount: number;
    headers: string[];
    id: string;
    label: string | null;
    mappingWarnings: string[];
    skippedCount: number;
    status: string;
    totalRows: number;
    unmappedHeaders: string[];
    updatedCount: number;
    warningCount: number;
  } | null;
};

function mappingLabel(label: string) {
  return label
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (value) => value.toUpperCase());
}

function importCtaCopy(status: string) {
  if (status === "queued") {
    return "Queued for worker";
  }

  if (status === "processing") {
    return "Worker running";
  }

  if (status === "failed") {
    return "Retry with worker";
  }

  return "Confirm and queue";
}

function statusVariant(status: string) {
  if (status === "completed") {
    return "secondary";
  }

  if (status === "failed") {
    return "destructive";
  }

  return "outline";
}

export function ImportDetailPanel({
  rowPage,
  selectedImport,
}: ImportDetailPanelProps) {
  const rangeStart =
    rowPage && rowPage.totalRows > 0
      ? (rowPage.page - 1) * rowPage.pageSize + 1
      : 0;
  const rangeEnd =
    rowPage && rowPage.totalRows > 0
      ? Math.min(rowPage.page * rowPage.pageSize, rowPage.totalRows)
      : 0;
  const showWorkerBanner =
    selectedImport?.status === "draft" ||
    selectedImport?.status === "queued" ||
    selectedImport?.status === "processing" ||
    selectedImport?.status === "failed";

  return (
    <DashboardPanel>
      <SectionHeading
        eyebrow="Row audit"
        title={
          selectedImport
            ? (selectedImport.label ?? selectedImport.fileName)
            : "No import selected"
        }
        description="Preview rows show what Kanbun plans to do before confirmation. Completed imports retain the draft decisions, warnings, and row-level outcomes for later audit."
      />
      {selectedImport && rowPage ? (
        <div className="space-y-4">
          {showWorkerBanner ? (
            <div className="rounded-2xl border border-border/85 bg-primary/8 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">
                    {selectedImport.status === "draft"
                      ? "Draft preview ready"
                      : selectedImport.status === "queued"
                        ? "Queued for worker"
                        : selectedImport.status === "processing"
                          ? "Worker processing import"
                          : "Worker failed"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {selectedImport.status === "draft"
                      ? "Review the mapping and row edits, then queue the import for the dedicated worker runtime."
                      : selectedImport.status === "queued"
                        ? "The web app has handed this import off. The worker will claim rows and apply them in batches."
                        : selectedImport.status === "processing"
                          ? "The worker runtime is actively claiming pending rows and writing contacts in the background."
                          : selectedImport.errorMessage ??
                            "Retry the import after adjusting any flagged rows."}
                  </p>
                </div>
                <form action={confirmCsvImportAction}>
                  <input type="hidden" name="importId" value={selectedImport.id} />
                  <Button
                    type="submit"
                    disabled={
                      selectedImport.status === "queued" ||
                      selectedImport.status === "processing"
                    }
                  >
                    {importCtaCopy(selectedImport.status)}
                  </Button>
                </form>
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {[
              ["Rows", String(selectedImport.totalRows)],
              ["Created", String(selectedImport.createdCount)],
              ["Updated", String(selectedImport.updatedCount)],
              ["Flagged", String(selectedImport.flaggedCount)],
              ["Skipped", String(selectedImport.skippedCount)],
              ["Warnings", String(selectedImport.warningCount)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-secondary/65 px-3 py-3">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  {label}
                </p>
                <p className="mt-2 text-2xl font-semibold text-foreground">
                  {value}
                </p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="rounded-2xl border border-border/85 bg-background/75 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                {selectedImport.status === "draft"
                  ? "Draft mapping"
                  : "Detected mapping"}
              </p>
              {selectedImport.status === "draft" ? (
                <form
                  action={updateCsvImportMappingAction}
                  className="mt-3 space-y-3"
                >
                  <input type="hidden" name="importId" value={selectedImport.id} />
                  {importMappingFields.map((field) => (
                    <div key={field} className="space-y-2">
                      <label
                        className="text-sm font-medium text-foreground"
                        htmlFor={`mapping-${field}`}
                      >
                        {importMappingFieldLabels[field]}
                      </label>
                      <select
                        id={`mapping-${field}`}
                        name={`mapping:${field}`}
                        defaultValue={
                          selectedImport.detectedMapping[field] ?? "__none__"
                        }
                        className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground"
                      >
                        <option value="__none__">Not mapped</option>
                        {selectedImport.headers.map((header) => (
                          <option key={header} value={header}>
                            {header}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                  <Button type="submit" variant="outline" className="w-full">
                    Recompute preview
                  </Button>
                </form>
              ) : (
                <div className="mt-3 space-y-2">
                  {Object.entries(selectedImport.detectedMapping).map(
                    ([field, header]) => (
                      <div
                        key={field}
                        className="flex items-center justify-between rounded-xl bg-secondary/65 px-3 py-3 text-sm"
                      >
                        <span>{mappingLabel(field)}</span>
                        <span className="font-medium text-foreground">
                          {header ?? "Not detected"}
                        </span>
                      </div>
                    ),
                  )}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-border/85 bg-background/75 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    File warnings
                  </p>
                  <a
                    href={`/api/imports/${selectedImport.id}/report`}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    Download review report
                  </a>
                </div>
                <div className="mt-3 space-y-2">
                  {selectedImport.mappingWarnings.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No global warnings for this import.
                    </p>
                  ) : (
                    selectedImport.mappingWarnings.map((warning) => (
                      <div
                        key={warning}
                        className="rounded-xl border border-border/80 bg-background px-3 py-3 text-sm"
                      >
                        {warning}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-border/85 bg-background/75 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Unmapped headers
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedImport.unmappedHeaders.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      All headers were consumed by the current mapping.
                    </p>
                  ) : (
                    selectedImport.unmappedHeaders.map((header) => (
                      <Badge key={header} variant="outline">
                        {header}
                      </Badge>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/85 bg-background/75 px-4 py-3">
            <p className="text-sm text-muted-foreground">
              Showing rows {rangeStart}-{rangeEnd} of {rowPage.totalRows}
            </p>
            <Badge variant={statusVariant(selectedImport.status)}>
              {selectedImport.status.replaceAll("_", " ")}
            </Badge>
          </div>

          <div className="space-y-3">
            {rowPage.rows.map((row) => (
              <ImportRowCard
                key={row.id}
                importId={selectedImport.id}
                isDraft={selectedImport.status === "draft"}
                page={rowPage.page}
                row={row}
              />
            ))}
          </div>

          <ImportPagination
            importId={selectedImport.id}
            page={rowPage.page}
            totalPages={rowPage.totalPages}
          />
        </div>
      ) : (
        <div className="rounded-2xl border border-border/85 bg-background/75 px-4 py-4 text-sm text-muted-foreground">
          Select an import after uploading a CSV to inspect row outcomes.
        </div>
      )}
    </DashboardPanel>
  );
}
