import Link from "next/link";
import { DashboardPanel, SectionHeading } from "@/components/app/ui";
import { Badge } from "@/components/ui/badge";

type ImportHistoryItem = {
  createdCount: number;
  fileName: string;
  flaggedCount: number;
  id: string;
  label: string | null;
  skippedCount: number;
  status: string;
  totalRows: number;
  updatedCount: number;
  warningCount: number;
};

function statusVariant(status: string) {
  if (status === "completed") {
    return "secondary";
  }

  if (status === "draft") {
    return "default";
  }

  if (status === "failed") {
    return "destructive";
  }

  return "outline";
}

export function ImportHistoryPanel({
  imports,
}: {
  imports: ImportHistoryItem[];
}) {
  return (
    <DashboardPanel>
      <SectionHeading
        eyebrow="Recent runs"
        title="Import history"
        description="Duplicate file uploads resolve to the existing import so review work stays attached to one canonical run."
      />
      {imports.length === 0 ? (
        <div className="rounded-2xl border border-border/85 bg-background/75 px-4 py-4 text-sm text-muted-foreground">
          No imports yet. Upload a CSV to create the first contact records.
        </div>
      ) : (
        <div className="space-y-3">
          {imports.map((item) => (
            <Link
              key={item.id}
              href={`/imports?import=${item.id}&page=1`}
              className="flex items-center justify-between rounded-2xl border border-border/85 bg-background/75 px-4 py-4 transition-colors hover:border-primary/30"
            >
              <div className="space-y-1">
                <span className="text-sm font-semibold text-foreground">
                  {item.label ?? item.fileName}
                </span>
                <p className="text-sm text-muted-foreground">
                  {item.totalRows} rows · {item.createdCount} created ·{" "}
                  {item.updatedCount} updated · {item.flaggedCount} flagged ·{" "}
                  {item.skippedCount} skipped · {item.warningCount} warnings
                </p>
              </div>
              <Badge variant={statusVariant(item.status)}>
                {item.status.replaceAll("_", " ")}
              </Badge>
            </Link>
          ))}
        </div>
      )}
    </DashboardPanel>
  );
}
